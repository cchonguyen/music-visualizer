import { describe, expect, it, beforeEach } from 'vitest';
import { advanceSceneTransform, getSceneTransform, resetSceneTransform, type SceneInput } from './sceneTransformStore';

const still: SceneInput = { zoom: 1, rotate: 0, centreX: 0, centreY: 0, stretchX: 1, stretchY: 1, warp: 0, warpScale: 1, warpSpeed: 1 };

describe('scene transform store', () => {
  beforeEach(() => resetSceneTransform());

  it('starts as no transform', () => {
    expect(getSceneTransform()).toMatchObject({ angle: 0, scale: 1, centreX: 0, stretchX: 1, warp: 0 });
  });

  it('takes the current zoom, drift, stretch and warp', () => {
    advanceSceneTransform({ ...still, zoom: 1.01, centreX: 0.1, stretchY: 1.5, warp: 0.4 }, 2);
    expect(getSceneTransform()).toMatchObject({ scale: 1.01, centreX: 0.1, stretchY: 1.5, warp: 0.4, timeSec: 2 });
  });

  it('accumulates rotation and wraps it to one turn', () => {
    for (let i = 0; i < 1000; i++) advanceSceneTransform({ ...still, rotate: 0.05 }, 0);
    const { angle } = getSceneTransform();
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThan(Math.PI * 2);
  });

  it('falls back to no effect on bad input', () => {
    advanceSceneTransform({ ...still, zoom: Number.NaN, rotate: Number.NaN, stretchX: -1, warp: 9 }, Number.NaN);
    expect(getSceneTransform()).toMatchObject({ angle: 0, scale: 1, stretchX: 1, warp: 1, timeSec: 0 });
  });
});
