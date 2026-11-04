// Section contrast (Stage 2, P4, 2026-11-04). Loud mastered tracks sit near the top
// of the loudness range, so absolute level alone looks flat. Comparing the fast
// loudness with an 8 s slow average shows breakdowns (negative) and drops (positive).
//
// Pure logic, no GL. The caller keeps the slow follower (SlowFollower, tau 8 s).

import { SlowFollower } from './dynamics';

/** Time constant of the slow loudness average, in seconds. */
export const SLOW_TAU_SEC = 8;

/** Contrast is clamped to +/- this, so the effect stays bounded. */
export const CONTRAST_LIMIT = 0.5;

/** Slow loudness follower with the P4 time constant. */
export function makeSlowLoudness(): SlowFollower {
  return new SlowFollower(SLOW_TAU_SEC);
}

/**
 * fastLoudness - slowLoudness, clamped to +/- CONTRAST_LIMIT.
 * Negative = breakdown (lower rings and particle speed), positive = drop (surge).
 * Non-finite input returns 0 (no effect).
 */
export function sectionContrast(fastLoudness: number, slowLoudness: number): number {
  if (!Number.isFinite(fastLoudness) || !Number.isFinite(slowLoudness)) return 0;
  const raw = fastLoudness - slowLoudness;
  return Math.min(CONTRAST_LIMIT, Math.max(-CONTRAST_LIMIT, raw));
}
