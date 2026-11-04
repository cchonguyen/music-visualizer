import { describe, expect, it } from 'vitest';
import { CONTRAST_LIMIT, sectionContrast, SLOW_TAU_SEC } from './sectionContrast';

describe('sectionContrast', () => {
  it('is zero when fast and slow loudness match', () => {
    expect(sectionContrast(0.6, 0.6)).toBe(0);
  });

  it('is negative in a breakdown and positive in a drop', () => {
    expect(sectionContrast(0.3, 0.6)).toBeLessThan(0);
    expect(sectionContrast(0.9, 0.6)).toBeGreaterThan(0);
  });

  it('equals fast minus slow inside the limit', () => {
    expect(sectionContrast(0.8, 0.6)).toBeCloseTo(0.2, 10);
  });

  it('clamps to plus and minus 0.5', () => {
    expect(sectionContrast(1, 0)).toBe(CONTRAST_LIMIT);
    expect(sectionContrast(0, 1)).toBe(-CONTRAST_LIMIT);
    expect(sectionContrast(5, -5)).toBe(CONTRAST_LIMIT);
  });

  it('returns zero for non-finite input', () => {
    expect(sectionContrast(Number.NaN, 0.5)).toBe(0);
    expect(sectionContrast(0.5, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('uses an 8 second slow time constant', () => {
    expect(SLOW_TAU_SEC).toBe(8);
  });
});
