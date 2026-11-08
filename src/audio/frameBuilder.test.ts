import { describe, it, expect } from "vitest";
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
