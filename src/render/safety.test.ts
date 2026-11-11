import { describe, it, expect } from 'vitest';
import {
  BrightnessLimiter,
  CAP_FLOOR,
  capLuminance,
  clampSaturatedRed,
  FALL_PER_SEC,
  INTENSITY_LIMITS,
  INTENSITY_OPTIONS,
  isIntensity,
  MAX_REVERSALS_PER_SEC,
  RISE_PER_SEC,
  type Intensity,
} from './safety';

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

describe('intensity limits (slice 21.3)', () => {
  it('Full equals today\'s limiter values exactly', () => {
    expect(INTENSITY_LIMITS.full).toEqual({
      risePerSec: RISE_PER_SEC,
      maxReversalsPerSec: MAX_REVERSALS_PER_SEC,
      ceiling: 1.0,
    });
    expect(RISE_PER_SEC).toBe(0.3);
    expect(FALL_PER_SEC).toBe(0.6);
    expect(MAX_REVERSALS_PER_SEC).toBe(3);
  });

  it('a new limiter starts on Full', () => {
    expect(new BrightnessLimiter().intensity).toBe('full');
  });

  it('Reduced and Calm never loosen any limit beyond Full', () => {
    const full = INTENSITY_LIMITS.full;
    for (const name of ['reduced', 'calm'] as const) {
      const l = INTENSITY_LIMITS[name];
      expect(l.risePerSec).toBeLessThanOrEqual(full.risePerSec);
      expect(l.maxReversalsPerSec).toBeLessThanOrEqual(full.maxReversalsPerSec);
      expect(l.ceiling).toBeLessThanOrEqual(full.ceiling);
      expect(l.ceiling).toBeGreaterThanOrEqual(CAP_FLOOR);
    }
  });

  it('Calm is at least as tight as Reduced on every limit', () => {
    const r = INTENSITY_LIMITS.reduced;
    const c = INTENSITY_LIMITS.calm;
    expect(c.risePerSec).toBeLessThanOrEqual(r.risePerSec);
    expect(c.maxReversalsPerSec).toBeLessThanOrEqual(r.maxReversalsPerSec);
    expect(c.ceiling).toBeLessThanOrEqual(r.ceiling);
  });

  it('every option in the list has a profile', () => {
    for (const opt of INTENSITY_OPTIONS) expect(INTENSITY_LIMITS[opt]).toBeDefined();
    expect(INTENSITY_OPTIONS).toEqual(['full', 'reduced', 'calm']);
  });

  it('isIntensity accepts only the three options', () => {
    expect(isIntensity('full')).toBe(true);
    expect(isIntensity('calm')).toBe(true);
    expect(isIntensity('loud')).toBe(false);
    expect(isIntensity(undefined)).toBe(false);
  });

  it('an unknown intensity falls back to Full', () => {
    const lim = new BrightnessLimiter();
    lim.setIntensity('calm');
    lim.setIntensity('bogus' as Intensity);
    expect(lim.intensity).toBe('full');
  });

  it('Full limiter output matches a default limiter on the same input', () => {
    const a = new BrightnessLimiter();
    const b = new BrightnessLimiter();
    b.setIntensity('full');
    let seed = 7;
    for (let i = 0; i < 600; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const target = (seed % 1000) / 1000;
      expect(b.step(target, 0.02)).toBe(a.step(target, 0.02));
    }
  });

  it('Reduced and Calm never exceed their ceiling and never rise faster than their rate', () => {
    for (const name of ['reduced', 'calm'] as const) {
      const lim = new BrightnessLimiter();
      lim.setIntensity(name);
      const { risePerSec, ceiling } = INTENSITY_LIMITS[name];
      const dt = 0.02;
      let prev = lim.value;
      let seed = 42;
      for (let i = 0; i < 3000; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const target = (seed % 1000) / 1000; // full-range random target, flashing hard
        const cap = lim.step(target, dt);
        expect(cap).toBeLessThanOrEqual(ceiling + 1e-9);
        expect(cap).toBeGreaterThanOrEqual(CAP_FLOOR - 1e-9);
        expect(cap - prev).toBeLessThanOrEqual(risePerSec * dt + 1e-9);
        prev = cap;
      }
    }
  });

  it('Calm holds a loud full-white input below its ceiling', () => {
    const lim = new BrightnessLimiter();
    lim.setIntensity('calm');
    for (let i = 0; i < 300; i++) lim.step(1, 0.05);
    expect(lim.value).toBeLessThanOrEqual(INTENSITY_LIMITS.calm.ceiling + 1e-9);
    expect(lim.value).toBeGreaterThan(0.6);
  });

  it('intensity survives reset()', () => {
    const lim = new BrightnessLimiter();
    lim.setIntensity('reduced');
    lim.reset();
    expect(lim.intensity).toBe('reduced');
  });
});
