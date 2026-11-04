import { binForFrequency } from "../audio/bands";

export const BAR_MIN_HZ = 40;
export const BAR_MAX_HZ = 12000;

/** One visualizer bar: a frequency range and its half-open FFT bin range [loBin, hiBin). */
export interface BarEdge {
  loHz: number;
  hiHz: number;
  loBin: number;
  hiBin: number;
}

/**
 * Log-spaced frequency edges for bar `i` of `count` bars spanning
 * BAR_MIN_HZ..BAR_MAX_HZ. Adjacent bars share an edge.
 */
export function barEdgeHz(i: number, count: number): { loHz: number; hiHz: number } {
  if (!(count >= 1)) {
    throw new RangeError(`count must be >= 1, got ${count}`);
  }
  if (!(i >= 0 && i < count)) {
    throw new RangeError(`i must be in [0, ${count}), got ${i}`);
  }
  const ratio = BAR_MAX_HZ / BAR_MIN_HZ;
  return {
    loHz: BAR_MIN_HZ * ratio ** (i / count),
    hiHz: BAR_MIN_HZ * ratio ** ((i + 1) / count),
  };
}

/**
 * Build one BarEdge per bar. Guarantees hiBin > loBin where possible by
 * bumping hiBin to loBin + 1, capped at fftSize / 2.
 */
export function buildBarEdges(count: number, sampleRate: number, fftSize: number): BarEdge[] {
  if (!(count >= 1)) {
    throw new RangeError(`count must be >= 1, got ${count}`);
  }
  const maxHiBin = fftSize / 2;
  const edges: BarEdge[] = [];
  for (let i = 0; i < count; i++) {
    const { loHz, hiHz } = barEdgeHz(i, count);
    const loBin = binForFrequency(loHz, sampleRate, fftSize);
    let hiBin = binForFrequency(hiHz, sampleRate, fftSize);
    if (hiBin <= loBin) {
      hiBin = Math.min(loBin + 1, maxHiBin);
    }
    edges.push({ loHz, hiHz, loBin, hiBin });
  }
  return edges;
}
