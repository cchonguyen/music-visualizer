// Brightness limiter for the final composite (slice 2.2).
//
// JS cannot read the real brightness of a procedural shader without a slow GPU
// readback, so this keeps an ESTIMATE of the scene's luminance cap:
// - it may rise by at most RISE_PER_SEC (0.30/s, which is +0.10 per 333 ms);
// - it falls with a time constant of 0.5 s, so a quiet passage pulls the cap
//   back down instead of sticking at full brightness (architect review, 2026-11-04).
// The composite shader scales any pixel brighter than the cap down to it.

export const RISE_PER_SEC = 0.3;
export const FALL_TAU_SEC = 0.5;
/** Dim floor: the cap never goes below this, so the screen is never forced black. */
export const CAP_FLOOR = 0.15;

export class BrightnessLimiter {
  private cap = CAP_FLOOR;

  /** Advance toward `target` (0..1 estimated brightness) over `dtSec`. Returns the cap. */
  step(target: number, dtSec: number): number {
    const t = Math.min(1, Math.max(CAP_FLOOR, Number.isFinite(target) ? target : CAP_FLOOR));
    const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
    if (t > this.cap) {
      this.cap = Math.min(t, this.cap + RISE_PER_SEC * dt);
    } else {
      const k = 1 - Math.exp(-dt / FALL_TAU_SEC);
      this.cap = this.cap + k * (t - this.cap);
    }
    return this.cap;
  }

  get value(): number {
    return this.cap;
  }

  reset(): void {
    this.cap = CAP_FLOOR;
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
