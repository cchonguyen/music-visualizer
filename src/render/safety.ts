// Brightness limiter and safety governor for the final composite (slice 2.2, extended in 7.9).
//
// JS cannot read the real brightness of a procedural shader without a slow GPU
// readback, so this keeps an ESTIMATE of the scene's luminance cap:
// - it may rise by at most RISE_PER_SEC (0.30/s, which is +0.10 per 333 ms);
// - it falls with the shared 320 ms release envelope (C2), clamped by FALL_PER_SEC (0.60/s);
// - bidirectional luminance slew limiting restricts both rapid upward spikes and rapid downward drops/inversions;
// - a rolling 1-second reversal counter detects alternating dark/light frames (> 3 reversals/sec)
//   and automatically increases damping (WCAG 2.3.1);
// - Calm mode exposes calmFactor (0.5 when enabled, 1.0 normal).
// The composite shader scales any pixel brighter than the cap down to it and applies Calm/damping/stripe rules.

import { releaseEnvelope, RELEASE_TAU_SEC } from './releaseEnvelope';

export const RISE_PER_SEC = 0.3;
export const FALL_PER_SEC = 0.6;
export const FALL_TAU_SEC = RELEASE_TAU_SEC;
/** Dim floor: the cap never goes below this, so the screen is never forced black. */
export const CAP_FLOOR = 0.15;
/** Rolling window for alternating dark/light reversal detection (WCAG 2.3.1: 1 second). */
export const REVERSAL_WINDOW_SEC = 1.0;
/** Max safe flashes/reversals per second before damping engages. */
export const MAX_REVERSALS_PER_SEC = 3;
/** Minimum luminance delta between frames to be considered a directional change. */
export const REVERSAL_THRESHOLD = 0.12;

/** Expose calm factor: 0.5 when Calm mode is enabled, 1.0 when disabled. */
export function calmFactor(calm: boolean): number {
  return calm ? 0.5 : 1.0;
}

/**
 * Viewer intensity setting (slice 21.3). Full is exactly today's limits. Reduced and Calm
 * only tighten them: a lower rise rate, fewer reversals allowed per second, and a lower
 * peak cap. No setting may exceed the Full values (enforced in safety.test.ts).
 */
export type Intensity = 'full' | 'reduced' | 'calm';

export interface IntensityLimits {
  /** Max cap rise per second (Full: RISE_PER_SEC). */
  risePerSec: number;
  /** Reversals per second allowed before damping engages (Full: MAX_REVERSALS_PER_SEC). */
  maxReversalsPerSec: number;
  /** Hard ceiling on the cap; 1.0 means no extra ceiling (Full). */
  ceiling: number;
}

export const INTENSITY_LIMITS: Readonly<Record<Intensity, IntensityLimits>> = {
  full: { risePerSec: RISE_PER_SEC, maxReversalsPerSec: MAX_REVERSALS_PER_SEC, ceiling: 1.0 },
  reduced: { risePerSec: 0.2, maxReversalsPerSec: 3, ceiling: 0.9 },
  calm: { risePerSec: 0.15, maxReversalsPerSec: 2, ceiling: 0.75 },
};

export const INTENSITY_OPTIONS: readonly Intensity[] = ['full', 'reduced', 'calm'];

export function isIntensity(value: unknown): value is Intensity {
  return typeof value === 'string' && (INTENSITY_OPTIONS as readonly string[]).includes(value);
}

export class BrightnessLimiter {
  private cap = CAP_FLOOR;
  private clock = 0;
  private lastTarget: number | null = null;
  private lastDirection = 0; // -1 = falling, 1 = rising, 0 = none
  private reversalTimes: number[] = [];
  private _reversalDamp = 0;
  private _intensity: Intensity = 'full';
  private limits: IntensityLimits = INTENSITY_LIMITS.full;
  public calm = false;

  /** Current viewer intensity. Survives reset(), since it is a user setting. */
  get intensity(): Intensity {
    return this._intensity;
  }

