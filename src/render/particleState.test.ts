import { describe, expect, it } from 'vitest';
import {
  angleFor,
  hash01,
  highFlash,
  POOL_SIZE,
  radialSpeedFor,
  radiusFor,
  SPAWN_RADIUS,
  seedFor,
  speedFor,
  swirlFor,
} from './particleState';

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

describe('hash01', () => {
  it('stays in [0, 1) for every index and salt', () => {
    for (let i = 0; i < 600; i++) {
      for (let salt = 0; salt < 6; salt++) {
        const v = hash01(i, salt);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('gives different values for different salts on the same particle', () => {
    let same = 0;
    for (let i = 0; i < 600; i++) {
      if (Math.abs(hash01(i, 1) - hash01(i, 2)) < 1e-9) same++;
    }
    expect(same).toBe(0);
  });
});

describe('radiusFor (C3 spawn at the crown tips)', () => {
  it('spawns at exactly r = 0.16 and ends at 0.95', () => {
    expect(SPAWN_RADIUS).toBe(0.16);
    expect(radiusFor(0)).toBeCloseTo(0.16, 9);
    expect(radiusFor(1)).toBeCloseTo(0.95, 9);
  });

  it('clamps life outside [0, 1]', () => {
    expect(radiusFor(-1)).toBeCloseTo(0.16, 9);
    expect(radiusFor(2)).toBeCloseTo(0.95, 9);
  });

  it('follows tunnel depth: 1/r is linear in life (depth 1/0.16 down to 1/0.95)', () => {
    for (let i = 0; i <= 10; i++) {
      const life = i / 10;
      const expectedDepth = 1 / 0.16 + (1 / 0.95 - 1 / 0.16) * life;
      expect(1 / radiusFor(life)).toBeCloseTo(expectedDepth, 9);
    }
  });

  it('is strictly increasing across life', () => {
    let prev = radiusFor(0);
    for (let i = 1; i <= 100; i++) {
      const r = radiusFor(i / 100);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  });

  it('radialSpeedFor is positive (outward) and matches the numeric derivative', () => {
    const h = 1e-6;
    // Interior points only: life is clamped to [0, 1], which would skew a central difference at the ends.
    for (let i = 1; i <= 9; i++) {
      const life = i / 10;
      const numeric = (radiusFor(life + h) - radiusFor(life - h)) / (2 * h);
      expect(radialSpeedFor(life)).toBeGreaterThan(0);
      expect(radialSpeedFor(life)).toBeCloseTo(numeric, 4);
    }
  });

  it('a particle with positive velocity moves outward monotonically over time', () => {
    // Use the per-particle life rate and the integrated phase, as the layer does.
    for (const index of [0, 7, 123, 599]) {
      const speed = speedFor(index);
      // Start the particle at life 0 and step its phase forward.
      let prev = radiusFor(0);
      const steps = 200;
      for (let s = 1; s <= steps; s++) {
        const phase = (s / steps) * (1 / speed); // one full life cycle, no wrap
        const life = phase * speed;
        const r = radiusFor(life);
        expect(r).toBeGreaterThan(prev);
        prev = r;
      }
    }
  });
});

describe('per-particle properties', () => {
  it('speedFor stays in [0.06, 0.16]', () => {
    for (let i = 0; i < POOL_SIZE; i++) {
      const s = speedFor(i);
      expect(s).toBeGreaterThanOrEqual(0.06);
      expect(s).toBeLessThanOrEqual(0.16);
    }
  });

  it('swirlFor stays in [-1.2, 1.2] and takes both signs', () => {
    let neg = 0;
    let pos = 0;
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = swirlFor(i);
      expect(w).toBeGreaterThanOrEqual(-1.2);
      expect(w).toBeLessThanOrEqual(1.2);
      if (w < 0) neg++;
      if (w > 0) pos++;
    }
    expect(neg).toBeGreaterThan(0);
    expect(pos).toBeGreaterThan(0);
  });

  it('angleFor stays in [0, 2π)', () => {
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = angleFor(i);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(2 * Math.PI);
    }
  });

  it('speeds are spread out, not one shared value', () => {
    const speeds = new Set<number>();
    for (let i = 0; i < POOL_SIZE; i++) speeds.add(Math.round(speedFor(i) * 1e6));
    expect(speeds.size).toBeGreaterThan(POOL_SIZE / 2);
  });
});

describe('highFlash', () => {
  it('rises to 1 at once on a trigger', () => {
    expect(highFlash(0, true, 0.016)).toBe(1);
    expect(highFlash(0.2, true, 0)).toBe(1);
  });

  it('decays to about exp(-1) of its start after 320 ms with no trigger', () => {
    const start = 1;
    const after = highFlash(start, false, 0.32);
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
