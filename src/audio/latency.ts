// Slice 1.10 — end-to-end audio latency estimate (pure, no DOM/Web Audio).
// NOTE(spec): all times (kickTimes, beatTimes, outputLatencySec, baseLatencySec)
// are seconds on the AudioContext clock; frameMs and the result are milliseconds.
// "Latest earlier kick" is read as kick <= beat, so a beat detected on the very
// frame of its kick still pairs (matched times must not report an empty window).
// "Within 200 ms" is read as an inclusive window: 0 <= (beat - kick) <= 200 ms.
// With no pairs at all we return { medianMs: 0, samples: 0 }; the caller treats
// samples === 0 the same as "no estimate available" (panel shows n/a).

/** Result of a latency estimate: the median of per-beat estimates, in ms. */
export interface LatencyEstimate {
  medianMs: number;
  /** How many beat/kick pairs went into the median (0 = no usable estimate). */
  samples: number;
}

/** A detection gap wider than this cannot plausibly be the same event. */
const KICK_WINDOW_SEC = 0.2;

/**
 * Pair each detected beat with the latest earlier kick (at most 200 ms before
 * it) that has not been used yet — each kick pairs with at most one beat.
 *
 * Result = how far the visual trails the sound you HEAR:
 *   lag = detection gap (beat - kick) + one display frame - (output + base latency)
 * The analyser sees the kick at its scheduled time, but the speakers play it
 * late by the output latency, so that latency hides part of the visual delay
 * (lead review 2026-11-04: the original spec added it, which was wrong).
 * Can be negative (visual slightly ahead of the sound). Median over all pairs.
 */
export function estimateLatencyMs(
  kickTimes: number[],
  beatTimes: number[],
  outputLatencySec: number,
  baseLatencySec: number,
  frameMs: number,
): LatencyEstimate {
  // Copies so the caller's arrays keep their order; ascending is required for
  // the scan-from-the-end pairing below.
  const kicks = [...kickTimes].sort((a, b) => a - b);
  const used = new Array<boolean>(kicks.length).fill(false);
  const latencies: number[] = [];

  // Terms that are identical for every pair; only the detection gap varies.
  const fixedMs = frameMs - (outputLatencySec + baseLatencySec) * 1000;

  const beats = [...beatTimes].sort((a, b) => a - b);
  for (const beat of beats) {
    // Latest unused kick at or before the beat, inside the 200 ms window.
    let bestIdx = -1;
    for (let i = kicks.length - 1; i >= 0; i -= 1) {
      const kick = kicks[i] as number;
      if (kick > beat) continue; // not "earlier" — keep looking back
      if (beat - kick > KICK_WINDOW_SEC) break; // older kicks are even farther
      if (!used[i]) {
        bestIdx = i;
        break;
      }
    }
    if (bestIdx >= 0) {
      used[bestIdx] = true;
      const gapMs = (beat - (kicks[bestIdx] as number)) * 1000;
      latencies.push(gapMs + fixedMs);
    }
  }

  const samples = latencies.length;
  if (samples === 0) return { medianMs: 0, samples: 0 };

  latencies.sort((a, b) => a - b);
  const mid = Math.floor(samples / 2);
  const medianMs =
    samples % 2 === 1
      ? (latencies[mid] as number)
      : ((latencies[mid - 1] as number) + (latencies[mid] as number)) / 2;
  return { medianMs, samples };
}
