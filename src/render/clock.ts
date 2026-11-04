// Render clock and phase accumulators (Council round 2).
//
// Motion must be INTEGRATED, not computed as time * speed. If a tunnel's speed
// follows loudness and the shader uses time * speed, the camera jumps backward
// whenever the music gets quieter. Instead: phase += dt * speed, every frame.

/** The visual clock: keeps running while audio is paused or suspended. */
export interface RenderClock {
  timeSec: number; // seconds since the renderer started
  dtSec: number; // seconds since the previous frame, clamped to [0, MAX_DT_SEC]
  frameIndex: number;
}

/** A tab returning from the background must not fling motion forward. */
export const MAX_DT_SEC = 0.1;

/** Wraps long before float32 loses precision in shaders (~2.7 hours at speed 1). */
export const PHASE_WRAP = 10000;

/** Monotonic phase: never steps backward, whatever the rate does. */
export class Phase {
  private value = 0;

  /** Advance by dt * rate. Negative rates are treated as 0 (no backward motion). */
  advance(dtSec: number, rate: number): number {
    const step = Math.max(0, dtSec) * Math.max(0, rate);
    this.value = (this.value + step) % PHASE_WRAP;
    return this.value;
  }

  get current(): number {
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }
}

export function clampDt(dtSec: number): number {
  if (!Number.isFinite(dtSec) || dtSec < 0) return 0;
  return Math.min(MAX_DT_SEC, dtSec);
}
