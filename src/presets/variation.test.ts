import { describe, it, expect } from 'vitest';
import { randomiseSettings, mutateSettings, randomValue, mutateValue } from './variation';
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
