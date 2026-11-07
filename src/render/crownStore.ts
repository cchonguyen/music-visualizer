// Crown heights (Stage 2, P5). The 48 frequency bars drawn radially around the tunnel
// rim, and the particle launch offsets, both read these heights. Once per frame the
// host calls advanceCrown(); layers only read getCrownHeights().
import { BAR_COUNT, barValues } from './barsState';
import type { BarEdge } from './logScale';
import { buildBarEdges } from './logScale';
import { SlowFollower, punch } from './dynamics';
import { getVisualGain, shapeReaction } from './gainStore';

/** Calm dampens the crown (and so the particle launch) to 35%. */
export const CROWN_CALM_SCALE = 0.35;

const heights = new Float32Array(BAR_COUNT);
const currentHeights = new Float32Array(BAR_COUNT);
const targetHeights = new Float32Array(BAR_COUNT);
const slow: SlowFollower[] = Array.from({ length: BAR_COUNT }, () => new SlowFollower(2.5));
let edges: BarEdge[] = [];
let edgeSampleRate = -1;
let edgeFftSize = -1;

/**
 * Pure step: turns raw per-bar values (0..1, from barValues) into heights (0..1).
 * Same shaping as the bars layer: expand the narrow absolute range, add the punch
 * above each bar's own recent average, then scale by visual gain. Calm scales by 0.35.
 * `slowAvg` is updated in place (one follower per bar).
 */
export function shapeHeights(
  raw: Float32Array,
  slowAvg: SlowFollower[],
  dtSec: number,
  gain: number,
  calm: boolean,
  out: Float32Array,
): Float32Array {
  const dt = Math.max(0, dtSec);
  const calmScale = calm ? CROWN_CALM_SCALE : 1;
  for (let i = 0; i < out.length; i++) {
    const v = raw[i] ?? 0;
    const base = slowAvg[i]!.step(v, dt);
    const expanded = Math.min(1, Math.max(0, (v - 0.3) / 0.4));
    const h = shapeReaction(0.6 * expanded + 0.8 * punch(v, base, 6), gain) * calmScale;
    out[i] = Math.min(1, Math.max(0, Number.isFinite(h) ? h : 0));
  }
  return out;
}

/**
 * Advance the crown once for this frame. `enabled` false (any scene without the crown)
 * keeps the followers running but stores zeros, so particles do not launch from nothing.
 */
export function advanceCrown(
  smoothed: Float32Array,
  sampleRate: number,
  fftSize: number,
  dtSec: number,
  calm: boolean,
  enabled: boolean,
): void {
  if (sampleRate !== edgeSampleRate || fftSize !== edgeFftSize) {
    edges = buildBarEdges(BAR_COUNT, sampleRate, fftSize);
    edgeSampleRate = sampleRate;
    edgeFftSize = fftSize;
  }
  const raw = barValues(smoothed, edges);
  shapeHeights(raw, slow, dtSec, getVisualGain(), calm, targetHeights);
  if (!enabled) {
    heights.fill(0);
    currentHeights.fill(0);
    return;
  }
  const dt = Math.max(0, dtSec);
  for (let i = 0; i < BAR_COUNT; i++) {
    const h = targetHeights[i] ?? 0;
    const curr = currentHeights[i] ?? 0;
    const tau = h > curr ? 0.020 : 0.140;
    const k = dt > 0 ? 1 - Math.exp(-dt / tau) : 1;
    const nextH = curr + k * (h - curr);
    currentHeights[i] = nextH;
    heights[i] = nextH;
  }
}

/** The heights for this frame, as last computed by advanceCrown(). Length BAR_COUNT. */
export function getCrownHeights(): Float32Array {
  return heights;
}

/** Test and reset helper. */
export function resetCrown(): void {
  heights.fill(0);
  currentHeights.fill(0);
  targetHeights.fill(0);
  for (const f of slow) f.reset();
  edgeSampleRate = -1;
  edgeFftSize = -1;
}
