// Lead review (Council 2026-11-04): exponential peak decay, so recovery time is
// the same whatever the loudness. peak = max(value, peak * exp(-dt / tau)).
// tau 4 s => a 10x (20 dB) drop recovers in about 9 s, inside the 5–10 s target.

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

  constructor(tauSec = 4, floor = 0.02) {
    this.floor = floor;
    this.tauSec = tauSec;
  }

  /** Feed a sample and get it scaled against the rolling peak, clamped to 0..1. */
  push(value: number, dtSec: number): number {
    if (dtSec > 0) {
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
