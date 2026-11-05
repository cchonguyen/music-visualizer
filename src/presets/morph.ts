// Morph (slice E-c): a slow cosine swing between a setting's value and its `to` value.
// Pure logic, so it is unit tested.
import type { Morph } from './format';

/** 0 → 1 → 0 cosine over each cycle. 0 when either input is not finite. */
export function morphPhase(timeSec: number, rateHz: number): number {
  if (!Number.isFinite(timeSec) || !Number.isFinite(rateHz)) return 0;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * rateHz * timeSec);
}

/** Moves from `base` toward `morph.to` and back, following the morph phase at `timeSec`. */
export function morphValue(base: number, morph: Morph, timeSec: number): number {
  return base + (morph.to - base) * morphPhase(timeSec, morph.rate);
}
