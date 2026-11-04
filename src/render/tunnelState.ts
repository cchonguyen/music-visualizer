// Forward-flight tunnel motion (Stage 2, slice 2.4).
//
// Pure logic, no GL. The tunnel's depth phase is INTEGRATED: phase += dt * rate
// every frame (see clock.ts). A rate that follows loudness can therefore change
// freely without the camera jumping backward.

import { Phase } from './clock';

/** Steady flight speed, in depth units per second. */
export const BASE_SPEED = 0.6;

/** Extra speed per unit of track-relative energy (0..1). Kept small: no shake. */
export const BOOST = 0.4;

/** Calm mode drifts at a quarter of the base speed, with no energy term. */
const CALM_FACTOR = 0.25;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Flight rate in depth units per second. Never negative.
 * Normal: BASE_SPEED + BOOST * clamp(energy, 0, 1).
 * Calm:   BASE_SPEED * 0.25 (energy is ignored).
 */
export function flightRate(energy: number, calm: boolean): number {
  if (calm) return BASE_SPEED * CALM_FACTOR;
  return BASE_SPEED + BOOST * clamp01(energy);
}

/** Owns the monotonic flight phase that drives the ring offset in the shader. */
export class FlightState {
  private readonly phase = new Phase();

  /**
   * Advance the phase by dtSec * flightRate(energy, calm) and return the new phase.
   * NOTE(spec): Phase wraps at PHASE_WRAP (10000) per clock.ts, so "never decreases"
   * holds for any realistic session, but it is a modulo wrap, not an infinite counter.
   */
  advance(dtSec: number, energy: number, calm: boolean): number {
    return this.phase.advance(dtSec, flightRate(energy, calm));
  }

  /** Current phase without advancing. */
  get current(): number {
    return this.phase.current;
  }

  /** Back to phase 0 (for example, when the scene restarts). */
  reset(): void {
    this.phase.reset();
  }
}
