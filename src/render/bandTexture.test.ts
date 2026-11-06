import { describe, it, expect } from 'vitest';
import { BAND_TEXELS, resampleToRow } from './bandTexture';

describe('resampleToRow', () => {
  it('maps a known ramp to 0..1 when the output has as many texels as input', () => {
    expect(Array.from(resampleToRow(new Float32Array([-1, -0.5, 0.5, 1]), 4))).toEqual([0, 0.25, 0.75, 1]);
  });

  it('keeps the sample with the largest magnitude in each bucket', () => {
    // Buckets [-1, -0.5] and [0.5, 1]: the largest magnitudes are -1 and 1.
    expect(Array.from(resampleToRow(new Float32Array([-1, -0.5, 0.5, 1]), 2))).toEqual([0, 1]);
    // One bucket of [0.2, -0.9, 0.5, 0.1]: -0.9 wins, so 0.05.
    expect(resampleToRow(new Float32Array([0.2, -0.9, 0.5, 0.1]), 1)[0]).toBeCloseTo(0.05, 5);
  });

  it('maps silence to 0.5 everywhere', () => {
    const out = resampleToRow(new Float32Array(2048), BAND_TEXELS);
    expect(out.every((v) => v === 0.5)).toBe(true);
  });

  it('returns exactly n texels, and reuses a matching out buffer', () => {
    const src = new Float32Array(2048);
    const out = new Float32Array(BAND_TEXELS);
    const result = resampleToRow(src, BAND_TEXELS, out);
    expect(result.length).toBe(BAND_TEXELS);
    expect(result).toBe(out);
    expect(resampleToRow(src, 64).length).toBe(64);
  });
});
