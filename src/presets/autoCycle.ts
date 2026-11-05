// Auto-cycle (slice T2): picks the next preset on a timer or on a strong beat. Pure logic.
// Presets tagged "skip" are never picked. With `favouritesOnly`, only presets tagged "favourite" are used.
export type CycleMode = 'off' | 'timer' | 'beat';

export interface CycleOptions {
  mode: CycleMode;
  intervalSec: number; // timer mode: seconds between switches
  minGapSec: number; // beat mode: shortest time between switches
  shuffle: boolean;
  favouritesOnly: boolean;
}

export interface CycleCandidate {
  id: string;
  tags: readonly string[];
}

export const DEFAULT_CYCLE: CycleOptions = { mode: 'off', intervalSec: 20, minGapSec: 8, shuffle: false, favouritesOnly: false };

/** Presets that the cycle may show, in their list order. */
export function eligible(candidates: readonly CycleCandidate[], opts: CycleOptions): string[] {
  return candidates
    .filter((c) => !c.tags.includes('skip'))
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
  next(dtSec: number, strongBeat: boolean, current: string, pool: readonly string[], opts: CycleOptions): string | null {
    if (opts.mode === 'off' || pool.length < 2) return null;
    this.sinceSwitch += Math.max(0, dtSec);
    this.lastBeatSwitch += Math.max(0, dtSec);
    let due = false;
    if (opts.mode === 'timer') {
      due = this.sinceSwitch >= opts.intervalSec;
    } else if (opts.mode === 'beat') {
      due = strongBeat && this.lastBeatSwitch >= opts.minGapSec;
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
