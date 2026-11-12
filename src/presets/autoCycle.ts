// Auto-cycle (slice T2): picks the next preset on a timer or on a strong beat. Pure logic.
// Presets tagged "skip" are never picked. With `favouritesOnly`, only presets tagged "favourite" are used.
import { withinCost, type CostLevel } from './cost';

export type CycleMode = 'off' | 'timer' | 'beat';

export interface CycleOptions {
  mode: CycleMode;
  intervalSec: number; // timer mode: seconds between switches
  minGapSec: number; // beat mode: shortest time between switches
  shuffle: boolean;
  favouritesOnly: boolean;
  calmOnly?: boolean;
  /** Skip presets heavier than this (Slice 16.11). Missing means no limit. Ignored if it would leave fewer than 2 presets. */
  maxCost?: CostLevel;
}

export interface CycleCandidate {
  id: string;
  tags: readonly string[];
  /** Cost level from presets/cost.ts. Missing counts as Light. */
  cost?: CostLevel;
}

/** How many seconds before a switch the next preset is chosen, so it can be prepared (Slice 16.3). */
export const PREPARE_LEAD_SEC = 3;

export const DEFAULT_CYCLE: CycleOptions = { mode: 'timer', intervalSec: 20, minGapSec: 8, shuffle: false, favouritesOnly: false, calmOnly: false };

/** Presets that the cycle may show, in their list order. */
export function eligible(candidates: readonly CycleCandidate[], opts: CycleOptions): string[] {
  const nonSkipped = candidates.filter((c) => !c.tags.includes('skip'));
  const favourite = opts.favouritesOnly
    ? nonSkipped.filter((c) => c.tags.includes('favourite'))
    : nonSkipped;
  // Slice 16.11: devices that cannot keep up skip the heaviest presets, unless that would leave nothing to switch to.
  const max = opts.maxCost;
  const light = max ? favourite.filter((c) => withinCost(c.cost ?? 'light', max)) : favourite;
  const base = light.length >= 2 ? light : favourite;

  if (opts.calmOnly === true) {
    const calm = base.filter((c) => c.tags.includes('calm'));
    if (calm.length >= 2) {
      return calm.map((c) => c.id);
    }
    // Gracefully fall back so auto-cycle never deadlocks
    return (base.length >= 2 ? base : nonSkipped).map((c) => c.id);
  }

  return base.map((c) => c.id);
}

/**
 * Chooses the next id, or null when no switch should happen now.
 * `random` is injected so tests can fix the choice. Call once per frame.
 */
export class AutoCycler {
  private sinceSwitch = 0;
  // Time since the last beat-mode switch. Starts at 0 so the first switch also waits for the minimum gap.
  private lastBeatSwitch = 0;

  // The pick announced by `upcoming`, kept so `next` switches to the same preset.
  private planned: string | null = null;

  constructor(private random: () => number = Math.random) {}

  /** Restart the timers, for example after the user switches by hand. */
  reset(): void {
    this.sinceSwitch = 0;
    this.lastBeatSwitch = 0;
    this.planned = null;
  }

  /**
   * The preset the next switch will show, once the switch is within `leadSec` seconds of being allowed.
   * Null before that, when the cycle is off, or when there is nothing to switch to. The answer is kept,
   * so `next` returns the same id (matters for shuffle). Call with the same arguments as `next`.
   */
  upcoming(current: string, pool: readonly string[], opts: CycleOptions, leadSec = PREPARE_LEAD_SEC): string | null {
    if (opts.mode === 'off' || pool.length < 2) {
      this.planned = null;
      return null;
    }
    const elapsed = opts.mode === 'timer' ? this.sinceSwitch : this.lastBeatSwitch;
    const wait = opts.mode === 'timer' ? opts.intervalSec : opts.minGapSec;
    if (elapsed < wait - leadSec) return null;
    if (!this.planned || this.planned === current || !pool.includes(this.planned)) {
      this.planned = this.choose(current, pool, opts.shuffle);
    }
    return this.planned;
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
    const pick =
      this.planned && this.planned !== current && pool.includes(this.planned)
        ? this.planned
        : this.choose(current, pool, opts.shuffle);
    this.planned = null;
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

// Visuals menu settings (Slice 21.13): the choice is kept in browser storage under one key.
export const CYCLE_STORAGE_KEY = 'mv.autoCycle';
export const MIN_INTERVAL_SEC = 5;
export const MAX_INTERVAL_SEC = 120;

/** Keeps the timer length inside 5 to 120 s. A non-number gives the default. */
export function clampInterval(sec: unknown): number {
  if (typeof sec !== 'number' || !Number.isFinite(sec)) return DEFAULT_CYCLE.intervalSec;
  return Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, Math.round(sec)));
}

/** Reads the saved choice into `target`. Anything missing or invalid leaves the current value alone. */
export function loadCycleSettings(target: CycleOptions, storage: Pick<Storage, 'getItem'> | undefined): void {
  try {
    const raw = storage?.getItem(CYCLE_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<Record<'mode' | 'shuffle' | 'intervalSec', unknown>>;
    if (saved.mode === 'off' || saved.mode === 'timer' || saved.mode === 'beat') target.mode = saved.mode;
    if (typeof saved.shuffle === 'boolean') target.shuffle = saved.shuffle;
    if (saved.intervalSec !== undefined) target.intervalSec = clampInterval(saved.intervalSec);
  } catch {
    // Blocked storage or bad JSON: keep the defaults.
  }
}

/** Saves mode, shuffle and timer length. Failure only means the choice is not remembered. */
export function saveCycleSettings(opts: CycleOptions, storage: Pick<Storage, 'setItem'> | undefined): void {
  try {
    storage?.setItem(CYCLE_STORAGE_KEY, JSON.stringify({ mode: opts.mode, shuffle: opts.shuffle, intervalSec: opts.intervalSec }));
  } catch {
    // Private mode or a full store.
  }
}
