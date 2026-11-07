import { describe, it, expect, beforeEach } from 'vitest';
import { advanceSway, getSway, resetSway } from '../swayStore';

describe('swayStore zeroed rock-solid sway invariants', () => {
  beforeEach(() => {
    resetSway();
  });

  it('is zero in Calm mode regardless of mid input', () => {
    for (let i = 0; i < 60; i++) {
      advanceSway(1 / 60, 1.0, true);
    }
    expect(getSway()).toEqual({ x: 0, y: 0 });
  });

  it('remains rock-solid at (0, 0) under normal loud audio input', () => {
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      const sway = advanceSway(dt, 1.0, false);
      expect(sway).toEqual({ x: 0, y: 0 });
      expect(getSway()).toEqual({ x: 0, y: 0 });
    }
  });

  it('resets cleanly with resetSway() and maintains (0, 0)', () => {
    advanceSway(1 / 60, 1.0, false);
    expect(getSway()).toEqual({ x: 0, y: 0 });
    resetSway();
    expect(getSway()).toEqual({ x: 0, y: 0 });
  });
});
