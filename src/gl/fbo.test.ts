import { describe, it, expect } from 'vitest';
import { clampSize } from './fbo';

describe('clampSize', () => {
  it('keeps normal sizes', () => {
    expect(clampSize(1280, 720)).toEqual({ width: 1280, height: 720 });
  });
  it('clamps zero, negative and non-finite sizes to at least 1 pixel', () => {
    expect(clampSize(0, -5)).toEqual({ width: 1, height: 1 });
    expect(clampSize(NaN, Infinity)).toEqual({ width: 1, height: 1 });
  });
  it('floors fractional sizes', () => {
    expect(clampSize(10.9, 3.2)).toEqual({ width: 10, height: 3 });
  });
});
