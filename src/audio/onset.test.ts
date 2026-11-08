import { describe, it, expect, afterEach } from 'vitest';
import {
  OnsetDetector,
  spectralFlux,
  setBeatSensitivity,
  getBeatSensitivity,
  triggerRatioForSensitivity,
  DEFAULT_BEAT_SENSITIVITY,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_RELEASE_RATIO,
  DEFAULT_FLUX_FLOOR,
} from './onset';

const STEP_SEC = 0.01;

function collectBeats(detector: OnsetDetector, fluxAt: (i: number) => number, steps: number): number[] {
  const beats: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    const time = i * STEP_SEC;
    const { beat } = detector.step(fluxAt(i), time);
    if (beat) beats.push(time);
  }
  return beats;
}

describe('spectralFlux', () => {
  it('averages only positive differences inside the range', () => {
    const prev = Float32Array.from([0, 0.2, 0.4, 0.1]);
    const curr = Float32Array.from([0.5, 0.1, 0.8, 0.3]);

    // Bins 0..3: +0.5, -0.1, +0.4, +0.2 -> negatives are ignored.
    expect(spectralFlux(prev, curr, 0, 3)).toBeCloseTo(1.1 / 4);
  });

  it('includes both range endpoints and ignores bins outside it', () => {
    const prev = Float32Array.from([0, 0.1, 0.1, 0.1, 0.1]);
    const curr = Float32Array.from([9, 0.3, 0.2, 0.6, 9]);

    // Bins 1..3: +0.2, +0.1, +0.5.
    expect(spectralFlux(prev, curr, 1, 3)).toBeCloseTo(0.8 / 3);
  });

  it('returns zero for silence, an empty range, or empty arrays', () => {
    expect(spectralFlux(new Float32Array(4), new Float32Array(4), 0, 3)).toBe(0);
    expect(spectralFlux(Float32Array.from([1]), Float32Array.from([2]), 2, 3)).toBe(0);
    expect(spectralFlux(new Float32Array(0), new Float32Array(0), 0, 0)).toBe(0);
  });

  it('clamps an upper bound past the end of the arrays', () => {
    const prev = Float32Array.from([0, 0]);
    const curr = Float32Array.from([0.4, 0.5]);

    expect(spectralFlux(prev, curr, 0, 99)).toBeCloseTo(0.9 / 2);
  });
});

describe('OnsetDetector', () => {
  it('fires exactly once for each spike in a 500 ms pulse train', () => {
    const detector = new OnsetDetector();
    const spikePeriodSteps = 50; // 500 ms at 10 ms resolution
    const steps = 301; // 0..3 s inclusive

    const beats = collectBeats(
      detector,
      (i) => (i > 0 && i % spikePeriodSteps === 0 ? 1 : 0.1),
      steps,
    );

    const expected = [50, 100, 150, 200, 250, 300].map((i) => i * STEP_SEC);
    expect(beats).toHaveLength(expected.length);
    beats.forEach((time, index) => {
      expect(time).toBeCloseTo(expected[index] ?? -1);
    });
  });

  it('never fires on a constant flux after warm-up', () => {
    const detector = new OnsetDetector();
    const beats = collectBeats(detector, () => 0.5, 200);

    expect(beats).toHaveLength(0);
  });

  it('fires only once for spikes 200 ms apart (220 ms cooldown)', () => {
    const detector = new OnsetDetector();
    // Spikes 200 ms apart (i = 50 and i = 70 at 10 ms steps):
    // 220 ms refractory cooldown rejects the second spike.
    const beats = collectBeats(
      detector,
      (i) => (i === 50 || i === 70 ? 1 : 0.1),
      150,
    );

    expect(beats).toHaveLength(1);
    expect(beats[0]).toBeCloseTo(0.5);
  });

  it('fires again once the 220 ms cooldown has elapsed (250 ms apart)', () => {
    const detector = new OnsetDetector();
    const beats = collectBeats(
      detector,
      (i) => (i === 50 || i === 75 ? 1 : 0.1), // 250 ms apart (> 220 ms)
      150,
    );

    expect(beats).toHaveLength(2);
  });

  it('never fires on zero flux', () => {
    const detector = new OnsetDetector();
    const beats = collectBeats(detector, () => 0, 200);

    expect(beats).toHaveLength(0);
  });

  it('reports strength relative to the trigger threshold', () => {
    const detector = new OnsetDetector({ triggerRatio: 1 });
    const first = detector.step(1, 0);
    const second = detector.step(1.5, 1);

    expect(first.beat).toBe(false);
    expect(second.beat).toBe(true);
    expect(second.strength).toBeCloseTo(0.5);
  });

  it('can be reset and run again', () => {
    const detector = new OnsetDetector();
    const sequence = [
      { flux: 0.1, time: 0 },
      { flux: 1, time: 0.5 },
    ];

    for (const point of sequence) detector.step(point.flux, point.time);
    detector.reset();

    const afterReset = sequence.map((point) => detector.step(point.flux, point.time));
    expect(afterReset[1]?.beat).toBe(true);
  });
});

