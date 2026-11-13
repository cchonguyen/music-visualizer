// Auto-cycle (slice T2): picks the next preset on a timer or on a strong beat. Pure logic.
// Presets tagged "skip" are never picked. With `favouritesOnly`, only presets tagged "favourite" are used.
// Phrase mode (Slice 22.1) switches on the first beat of every N bars, and acts as Timer when there is no tempo.
import { withinCost, type CostLevel } from './cost';
import { BEATS_PER_BAR, LOCK_CONFIDENCE } from '../audio/tempo';

export type CycleMode = 'off' | 'timer' | 'beat' | 'phrase';

/** Bars per phrase that Phrase mode may use (Slice 22.1). */
export const PHRASE_BAR_OPTIONS = [4, 8, 16] as const;
export const DEFAULT_PHRASE_BARS = 8;

export interface CycleOptions {
  mode: CycleMode;
  intervalSec: number; // timer mode: seconds between switches
  minGapSec: number; // beat mode: shortest time between switches
  shuffle: boolean;
  favouritesOnly: boolean;
  calmOnly?: boolean;
  /** Skip presets heavier than this (Slice 16.11). Missing means no limit. Ignored if it would leave fewer than 2 presets. */
  maxCost?: CostLevel;
  /** Phrase mode: bars per phrase, one of PHRASE_BAR_OPTIONS. Missing means DEFAULT_PHRASE_BARS. */
  phraseBars?: number;
}

/** The tempo fields of an AudioFrame that Phrase mode reads. Missing fields mean no tempo. */
export interface CycleTempo {
  beatCount?: number;
  bpm?: number;
  tempoConfidence?: number;
}

export interface CycleCandidate {
  id: string;
  tags: readonly string[];
  /** Cost level from presets/cost.ts. Missing counts as Light. */
  cost?: CostLevel;
}

/** How many seconds before a switch the next preset is chosen, so it can be prepared (Slice 16.3). */
export const PREPARE_LEAD_SEC = 3;

export const DEFAULT_CYCLE: CycleOptions = { mode: 'timer', intervalSec: 20, minGapSec: 8, shuffle: false, favouritesOnly: false, calmOnly: false, phraseBars: DEFAULT_PHRASE_BARS };

/** Bars per phrase, or the default when missing or not one of the options. */
export function phraseBarsOf(opts: Pick<CycleOptions, 'phraseBars'>): number {
  const bars = opts.phraseBars;
  return bars !== undefined && (PHRASE_BAR_OPTIONS as readonly number[]).includes(bars) ? bars : DEFAULT_PHRASE_BARS;
}

