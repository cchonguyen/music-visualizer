import { beforeEach, describe, expect, it } from 'vitest';
import { BAR_COUNT } from './barsState';
import { SlowFollower } from './dynamics';
import { advanceCrown, CROWN_CALM_SCALE, getCrownHeights, resetCrown, shapeHeights } from './crownStore';

function followers(): SlowFollower[] {
  return Array.from({ length: BAR_COUNT }, () => new SlowFollower(2.5));
}

function raw(value: number): Float32Array {
  return new Float32Array(BAR_COUNT).fill(value);
}

describe('shapeHeights', () => {
  it('gives zero heights for silent bars', () => {
    const out = shapeHeights(raw(0), followers(), 1 / 60, 1, false, new Float32Array(BAR_COUNT));
    expect(Array.from(out).every((h) => h === 0)).toBe(true);
  });

  it('keeps every height in [0, 1], even at high gain and loud bars', () => {
    const out = shapeHeights(raw(1), followers(), 1 / 60, 3, false, new Float32Array(BAR_COUNT));
    for (const h of out) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
  });

  it('calm multiplies every height by 0.35', () => {
    const normal = shapeHeights(raw(0.8), followers(), 1 / 60, 1, false, new Float32Array(BAR_COUNT));
    const calm = shapeHeights(raw(0.8), followers(), 1 / 60, 1, true, new Float32Array(BAR_COUNT));
    expect(CROWN_CALM_SCALE).toBe(0.35);
    for (let i = 0; i < BAR_COUNT; i++) {
      expect(calm[i]).toBeCloseTo(normal[i]! * 0.35, 6);
    }
  });

  it('visual gain bends the curve around 0.5 (more contrast above 1, calmer below 1)', () => {
    // 0.5 raw: the reaction is 0.3 at gain 1. Gain 2 pushes it away from 0.5 (0.1);
    // gain 0.5 pulls it toward 0.5 (0.4).
    const g1 = shapeHeights(raw(0.5), followers(), 1 / 60, 1, false, new Float32Array(BAR_COUNT));
    const g2 = shapeHeights(raw(0.5), followers(), 1 / 60, 2, false, new Float32Array(BAR_COUNT));
    const gHalf = shapeHeights(raw(0.5), followers(), 1 / 60, 0.5, false, new Float32Array(BAR_COUNT));
    expect(g1[0]).toBeCloseTo(0.3, 6);
    expect(g2[0]).toBeCloseTo(0.1, 6);
    expect(gHalf[0]).toBeCloseTo(0.4, 6);
  });

  it('treats non-finite input as silence', () => {
    const bad = new Float32Array(BAR_COUNT).fill(Number.NaN);
    const out = shapeHeights(bad, followers(), 1 / 60, 1, false, new Float32Array(BAR_COUNT));
    expect(Array.from(out).every((h) => h === 0)).toBe(true);
  });
});

describe('advanceCrown and getCrownHeights', () => {
  beforeEach(() => resetCrown());

  const smoothed = new Float32Array(1024).fill(0.9);

  it('stores 48 heights in [0, 1] once per frame', () => {
    advanceCrown(smoothed, 48000, 2048, 1 / 60, false, true);
    const h = getCrownHeights();
    expect(h.length).toBe(BAR_COUNT);
    for (const v of h) expect(v).toBeGreaterThan(0);
  });

  it('stores zeros when the crown is not enabled (flight scene without crown)', () => {
    advanceCrown(smoothed, 48000, 2048, 1 / 60, false, false);
    expect(Array.from(getCrownHeights()).every((h) => h === 0)).toBe(true);
  });
});