describe("OnsetDetector noise floor", () => {
  it("never fires on near-silent jittery flux", () => {
    const d = new OnsetDetector();
    let beats = 0;
    for (let i = 0; i < 600; i++) {
      const flux = 1e-4 * (1 + 0.4 * Math.sin(i * 1.7));
      if (d.step(flux, i / 60).beat) beats++;
    }
    expect(beats).toBe(0);
  });
});

describe('beat sensitivity', () => {
  afterEach(() => {
    setBeatSensitivity(DEFAULT_BEAT_SENSITIVITY);
  });

  it('maps known sensitivity points to trigger ratios', () => {
    expect(triggerRatioForSensitivity(0)).toBeCloseTo(2.0);
    expect(triggerRatioForSensitivity(0.5)).toBeCloseTo(1.3);
    expect(triggerRatioForSensitivity(1)).toBeCloseTo(1.05);
  });

  it('is monotonic non-increasing across 0..1', () => {
    let previous = Infinity;
    for (let i = 0; i <= 10; i += 1) {
      const ratio = triggerRatioForSensitivity(i / 10);
      expect(ratio).toBeLessThanOrEqual(previous);
      previous = ratio;
    }
  });

  it('clamps out-of-range sensitivity inputs', () => {
    expect(triggerRatioForSensitivity(-5)).toBeCloseTo(2.0);
    expect(triggerRatioForSensitivity(5)).toBeCloseTo(1.05);
  });

  it('clamps stored sensitivity and resets non-finite input to the default', () => {
    setBeatSensitivity(2);
    expect(getBeatSensitivity()).toBe(1);
    setBeatSensitivity(-1);
    expect(getBeatSensitivity()).toBe(0);
    setBeatSensitivity(Number.NaN);
    expect(getBeatSensitivity()).toBe(DEFAULT_BEAT_SENSITIVITY);
  });

  it('fires on fewer events at sensitivity 0 than at sensitivity 1', () => {
    // Steady baseline 0.1 with periodic 1.2x bumps: fires at ratio 1.05, not at 2.0.
    const fluxAt = (i: number) => (i > 0 && i % 50 === 0 ? 0.12 : 0.1);

    setBeatSensitivity(0);
    const atZero = collectBeats(new OnsetDetector(), fluxAt, 301).length;

    setBeatSensitivity(1);
    const atOne = collectBeats(new OnsetDetector(), fluxAt, 301).length;

    expect(atZero).toBe(0);
    expect(atOne).toBeGreaterThan(atZero);
  });

  it('default sensitivity reproduces the fixed 1.3 trigger ratio', () => {
    setBeatSensitivity(DEFAULT_BEAT_SENSITIVITY);
    // Deterministic pseudo-random flux with bursts.
    const fluxAt = (i: number) => 0.1 + 0.15 * Math.abs(Math.sin(i * 0.37)) ** 6;

    const defaultBeats = collectBeats(new OnsetDetector(), fluxAt, 600);
    const fixedBeats = collectBeats(new OnsetDetector({ triggerRatio: 1.3 }), fluxAt, 600);

    expect(defaultBeats.length).toBeGreaterThan(0);
    expect(defaultBeats).toEqual(fixedBeats);
  });
});

describe("spectralFlux is a per-bin mean", () => {
  it("gives the same value for one bin or many bins with the same rise", () => {
    const prev = new Float32Array(8);
    const curr = new Float32Array(8).fill(0.5);
    expect(spectralFlux(prev, curr, 0, 0)).toBeCloseTo(0.5);
    expect(spectralFlux(prev, curr, 0, 7)).toBeCloseTo(0.5);
  });
});

describe("Slice 7.44 OnsetDetector contracts", () => {
  it("exports rock-solid default constants", () => {
    expect(DEFAULT_COOLDOWN_MS).toBe(220);
    expect(DEFAULT_RELEASE_RATIO).toBe(0.95);
    expect(DEFAULT_FLUX_FLOOR).toBe(0.035);
  });

  it("requires flux to fall below 0.95 * baseline to re-arm", () => {
    const d = new OnsetDetector({ triggerRatio: 1.2, releaseRatio: 0.95, fluxFloor: 0.035, cooldownMs: 0 });
    // Baseline sample
    d.step(0.1, 0.0);
    // Trigger spike at t=0.01: flux 0.2 > 0.1 * 1.2
    const first = d.step(0.2, 0.01);
    expect(first.beat).toBe(true);

    // Flux drops back to 0.105 (above 0.95 * mean ~ 0.098): not re-armed yet
    const intermediate = d.step(0.105, 0.02);
    expect(intermediate.beat).toBe(false);

    // Another spike before dipping below 0.95 * mean: should NOT fire
    const premature = d.step(0.25, 0.03);
    expect(premature.beat).toBe(false);

    // Flux drops below baseline * 0.95 (e.g. 0.05) -> re-arms
    d.step(0.05, 0.04);

    // Now a new spike can fire
    const second = d.step(0.2, 0.05);
    expect(second.beat).toBe(true);
  });
});