/** The tempo as a usable beat grid, or undefined when the grid is not trusted (no tempo, low confidence, or no count). */
function gridOf(tempo: CycleTempo | undefined): Required<CycleTempo> | undefined {
  if (!tempo) return undefined;
  const { beatCount, bpm, tempoConfidence } = tempo;
  if (beatCount === undefined || bpm === undefined || tempoConfidence === undefined) return undefined;
  if (!(bpm > 0) || !(tempoConfidence >= LOCK_CONFIDENCE)) return undefined;
  return { beatCount, bpm, tempoConfidence };
}

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

  // Beat count seen on the last call to `next`, so a rise can be told from a reset. Undefined without a beat grid.
  private seenBeat: number | undefined = undefined;

  constructor(private random: () => number = Math.random) {}

  /** Restart the timers, for example after the user switches by hand. */
  reset(): void {
    this.sinceSwitch = 0;
    this.lastBeatSwitch = 0;
    this.planned = null;
    this.seenBeat = undefined;
  }

  /**
   * The preset the next switch will show, once the switch is within `leadSec` seconds of being allowed.
   * Null before that, when the cycle is off, or when there is nothing to switch to. The answer is kept,
   * so `next` returns the same id (matters for shuffle). Call with the same arguments as `next`.
   * `tempo` is the current frame (Phrase mode). Without it Phrase mode acts as Timer.
   */
  upcoming(current: string, pool: readonly string[], opts: CycleOptions, leadSec = PREPARE_LEAD_SEC, tempo?: CycleTempo): string | null {
    if (opts.mode === 'off' || pool.length < 2) {
      this.planned = null;
      return null;
    }
    const grid = opts.mode === 'phrase' ? gridOf(tempo) : undefined;
    let due: boolean;
    if (grid) {
      // Phrase: the bar before the boundary (beat index 4N-1), once the minimum gap is nearly over.
      const period = BEATS_PER_BAR * phraseBarsOf(opts);
      due = grid.beatCount % period === period - 1 && this.lastBeatSwitch >= opts.minGapSec - leadSec;
    } else if (opts.mode === 'timer' || opts.mode === 'phrase') {
      due = this.sinceSwitch >= opts.intervalSec - leadSec;
    } else {
      due = this.lastBeatSwitch >= opts.minGapSec - leadSec;
    }
    if (!due) return null;
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
   * @param tempo      the current frame's tempo fields (Phrase mode). Optional, so older callers still work.
   */
  next(dtSec: number, strongBeat: boolean, current: string, pool: readonly string[], opts: CycleOptions, tempo?: CycleTempo): string | null {
    const grid = gridOf(tempo);
    // A rise in the beat count since the last call. A reset to a lower count is not a rise.
    const rose = grid !== undefined && this.seenBeat !== undefined && grid.beatCount > this.seenBeat;
    this.seenBeat = grid?.beatCount;
    if (opts.mode === 'off' || pool.length < 2) return null;
    this.sinceSwitch += Math.max(0, dtSec);
    this.lastBeatSwitch += Math.max(0, dtSec);
    let due = false;
    if (opts.mode === 'beat') {
      due = strongBeat && this.lastBeatSwitch >= opts.minGapSec;
    } else if (opts.mode === 'phrase' && grid) {
      // Phrase: the first beat of a phrase. The minimum gap stops a reset count from switching twice.
      due = rose && grid.beatCount % (BEATS_PER_BAR * phraseBarsOf(opts)) === 0 && this.lastBeatSwitch >= opts.minGapSec;
    } else if (opts.mode === 'timer' || opts.mode === 'phrase') {
      // Timer mode, and Phrase mode without a usable tempo.
      due = this.sinceSwitch >= opts.intervalSec;
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

/**
 * Slice 23.2: the options for this preset's own display time. Only Timer mode uses it: with a display time
 * the timer length becomes that time. Beat and Phrase modes, and no display time, return opts unchanged.
 */
export function effectiveCycleOptions(opts: CycleOptions, displaySec: number | undefined): CycleOptions {
  if (displaySec === undefined || opts.mode !== 'timer') return opts;
  return { ...opts, intervalSec: displaySec };
}

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
    const saved = JSON.parse(raw) as Partial<Record<'mode' | 'shuffle' | 'intervalSec' | 'phraseBars', unknown>>;
    if (saved.mode === 'off' || saved.mode === 'timer' || saved.mode === 'beat' || saved.mode === 'phrase') target.mode = saved.mode;
    if (typeof saved.shuffle === 'boolean') target.shuffle = saved.shuffle;
    if (saved.intervalSec !== undefined) target.intervalSec = clampInterval(saved.intervalSec);
    // Saves from before Phrase mode have no phraseBars: the current (default) value stays.
    if (typeof saved.phraseBars === 'number' && (PHRASE_BAR_OPTIONS as readonly number[]).includes(saved.phraseBars)) target.phraseBars = saved.phraseBars;
  } catch {
    // Blocked storage or bad JSON: keep the defaults.
  }
}

/** Saves mode, shuffle, timer length and phrase bars. Failure only means the choice is not remembered. */
export function saveCycleSettings(opts: CycleOptions, storage: Pick<Storage, 'setItem'> | undefined): void {
  try {
    storage?.setItem(CYCLE_STORAGE_KEY, JSON.stringify({ mode: opts.mode, shuffle: opts.shuffle, intervalSec: opts.intervalSec, phraseBars: phraseBarsOf(opts) }));
  } catch {
    // Private mode or a full store.
  }
}
