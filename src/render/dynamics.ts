// Dynamics helpers (2026-11-04). Music at a steady loud level looks "flat" if
// visuals only follow absolute level. These helpers measure how far a value is
// above its own recent average, so swells and hits stand out.

/** Exponential moving average with a time constant in seconds. */
export class SlowFollower {
  private value: number | null = null;
  constructor(private readonly tauSec: number) {}

  /** Move toward `x` over `dtSec`. Returns the current average. */
  step(x: number, dtSec: number): number {
    if (this.value === null) {
      this.value = x;
      return x;
    }
    const dt = Math.max(0, dtSec);
    const k = 1 - Math.exp(-dt / this.tauSec);
    this.value += k * (x - this.value);
    return this.value;
  }

  get average(): number {
    return this.value ?? 0;
  }

  reset(): void {
    this.value = null;
  }
}

/** How far `x` is above its average, scaled by `gain` and clamped to 0..1. */
export function punch(x: number, average: number, gain: number): number {
  const d = (x - average) * gain;
  return d <= 0 ? 0 : d >= 1 ? 1 : d;
}
