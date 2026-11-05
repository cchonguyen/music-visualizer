// Shared release envelope (Stage 2.5, constraint C2). Pure, no GL, so it can be unit tested.
//
// Every layer opacity and the master brightness scalar eases toward its target with
// this helper. Rising targets use an attack time constant (fast, or 0 = instant).
// Falling targets use the release time constant, RELEASE_TAU_SEC (320 ms), so a
// loud-to-quiet step falls over about 1 s (3 time constants) with no single-frame jump.

/** Release time constant shared by all quiet-passage fades. Inside the 250–400 ms band. */
export const RELEASE_TAU_SEC = 0.32;

/**
 * One smoothing step toward `target`.
 * - `target > current` uses `attackTau`; otherwise `releaseTau`.
 * - A tau of 0 means no smoothing (the value jumps to the target on the next step).
 * - Coefficient is 1 - exp(-dt / tau), clamped to [0, 1], so the result never
 *   overshoots the target. dt = 0 (or a bad dt) leaves the value unchanged.
 */
export function releaseEnvelope(
  current: number,
  target: number,
  dtSec: number,
  attackTau: number,
  releaseTau: number,
): number {
  const cur = Number.isFinite(current) ? current : 0;
  const tgt = Number.isFinite(target) ? target : 0;
  const dt = Number.isFinite(dtSec) && dtSec > 0 ? dtSec : 0;
  if (dt === 0) return cur;
  const tau = tgt > cur ? attackTau : releaseTau;
  const k = tau > 0 ? Math.min(1, Math.max(0, 1 - Math.exp(-dt / tau))) : 1;
  return cur + (tgt - cur) * k;
}
