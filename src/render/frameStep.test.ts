import { describe, expect, it } from 'vitest';
import { FrameStepper } from './frameStep';

describe('FrameStepper', () => {
  it('draws every call while running', () => {
    const s = new FrameStepper();
    expect(s.isFrozen).toBe(false);
    expect([s.consumeDraw(), s.consumeDraw(), s.consumeDraw()]).toEqual([true, true, true]);
  });

  it('stops drawing while frozen', () => {
    const s = new FrameStepper();
    expect(s.toggle()).toBe(true);
    expect(s.isFrozen).toBe(true);
    expect([s.consumeDraw(), s.consumeDraw()]).toEqual([false, false]);
  });

  it('a step requested while frozen yields exactly one draw', () => {
    const s = new FrameStepper();
    s.toggle();
    s.requestStep();
    expect(s.consumeDraw()).toBe(true);
    expect(s.consumeDraw()).toBe(false);
    expect(s.consumeDraw()).toBe(false);
  });

  it('a step requested while running does nothing extra', () => {
    const s = new FrameStepper();
    s.requestStep();
    s.toggle();
    expect(s.consumeDraw()).toBe(false);
    s.toggle();
    expect(s.consumeDraw()).toBe(true);
    expect(s.consumeDraw()).toBe(true);
  });

  it('unfreezing clears pending steps', () => {
    const s = new FrameStepper();
    s.toggle();
    s.requestStep();
    s.requestStep();
    s.toggle();
    expect(s.isFrozen).toBe(false);
    s.toggle();
    expect(s.consumeDraw()).toBe(false);
  });

  it('toggle returns the new state', () => {
    const s = new FrameStepper();
    expect(s.toggle()).toBe(true);
    expect(s.toggle()).toBe(false);
    expect(s.toggle()).toBe(true);
  });
});
