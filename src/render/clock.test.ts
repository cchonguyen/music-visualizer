import { describe, it, expect } from 'vitest';
import { clampDt, MAX_DT_SEC, Phase, PHASE_WRAP } from './clock';

describe('Phase', () => {
  it('never steps backward while loudness swings between 0.08 and 1.0', () => {
    const p = new Phase();
    let prev = 0;
    for (let i = 0; i < 1000; i++) {
      const energy = i % 2 ? 0.08 : 1.0;
      const v = p.advance(0.016, 1 + 4 * energy);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
  it('treats negative rates and dt as no motion', () => {
    const p = new Phase();
    p.advance(1, 2);
    expect(p.advance(1, -5)).toBe(2);
    expect(p.advance(-1, 5)).toBe(2);
  });
  it('wraps to stay precise in shaders', () => {
    const p = new Phase();
    expect(p.advance(1, PHASE_WRAP + 3)).toBeCloseTo(3);
  });
});

describe('clampDt', () => {
  it('clamps big gaps, negatives and NaN', () => {
    expect(clampDt(5)).toBe(MAX_DT_SEC);
    expect(clampDt(-1)).toBe(0);
    expect(clampDt(NaN)).toBe(0);
    expect(clampDt(0.016)).toBe(0.016);
  });
});
