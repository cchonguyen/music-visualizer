import { describe, it, expect, vi } from "vitest";
import { BandSplitter } from "./bandWaveforms";
import { FrameBuilder, loudnessFromWaveform } from "./frameBuilder";
import { binForFrequency } from "./bands";

const SAMPLE_RATE = 48000;
const FFT_SIZE = 4096;
const BIN_COUNT = FFT_SIZE / 2;
const STEP_SEC = 1 / 60;

const silentWaveform = new Float32Array(FFT_SIZE);

function emptySpectrum(): Uint8Array {
  return new Uint8Array(BIN_COUNT);
}

/** All analyzer bytes in a frequency range set to full scale. */
function spectrumRange(loHz: number, hiHz: number): Uint8Array {
  const spectrum = emptySpectrum();
  const start = binForFrequency(loHz, SAMPLE_RATE, FFT_SIZE);
  const end = Math.min(
    BIN_COUNT,
    Math.max(0, Math.round((hiHz * FFT_SIZE) / SAMPLE_RATE)),
  );
  for (let i = start; i < end; i += 1) {
    spectrum[i] = 255;
  }
  return spectrum;
}

function kickSpectrum(): Uint8Array {
  return spectrumRange(20, 120);
}

function toneSpectrum(hz: number): Uint8Array {
  const spectrum = emptySpectrum();
  spectrum[binForFrequency(hz, SAMPLE_RATE, FFT_SIZE)] = 255;
  return spectrum;
}

describe("FrameBuilder beats", () => {
  it("fires beat only on the frames with a fake kick every 0.5 s", () => {
    const builder = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    const expectedBeatFrames: number[] = [];
    const actualBeatFrames: number[] = [];

    // 3 seconds at 60 fps; a kick lands every 30th frame (0.5 s).
    for (let i = 0; i < 180; i += 1) {
      const isKick = i > 0 && i % 30 === 0;
      if (isKick) expectedBeatFrames.push(i);

      const frame = builder.build(
        i * STEP_SEC,
        isKick ? kickSpectrum() : emptySpectrum(),
        silentWaveform,
      );

      if (frame.beat) actualBeatFrames.push(i);
      // The convenience flag must always mirror the sub-band flag.
      expect(frame.beat).toBe(frame.beatByBand.sub);
      expect(frame.flux).toBe(frame.fluxByBand.sub);
    }

    expect(actualBeatFrames).toEqual(expectedBeatFrames);
  });

  it("treats a steady 2 kHz tone as mid-band energy with no sub beats", () => {
    const builder = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    const spectrum = toneSpectrum(2000);

    for (let i = 0; i < 120; i += 1) {
      const frame = builder.build(i * STEP_SEC, spectrum, silentWaveform);

      expect(frame.raw.sub).toBeLessThan(0.001);
      expect(frame.raw.sub).toBeCloseTo(0, 6);
      expect(frame.raw.mid).toBeGreaterThan(0);
      expect(frame.beat).toBe(false);
      expect(frame.beatByBand.sub).toBe(false);
      expect(frame.beatByBand.mid).toBe(false);
      expect(frame.beatByBand.high).toBe(false);
      expect(frame.beatStrength).toBe(0);
    }
  });

  it("reports zero energy and no beats for silence", () => {
    const builder = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    const spectrum = emptySpectrum();

    for (let i = 0; i < 120; i += 1) {
      const frame = builder.build(i * STEP_SEC, spectrum, new Float32Array(FFT_SIZE));

      expect(frame.energy).toBe(0);
      expect(frame.beat).toBe(false);
      expect(frame.beatByBand).toEqual({ sub: false, mid: false, high: false });
      expect(frame.flux).toBe(0);
    }
  });
});

