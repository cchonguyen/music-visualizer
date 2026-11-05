import { describe, it, expect } from 'vitest';
import { ContextLossState } from './lossState';
import { clampDt, MAX_DT_SEC } from '../render/clock';

describe('ContextLossState', () => {
  it('starts not lost', () => {
    expect(new ContextLossState().isLost).toBe(false);
  });

  it('markLost returns lost once and null on a second call', () => {
    const s = new ContextLossState();
    expect(s.markLost()).toBe('lost');
    expect(s.markLost()).toBeNull();
    expect(s.isLost).toBe(true);
  });

  it('markRestored with no prior loss returns null', () => {
    const s = new ContextLossState();
    expect(s.markRestored()).toBeNull();
    expect(s.isLost).toBe(false);
  });

  it('loss then restore returns restored and clears isLost', () => {
    const s = new ContextLossState();
    s.markLost();
    expect(s.markRestored()).toBe('restored');
    expect(s.isLost).toBe(false);
  });

  it('a second loss after restore returns lost again', () => {
    const s = new ContextLossState();
    s.markLost();
    s.markRestored();
    expect(s.markLost()).toBe('lost');
    expect(s.isLost).toBe(true);
  });
});

describe('hidden tab gap clamp', () => {
  it('clamps a long gap to MAX_DT_SEC', () => {
    expect(clampDt(60)).toBe(MAX_DT_SEC);
  });

  it('returns 0 for negative dt', () => {
    expect(clampDt(-1)).toBe(0);
  });

  it('passes a normal frame through', () => {
    expect(Math.abs(clampDt(0.016) - 0.016)).toBeLessThan(1e-12);
  });

  it('returns 0 for NaN', () => {
    expect(clampDt(NaN)).toBe(0);
  });
});
