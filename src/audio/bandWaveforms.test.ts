import { describe, it, expect } from "vitest";
import { BandSplitter } from "./bandWaveforms";
import type { BandWaveforms } from "./types";

const SAMPLE_RATE = 48000;
const LENGTH = 4096;

function sine(hz: number, amp = 0.8): Float32Array {
  const w = new Float32Array(LENGTH);
  for (let i = 0; i < LENGTH; i += 1) {
    w[i] = amp * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE);
  }
  return w;
}

function emptyBands(length = LENGTH): BandWaveforms {
  return {
    sub: new Float32Array(length),
    mid: new Float32Array(length),
    high: new Float32Array(length),
  };
}

function rms(wave: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < wave.length; i += 1) {
    const v = wave[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / wave.length);
}

function splitSine(hz: number): { input: Float32Array; bands: BandWaveforms } {
  const input = sine(hz);
  const bands = emptyBands();
  new BandSplitter(SAMPLE_RATE).split(input, bands);
  return { input, bands };
}

describe("BandSplitter", () => {
  it("passes a 60 Hz sine into sub and keeps it out of high", () => {
    const { input, bands } = splitSine(60);
    const inRms = rms(input);

    expect(rms(bands.sub)).toBeGreaterThan(0.5 * inRms);
    expect(rms(bands.high)).toBeLessThan(0.05 * inRms);
  });

  it("passes an 800 Hz sine into mid and keeps it out of sub and high", () => {
    const { input, bands } = splitSine(800);
    const inRms = rms(input);

    expect(rms(bands.mid)).toBeGreaterThan(0.6 * inRms);
    expect(rms(bands.sub)).toBeLessThan(0.02 * inRms);
    expect(rms(bands.high)).toBeLessThan(0.02 * inRms);
  });

  it("passes a 6 kHz sine into high, not mid", () => {
    const { input, bands } = splitSine(6000);
    const inRms = rms(input);

    expect(rms(bands.high)).toBeGreaterThan(0.6 * inRms);
    expect(rms(bands.mid)).toBeLessThan(0.1 * inRms);
  });

  it("gives all zeros for a silent input", () => {
    const bands = emptyBands();
    // Start from non-zero garbage so the test proves the split overwrites it.
    bands.sub.fill(0.5);
    bands.mid.fill(0.5);
    bands.high.fill(0.5);

    new BandSplitter(SAMPLE_RATE).split(new Float32Array(LENGTH), bands);

    expect(rms(bands.sub)).toBe(0);
    expect(rms(bands.mid)).toBe(0);
    expect(rms(bands.high)).toBe(0);
  });

  it("writes output arrays with the same length as the input", () => {
    const { bands } = splitSine(800);

    expect(bands.sub.length).toBe(LENGTH);
    expect(bands.mid.length).toBe(LENGTH);
    expect(bands.high.length).toBe(LENGTH);
  });

  it("gives identical output when split is called twice on the same input", () => {
    const input = sine(800);
    const splitter = new BandSplitter(SAMPLE_RATE);
    const first = emptyBands();
    const second = emptyBands();

    splitter.split(input, first);
    splitter.split(input, second);

    expect(second.sub).toEqual(first.sub);
    expect(second.mid).toEqual(first.mid);
    expect(second.high).toEqual(first.high);
  });
});
