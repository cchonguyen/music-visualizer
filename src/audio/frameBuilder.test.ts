import { describe, it, expect } from "vitest";
import { FrameBuilder } from "./frameBuilder";
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
