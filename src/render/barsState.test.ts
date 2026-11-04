import { describe, expect, it } from 'vitest';
import { BAR_COUNT, barValues } from './barsState';
import { buildBarEdges } from './logScale';

const SAMPLE_RATE = 48000;
const FFT_SIZE = 8192;
const BIN_COUNT = FFT_SIZE / 2;

describe('barValues', () => {
  it('a single bin of 1.0 lights only the bar(s) whose range contains that bin', () => {
    const edges = buildBarEdges(BAR_COUNT, SAMPLE_RATE, FFT_SIZE);
    for (const bin of [20, 100, 500, 1000, 2000]) {
      const spectrum = new Float32Array(BIN_COUNT);
      spectrum[bin] = 1.0;
      const values = barValues(spectrum, edges);
      const containing = edges
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => e.loBin <= bin && bin < e.hiBin)
        .map(({ i }) => i);
      const lit = Array.from(values)
        .map((v, i) => (v > 0 ? i : -1))
        .filter((i) => i >= 0);
      expect(lit).toEqual(containing);
      for (const i of containing) {
        expect(values[i]).toBeGreaterThan(0);
      }
    }
  });

  it('a bin of 1.0 in the middle of the scale lights a middle bar, not the first few', () => {
    const edges = buildBarEdges(BAR_COUNT, SAMPLE_RATE, FFT_SIZE);
    // 1 kHz is roughly the middle of the 40 Hz..12 kHz log scale.
    const bin = Math.round((1000 * FFT_SIZE) / SAMPLE_RATE);
    const spectrum = new Float32Array(BIN_COUNT);
    spectrum[bin] = 1.0;
    const values = barValues(spectrum, edges);
    const litIndex = Array.from(values).findIndex((v) => v > 0);
    expect(litIndex).toBeGreaterThan(BAR_COUNT / 4);
    expect(litIndex).toBeLessThan((3 * BAR_COUNT) / 4);
  });

  it('output length equals the edge count', () => {
    const edges = buildBarEdges(BAR_COUNT, SAMPLE_RATE, FFT_SIZE);
    expect(barValues(new Float32Array(BIN_COUNT), edges).length).toBe(edges.length);
    expect(barValues(new Float32Array(BIN_COUNT), edges).length).toBe(BAR_COUNT);
  });

  it('an empty spectrum gives all zeros', () => {
    const edges = buildBarEdges(BAR_COUNT, SAMPLE_RATE, FFT_SIZE);
    const values = barValues(new Float32Array(0), edges);
    expect(values.length).toBe(edges.length);
    expect(values.every((v) => v === 0)).toBe(true);
  });

  it('a short spectrum ignores bins that do not exist', () => {
    const edges = buildBarEdges(BAR_COUNT, SAMPLE_RATE, FFT_SIZE);
    const values = barValues(new Float32Array(4), edges);
    expect(values.length).toBe(BAR_COUNT);
    expect(values.every((v) => v === 0)).toBe(true);
  });

  it('values always stay within 0..1, even for out-of-range input', () => {
    const edges = buildBarEdges(BAR_COUNT, SAMPLE_RATE, FFT_SIZE);
    const spectrum = new Float32Array(BIN_COUNT);
    for (let k = 0; k < BIN_COUNT; k++) {
      spectrum[k] = k % 3 === 0 ? 2.5 : k % 3 === 1 ? -0.7 : 0.4;
    }
    const values = barValues(spectrum, edges);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
