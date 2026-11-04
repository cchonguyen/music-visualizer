// Drop colour swap (Stage 2, P4, 2026-11-04). When a kick lands after a breakdown
// dip and the energy is high, accents A and B swap over about 1 s. This is a smooth
// crossfade, not a flash, so it does NOT use the flash governor (owner patch 2026-11-04).
//
// Pure logic, no GL. Each drop toggles the swap, so the next drop swaps back.

import type { RGB } from './palette';

/** A breakdown dip: section contrast below this, seen recently. */
export const DIP_THRESHOLD = -0.15;
/** How long a dip stays "recent", in seconds. */
export const DIP_WINDOW_SEC = 8;
/** Minimum track-relative energy for a drop. */
export const DROP_ENERGY = 0.75;
/** Crossfade length, in seconds. */
export const SWAP_SEC = 1;

export interface ColourSwapInput {
  dtSec: number;
  /** sectionContrast() for this frame. */
  contrast: number;
  /** frame.energy (track-relative, 0..1). */
  energy: number;
  /** frame.beatByBand.sub: a kick landed this frame. */
  kick: boolean;
  /** Calm: no new swaps, and any swap eases back to normal. */
  calm: boolean;
}

function smooth01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

export class ColourSwap {
  private time = 0;
  private lastDipSec = Number.NEGATIVE_INFINITY;
  /** Whether the accents are (or should be) swapped. */
  private swapped = false;
  /** Linear crossfade position: 0 = normal, 1 = swapped. */
  private pos = 0;

  /** Advance one frame. Returns the eased mix: 0 = accents A/B normal, 1 = fully swapped. */
  update(input: ColourSwapInput): number {
    const dt = Number.isFinite(input.dtSec) ? Math.max(0, input.dtSec) : 0;
    this.time += dt;

    if (input.contrast < DIP_THRESHOLD) this.lastDipSec = this.time;

    if (input.calm) {
      this.swapped = false;
    } else if (
      input.kick &&
      input.energy > DROP_ENERGY &&
      this.time - this.lastDipSec <= DIP_WINDOW_SEC
    ) {
      // One drop uses up the dip, so the next kick cannot swap again on its own.
      this.swapped = !this.swapped;
      this.lastDipSec = Number.NEGATIVE_INFINITY;
    }

    const target = this.swapped ? 1 : 0;
    const step = dt / SWAP_SEC;
    if (this.pos < target) this.pos = Math.min(target, this.pos + step);
    else this.pos = Math.max(target, this.pos - step);
    return smooth01(this.pos);
  }

  reset(): void {
    this.time = 0;
    this.lastDipSec = Number.NEGATIVE_INFINITY;
    this.swapped = false;
    this.pos = 0;
  }
}

/** Accent A and accent B for a given swap mix (0 = unchanged, 1 = exchanged). */
export function blendAccents(a: RGB, b: RGB, mix: number): { a: RGB; b: RGB } {
  const t = Math.min(1, Math.max(0, mix));
  const lerp = (x: RGB, y: RGB): RGB => [
    x[0] + (y[0] - x[0]) * t,
    x[1] + (y[1] - x[1]) * t,
    x[2] + (y[2] - x[2]) * t,
  ];
  return { a: lerp(a, b), b: lerp(b, a) };
}