describe("FrameBuilder time handling", () => {
  it("clamps a 5 s time jump so envelopes stay inside 0..1", () => {
    const builder = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    const kick = kickSpectrum();

    builder.build(0, kick, silentWaveform);
    builder.build(STEP_SEC, kick, silentWaveform);

    const frame = builder.build(STEP_SEC + 5, kick, silentWaveform);

    expect(frame.dtSec).toBeCloseTo(0.1);
    for (const value of [
      frame.env.sub,
      frame.env.mid,
      frame.env.high,
      frame.norm.sub,
      frame.norm.mid,
      frame.norm.high,
      frame.energy,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("treats a seek-back as dt 0 instead of a negative step", () => {
    const builder = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    const kick = kickSpectrum();

    builder.build(10, kick, silentWaveform);
    const frame = builder.build(3, kick, silentWaveform);

    expect(frame.dtSec).toBe(0);
  });

  it("starts at frame 0 with dt 0 after reset and reuses its output arrays", () => {
    const builder = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);

    const first = builder.build(0, kickSpectrum(), silentWaveform);
    const firstWaveform = first.waveform;
    const firstSpectrum = first.spectrum;

    expect(first.frameIndex).toBe(0);
    expect(first.dtSec).toBe(0);

    const second = builder.build(STEP_SEC, kickSpectrum(), silentWaveform);
    expect(second.frameIndex).toBe(1);
    expect(second.waveform).toBe(firstWaveform);
    expect(second.spectrum).toBe(firstSpectrum);

    builder.reset();
    const afterReset = builder.build(20, kickSpectrum(), silentWaveform);

    expect(afterReset.frameIndex).toBe(0);
    expect(afterReset.dtSec).toBe(0);
    expect(afterReset.beat).toBe(false);
    expect(afterReset.energy).toBeGreaterThanOrEqual(0);
  });
});

describe("FrameBuilder band waveforms", () => {
  it("fills sub, mid and high waveforms of FFT_SIZE, with mid louder than sub for a 2 kHz tone", () => {
    const builder = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    const wave = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i += 1) {
      wave[i] = 0.5 * Math.sin((2 * Math.PI * 2000 * i) / SAMPLE_RATE);
    }

    const frame = builder.build(0, toneSpectrum(2000), wave);

    expect(frame.bandWaveforms.sub.length).toBe(FFT_SIZE);
    expect(frame.bandWaveforms.mid.length).toBe(FFT_SIZE);
    expect(frame.bandWaveforms.high.length).toBe(FFT_SIZE);

    const rmsOf = (w: Float32Array) => {
      let sum = 0;
      for (let i = 0; i < w.length; i += 1) sum += (w[i] ?? 0) ** 2;
      return Math.sqrt(sum / w.length);
    };
    expect(rmsOf(frame.bandWaveforms.mid)).toBeGreaterThan(rmsOf(frame.bandWaveforms.sub));
  });
});

describe("Council round 2 checks", () => {
  const SR = 48000, FFT = 4096;
  const sine = (hz: number, amp: number) => {
    const w = new Float32Array(FFT);
    for (let i = 0; i < FFT; i++) w[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
    return w;
  };

  it("ignores a maxed DC bin (bin 0) in the sub band", () => {
    const fb = new FrameBuilder(SR, FFT);
    const spec = new Uint8Array(FFT / 2);
    spec[0] = 255;
    let f = fb.build(0, spec, new Float32Array(FFT));
    for (let i = 1; i < 30; i++) f = fb.build(i / 60, spec, new Float32Array(FFT));
    expect(f.raw.sub).toBe(0);
    expect(f.beat).toBe(false);
  });

  it("a narrow 600 Hz tone reads as loud, not diluted by silent bins", () => {
    const fb = new FrameBuilder(SR, FFT);
    const spec = new Uint8Array(FFT / 2);
    spec[51] = 255; // one bin near 600 Hz
    const wave = sine(600, 0.5); // about -9 dBFS RMS
    let f = fb.build(0, spec, wave);
    for (let i = 1; i < 60; i++) f = fb.build(i / 60, spec, wave);
    expect(f.raw.mid).toBeLessThan(0.05); // the band mean IS diluted...
    expect(f.loudness).toBeGreaterThan(0.85); // ...but RMS loudness is not
    expect(f.energy).toBeGreaterThan(0.5);
  });

  it("loudness is absolute: a quieter sine reads lower", () => {
    expect(loudnessFromWaveform(sine(1000, 0.05))).toBeLessThan(loudnessFromWaveform(sine(1000, 0.5)));
    expect(loudnessFromWaveform(new Float32Array(FFT))).toBe(0);
  });
});

describe("FrameBuilder kickEnv and kickPulse (Slice 7.10)", () => {
  it("kickPulse fires for a single frame on beat, and kickEnv decays frame-rate independently", () => {
    const builder = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);

    // Frame 0: silence baseline
    const f0 = builder.build(0, emptySpectrum(), silentWaveform);
    expect(f0.kickPulse).toBe(false);
    expect(f0.kickEnv).toBe(0);

    // Run until a kick fires at frame 30
    let kickFrameIndex = -1;
    for (let i = 1; i <= 35; i++) {
      const isKick = i === 30;
      const f = builder.build(
        i * STEP_SEC,
        isKick ? kickSpectrum() : emptySpectrum(),
        silentWaveform,
      );
      if (f.beatByBand.sub) {
        kickFrameIndex = i;
        expect(f.kickPulse).toBe(true);
        expect(f.kickEnv).toBe(1.0);
      } else if (kickFrameIndex > 0 && i === kickFrameIndex + 1) {
        // Single-frame edge behavior: kickPulse immediately returns to false
        expect(f.kickPulse).toBe(false);
        // Frame-rate independent decay: after 1 frame at 60 fps (dt = 1/60), kickEnv = 0.88^1
        expect(f.kickEnv).toBeCloseTo(0.88, 4);
      } else if (kickFrameIndex > 0 && i === kickFrameIndex + 2) {
        expect(f.kickPulse).toBe(false);
        // After 2 frames at 60 fps, kickEnv = 0.88^2 = 0.7744
        expect(f.kickEnv).toBeCloseTo(0.88 ** 2, 4);
      }
    }
    expect(kickFrameIndex).toBe(30);
  });

  it("decays kickEnv identically for 2 steps at 60fps vs 1 step at 30fps", () => {
    // Builder A: 60 fps (dt = 1/60)
    const fbA = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    fbA.build(0, emptySpectrum(), silentWaveform);
    for (let i = 1; i < 30; i++) fbA.build(i * (1 / 60), emptySpectrum(), silentWaveform);
    // Kick at frame 30
    const fKickA = fbA.build(30 * (1 / 60), kickSpectrum(), silentWaveform);
    expect(fKickA.kickPulse).toBe(true);
    expect(fKickA.kickEnv).toBe(1.0);

    // 2 subsequent frames at 60 fps (dt = 1/60)
    fbA.build(31 * (1 / 60), emptySpectrum(), silentWaveform);
    const fA = fbA.build(32 * (1 / 60), emptySpectrum(), silentWaveform);

    // Builder B: same kick, then 1 step at 30 fps (dt = 2/60 = 1/30)
    const fbB = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    fbB.build(0, emptySpectrum(), silentWaveform);
    for (let i = 1; i < 30; i++) fbB.build(i * (1 / 60), emptySpectrum(), silentWaveform);
    const fKickB = fbB.build(30 * (1 / 60), kickSpectrum(), silentWaveform);
    expect(fKickB.kickPulse).toBe(true);

    const fB = fbB.build(30 * (1 / 60) + 2 / 60, emptySpectrum(), silentWaveform);

    expect(fA.kickEnv).toBeCloseTo(fB.kickEnv, 5);
    expect(fA.kickEnv).toBeCloseTo(0.88 ** 2, 4);
  });

  it("reset clears kickEnv and kickPulse", () => {
    const builder = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    builder.build(0, emptySpectrum(), silentWaveform);
    for (let i = 1; i < 30; i++) builder.build(i * STEP_SEC, emptySpectrum(), silentWaveform);
    const fKick = builder.build(30 * STEP_SEC, kickSpectrum(), silentWaveform);
    expect(fKick.kickPulse).toBe(true);
    expect(fKick.kickEnv).toBe(1.0);

    builder.reset();
    const fAfter = builder.build(0, emptySpectrum(), silentWaveform);
    expect(fAfter.kickPulse).toBe(false);
    expect(fAfter.kickEnv).toBe(0);
  });

  it("snaps kickEnv cleanly to 0.0 after decay drops below 0.01", () => {
    const builder = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    builder.build(0, emptySpectrum(), silentWaveform);
    for (let i = 1; i < 30; i++) builder.build(i * STEP_SEC, emptySpectrum(), silentWaveform);
    const fKick = builder.build(30 * STEP_SEC, kickSpectrum(), silentWaveform);
    expect(fKick.kickPulse).toBe(true);
    expect(fKick.kickEnv).toBe(1.0);

    // After ~40 silent frames at 60fps (0.88^40 ~ 0.0058 < 0.01), kickEnv must snap to exact 0.0
    let fDecay = fKick;
    for (let i = 31; i <= 80; i++) {
      fDecay = builder.build(i * STEP_SEC, emptySpectrum(), silentWaveform);
    }
    expect(fDecay.kickEnv).toBe(0.0);
    expect(fDecay.kickPulse).toBe(false);
  });
});

describe("Slice 7.44 rock-solid kick & beat detection gating", () => {
  it("rejects sub beats when raw sub is below 0.08 even if flux rises", () => {
    const builder = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    builder.build(0, emptySpectrum(), silentWaveform);

    // Provide a faint sub signal (e.g. byte 10 out of 255 -> 10/255 ~ 0.039 < 0.08)
    const faintSub = emptySpectrum();
    const start = binForFrequency(20, SAMPLE_RATE, FFT_SIZE);
    const end = Math.min(BIN_COUNT, Math.round((120 * FFT_SIZE) / SAMPLE_RATE));
    for (let i = start; i < end; i++) faintSub[i] = 10;

    for (let i = 1; i < 30; i++) builder.build(i * STEP_SEC, emptySpectrum(), silentWaveform);
    const frame = builder.build(30 * STEP_SEC, faintSub, silentWaveform);

    expect(frame.raw.sub).toBeLessThan(0.08);
    expect(frame.beat).toBe(false);
    expect(frame.beatByBand.sub).toBe(false);
    expect(frame.kickPulse).toBe(false);
  });

  it("enforces 220ms refractory cooldown between kick pulses", () => {
    const builder = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    builder.build(0, emptySpectrum(), silentWaveform);
    for (let i = 1; i < 30; i++) builder.build(i * STEP_SEC, emptySpectrum(), silentWaveform);

    // First kick at frame 30 (0.50 s)
    const f1 = builder.build(30 * STEP_SEC, kickSpectrum(), silentWaveform);
    expect(f1.beat).toBe(true);
    expect(f1.kickPulse).toBe(true);

    // Empty spectrum on frame 31
    builder.build(31 * STEP_SEC, emptySpectrum(), silentWaveform);

    // Second kick at frame 39 (0.65 s, 150 ms later — within 220 ms cooldown)
    const f2 = builder.build(39 * STEP_SEC, kickSpectrum(), silentWaveform);
    expect(f2.beat).toBe(false);
    expect(f2.kickPulse).toBe(false);

    // Empty spectrum on frame 40
    builder.build(40 * STEP_SEC, emptySpectrum(), silentWaveform);

    // Third kick at frame 46 (0.766 s, > 266 ms after frame 30 — past 220 ms cooldown)
    const f3 = builder.build(46 * STEP_SEC, kickSpectrum(), silentWaveform);
    expect(f3.beat).toBe(true);
    expect(f3.kickPulse).toBe(true);
  });
});

describe("FrameBuilder band waveforms on demand (Slice 16.9)", () => {
  function sine(freq: number): Float32Array {
    const w = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i += 1) w[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
    return w;
  }

  it("does not split the waveform when nothing reads the bands", () => {
    const split = vi.spyOn(BandSplitter.prototype, "split");
    const b = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    for (let i = 0; i < 5; i += 1) b.build(i * STEP_SEC, kickSpectrum(), sine(60));
    expect(split).not.toHaveBeenCalled();
    split.mockRestore();
  });

  it("splits once per frame on first read, and again after the next build", () => {
    const split = vi.spyOn(BandSplitter.prototype, "split");
    const b = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    const f1 = b.build(0, kickSpectrum(), sine(60));
    void f1.bandWaveforms.sub;
    void f1.bandWaveforms.mid;
    expect(split).toHaveBeenCalledTimes(1);
    const f2 = b.build(STEP_SEC, kickSpectrum(), sine(60));
    void f2.bandWaveforms.high;
    expect(split).toHaveBeenCalledTimes(2);
    split.mockRestore();
  });

  it("gives the same arrays as an eager split would", () => {
    const wave = sine(1000);
    const lazy = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    const frame = lazy.build(0, emptySpectrum(), wave);
    const expected = { sub: new Float32Array(FFT_SIZE), mid: new Float32Array(FFT_SIZE), high: new Float32Array(FFT_SIZE) };
    new BandSplitter(SAMPLE_RATE).split(wave, expected);
    expect(Array.from(frame.bandWaveforms.mid)).toEqual(Array.from(expected.mid));
    expect(Array.from(frame.bandWaveforms.sub)).toEqual(Array.from(expected.sub));
    expect(Array.from(frame.bandWaveforms.high)).toEqual(Array.from(expected.high));
  });

  it("reflects the current frame's waveform, not a stale one, after a skipped frame", () => {
    const b = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    b.build(0, emptySpectrum(), sine(60));
    const f = b.build(STEP_SEC, emptySpectrum(), sine(5000));
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((t, v) => t + v * v, 0) / a.length);
    expect(rms(f.bandWaveforms.high)).toBeGreaterThan(rms(f.bandWaveforms.sub));
  });

  it("keeps the property listed and ignores assignment", () => {
    const b = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    const f = b.build(0, emptySpectrum(), silentWaveform);
    expect(Object.keys(f)).toContain("bandWaveforms");
    const before = f.bandWaveforms;
    (f as { bandWaveforms: unknown }).bandWaveforms = null;
    expect(f.bandWaveforms).toBe(before);
  });
});

describe("FrameBuilder short-window onset (Slice 17.1)", () => {
  const FAST_FFT = 2048;
  const FAST_BINS = FAST_FFT / 2;
  const KICK_PERIOD = 30; // frames, 0.5 s at 60 fps

  /** Sub-band bytes for an analyser window of `fft` points, `age` seconds after a kick began. */
  function kickBytes(fft: number, age: number, peak: number): Uint8Array {
    const bins = new Uint8Array(fft / 2);
    // A window that is only partly filled with the kick shows a proportionally smaller level.
    const fill = Math.min(1, Math.max(0, age / (fft / SAMPLE_RATE)));
    const lo = binForFrequency(20, SAMPLE_RATE, fft);
    const hi = Math.round((120 * fft) / SAMPLE_RATE);
    for (let i = lo; i < hi; i += 1) bins[i] = Math.round(peak * fill);
    return bins;
  }

  function run(peak: number, withFast: boolean) {
    const builder = new FrameBuilder(SAMPLE_RATE, FFT_SIZE, withFast ? FAST_FFT : 0);
    const onsetFrames: number[] = [];
    const beatFrames: number[] = [];
    for (let i = 0; i < 180; i += 1) {
      const sinceKick = i % KICK_PERIOD;
      const age = i >= KICK_PERIOD && sinceKick < 12 ? (sinceKick + 1) * STEP_SEC : -1;
      // After the rise the kick tail dies away, as a real kick does.
      const full = age >= 0 && sinceKick < 6;
      const slow = full ? kickBytes(FFT_SIZE, age, peak) : emptySpectrum();
      const fast = full ? kickBytes(FAST_FFT, age, peak) : new Uint8Array(FAST_BINS);
      const frame = builder.build(i * STEP_SEC, slow, silentWaveform, withFast ? fast : undefined);
      if (frame.onset) onsetFrames.push(i);
      if (frame.beat) beatFrames.push(i);
    }
    return { onsetFrames, beatFrames };
  }

  it("fires on the first frame of every kick, even a soft one the long window misses", () => {
    const { onsetFrames, beatFrames } = run(100, true);
    expect(onsetFrames).toEqual([30, 60, 90, 120, 150]);
    // The 8192-point window rises too slowly for a soft kick to cross the threshold; the short one does not.
    expect(beatFrames.length).toBeLessThan(onsetFrames.length);
  });

  it("never fires later than the long-window beat on a full-strength kick", () => {
    const { onsetFrames, beatFrames } = run(255, true);
    expect(onsetFrames.length).toBe(5);
    beatFrames.forEach((b, k) => expect(onsetFrames[k]!).toBeLessThanOrEqual(b));
  });

  it("mirrors the normal beat when there is no short analyser", () => {
    const builder = new FrameBuilder(SAMPLE_RATE, FFT_SIZE);
    for (let i = 0; i < 90; i += 1) {
      const isKick = i > 0 && i % 30 === 0;
      const frame = builder.build(i * STEP_SEC, isKick ? kickSpectrum() : emptySpectrum(), silentWaveform);
      expect(frame.onset).toBe(frame.beat);
    }
  });

  it("keeps the normal beat output unchanged when a short analyser is added", () => {
    const a = run(255, true).beatFrames;
    const b = run(255, false).beatFrames;
    expect(a).toEqual(b);
  });

  it("reset clears the short-window state", () => {
    const builder = new FrameBuilder(SAMPLE_RATE, FFT_SIZE, FAST_FFT);
    builder.build(0, emptySpectrum(), silentWaveform, new Uint8Array(FAST_BINS));
    builder.reset();
    const frame = builder.build(0, emptySpectrum(), silentWaveform, new Uint8Array(FAST_BINS));
    expect(frame.onset).toBe(false);
    expect(frame.onsetStrength).toBe(0);
  });
});
