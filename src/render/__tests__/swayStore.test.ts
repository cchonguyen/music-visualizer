import { describe, it, expect, beforeEach } from 'vitest';
import { advanceSway, getSway, resetSway } from '../swayStore';

describe('swayStore smoothing & invariants', () => {
  beforeEach(() => {
    resetSway();
  });

  it('is zero in Calm mode regardless of mid input', () => {
    for (let i = 0; i < 60; i++) {
      advanceSway(1 / 60, 1.0, true);
    }
    expect(getSway()).toEqual({ x: 0, y: 0 });
  });

  it('smooths mid with a 150ms exponential follower to eliminate abrupt jumps', () => {
    const dt = 1 / 60;
    // Frame 1 with sudden burst of mid = 1.0
    const firstSway = advanceSway(dt, 1.0, false);
    const firstMag = Math.hypot(firstSway.x, firstSway.y);

    // Let it settle to steady state over 1 second (60 frames)
    for (let i = 0; i < 59; i++) {
      advanceSway(dt, 1.0, false);
    }
    const settledSway = getSway();
    const settledMag = Math.hypot(settledSway.x, settledSway.y);

    // After 1 frame (16.6ms), 1 - exp(-0.01667 / 0.15) ≈ 0.105
    // So the initial frame must be significantly smaller than steady state
    expect(firstMag).toBeGreaterThan(0);
    expect(firstMag).toBeLessThan(settledMag * 0.25);
  });

  it('resets smoothed state cleanly with resetSway()', () => {
    advanceSway(1 / 60, 1.0, false);
    expect(getSway().x !== 0 || getSway().y !== 0).toBe(true);
    resetSway();
    expect(getSway()).toEqual({ x: 0, y: 0 });
  });
});
