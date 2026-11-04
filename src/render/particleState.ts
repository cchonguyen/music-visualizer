// Pure state for the treble particle layer (Stage 2, slice 2.5). No GL here, so
// it can be unit tested. The vertex shader repeats the seed formula in GLSL.

/** Fixed number of particles in the pool. Must match the shader's loop/instance count. */
export const POOL_SIZE = 600;

/** Flash release time: how long a high-band onset takes to fade to 1/e. */
const FLASH_RELEASE_SEC = 0.15;

/**
 * Deterministic pseudo-random value in [0, 1) for a particle index.
 * Same hash as the classic GLSL fract(sin(x) * 43758.5453) trick.
 */
export function seedFor(index: number): number {
  const x = Math.sin(index * 12.9898) * 43758.5453;
  return Math.abs(x) - Math.floor(Math.abs(x));
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
