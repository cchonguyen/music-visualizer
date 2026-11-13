import { describe, it, expect } from 'vitest';
import {
  AutoCycler,
  CYCLE_STORAGE_KEY,
  DEFAULT_CYCLE,
  MAX_INTERVAL_SEC,
  MIN_INTERVAL_SEC,
  PREPARE_LEAD_SEC,
  clampInterval,
  eligible,
  loadCycleSettings,
  phraseBarsOf,
  saveCycleSettings,
  type CycleOptions,
  type CycleTempo,
} from './autoCycle';
import { maxCostForTier } from './cost';

const opts = (over: Partial<CycleOptions>): CycleOptions => ({ ...DEFAULT_CYCLE, ...over });

describe('eligible', () => {
  it('drops skipped presets', () => {
    const ids = eligible([{ id: 'a', tags: [] }, { id: 'b', tags: ['skip'] }, { id: 'c', tags: ['built-in'] }], opts({}));
    expect(ids).toEqual(['a', 'c']);
  });

  it('keeps only favourites when asked', () => {
    const ids = eligible([{ id: 'a', tags: ['favourite'] }, { id: 'b', tags: [] }], opts({ favouritesOnly: true }));
    expect(ids).toEqual(['a']);
  });

  it('phone tier skips Heavy presets and keeps Light and Medium', () => {
    const candidates = [
      { id: 'l', tags: [], cost: 'light' as const },
      { id: 'm', tags: [], cost: 'medium' as const },
      { id: 'h', tags: [], cost: 'heavy' as const },
    ];
    expect(eligible(candidates, opts({ maxCost: maxCostForTier('phone') }))).toEqual(['l', 'm']);
  });

  it('desktop tier keeps Heavy presets in the cycle', () => {
    const candidates = [
      { id: 'l', tags: [], cost: 'light' as const },
      { id: 'h', tags: [], cost: 'heavy' as const },
    ];
    expect(eligible(candidates, opts({ maxCost: maxCostForTier('desktop') }))).toEqual(['l', 'h']);
  });

  it('phone tier still cycles when skipping Heavy would leave fewer than 2 presets', () => {
    const candidates = [
      { id: 'l', tags: [], cost: 'light' as const },
      { id: 'h1', tags: [], cost: 'heavy' as const },
      { id: 'h2', tags: [], cost: 'heavy' as const },
    ];
    expect(eligible(candidates, opts({ maxCost: maxCostForTier('phone') }))).toEqual(['l', 'h1', 'h2']);
  });
});

describe('AutoCycler', () => {
  it('does nothing when off', () => {
    expect(new AutoCycler().next(100, true, 'a', ['a', 'b'], opts({ mode: 'off' }))).toBeNull();
  });

  it('timer mode switches after the interval, in list order', () => {
    const c = new AutoCycler();
    const o = opts({ mode: 'timer', intervalSec: 2 });
    expect(c.next(1, false, 'a', ['a', 'b', 'c'], o)).toBeNull();
    expect(c.next(1.1, false, 'a', ['a', 'b', 'c'], o)).toBe('b');
    expect(c.next(1, false, 'b', ['a', 'b', 'c'], o)).toBeNull();
    expect(c.next(1.1, false, 'b', ['a', 'b', 'c'], o)).toBe('c');
  });

  it('beat mode waits for a strong beat and the minimum gap', () => {
    const c = new AutoCycler();
    const o = opts({ mode: 'beat', minGapSec: 5 });
    expect(c.next(1, true, 'a', ['a', 'b'], o)).toBeNull(); // too soon after start
    expect(c.next(5, false, 'a', ['a', 'b'], o)).toBeNull(); // no beat
    expect(c.next(0, true, 'a', ['a', 'b'], o)).toBe('b');
    expect(c.next(1, true, 'b', ['a', 'b'], o)).toBeNull(); // gap not yet passed
  });

  it('shuffle picks a different preset, using the injected random', () => {
    const c = new AutoCycler(() => 0);
    const o = opts({ mode: 'timer', intervalSec: 1, shuffle: true });
    expect(c.next(2, false, 'a', ['a', 'b', 'c'], o)).toBe('b');
  });

  it('never picks the current preset with shuffle', () => {
    let seed = 1;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const c = new AutoCycler(rng);
    const o = opts({ mode: 'timer', intervalSec: 1, shuffle: true });
    for (let i = 0; i < 50; i++) {
      const next = c.next(2, false, 'a', ['a', 'b', 'c'], o);
      expect(next).not.toBe('a');
    }
  });

  it('needs at least two presets', () => {
    expect(new AutoCycler().next(100, true, 'a', ['a'], opts({ mode: 'timer', intervalSec: 1 }))).toBeNull();
  });
});

