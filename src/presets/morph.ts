// Morph (slice E-c): a slow cosine swing between a setting's value and its `to` value.
// The swing runs on an integrated phase (phase += rate * dt), so changing the rate never jumps the wave.
// Pure logic, so it is unit tested.
import type { Morph } from './format';

/** Largest time step one update may add. A pause, seek or hidden tab must not spin the phase. */
export const MORPH_MAX_DT_SEC = 0.1;

/** Running state of one morph: the phase in cycles (0..1) and the clock reading it was last advanced to. */
export interface MorphPhaseState {
  cycles: number;
  lastTimeSec: number;
}

/** Shape of the swing: 0 → 1 → 0 cosine over one cycle. `cycles` is the phase in cycles. 0 when not finite. */
export function morphShape(cycles: number): number {
  if (!Number.isFinite(cycles)) return 0;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * cycles);
}

/** 0 → 1 → 0 cosine over each cycle, from absolute time. 0 when either input is not finite. */
export function morphPhase(timeSec: number, rateHz: number): number {
  if (!Number.isFinite(timeSec) || !Number.isFinite(rateHz)) return 0;
  return morphShape(rateHz * timeSec);
}

/**
 * Advances the integrated phase to `timeSec` at `rateHz` and returns the 0..1 swing.
 * The first call starts at the phase absolute time would give. Later calls add `rate * dt`, with dt
 * clamped to 0..MORPH_MAX_DT_SEC, so the rate can change at any moment without a jump.
 */
export function advanceMorphPhase(state: MorphPhaseState | undefined, timeSec: number, rateHz: number): { state: MorphPhaseState; value: number } {
  if (!Number.isFinite(timeSec) || !Number.isFinite(rateHz)) {
    return { state: state ?? { cycles: 0, lastTimeSec: 0 }, value: 0 };
  }
  if (!state) {
    const cycles = (((rateHz * timeSec) % 1) + 1) % 1;
    return { state: { cycles, lastTimeSec: timeSec }, value: morphShape(cycles) };
  }
  const dt = Math.min(MORPH_MAX_DT_SEC, Math.max(0, timeSec - state.lastTimeSec));
  const cycles = (((state.cycles + rateHz * dt) % 1) + 1) % 1;
  return { state: { cycles, lastTimeSec: timeSec }, value: morphShape(cycles) };
}

// One running phase per morph object (presets are parsed once, so the object is stable).
const phaseStates = new WeakMap<Morph, MorphPhaseState>();

/** Moves from `base` toward `morph.to` and back, following the integrated morph phase at `timeSec`. */
export function morphValue(base: number, morph: Morph, timeSec: number): number {
  const { state, value } = advanceMorphPhase(phaseStates.get(morph), timeSec, morph.rate);
  phaseStates.set(morph, state);
  return base + (morph.to - base) * value;
}
