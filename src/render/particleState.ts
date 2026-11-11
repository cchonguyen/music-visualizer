// Pure state for the treble particle layer (Stage 2, slice 2.5 and P2). No GL here,
// so it can be unit tested. The vertex shader repeats these hash and radius formulas in GLSL.

import { releaseEnvelope, RELEASE_TAU_SEC } from './releaseEnvelope';

/** Default particle count. Presets that do not set a count keep drawing this many. */
export const POOL_SIZE = 600;
/** Fewest and most particles a layer can ask for. */
export const MIN_PARTICLES = 50;
export const MAX_PARTICLES = 4000;
/** The render scale never thins the particles below this share of what was asked for. */
const MIN_COUNT_SHARE = 0.25;

/**
 * Number of particles to draw: the requested count, thinned when the render scale is below 100%
 * (weaker devices and the quality governor lower the scale). At scale 1 the request is used as is.
 */
export function effectiveParticleCount(requested: number, renderScale: number): number {
  const asked = Number.isFinite(requested) ? requested : POOL_SIZE;
  const base = Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, Math.round(asked)));
  const scale = Number.isFinite(renderScale) ? Math.min(1, Math.max(MIN_COUNT_SHARE, renderScale)) : 1;
  return Math.max(MIN_PARTICLES, Math.round(base * scale));
}

/** Spawn radius (C3): particles start at the crown bar tips, r = 0.16, the inner rim of the tunnel. */
export const SPAWN_RADIUS = 0.16;
/** Edge radius: particles fly out to 0.95. */
const RADIUS_FAR = 0.95;

/** One salt per particle property, so each hash is independent of the others. */
export const SALT_SEED = 0;
export const SALT_SPEED = 1;
export const SALT_ANGLE = 2;
export const SALT_SWIRL = 3;
export const SALT_TWINKLE_RATE = 4;
export const SALT_TWINKLE_PHASE = 5;

/**
 * Deterministic pseudo-random value in [0, 1) for a particle index and a salt.
 * Same formula as hash01() in particles.vert.glsl: fract(sin(x) * 43758.5453).
 * Uses a true fract (x - floor(x)), which matches GLSL for negative sine values too.
 */
export function hash01(index: number, salt: number): number {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Per-particle seed: the spawn offset along the life cycle. */
export function seedFor(index: number): number {
  return hash01(index, SALT_SEED);
}

/**
 * Tunnel depth at radius r is 1/r (tunnel.frag.glsl). A particle flies at constant
 * depth speed, the same as the tunnel rings, so r = 1 / mix(1/0.16, 1/0.95, life).
 * Input is clamped to [0, 1]. It starts at 0.16 and reaches 0.95, accelerating outward.
 */
export function radiusFor(life: number): number {
  const l = Math.min(1, Math.max(0, life));
  const depthNear = 1 / SPAWN_RADIUS;
  const depthFar = 1 / RADIUS_FAR;
  return 1 / (depthNear + (depthFar - depthNear) * l);
}

/**
 * Radial speed per unit life, dr/dlife. From r = 1/D with D linear in life:
 * dr/dlife = (1/0.16 - 1/0.95) * r^2. Always positive, so particles move outward.
 * particles.vert.glsl uses the same formula.
 */
export function radialSpeedFor(life: number): number {
  const r = radiusFor(life);
  return (1 / SPAWN_RADIUS - 1 / RADIUS_FAR) * r * r;
}

/** Life rate per particle, 0.06 to 0.16 (multiplies the integrated phase). */
export function speedFor(index: number): number {
  return 0.06 + 0.1 * hash01(index, SALT_SPEED);
}

/** Starting angle per particle, in radians, 0 to 2π. */
export function angleFor(index: number): number {
  return hash01(index, SALT_ANGLE) * 2 * Math.PI;
}

/** Swirl direction per particle, -1.2 to +1.2. The shader multiplies it by the midrange drive. */
export function swirlFor(index: number): number {
  return -1.2 + 2.4 * hash01(index, SALT_SWIRL);
}

/**
 * High-band flash envelope. Attack is instant (0 ms): a trigger sets it to 1.
 * Release uses the shared 320 ms envelope (releaseEnvelope, C2). Output is clamped to [0, 1].
 */
export function highFlash(prev: number, triggered: boolean, dtSec: number): number {
  if (triggered) return 1;
  const value = releaseEnvelope(prev, 0, dtSec, 0, RELEASE_TAU_SEC);
  return Math.min(1, Math.max(0, value));
}
