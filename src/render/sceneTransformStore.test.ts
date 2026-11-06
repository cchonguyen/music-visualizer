import { describe, expect, it, beforeEach } from 'vitest';
import { advanceSceneTransform, getSceneTransform, resetSceneTransform } from './sceneTransformStore';

describe('scene transform store', () => {
  beforeEach(() => resetSceneTransform());

  it('starts as no transform', () => {
    expect(getSceneTransform()).toEqual({ angle: 0, scale: 1 });
  });

  it('takes the current zoom as the scale', () => {
    advanceSceneTransform(1.01, 0);
    expect(getSceneTransform().scale).toBe(1.01);
  });

  it('accumulates rotation and wraps it to one turn', () => {
    for (let i = 0; i < 1000; i++) advanceSceneTransform(1, 0.05);
    const { angle } = getSceneTransform();
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThan(Math.PI * 2);
  });

  it('falls back to no zoom and no turn on bad input', () => {
    advanceSceneTransform(Number.NaN, Number.NaN);
    expect(getSceneTransform()).toEqual({ angle: 0, scale: 1 });
  });
});
