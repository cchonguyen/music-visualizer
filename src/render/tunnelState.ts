// Forward-flight tunnel motion (Stage 2, slice 2.4).
//
// Pure logic, no GL. The tunnel's depth phase is INTEGRATED: phase += dt * rate
// every frame (see clock.ts). A rate that follows loudness can therefore change
// freely without the camera jumping backward.

import { Phase } from './clock';
import type { AudioFrame } from '../audio/types';
import type { TunnelParams } from '../presets/layerSchemas';

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
 * Normal: (BASE_SPEED + BOOST * clamp(energy, 0, 1)) * scale.
 * Calm:   BASE_SPEED * 0.25 * scale (energy is ignored; scale carries visual gain).
 * scale (P4): 1 + section contrast, so breakdowns slow the flight and drops speed it up.
 */
export function flightRate(energy: number, calm: boolean, scale = 1): number {
  const s = Number.isFinite(scale) ? Math.max(0, scale) : 1;
  // Visual gain (inside scale) also applies in Calm, so the slider works in every mode.
  if (calm) return BASE_SPEED * CALM_FACTOR * s;
  return (BASE_SPEED + BOOST * clamp01(energy)) * s;
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
  advance(dtSec: number, energy: number, calm: boolean, scale = 1): number {
    return this.phase.advance(dtSec, flightRate(energy, calm, scale));
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

export interface StepTunnelFrame {
  time?: number;
  energy?: number;
  sectionContrast?: number;
  sub?: number;
  kick?: number;
  norm?: {
    sub?: number;
    kick?: number;
    [key: string]: number | undefined;
  };
  beatByBand?: {
    sub?: boolean;
    [key: string]: boolean | undefined;
  };
  [key: string]: unknown;
}

export interface StepTunnelParams extends Partial<TunnelParams> {
  calm?: boolean;
  scale?: number;
  [key: string]: unknown;
}

/** Tunnel state tracking breakdown flight reversal, velocity slew, and horizon sway. */
export class TunnelState {
  flightSign: number = 1;
  velocityMultiplier: number = 1;
  reverseCooldownSec: number = 18;
  reverseHoldSec: number = 0;
  horizonSwayPhase: number = 0;
  vanishX: number = 0;
  vanishY: number = 0;
  forwardPhase: number = 0;

  constructor(init?: Partial<TunnelState>) {
    if (init) Object.assign(this, init);
  }
}

export function createTunnelState(init?: Partial<TunnelState>): TunnelState {
  return new TunnelState(init);
}

/**
 * Step tunnel motion, breakdown reversal timing, velocity smoothing, and horizon sway.
 */
export function stepTunnel(
  state: TunnelState,
  frame: StepTunnelFrame | AudioFrame | any,
  dt: number,
  params: StepTunnelParams = {},
): { forwardDelta: number; forwardPhase: number } {
  const dtSec = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  const sub = frame?.norm?.sub ?? frame?.sub ?? 0;
  state.reverseCooldownSec += dtSec;
  state.horizonSwayPhase += dtSec * (0.45 + sub * 0.85);

  const horizonDrift = params.horizonDrift ?? 0.40;
  state.vanishX += Math.sin(state.horizonSwayPhase) * 0.22 * horizonDrift;

  const flightMode = params.flightMode ?? 'dropReverse';
  const reverseOnBreakdown = params.reverseOnBreakdown !== false;

  let target: number;

  if (flightMode === 'forward' || (!reverseOnBreakdown && flightMode === 'dropReverse')) {
    target = 1.0;
  } else if (flightMode === 'reverse') {
    target = -0.75;
  } else if (flightMode === 'pendulum') {
    const t = frame?.time ?? 0;
    target = Math.sin(t * 0.28);
  } else {
    // flightMode === 'dropReverse' with reverseOnBreakdown !== false
    const contrast = frame?.sectionContrast ?? 0;
    const energy = frame?.energy ?? 0;
    const kick = frame?.norm?.kick ?? frame?.kick ?? 0;

    if (state.flightSign > 0) {
      if (state.reverseCooldownSec >= 18.0 && (contrast < -0.06 || energy < 0.18)) {
        state.flightSign = -1;
        state.reverseCooldownSec = 0;
        state.reverseHoldSec = 4.5;
      }
    } else {
      state.reverseHoldSec = Math.max(0, state.reverseHoldSec - dtSec);
      if (state.reverseHoldSec <= 0 && (kick > 0.45 || contrast > 0.05 || state.reverseCooldownSec >= 8.0)) {
        state.flightSign = 1;
        state.reverseCooldownSec = 0;
      }
    }
    target = state.flightSign > 0 ? 1.0 : -0.65;
  }

  // Smoothly slew velocityMultiplier toward target with 1.4s time constant
  const alpha = dtSec > 0 ? 1 - Math.exp(-dtSec / 1.4) : 0;
  state.velocityMultiplier += (target - state.velocityMultiplier) * alpha;

  // Multiply forward delta by state.velocityMultiplier
  const calm = params.calm ?? false;
  const scale = params.scale ?? 1;
  const baseRate = flightRate(frame?.energy ?? 0, calm, scale);
  const forwardDelta = dtSec * baseRate * state.velocityMultiplier;
  state.forwardPhase += forwardDelta;

  return { forwardDelta, forwardPhase: state.forwardPhase };
}

