// Lead review (Council 2026-11-04): exponential peak decay, so recovery time is
// the same whatever the loudness. peak = max(value, peak * exp(-dt / tau)).
// Council round 2 (2026-11-04): longer default tau (12 s) and an optional
// freeze, so a quiet breakdown isn't pumped back up to full size before the drop.

/**
 * Rolling normalizer: keeps a decaying peak observed over `windowSec` seconds
 * and scales inputs by it, so quiet and loud music both stay readable.
 * `floor` prevents silence from being amplified into noise.
 */
export class RollingNormalizer {
  private floor: number;
  /** Decay time constant in seconds. */
  private tauSec: number;
  private peakValue = 0;
  /** Below this input the peak stops decaying (quiet passages keep their contrast). */
  private freezeBelow: number;

  constructor(tauSec = 12, floor = 0.02, freezeBelow = 0) {
    this.floor = floor;
    this.tauSec = tauSec;
    this.freezeBelow = freezeBelow;
  }

  /** Feed a sample and get it scaled against the rolling peak, clamped to 0..1. */
  push(value: number, dtSec: number): number {
    if (dtSec > 0 && value >= this.freezeBelow) {
      this.peakValue = Math.max(value, this.peakValue * Math.exp(-dtSec / this.tauSec));
    } else {
      // dt of 0 changes nothing about the peak; it can still rise instantly.
      this.peakValue = Math.max(this.peakValue, value);
    }
    const denom = Math.max(this.peakValue, this.floor);
    return clamp01(value / denom);
  }

  /** Current stored decaying peak. */
  peak(): number {
    return this.peakValue;
  }

  /** Clear the rolling peak (e.g. on audio restart). */
  reset(): void {
    this.peakValue = 0;
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
