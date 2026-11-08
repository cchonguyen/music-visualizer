// Lead review (Council 2026-11-04): flux is a per-bin mean; fluxFloor 0.02.
// NOTE(spec): "bin range" is treated as inclusive (loBin..hiBin), clamped to
// the arrays so callers may pass fftSize/2 as the upper bound. The running mean
// is seeded with the first flux sample, so a constant signal is steady from the
// start and can never cross its own threshold. With a zero mean (silence), a
// non-zero flux is given the maximum strength rather than dividing by zero.

/**
 * Mean positive increase per bin over an inclusive bin range.
 * Mean (not sum) so thresholds mean the same thing for narrow and wide bands.
 */
export function spectralFlux(
  prev: Float32Array,
  curr: Float32Array,
  loBin: number,
  hiBin: number,
): number {
  const len = Math.min(prev.length, curr.length);
  const start = Math.max(0, Math.floor(loBin));
  const end = Math.min(len - 1, Math.floor(hiBin));

  let sum = 0;
  for (let i = start; i <= end; i += 1) {
    // Only energy that appears is novel; energy that disappears is not an onset.
    const delta = (curr[i] ?? 0) - (prev[i] ?? 0);
    if (delta > 0) sum += delta;
  }
  const count = end - start + 1;
  return count > 0 ? sum / count : 0;
}

export const DEFAULT_COOLDOWN_MS = 220;
export const DEFAULT_RELEASE_RATIO = 0.95;
export const DEFAULT_FLUX_FLOOR = 0.035;

export interface OnsetDetectorOptions {
  triggerRatio?: number;
  releaseRatio?: number;
  cooldownMs?: number;
  meanTauMs?: number;
  /** Minimum flux baseline; stops near-silent noise from triggering beats. */
  fluxFloor?: number;
}

interface OnsetResult {
  beat: boolean;
  strength: number;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export const DEFAULT_BEAT_SENSITIVITY = 0.5;
let beatSensitivity = DEFAULT_BEAT_SENSITIVITY;

/** Sets the global beat sensitivity (0..1). Non-finite input resets to the default. */
export function setBeatSensitivity(value: number): void {
  beatSensitivity = Number.isFinite(value) ? clamp01(value) : DEFAULT_BEAT_SENSITIVITY;
}

export function getBeatSensitivity(): number {
  return beatSensitivity;
}

/**
 * Maps sensitivity to a trigger ratio: 0 -> 2.0 (fewer beats), 0.5 -> 1.3,
 * 1 -> 1.05 (more beats). Piecewise linear; input is clamped to 0..1.
 */
export function triggerRatioForSensitivity(sensitivity: number): number {
  const s = clamp01(sensitivity);
  if (s <= 0.5) return 2.0 - 1.4 * s;
  return 1.3 - 0.5 * (s - 0.5);
}

/**
 * Adaptive threshold onset detector: compare flux with an exponential moving
 * average of recent flux, with hysteresis and a cooldown between beats.
 */
export class OnsetDetector {
  private readonly fixedTriggerRatio: number | null;
  private readonly releaseRatio: number;
  private readonly cooldownSec: number;
  private readonly meanTauSec: number;
  private readonly fluxFloor: number;

  private mean: number | null = null;
  private lastTime = 0;
  private lastFireTime = -Infinity;
  private armed = true;

  constructor(opts: OnsetDetectorOptions = {}) {
    this.fixedTriggerRatio = opts.triggerRatio ?? null;
    this.releaseRatio = opts.releaseRatio ?? DEFAULT_RELEASE_RATIO;
    this.cooldownSec = (opts.cooldownMs ?? DEFAULT_COOLDOWN_MS) / 1000;
    this.meanTauSec = (opts.meanTauMs ?? 500) / 1000;
    this.fluxFloor = opts.fluxFloor ?? DEFAULT_FLUX_FLOOR;
  }

  step(flux: number, timeSec: number): OnsetResult {
    // The first sample only establishes the baseline; there is no history yet.
    if (this.mean === null) {
      this.mean = flux;
      this.lastTime = timeSec;
      return { beat: false, strength: 0 };
    }

    const mean = this.mean;
    // The floor keeps the ratio test from firing on tiny noise (Council review).
    const base = Math.max(mean, this.fluxFloor);
    const triggerRatio = this.fixedTriggerRatio ?? triggerRatioForSensitivity(beatSensitivity);
    const triggerThreshold = base * triggerRatio;

    // Hysteresis: stay disarmed until flux falls back near the baseline.
    if (!this.armed && flux < base * this.releaseRatio) {
      this.armed = true;
    }

    const inCooldown = timeSec - this.lastFireTime < this.cooldownSec;
    let beat = false;
    let strength = 0;

    if (this.armed && !inCooldown && flux > triggerThreshold) {
      beat = true;
      strength =
        triggerThreshold > 0 ? clamp01(flux / triggerThreshold - 1) : 1;
      this.armed = false;
      this.lastFireTime = timeSec;
    }

    // Time-based EMA, so behaviour does not depend on the frame rate.
    const dt = timeSec - this.lastTime;
    if (dt > 0 && this.meanTauSec > 0) {
      const alpha = 1 - Math.exp(-dt / this.meanTauSec);
      this.mean = mean + alpha * (flux - mean);
    }
    this.lastTime = timeSec;

    return { beat, strength };
  }

  reset(): void {
    this.mean = null;
    this.lastTime = 0;
    this.lastFireTime = -Infinity;
    this.armed = true;
  }
}