  /** Switch intensity. Unknown values fall back to Full, the widest allowed profile. */
  setIntensity(intensity: Intensity): void {
    const next = isIntensity(intensity) ? intensity : 'full';
    this._intensity = next;
    this.limits = INTENSITY_LIMITS[next];
  }

  /** Calm factor for compositor uniform state: 1.0 normal, 0.5 when Calm mode is enabled. */
  get calmFactor(): number {
    return calmFactor(this.calm);
  }

  /** Reversal damping factor in [0, 1]. Rises above 0 when > 3 reversals/sec occur. */
  get reversalDamp(): number {
    return this._reversalDamp;
  }

  /** Count of reversals in the rolling 1-second window. */
  get reversalCount(): number {
    return this.reversalTimes.length;
  }

  setCalm(calm: boolean): void {
    this.calm = calm;
  }

  /** Advance toward `target` (0..1 estimated brightness) over `dtSec`. Returns the cap. */
  step(target: number, dtSec: number, calm?: boolean): number {
    if (calm !== undefined) this.calm = calm;
    const t = Math.min(1, Math.max(CAP_FLOOR, Number.isFinite(target) ? target : CAP_FLOOR));
    const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;

    if (dt > 0) {
      this.clock += dt;

      // Track reversals (alternating dark/light transitions)
      if (this.lastTarget !== null) {
        const delta = t - this.lastTarget;
        if (Math.abs(delta) >= REVERSAL_THRESHOLD) {
          const dir = delta > 0 ? 1 : -1;
          if (this.lastDirection !== 0 && dir !== this.lastDirection) {
            this.reversalTimes.push(this.clock);
          }
          this.lastDirection = dir;
          this.lastTarget = t;
        }
      } else {
        this.lastTarget = t;
      }

      // Maintain rolling 1-second window
      const cutoff = this.clock - REVERSAL_WINDOW_SEC;
      // Drop reversals older than the window in place, without building a new array every frame.
      const times = this.reversalTimes;
      let keep = 0;
      for (let i = 0; i < times.length; i++) {
        const time = times[i]!;
        if (time > cutoff) times[keep++] = time;
      }
      times.length = keep;

      // Increase damping when reversals exceed 3 per second
      const count = this.reversalTimes.length;
      const maxReversals = this.limits.maxReversalsPerSec;
      if (count > maxReversals) {
        this._reversalDamp = Math.min(1.0, (count - maxReversals) * 0.25);
      } else {
        this._reversalDamp = 0;
      }
    }

    // Bidirectional luminance slew clamping:
    // Increased damping reduces slew rates and caps peak luminance.
    const dampMult = 1.0 - 0.5 * this._reversalDamp;
    const effRise = this.limits.risePerSec * dampMult;
    const effFall = FALL_PER_SEC * dampMult;

    if (t > this.cap) {
      // Clamped upward slew
      this.cap = Math.min(t, this.cap + effRise * dt);
    } else {
      // Clamped downward slew: release envelope bounded by maximum fall rate
      const env = releaseEnvelope(this.cap, t, dt, 0, FALL_TAU_SEC);
      const clamped = Math.max(t, this.cap - effFall * dt);
      this.cap = Math.max(CAP_FLOOR, Math.max(env, clamped));
    }

    if (this._reversalDamp > 0) {
      this.cap = Math.min(this.cap, 1.0 - 0.3 * this._reversalDamp);
    }
    // Intensity ceiling (Full: 1.0, so no change). Ceilings are never below CAP_FLOOR.
    this.cap = Math.min(this.cap, this.limits.ceiling);

    return this.cap;
  }

  get value(): number {
    return this.cap;
  }

  reset(): void {
    this.cap = CAP_FLOOR;
    this.clock = 0;
    this.lastTarget = null;
    this.lastDirection = 0;
    this.reversalTimes = [];
    this._reversalDamp = 0;
  }
}

