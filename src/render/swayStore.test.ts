import { describe, it, expect, beforeEach } from 'vitest';
import { advanceSway, getSway, resetSway } from './swayStore';

describe('shared sway', () => {
  beforeEach(() => resetSway());

  it('is zero in Calm, however loud the midrange is', () => {
    for (let i = 0; i < 60; i++) advanceSway(1 / 60, 1, true);
    expect(getSway()).toEqual({ x: 0, y: 0 });
  });

  it('remains rock-solid at (0, 0) even when not in Calm', () => {
    let maxX = 0;
    let maxY = 0;
    for (let i = 0; i < 600; i++) {
      const s = advanceSway(1 / 60, 1, false);
      maxX = Math.max(maxX, Math.abs(s.x));
      maxY = Math.max(maxY, Math.abs(s.y));
    }
    expect(maxX).toBe(0);
    expect(maxY).toBe(0);
  });

  it('is zero when the midrange is silent, even outside Calm', () => {
    for (let i = 0; i < 60; i++) advanceSway(1 / 60, 0, false);
    expect(getSway()).toEqual({ x: 0, y: 0 });
  });
});
