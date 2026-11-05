import { describe, expect, it } from 'vitest';
import { FRAME_BUDGET_MS, FrameBudget } from './frameBudget';

describe('FrameBudget', () => {
  it('uses 16.7 ms as the default budget', () => {
    expect(FRAME_BUDGET_MS).toBe(16.7);
  });

  it('returns all zeros when empty', () => {
    expect(new FrameBudget().summary()).toEqual({ samples: 0, p50Ms: 0, p95Ms: 0, overBudgetPct: 0 });
  });

  it('computes p50 and over-budget share for 100x10 ms plus 5x20 ms', () => {
    const b = new FrameBudget();
    for (let i = 0; i < 100; i++) b.push(10);
    for (let i = 0; i < 5; i++) b.push(20);
    const s = b.summary();
    expect(s.samples).toBe(105);
    expect(s.overBudgetPct).toBe(4.8);
    expect(s.p50Ms).toBe(10);
  });

  it('wraps the ring buffer at capacity and drops the oldest values', () => {
    const b = new FrameBudget(16.7, 600);
    for (let i = 0; i < 700; i++) b.push(i < 100 ? 50 : 5);
    const s = b.summary();
    expect(s.samples).toBe(600);
    // The first 100 (value 50, all over budget) were overwritten; none remain.
    expect(s.overBudgetPct).toBe(0);
    expect(s.p95Ms).toBe(5);
  });

  it('ignores negative and non-finite values', () => {
    const b = new FrameBudget();
    b.push(-1);
    b.push(NaN);
    b.push(Infinity);
    expect(b.summary().samples).toBe(0);
    b.push(8);
    expect(b.summary().samples).toBe(1);
  });

  it('reset clears all samples', () => {
    const b = new FrameBudget();
    b.push(30);
    b.reset();
    expect(b.summary()).toEqual({ samples: 0, p50Ms: 0, p95Ms: 0, overBudgetPct: 0 });
  });
});
