import { describe, it, expect } from 'vitest';
import { morphPhase, morphValue, advanceMorphPhase, MORPH_MAX_DT_SEC, type MorphPhaseState } from './morph';
import { parsePreset, MORPH_RATE_DEFAULT, MORPH_RATE_MAX, type SchemaRegistry } from './format';
import type { NumberSpec, EnumSpec } from './schema';

describe('morphPhase', () => {
  const rate = 2; // period 0.5 s
  it('is 0 at t = 0 and about 1 at half a period', () => {
    expect(morphPhase(0, rate)).toBeCloseTo(0, 9);
    expect(morphPhase(0.5 / rate, rate)).toBeCloseTo(1, 9);
  });

  it('is about 0 again after a full period', () => {
    expect(morphPhase(1 / rate, rate)).toBeCloseTo(0, 9);
  });

  it('stays within [0, 1] over many samples', () => {
    for (let i = 0; i < 2000; i++) {
      const v = morphPhase(i * 0.0137, 0.37);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('returns 0 for non-finite input', () => {
    expect(morphPhase(Number.NaN, 1)).toBe(0);
    expect(morphPhase(1, Number.POSITIVE_INFINITY)).toBe(0);
    expect(morphPhase(Number.NEGATIVE_INFINITY, Number.NaN)).toBe(0);
  });
});

describe('morphValue', () => {
  it('moves from base to `to` and back', () => {
    // A fresh morph object per sample starts at the absolute-time phase.
    expect(morphValue(0.5, { to: 0.9, rate: 1 }, 0)).toBeCloseTo(0.5, 9);
    expect(morphValue(0.5, { to: 0.9, rate: 1 }, 0.5)).toBeCloseTo(0.9, 9);
    expect(morphValue(0.5, { to: 0.9, rate: 1 }, 1)).toBeCloseTo(0.5, 9);
  });

  it('follows the integrated phase over steady frames', () => {
    const morph = { to: 1, rate: 1 };
    let v = 0;
    for (let i = 0; i <= 50; i++) v = morphValue(0, morph, i * 0.01);
    expect(v).toBeCloseTo(1, 9); // half a cycle after 0.5 s
  });
});

describe('advanceMorphPhase', () => {
  const run = (rateAt: (t: number) => number, seconds: number, dt = 1 / 60) => {
    let state: MorphPhaseState | undefined;
    const values: number[] = [];
    for (let t = 0; t <= seconds + 1e-9; t += dt) {
      const r = advanceMorphPhase(state, t, rateAt(t));
      state = r.state;
      values.push(r.value);
    }
    return values;
  };

  it('matches the cosine shape at the same phase', () => {
    expect(advanceMorphPhase(undefined, 0.25, 1).value).toBeCloseTo(morphPhase(0.25, 1), 9);
    const half = advanceMorphPhase({ cycles: 0.5, lastTimeSec: 3 }, 3, 2);
    expect(half.value).toBeCloseTo(1, 9);
  });

  it('does not jump when the rate changes', () => {
    // Absolute-time sin(t * rate) would leap here: at t = 10 s, rate 0.3 → 0.7 moves the phase by 4 cycles.
    const values = run((t) => (t < 10 ? 0.3 : 0.7), 12);
    let maxStep = 0;
    for (let i = 1; i < values.length; i++) maxStep = Math.max(maxStep, Math.abs(values[i]! - values[i - 1]!));
    // Fastest possible per-frame change at 0.7 Hz and 60 fps is about pi * 0.7 / 60.
    expect(maxStep).toBeLessThan((Math.PI * 0.7) / 60 + 1e-6);
  });

  it('stays within 0..1', () => {
    for (const v of run((t) => 0.2 + 0.5 * Math.sin(t), 30)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('clamps a long gap and a backwards clock to the step limit', () => {
    const start = { cycles: 0.1, lastTimeSec: 5 };
    const gap = advanceMorphPhase(start, 500, 1);
    expect(gap.state.cycles).toBeCloseTo(0.1 + MORPH_MAX_DT_SEC, 9);
    const back = advanceMorphPhase(start, 1, 1);
    expect(back.state.cycles).toBeCloseTo(0.1, 9);
  });

  it('ignores non-finite input', () => {
    expect(advanceMorphPhase(undefined, Number.NaN, 1).value).toBe(0);
    expect(advanceMorphPhase(undefined, 1, Number.POSITIVE_INFINITY).value).toBe(0);
  });
});

const wave: NumberSpec = { type: 'float', name: 'size', label: 'Size', group: 'G', default: 0.5, min: 0, max: 1, step: 0.01 };
const mode: EnumSpec = { type: 'enum', name: 'mode', label: 'Mode', group: 'G', default: 'a', options: ['a', 'b'] };
const registry: SchemaRegistry = {
  feedback: [],
  post: [],
  layers: { wave: [wave, mode] },
};
const presetWith = (params: Record<string, unknown>) => ({
  version: 1,
  name: 'test',
  layers: [{ type: 'wave', params }],
});

describe('morph in parsePreset', () => {
  it('keeps a valid morph on a number setting', () => {
    const { preset, warnings } = parsePreset(presetWith({ size: { value: 0.5, morph: { to: 0.9, rate: 0.5 } } }), registry);
    expect(preset.layers[0]?.params.size?.morph).toEqual({ to: 0.9, rate: 0.5 });
    expect(warnings).toEqual([]);
  });

  it('drops a morph on an enum setting with a warning', () => {
    const { preset, warnings } = parsePreset(presetWith({ mode: { value: 'a', morph: { to: 'b', rate: 0.5 } } }), registry);
    expect(preset.layers[0]?.params.mode?.morph).toBeUndefined();
    expect(warnings.some((w) => w.includes('only number settings can morph'))).toBe(true);
  });

  it('clamps a rate of 100 to the maximum', () => {
    const { preset } = parsePreset(presetWith({ size: { value: 0.5, morph: { to: 0.9, rate: 100 } } }), registry);
    expect(preset.layers[0]?.params.size?.morph?.rate).toBe(MORPH_RATE_MAX);
  });

  it('uses the default rate when none is given', () => {
    const { preset } = parsePreset(presetWith({ size: { value: 0.5, morph: { to: 0.9 } } }), registry);
    expect(preset.layers[0]?.params.size?.morph?.rate).toBe(MORPH_RATE_DEFAULT);
  });
});
