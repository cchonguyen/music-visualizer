import { describe, expect, it } from 'vitest';
import { highFlash, POOL_SIZE, seedFor } from './particleState';

describe('seedFor', () => {
  it('is deterministic and stays in [0, 1) for indices 0..999', () => {
    for (let i = 0; i < 1000; i++) {
      const a = seedFor(i);
      const b = seedFor(i);
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('exposes a pool size of 600', () => {
    expect(POOL_SIZE).toBe(600);
  });
});

describe('highFlash', () => {
  it('rises to 1 at once on a trigger', () => {
    expect(highFlash(0, true, 0.016)).toBe(1);
    expect(highFlash(0.2, true, 0)).toBe(1);
  });

  it('decays to about exp(-1) of its start after 150 ms with no trigger', () => {
    const start = 1;
    const after = highFlash(start, false, 0.15);
    expect(Math.abs(after - Math.exp(-1))).toBeLessThan(0.01);
  });

  it('never goes negative', () => {
    let v = 1;
    for (let i = 0; i < 1000; i++) {
      v = highFlash(v, false, 0.1);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(highFlash(-5, false, 0.1)).toBe(0);
  });

  it('treats negative dt as 0', () => {
    expect(highFlash(0.5, false, -1)).toBe(0.5);
  });
});
