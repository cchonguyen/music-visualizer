import { describe, it, expect } from 'vitest';
import { randomiseSettings, mutateSettings, randomValue, mutateValue, seededRng, newLayerSeed, randomiseLayerSettings, MAX_LAYER_SEED } from './variation';
import { SHAPE_SPECS } from './layerSchemas';
import type { ParamSpec } from './schema';
import type { Settings } from './format';

// A tiny seeded generator, so the tests are repeatable.
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const specs: ParamSpec[] = [
  { type: 'float', name: 'zoom', label: 'Zoom', group: 'G', default: 1, min: 0.5, max: 2, step: 0.01 },
  { type: 'int', name: 'sides', label: 'Sides', group: 'G', default: 6, min: 3, max: 12, step: 1 },
  { type: 'bool', name: 'invert', label: 'Invert', group: 'G', default: false },
  { type: 'enum', name: 'pattern', label: 'Pattern', group: 'G', default: 'a', options: ['a', 'b', 'c'] },
  { type: 'colour', name: 'tint', label: 'Tint', group: 'G', default: '#00ffff' },
];

const start: Settings = { zoom: { value: 1 }, sides: { value: 6 }, invert: { value: false }, pattern: { value: 'a' }, tint: { value: '#00ffff' } };

describe('randomise', () => {
  it('keeps every value inside its range and grid', () => {
    const rng = seeded(7);
    for (let i = 0; i < 300; i++) {
      const out = randomiseSettings(start, specs, rng);
      const zoom = out.zoom!.value as number;
      const sides = out.sides!.value as number;
      expect(zoom).toBeGreaterThanOrEqual(0.5);
      expect(zoom).toBeLessThanOrEqual(2);
      expect(Math.round(zoom * 100)).toBeCloseTo(zoom * 100, 6);
      expect(Number.isInteger(sides)).toBe(true);
      expect(sides).toBeGreaterThanOrEqual(3);
      expect(sides).toBeLessThanOrEqual(12);
      expect(['a', 'b', 'c']).toContain(out.pattern!.value);
      expect(out.tint!.value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('leaves locked settings alone', () => {
    const out = randomiseSettings(start, specs, seeded(3), new Set(['zoom', 'pattern']));
    expect(out.zoom!.value).toBe(1);
    expect(out.pattern!.value).toBe('a');
  });

  it('does not change the input', () => {
    const copy = JSON.parse(JSON.stringify(start));
    randomiseSettings(start, specs, seeded(1));
    expect(start).toEqual(copy);
  });

  it('is repeatable with the same seed', () => {
    expect(randomiseSettings(start, specs, seeded(42))).toEqual(randomiseSettings(start, specs, seeded(42)));
  });

  it('randomValue covers the whole range over many draws', () => {
    const rng = seeded(9);
    const values = Array.from({ length: 500 }, () => randomValue(specs[0]!, rng) as number);
    expect(Math.min(...values)).toBeLessThan(0.6);
    expect(Math.max(...values)).toBeGreaterThan(1.9);
  });
});

describe('mutate', () => {
  it('moves numbers by at most about 10% and keeps them in range', () => {
    const rng = seeded(11);
    for (let i = 0; i < 300; i++) {
      const v = mutateValue(specs[0]!, 1, rng) as number;
      expect(Math.abs(v - 1)).toBeLessThanOrEqual(0.1 + 0.01);
      expect(v).toBeGreaterThanOrEqual(0.5);
      expect(v).toBeLessThanOrEqual(2);
    }
  });

  it('nudges a zero value (a percentage alone would never move it)', () => {
    const spec: ParamSpec = { type: 'float', name: 'x', label: 'x', group: 'g', default: 0, min: -1, max: 1, step: 0.01 };
    const moved = Array.from({ length: 50 }, () => mutateValue(spec, 0, seeded(Math.random() * 1e6)) as number);
    expect(moved.some((v) => v !== 0)).toBe(true);
  });

  it('does not touch bools, enums or colours', () => {
    const out = mutateSettings(start, specs, seeded(5));
    expect(out.invert!.value).toBe(false);
    expect(out.pattern!.value).toBe('a');
    expect(out.tint!.value).toBe('#00ffff');
  });

  it('respects locks', () => {
    const out = mutateSettings(start, specs, seeded(5), new Set(['zoom']));
    expect(out.zoom!.value).toBe(1);
  });
});

describe('high-intensity effect weighted dampening', () => {
  const highIntensitySpecs: ParamSpec[] = [
    { type: 'float', name: 'sobel', label: 'Sobel', group: 'Trail', default: 0, min: 0, max: 1, step: 0.01 },
    { type: 'float', name: 'solarize', label: 'Solarize', group: 'Colour', default: 0, min: 0, max: 1, step: 0.01 },
    { type: 'float', name: 'chroma', label: 'Chroma', group: 'Shape', default: 0, min: 0, max: 0.02, step: 0.0005 },
    { type: 'float', name: 'rgbSplit', label: 'RGB split', group: 'Warp', default: 0, min: 0, max: 0.08, step: 0.001 },
    { type: 'int', name: 'mirror', label: 'Mirror', group: 'Shape', default: 0, min: 0, max: 8, step: 1 },
  ];

  it('gates effects with ~85% off and caps active draws to subtle ranges over 200+ draws', () => {
    const rng = seeded(12345);
    const N = 500;

    for (const spec of highIntensitySpecs) {
      const draws = Array.from({ length: N }, () => randomValue(spec, rng) as number);
      const zeroCount = draws.filter((v) => v === 0).length;
      const zeroFraction = zeroCount / N;

      // Around ~85% of draws evaluate to 0 (default off)
      expect(zeroFraction).toBeGreaterThan(0.75);
      expect(zeroFraction).toBeLessThan(0.95);

      const activeDraws = draws.filter((v) => v !== 0);
      expect(activeDraws.length).toBeGreaterThan(0);

      switch (spec.name) {
        case 'sobel':
          for (const v of activeDraws) {
            expect(v).toBeGreaterThanOrEqual(0.05);
            expect(v).toBeLessThanOrEqual(0.20);
          }
          break;
        case 'solarize':
          for (const v of activeDraws) {
            expect(v).toBeGreaterThanOrEqual(0.10);
            expect(v).toBeLessThanOrEqual(0.35);
          }
          break;
        case 'chroma':
          for (const v of activeDraws) {
            expect(v).toBeGreaterThanOrEqual(0.001);
            expect(v).toBeLessThanOrEqual(0.004);
          }
          break;
        case 'rgbSplit':
          for (const v of activeDraws) {
            expect(v).toBeGreaterThanOrEqual(0.002);
            expect(v).toBeLessThanOrEqual(0.012);
          }
          break;
        case 'mirror':
          for (const v of activeDraws) {
            expect([2, 4, 6]).toContain(v);
          }
          break;
      }
    }
  });
});

describe('seeded per-layer randomise (Slice 19.7)', () => {
  it('seededRng repeats for the same seed and differs for another', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const c = seededRng(43);
    const runA = [a(), a(), a(), a()];
    expect(runA).toEqual([b(), b(), b(), b()]);
    expect(runA).not.toEqual([c(), c(), c(), c()]);
    for (const v of runA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('newLayerSeed stays in 1..MAX_LAYER_SEED', () => {
    expect(newLayerSeed(() => 0)).toBe(1);
    expect(newLayerSeed(() => 0.999999999)).toBe(MAX_LAYER_SEED);
  });

  const shape: Settings = Object.fromEntries(SHAPE_SPECS.map((s) => [s.name, { value: s.default }]));

  it('the same seed gives the same Shape layer, a different seed gives a different one', () => {
    const one = randomiseLayerSettings(shape, SHAPE_SPECS, 1234);
    const again = randomiseLayerSettings(shape, SHAPE_SPECS, 1234);
    const other = randomiseLayerSettings(shape, SHAPE_SPECS, 4321);
    expect(one).toEqual(again);
    expect(one).not.toEqual(other);
  });

  it('every randomised Shape value stays inside its schema range', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const out = randomiseLayerSettings(shape, SHAPE_SPECS, seed);
      for (const spec of SHAPE_SPECS) {
        const v = out[spec.name]!.value;
        if (spec.type === 'float' || spec.type === 'int') {
          expect(v as number).toBeGreaterThanOrEqual(spec.min);
          expect(v as number).toBeLessThanOrEqual(spec.max);
        } else if (spec.type === 'enum') {
          expect(spec.options).toContain(v);
        }
      }
    }
  });
});
