import { describe, it, expect } from 'vitest';
import { BrightnessLimiter, CAP_FLOOR, capLuminance, clampSaturatedRed, RISE_PER_SEC } from './safety';

describe('BrightnessLimiter', () => {
  it('rises at most 0.10 per 333 ms, even from an instant full-white target', () => {
    const lim = new BrightnessLimiter();
    const v = lim.step(1, 0.333);
    expect(v - CAP_FLOOR).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(RISE_PER_SEC * 0.333).toBeCloseTo(0.1, 2);
  });
  it('falls back down after a quiet passage instead of sticking at 1.0', () => {
    const lim = new BrightnessLimiter();
    for (let i = 0; i < 300; i++) lim.step(1, 0.05); // 15 s of loud
    expect(lim.value).toBeGreaterThan(0.9);
    for (let i = 0; i < 40; i++) lim.step(CAP_FLOOR, 0.05); // 2 s of quiet
    expect(lim.value).toBeLessThan(0.3);
  });
  it('never goes below the dim floor and ignores bad input', () => {
    const lim = new BrightnessLimiter();
    expect(lim.step(-5, 0.1)).toBeGreaterThanOrEqual(CAP_FLOOR);
    expect(lim.step(NaN, 0.1)).toBeGreaterThanOrEqual(CAP_FLOOR);
  });
});

describe('capLuminance', () => {
  it('leaves pixels under the cap unchanged', () => {
    expect(capLuminance([0.1, 0.1, 0.1], 0.5)).toEqual([0.1, 0.1, 0.1]);
  });
  it('scales bright pixels down to the cap luminance', () => {
    const out = capLuminance([1, 1, 1], 0.4);
    const L = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
    expect(L).toBeCloseTo(0.4, 5);
  });
});

describe('clampSaturatedRed', () => {
  it('leaves neutral greys unchanged', () => {
    expect(clampSaturatedRed([0.5, 0.5, 0.5])).toEqual([0.5, 0.5, 0.5]);
  });
  it('pulls pure red down', () => {
    const out = clampSaturatedRed([1, 0, 0]);
    expect(out[0]).toBeLessThan(1);
    expect(out[0] / (out[0] + out[1] + out[2])).toBeCloseTo(0.79, 5);
    expect(out[0] + out[1] + out[2]).toBeCloseTo(1, 5); // brightness kept
  });
  it('leaves magenta-ish colours that are not saturated red alone', () => {
    expect(clampSaturatedRed([0.6, 0.2, 0.6])).toEqual([0.6, 0.2, 0.6]);
  });
});
