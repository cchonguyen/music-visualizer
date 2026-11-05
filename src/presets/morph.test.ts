import { describe, it, expect } from 'vitest';
import { morphPhase, morphValue } from './morph';
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
  const morph = { to: 0.9, rate: 1 };
  it('moves from base to `to` and back', () => {
    expect(morphValue(0.5, morph, 0)).toBeCloseTo(0.5, 9);
    expect(morphValue(0.5, morph, 0.5)).toBeCloseTo(0.9, 9);
    expect(morphValue(0.5, morph, 1)).toBeCloseTo(0.5, 9);
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
