// Pure state for the treble particle layer (Stage 2, slice 2.5 and P2). No GL here,
// so it can be unit tested. The vertex shader repeats these hash and radius formulas in GLSL.

/** Fixed number of particles in the pool. Must match the shader's loop/instance count. */
export const POOL_SIZE = 600;

/** Flash release time: how long a high-band onset takes to fade to 1/e. */
const FLASH_RELEASE_SEC = 0.15;

/** Radius range: particles spawn at 0.14 and reach the edge at 0.95. */
const RADIUS_NEAR = 0.14;
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
 * Radius along the path for a life value. Accelerates outward:
 * r = mix(launch, 0.95, life^1.8). Input is clamped to [0, 1].
 * `launch` is the spawn radius: 0.14 by default, or 0.16 + crown height (P5) so
 * particles leave the tips of the radial crown.
 */
export function radiusFor(life: number, launch = RADIUS_NEAR): number {
  const l = Math.min(1, Math.max(0, life));
  return launch + (RADIUS_FAR - launch) * Math.pow(l, 1.8);
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
 * Release is 150 ms exponential decay. Output is clamped to [0, 1].
 */
export function highFlash(prev: number, triggered: boolean, dtSec: number): number {
  if (triggered) return 1;
  const start = Number.isFinite(prev) ? prev : 0;
  const dt = Math.max(0, dtSec);
  const value = start * Math.exp(-dt / FLASH_RELEASE_SEC);
  return Math.min(1, Math.max(0, value));
}
