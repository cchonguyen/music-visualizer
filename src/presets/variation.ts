// Randomise and mutate (slice S4). Every value stays inside its schema range, so a random
// preset cannot leave the safe ranges. Only numbers are mutated; bools, enums and colours
// are left alone by mutate (they are either chosen or kept, never nudged).
import type { Settings } from './format';
import type { ParamSpec, ParamValue } from './schema';

/** A random number source in [0, 1). Pass a seeded one in tests. */
export type Rng = () => number;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Snap a number to the spec's step grid (keeps sliders tidy). */
function snap(spec: { min: number; step: number }, v: number): number {
  return spec.min + Math.round((v - spec.min) / spec.step) * spec.step;
}

export function randomValue(spec: ParamSpec, rng: Rng): ParamValue {
  switch (spec.type) {
    case 'float':
      return clamp(snap(spec, spec.min + rng() * (spec.max - spec.min)), spec.min, spec.max);
    case 'int':
      return Math.round(clamp(spec.min + rng() * (spec.max - spec.min), spec.min, spec.max));
    case 'bool':
      return rng() < 0.5;
    case 'enum':
      return spec.options[Math.floor(rng() * spec.options.length)] ?? spec.default;
    case 'colour': {
      let hex = '#';
      for (let i = 0; i < 6; i++) hex += Math.floor(rng() * 16).toString(16);
      return hex;
    }
  }
}

/** Nudges a number by up to ±`amount` of its value (default 10%), staying inside min..max. */
export function mutateValue(spec: ParamSpec, value: ParamValue, rng: Rng, amount = 0.1): ParamValue {
  if (spec.type !== 'float' && spec.type !== 'int') return value;
  const current = typeof value === 'number' ? value : spec.default;
  // A zero value would never move with a percentage, so use 10% of the range instead.
  const base = Math.abs(current) > 1e-9 ? Math.abs(current) : (spec.max - spec.min) * 0.1;
  const next = clamp(current + base * amount * (2 * rng() - 1), spec.min, spec.max);
  return spec.type === 'int' ? Math.round(next) : snap(spec, next);
}

/** New settings with every unlocked value randomised. `locked` names are kept as they are. */
export function randomiseSettings(settings: Settings, specs: readonly ParamSpec[], rng: Rng, locked: ReadonlySet<string> = new Set()): Settings {
  const out: Settings = structuredClone(settings);
  for (const spec of specs) {
    if (locked.has(spec.name)) continue;
    out[spec.name] = { ...out[spec.name], value: randomValue(spec, rng) };
  }
  return out;
}

/** New settings with every unlocked number nudged. Bools, enums and colours are unchanged. */
export function mutateSettings(settings: Settings, specs: readonly ParamSpec[], rng: Rng, locked: ReadonlySet<string> = new Set(), amount = 0.1): Settings {
  const out: Settings = structuredClone(settings);
  for (const spec of specs) {
    if (locked.has(spec.name)) continue;
    const current = out[spec.name];
    if (!current) continue;
    out[spec.name] = { ...current, value: mutateValue(spec, current.value, rng, amount) };
  }
  return out;
}