describe('AutoCycler.upcoming (Slice 16.3)', () => {
  const pool = ['a', 'b', 'c'];

  it('is null while the cycle is off or the pool is too small', () => {
    expect(new AutoCycler().upcoming('a', pool, opts({ mode: 'off' }))).toBeNull();
    expect(new AutoCycler().upcoming('a', ['a'], opts({ mode: 'timer', intervalSec: 1 }))).toBeNull();
  });

  it('names the next preset only inside the lead window before a timer switch', () => {
    const c = new AutoCycler();
    const o = opts({ mode: 'timer', intervalSec: 20 });
    expect(PREPARE_LEAD_SEC).toBe(3);
    c.next(16, false, 'a', pool, o);
    expect(c.upcoming('a', pool, o)).toBeNull();
    c.next(1.5, false, 'a', pool, o);
    expect(c.upcoming('a', pool, o)).toBe('b');
  });

  it('beat mode names the next preset when the minimum gap is nearly over', () => {
    const c = new AutoCycler();
    const o = opts({ mode: 'beat', minGapSec: 8 });
    c.next(4, false, 'a', pool, o);
    expect(c.upcoming('a', pool, o)).toBeNull();
    c.next(1.5, false, 'a', pool, o);
    expect(c.upcoming('a', pool, o)).toBe('b');
  });

  it('next switches to the announced preset, even when shuffled', () => {
    const picks = [0.9, 0.0];
    const c = new AutoCycler(() => picks.shift() ?? 0);
    const o = opts({ mode: 'timer', intervalSec: 5, shuffle: true });
    c.next(3, false, 'a', pool, o);
    const announced = c.upcoming('a', pool, o);
    expect(announced).toBe('c');
    expect(c.upcoming('a', pool, o)).toBe('c');
    expect(c.next(3, false, 'a', pool, o)).toBe('c');
  });

  it('forgets the announcement after a switch and on reset', () => {
    const c = new AutoCycler();
    const o = opts({ mode: 'timer', intervalSec: 5 });
    c.next(3, false, 'a', pool, o);
    expect(c.upcoming('a', pool, o)).toBe('b');
    expect(c.next(3, false, 'a', pool, o)).toBe('b');
    expect(c.upcoming('b', pool, o)).toBeNull();
    c.next(3, false, 'b', pool, o);
    expect(c.upcoming('b', pool, o)).toBe('c');
    c.reset();
    expect(c.upcoming('b', pool, o)).toBeNull();
  });

  it('drops an announcement that left the pool or became the current preset', () => {
    const c = new AutoCycler();
    const o = opts({ mode: 'timer', intervalSec: 5 });
    c.next(3, false, 'a', pool, o);
    expect(c.upcoming('a', pool, o)).toBe('b');
    expect(c.upcoming('a', ['a', 'c'], o)).toBe('c');
    expect(c.upcoming('c', ['a', 'c'], o)).toBe('a');
  });
});

