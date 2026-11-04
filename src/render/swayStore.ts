// One figure-eight sway offset per frame, shared by the tunnel, particles and (later)
// the radial crown, so they all move together and never separate (patch 2026-11-04).
// The host computes it once per frame with setSway(); layers only read it with getSway().
import { BendState, bendOffset } from './tunnelState';

export interface SwayOffset {
  /** Vanishing-point offset in uv units (screen = 0..1). Zero in Calm. */
  x: number;
  y: number;
}

const ZERO: SwayOffset = { x: 0, y: 0 };
let current: SwayOffset = ZERO;
const bend = new BendState();

/** Advance the shared sway once for this frame and store it. Call once per frame. */
export function advanceSway(dtSec: number, mid: number, calm: boolean): SwayOffset {
  const angle = bend.advance(dtSec);
  const o = bendOffset(angle, mid, calm);
  current = { x: o.x, y: o.y };
  return current;
}

/** The sway for this frame, as last computed by advanceSway(). */
export function getSway(): SwayOffset {
  return current;
}

/** Test and reset helper. */
export function resetSway(): void {
  bend.reset();
  current = ZERO;
}
