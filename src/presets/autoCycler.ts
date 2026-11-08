// Auto-cycler (slice T2, extended in Slice 7.16 with 3.0s beatless fallback and archive exclusion):
// picks the next preset on a timer or on a strong beat with 3.0s fallback timeout.
// Presets tagged "skip" or in the "archive" group are excluded by default.
// With `favouritesOnly`, only presets tagged "favourite" are used.
export type CycleMode = 'off' | 'timer' | 'beat';

export interface CycleOptions {
  mode: CycleMode;
  intervalSec: number; // timer mode: seconds between switches
  minGapSec: number; // beat mode: shortest time between switches
  shuffle: boolean;
  favouritesOnly: boolean;
  fallbackSec?: number; // fallback timeout during beatless ambient breakdowns (default 3.0s)
  excludeArchive?: boolean; // defaults to true: excludes archive draft presets
}

export interface CycleCandidate {
  id: string;
  tags: readonly string[];
  group?: string;
}

export const DEFAULT_CYCLE: CycleOptions = {
  mode: 'off',
  intervalSec: 20,
  minGapSec: 8,
  shuffle: false,
  favouritesOnly: false,
  fallbackSec: 3.0,
  excludeArchive: true,
};

export const BEAT_FALLBACK_TIMEOUT_SEC = 3.0;

/** Presets that the cycle may show, in their list order. */
export function eligible(candidates: readonly CycleCandidate[], opts: CycleOptions): string[] {
  const excludeArchive = opts.excludeArchive ?? true;
  return candidates
    .filter((c) => !c.tags.includes('skip'))
    .filter((c) => !excludeArchive || (c.group !== 'archive' && !c.tags.includes('archive') && !c.id.startsWith('starter-')))
    .filter((c) => !opts.favouritesOnly || c.tags.includes('favourite'))
    .map((c) => c.id);
}

/**
 * Chooses the next id, or null when no switch should happen now.
 * `random` is injected so tests can fix the choice. Call once per frame.
 */
export class AutoCycler {
  private sinceSwitch = 0;
  // Time since the last beat-mode switch. Starts at 0 so the first switch also waits for the minimum gap.
  private lastBeatSwitch = 0;

  constructor(private random: () => number = Math.random) {}

  /** Restart the timers, for example after the user switches by hand. */
  reset(): void {
    this.sinceSwitch = 0;
    this.lastBeatSwitch = 0;
  }

  /**
   * @param dtSec      seconds since the last call
   * @param strongBeat true on a strong kick this frame (beat mode)
   * @param current    the preset on screen
   * @param pool       the eligible ids (see eligible())
   */
  next(
    dtSec: number,
    strongBeat: boolean,
    current: string,
    pool: readonly string[],
    opts: CycleOptions,
  ): string | null {
    if (opts.mode === 'off' || pool.length < 2) return null;
    this.sinceSwitch += Math.max(0, dtSec);
    this.lastBeatSwitch += Math.max(0, dtSec);
    let due = false;
    if (opts.mode === 'timer') {
      due = this.sinceSwitch >= opts.intervalSec;
    } else if (opts.mode === 'beat') {
      const fallback = opts.fallbackSec ?? BEAT_FALLBACK_TIMEOUT_SEC;
      const beatTriggered = strongBeat && this.lastBeatSwitch >= opts.minGapSec;
      const fallbackTriggered = this.lastBeatSwitch >= opts.minGapSec + fallback;
      due = beatTriggered || fallbackTriggered;
    }
    if (!due) return null;
    const pick = this.choose(current, pool, opts.shuffle);
    this.sinceSwitch = 0;
    this.lastBeatSwitch = 0;
    return pick;
  }

  private choose(current: string, pool: readonly string[], shuffle: boolean): string {
    const others = pool.filter((id) => id !== current);
    if (others.length === 0) return current;
    if (shuffle) return others[Math.floor(this.random() * others.length)]!;
    const at = pool.indexOf(current);
    return pool[(at + 1) % pool.length]!;
  }
}
