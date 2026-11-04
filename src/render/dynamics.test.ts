import { describe, it, expect } from 'vitest';
import { SlowFollower, punch } from './dynamics';

describe('SlowFollower', () => {
  it('starts at the first value and settles on a steady input', () => {
    const f = new SlowFollower(1);
    expect(f.step(0.5, 0.016)).toBe(0.5);
    for (let i = 0; i < 600; i++) f.step(0.8, 0.016);
    expect(f.average).toBeCloseTo(0.8, 3);
  });
  it('moves slower than the input (time constant respected)', () => {
    const f = new SlowFollower(2);
    f.step(0, 0.016);
    const after = f.step(1, 0.5);
    expect(after).toBeLessThan(0.3);
  });
  it('ignores negative time steps', () => {
    const f = new SlowFollower(1);
    f.step(0.4, 0.1);
    expect(f.step(1, -5)).toBeCloseTo(0.4, 6);
  });
});

describe('punch', () => {
  it('is zero when the value is below its average', () => {
    expect(punch(0.2, 0.5, 4)).toBe(0);
  });
  it('is 1 when far above the average', () => {
    expect(punch(0.9, 0.5, 4)).toBeCloseTo(1, 6);
  });
  it('scales with gain and stays within 0..1', () => {
    expect(punch(0.6, 0.5, 2)).toBeCloseTo(0.2, 6);
    expect(punch(0.6, 0.5, 10)).toBeCloseTo(1, 6);
  });
});