/** Per-pixel rule from the composite shader, mirrored here for tests. */
export function capLuminance(rgb: [number, number, number], cap: number): [number, number, number] {
  const L = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  if (L <= cap) return rgb;
  const k = cap / Math.max(L, 0.0001);
  return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
}

/**
 * Saturated red: where R/(R+G+B) >= 0.8, mix the colour toward grey of the same
 * total brightness until the red share is exactly 0.79. Lowering R alone cannot
 * work when G and B are zero, so this desaturates instead (fixed in test, 2026-11-04).
 */
export function clampSaturatedRed(rgb: [number, number, number]): [number, number, number] {
  const sum = rgb[0] + rgb[1] + rgb[2];
  if (sum <= 0) return rgb;
  const r = rgb[0] / sum;
  if (r < 0.8) return rgb;
  const a = (r - 0.79) / (r - 1 / 3); // mix amount toward grey
  const grey = sum / 3;
  return [
    (1 - a) * rgb[0] + a * grey,
    (1 - a) * rgb[1] + a * grey,
    (1 - a) * rgb[2] + a * grey,
  ];
}

/**
 * Calm mode per-pixel contrast and saturation reduction, mirrored from composite.frag.glsl for tests.
 * Reduces contrast excursions from midpoint luminance (0.5) by 50% and caps peak saturation.
 */
export function applyCalmMode(rgb: [number, number, number]): [number, number, number] {
  // 1. Reduce contrast excursions from midpoint (0.5) by 50%
  let r = 0.5 + (rgb[0] - 0.5) * 0.5;
  let g = 0.5 + (rgb[1] - 0.5) * 0.5;
  let b = 0.5 + (rgb[2] - 0.5) * 0.5;

  // 2. Cap peak saturation (maxSat = 0.75)
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const sat = maxC > 0.0001 ? (maxC - minC) / maxC : 0;
  const maxSat = 0.75;
  if (sat > maxSat) {
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const factor = maxSat / sat;
    r = L + (r - L) * factor;
    g = L + (g - L) * factor;
    b = L + (b - L) * factor;
  }
  return [r, g, b];
}

/**
 * Reversal damping per-pixel attenuation, mirrored from composite.frag.glsl for tests.
 */
export function applyReversalDamp(rgb: [number, number, number], damp: number): [number, number, number] {
  const d = Math.max(0, Math.min(1, damp)) * 0.5;
  return [
    rgb[0] * (1 - d) + 0.5 * d,
    rgb[1] * (1 - d) + 0.5 * d,
    rgb[2] * (1 - d) + 0.5 * d,
  ];
}

/** Shortest allowed gap between two visible flash events: at most 3 per second (WCAG 2.3.1). */
export const MIN_FLASH_GAP_SEC = 1 / 3;

/**
 * Global flash governor (P6, 2026-11-04, patched). Macro flashes (e.g. kick shockwave,
 * tunnel beat flash) ask here first; particle sparkles and palette crossfades do not
 * consume tokens. A request is granted only if MIN_FLASH_GAP_SEC has passed since
 * the last grant, so flashes cannot strobe. A clock that jumps backwards (for example
 * after a restart) resets the governor.
 */
export class FlashGovernor {
  private lastGrantSec = Number.NEGATIVE_INFINITY;

  /** True if a flash may show now. Call once per flash event, at its start. */
  tryFlash(timeSec: number): boolean {
    if (!Number.isFinite(timeSec)) return false;
    if (timeSec < this.lastGrantSec) this.lastGrantSec = Number.NEGATIVE_INFINITY;
    // The 1e-9 tolerance stops float rounding from refusing an exact 1/3 s gap.
    if (timeSec - this.lastGrantSec < MIN_FLASH_GAP_SEC - 1e-9) return false;
    this.lastGrantSec = timeSec;
    return true;
  }

  reset(): void {
    this.lastGrantSec = Number.NEGATIVE_INFINITY;
  }
}

/** Shared by every layer, so the limit applies to the whole screen, not per layer. */
export const flashGovernor = new FlashGovernor();
