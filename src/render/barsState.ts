// Pure bar-value logic for the bars layer (Stage 2, slice 2.6). No GL here, so it is testable.
import type { BarEdge } from './logScale';

/** Number of bars drawn by the bars layer. */
export const BAR_COUNT = 48;

/**
 * One value per bar: the mean of `smoothed` over the bar's bins [loBin, hiBin),
 * clamped to 0..1. Bins past the end of `smoothed` are ignored. Empty bins give 0.
 */
export function barValues(smoothed: Float32Array, edges: BarEdge[]): Float32Array {
  const out = new Float32Array(edges.length);
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!edge) continue;
    const lo = Math.max(0, edge.loBin);
    const hi = Math.min(edge.hiBin, smoothed.length);
    if (hi <= lo) continue;
    let sum = 0;
    for (let k = lo; k < hi; k++) {
      sum += smoothed[k] ?? 0;
    }
    const mean = sum / (hi - lo);
    out[i] = Math.min(1, Math.max(0, mean));
  }
  return out;
}
