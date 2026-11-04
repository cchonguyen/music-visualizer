import { describe, it, expect } from 'vitest';
import { FlashGovernor, MIN_FLASH_GAP_SEC } from './safety';

describe('FlashGovernor (P6 photosensitivity guard)', () => {
  it('grants the first flash', () => {
    const g = new FlashGovernor();
    expect(g.tryFlash(0)).toBe(true);
  });

  it('refuses a second flash within 333 ms', () => {
    const g = new FlashGovernor();
    expect(g.tryFlash(1.0)).toBe(true);
    expect(g.tryFlash(1.0 + 0.15)).toBe(false); // a 150 ms beat cooldown is too fast
    expect(g.tryFlash(1.0 + 0.3)).toBe(false);
  });

  it('grants again once the gap has passed', () => {
    const g = new FlashGovernor();
    expect(g.tryFlash(1.0)).toBe(true);
    expect(g.tryFlash(1.0 + MIN_FLASH_GAP_SEC)).toBe(true);
  });

  it('never allows more than 3 flashes in any one second of a busy hi-hat track', () => {
    const g = new FlashGovernor();
    const granted: number[] = [];
    // Beats every 150 ms for 10 s (about 6.7 per second requested).
    for (let t = 0; t < 10; t += 0.15) {
      if (g.tryFlash(t)) granted.push(t);
    }
    for (let start = 0; start < 9; start += 0.05) {
      const inWindow = granted.filter((t) => t >= start && t < start + 1).length;
      expect(inWindow).toBeLessThanOrEqual(3);
    }
  });

  it('resets when the clock jumps backwards', () => {
    const g = new FlashGovernor();
    expect(g.tryFlash(100)).toBe(true);
    expect(g.tryFlash(0)).toBe(true);
  });

  it('ignores non-finite time', () => {
    const g = new FlashGovernor();
    expect(g.tryFlash(Number.NaN)).toBe(false);
    expect(g.tryFlash(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
