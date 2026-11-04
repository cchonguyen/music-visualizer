// Forward-flight tunnel motion (Stage 2, slice 2.4).
//
// Pure logic, no GL. The tunnel's depth phase is INTEGRATED: phase += dt * rate
// every frame (see clock.ts). A rate that follows loudness can therefore change
// freely without the camera jumping backward.

import { Phase } from './clock';

/** Steady flight speed, in depth units per second. */
export const BASE_SPEED = 0.3;

/** Extra speed per unit of track-relative energy (0..1). Kept small: no shake. */
export const BOOST = 1.2; // raised from 0.4 (measured: speed barely changed on real music)

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

const TAU = 2 * Math.PI;

/** Slow roll of the ring shape, in radians per second, when quiet. */
export const ROLL_BASE = 0.08;

/** Extra roll speed per unit of energy (0..1). Normal mode only. */
export const ROLL_ENERGY = 0.15;

/** Figure-eight sway: cycles per second. */
export const BEND_HZ = 0.1;

/** Figure-eight sway amplitude in screen-width units (X) and screen-height units (Y), at mid = 1. */
export const BEND_X = 0.1;
export const BEND_Y = 0.06;

/**
 * Roll rate in radians per second. Never negative.
 * Normal: ROLL_BASE + ROLL_ENERGY * clamp(energy, 0, 1).
 * Calm:   ROLL_BASE (energy is ignored, so no speed-up).
 */
export function rollRate(energy: number, calm: boolean): number {
  if (calm) return ROLL_BASE;
  return ROLL_BASE + ROLL_ENERGY * clamp01(energy);
}

/** Wrap an angle into [0, 2π). Non-finite input becomes 0. */
export function wrapAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const wrapped = angle % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/** Integrated roll angle (radians). Adds dt * rate each frame, so changes never jump. */
export class RollState {
  private angle = 0;

  /** Advance by dtSec * rollRate(energy, calm) and return the new angle. */
  advance(dtSec: number, energy: number, calm: boolean): number {
    const dt = Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
    this.angle = wrapAngle(this.angle + dt * rollRate(energy, calm));
    return this.angle;
  }

  get current(): number {
    return this.angle;
  }

  reset(): void {
    this.angle = 0;
  }
}

/** Integrated bend angle (radians) that drives the figure-eight sway. */
export class BendState {
  private angle = 0;

  /** Advance by dtSec at BEND_HZ and return the new angle. */
  advance(dtSec: number): number {
    const dt = Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
    this.angle = wrapAngle(this.angle + dt * TAU * BEND_HZ);
    return this.angle;
  }

  get current(): number {
    return this.angle;
  }

  reset(): void {
    this.angle = 0;
  }
}

/**
 * Vanishing-point offset for the figure-eight sway, in uv units.
 * x = sin(a) and y = sin(2a) trace a figure-eight. Scaled by mid (0..1).
 * Calm returns zero: no sway.
 */
export function bendOffset(angle: number, mid: number, calm: boolean): { x: number; y: number } {
  if (calm) return { x: 0, y: 0 };
  const m = clamp01(mid);
  return { x: BEND_X * m * Math.sin(angle), y: BEND_Y * m * Math.sin(2 * angle) };
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
