// Frame-time budget tracker (S3-c). Pure logic, no DOM.
// Keeps a ring buffer of recent frame times and reports how many exceed the budget.

/** Frame budget at 60 fps, in milliseconds. */
export const FRAME_BUDGET_MS = 16.7;

export interface FrameBudgetSummary {
  samples: number;
  p50Ms: number;
  p95Ms: number;
  overBudgetPct: number;
}

/** Nearest-rank percentile on an already-sorted array (p in 0..100). */
function nearestRank(sorted: number[], p: number): number {
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0;
}

export class FrameBudget {
  private readonly budgetMs: number;
  private readonly capacity: number;
  private readonly buffer: number[] = [];
  private next = 0;

  constructor(budgetMs = FRAME_BUDGET_MS, capacity = 600) {
    this.budgetMs = budgetMs;
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  /** Record one frame time. Non-finite and negative values are ignored. */
  push(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    if (this.buffer.length < this.capacity) {
      this.buffer.push(ms);
    } else {
      this.buffer[this.next] = ms;
      this.next = (this.next + 1) % this.capacity;
    }
  }

  summary(): FrameBudgetSummary {
    const n = this.buffer.length;
    if (n === 0) return { samples: 0, p50Ms: 0, p95Ms: 0, overBudgetPct: 0 };
    const sorted = this.buffer.slice().sort((a, b) => a - b);
    let over = 0;
    for (const v of this.buffer) if (v > this.budgetMs) over++;
    return {
      samples: n,
      p50Ms: nearestRank(sorted, 50),
      p95Ms: nearestRank(sorted, 95),
      overBudgetPct: Math.round((over / n) * 1000) / 10,
    };
  }

  reset(): void {
    this.buffer.length = 0;
    this.next = 0;
  }
}
