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

const FEEDBACK_MOTION_KEYS = new Set([
  'zoom',
  'rotate',
  'centreX',
  'centreY',
  'driftX',
  'driftY',
  'stretchX',
  'stretchY',
]);

export const HIGH_INTENSITY_KEYS = new Set([
  'sobel',
  'solarize',
  'chroma',
  'rgbSplit',
  'mirror',
]);

const HIGH_INTENSITY_RANGES: Record<string, [number, number]> = {
  sobel: [0.05, 0.20],
  solarize: [0.10, 0.35],
  chroma: [0.001, 0.004],
  rgbSplit: [0.002, 0.012],
};

export function randomValue(spec: ParamSpec, rng: Rng): ParamValue {
  if (HIGH_INTENSITY_KEYS.has(spec.name)) {
    if (rng() < 0.85) {
      return spec.default;
    }
    if (spec.name === 'mirror') {
      const folds = [2, 4, 6];
      return folds[Math.floor(rng() * folds.length)] ?? 2;
    }
    const range = HIGH_INTENSITY_RANGES[spec.name];
    if (range) {
      const [min, max] = range;
      const raw = min + rng() * (max - min);
      const stepped = 'step' in spec && typeof (spec as any).step === 'number'
        ? snap(spec as { min: number; step: number }, raw)
        : raw;
      return Number(clamp(stepped, min, max).toFixed(6));
    }
  }

  switch (spec.type) {
    case 'float': {
      const fullPick = spec.min + rng() * (spec.max - spec.min);
      const isFeedbackMotion = FEEDBACK_MOTION_KEYS.has(spec.name) && spec.group === 'Motion';
      const v = isFeedbackMotion ? spec.default + (fullPick - spec.default) * 0.25 : fullPick;
      return clamp(snap(spec, v), spec.min, spec.max);
    }
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