describe('eligible with a cost limit (Slice 16.11)', () => {
  const cands = [
    { id: 'a', tags: [], cost: 'light' as const },
    { id: 'b', tags: [], cost: 'heavy' as const },
    { id: 'c', tags: [], cost: 'medium' as const },
    { id: 'd', tags: ['calm'], cost: 'heavy' as const },
  ];

  it('keeps everything with no limit', () => {
    expect(eligible(cands, opts({}))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('drops presets heavier than the limit', () => {
    expect(eligible(cands, opts({ maxCost: 'medium' }))).toEqual(['a', 'c']);
    expect(eligible(cands, opts({ maxCost: 'light' }))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('treats a missing cost as light', () => {
    expect(eligible([{ id: 'x', tags: [] }, { id: 'y', tags: [] }, { id: 'z', tags: [], cost: 'heavy' as const }], opts({ maxCost: 'medium' }))).toEqual(['x', 'y']);
  });

  it('never filters down to fewer than two presets', () => {
    expect(eligible([{ id: 'a', tags: [], cost: 'light' as const }, { id: 'b', tags: [], cost: 'heavy' as const }], opts({ maxCost: 'medium' }))).toEqual(['a', 'b']);
  });

  it('combines with favourites and skip', () => {
    const list = [
      { id: 'a', tags: ['favourite'], cost: 'light' as const },
      { id: 'b', tags: ['favourite'], cost: 'medium' as const },
      { id: 'c', tags: ['favourite'], cost: 'heavy' as const },
      { id: 'd', tags: ['skip'], cost: 'light' as const },
    ];
    expect(eligible(list, opts({ maxCost: 'medium', favouritesOnly: true }))).toEqual(['a', 'b']);
  });

  it('combines with calm-only', () => {
    const list = [
      { id: 'a', tags: ['calm'], cost: 'light' as const },
      { id: 'b', tags: ['calm'], cost: 'medium' as const },
      { id: 'c', tags: ['calm'], cost: 'heavy' as const },
    ];
    expect(eligible(list, opts({ maxCost: 'medium', calmOnly: true }))).toEqual(['a', 'b']);
  });
});

describe('saved Visuals menu settings (Slice 21.13)', () => {
  const store = (initial?: string) => {
    const data = new Map<string, string>(initial === undefined ? [] : [[CYCLE_STORAGE_KEY, initial]]);
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };

  it('clamps the timer length to 5 to 120 s', () => {
    expect(clampInterval(1)).toBe(MIN_INTERVAL_SEC);
    expect(clampInterval(500)).toBe(MAX_INTERVAL_SEC);
    expect(clampInterval(30.4)).toBe(30);
    expect(clampInterval('x')).toBe(DEFAULT_CYCLE.intervalSec);
    expect(clampInterval(NaN)).toBe(DEFAULT_CYCLE.intervalSec);
  });

  it('round-trips mode, shuffle and timer length', () => {
    const s = store();
    saveCycleSettings(opts({ mode: 'beat', shuffle: true, intervalSec: 45 }), s);
    const target = opts({});
    loadCycleSettings(target, s);
    expect([target.mode, target.shuffle, target.intervalSec]).toEqual(['beat', true, 45]);
  });

  it('keeps the defaults when nothing is saved', () => {
    const target = opts({});
    loadCycleSettings(target, store());
    expect(target).toEqual(DEFAULT_CYCLE);
    loadCycleSettings(target, undefined);
    expect(target).toEqual(DEFAULT_CYCLE);
  });

  it('ignores bad JSON and bad values', () => {
    const target = opts({});
    loadCycleSettings(target, store('{nope'));
    expect(target).toEqual(DEFAULT_CYCLE);
    loadCycleSettings(target, store(JSON.stringify({ mode: 'sideways', shuffle: 'yes', intervalSec: 9999 })));
    expect([target.mode, target.shuffle, target.intervalSec]).toEqual(['timer', false, MAX_INTERVAL_SEC]);
  });

  it('does not throw when storage fails', () => {
    const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    expect(() => saveCycleSettings(opts({}), bad)).not.toThrow();
    expect(() => loadCycleSettings(opts({}), bad)).not.toThrow();
  });
});

describe('phrase mode (Slice 22.1)', () => {
  const pool = ['a', 'b', 'c'];
  const phrase = (over: Partial<CycleOptions> = {}) => opts({ mode: 'phrase', intervalSec: 100, minGapSec: 1, ...over });
  const tempoAt = (beatCount: number, bpm = 120, tempoConfidence = 0.9): CycleTempo => ({ beatCount, bpm, tempoConfidence });
  const storeWith = (raw: string) => {
    const data = new Map<string, string>([[CYCLE_STORAGE_KEY, raw]]);
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };

  it('switches on the first beat of every 4-bar phrase and not on other beats', () => {
    const c = new AutoCycler();
    const o = phrase({ phraseBars: 4 });
    expect(c.next(0.5, false, 'a', pool, o, tempoAt(0))).toBeNull();
    for (let beat = 1; beat < 16; beat++) {
      expect(c.next(0.5, false, 'a', pool, o, tempoAt(beat))).toBeNull();
    }
    expect(c.next(0.5, false, 'a', pool, o, tempoAt(16))).toBe('b');
  });

  it('uses 16-bar phrases when asked', () => {
    const c = new AutoCycler();
    const o = phrase({ phraseBars: 16 });
    expect(c.next(0.5, false, 'a', pool, o, tempoAt(0))).toBeNull();
    for (let beat = 1; beat < 64; beat++) {
      expect(c.next(0.5, false, 'a', pool, o, tempoAt(beat))).toBeNull();
    }
    expect(c.next(0.5, false, 'a', pool, o, tempoAt(64))).toBe('b');
  });

  it('keeps the minimum gap, so a reset beat count cannot switch twice', () => {
    const c = new AutoCycler();
    const o = phrase({ phraseBars: 4, minGapSec: 5 });
    expect(c.next(0, false, 'a', pool, o, tempoAt(0))).toBeNull();
    for (let beat = 1; beat <= 15; beat++) c.next(0.5, false, 'a', pool, o, tempoAt(beat));
    expect(c.next(0.5, false, 'a', pool, o, tempoAt(16))).toBe('b');
    // The count resets and climbs back to a boundary within the gap: no second switch.
    expect(c.next(0.1, false, 'b', pool, o, tempoAt(0))).toBeNull();
    for (let beat = 1; beat <= 16; beat++) {
      expect(c.next(0.1, false, 'b', pool, o, tempoAt(beat))).toBeNull();
    }
  });

  it('falls back to the Timer rule without a usable tempo', () => {
    const noGrid: Array<CycleTempo | undefined> = [
      undefined, // no beat count on the frame
      { beatCount: 16, bpm: 120, tempoConfidence: 0.3 }, // low confidence
      { beatCount: 16, bpm: 0, tempoConfidence: 0.9 }, // no bpm
    ];
    for (const tempo of noGrid) {
      const c = new AutoCycler();
      const o = phrase({ phraseBars: 4, intervalSec: 2 });
      expect(c.next(1, false, 'a', pool, o, tempo)).toBeNull();
      expect(c.next(1.1, false, 'a', pool, o, tempo)).toBe('b');
    }
  });

  it('upcoming names the same preset that next switches to on the boundary', () => {
    const c = new AutoCycler(() => 0.99);
    const o = phrase({ phraseBars: 4, shuffle: true });
    expect(c.next(0.5, false, 'a', pool, o, tempoAt(0))).toBeNull();
    for (let beat = 1; beat <= 14; beat++) c.next(0.5, false, 'a', pool, o, tempoAt(beat));
    expect(c.upcoming('a', pool, o, undefined, tempoAt(14))).toBeNull();
    c.next(0.5, false, 'a', pool, o, tempoAt(15));
    const announced = c.upcoming('a', pool, o, undefined, tempoAt(15));
    expect(announced).toBe('c');
    expect(c.upcoming('a', pool, o, undefined, tempoAt(15))).toBe(announced);
    expect(c.next(0.5, false, 'a', pool, o, tempoAt(16))).toBe(announced);
  });

  it('loads saved settings without phraseBars with the default of 8 bars', () => {
    const target = opts({});
    loadCycleSettings(target, storeWith(JSON.stringify({ mode: 'phrase', shuffle: true, intervalSec: 30 })));
    expect([target.mode, target.shuffle, target.intervalSec]).toEqual(['phrase', true, 30]);
    expect(phraseBarsOf(target)).toBe(8);
  });

  it('saves and loads 4 and 16 bars, and ignores other bar counts', () => {
    for (const bars of [4, 16]) {
      const s = storeWith('{}');
      saveCycleSettings(phrase({ phraseBars: bars }), s);
      const target = opts({});
      loadCycleSettings(target, s);
      expect(target.phraseBars).toBe(bars);
    }
    const target = opts({});
    loadCycleSettings(target, storeWith(JSON.stringify({ mode: 'phrase', phraseBars: 5 })));
    expect(phraseBarsOf(target)).toBe(8);
  });
});
