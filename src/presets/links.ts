// Audio links (slice E2). A setting with a link follows a signal:
//   final = base + amount × (max − min) × shaped(source), then clamped to the setting's range.
// `amount` is the share of the setting's full range (-1 .. 1). `shaped` is the source, smoothed
// with a one-pole filter (smooth 0 = quick, 1 = slow). Pure logic, so it is unit tested.
import type { AudioFrame } from '../audio/types';
import { AUDIO_SOURCES, LFO_RATE_DEFAULT, LFO_RATE_MAX, LFO_RATE_MIN, type AudioLink, type AudioSource, type Settings } from './format';
import type { ParamSpec, ParamValue } from './schema';
import { morphValue } from './morph';

export interface LinkInputs {
  frame: AudioFrame;
  /** Render clock, seconds. Drives the LFO and time sources. */
  timeSec: number;
  /** Section contrast from sectionContrast.ts, −1..1 (0 = no change). */
  sectionContrast: number;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** A deterministic 0..1 value per time step, used by the random LFO. */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** The raw source value, 0..1, before smoothing. */
export function sourceValue(source: AudioSource, inputs: LinkInputs, rateHz: number = LFO_RATE_DEFAULT): number {
  const { frame, timeSec: t } = inputs;
  const rate = Math.min(LFO_RATE_MAX, Math.max(LFO_RATE_MIN, Number.isFinite(rateHz) ? rateHz : LFO_RATE_DEFAULT));
  switch (source) {
    case 'sub':
      return clamp01(frame.norm.sub);
    case 'bass':
      return clamp01(frame.env.sub);
    case 'mid':
      return clamp01(frame.norm.mid);
    case 'high':
      return clamp01(frame.norm.high);
    case 'energy':
      return clamp01(frame.energy);
    case 'loudness':
      return clamp01(frame.loudness);
    case 'beat':
      return frame.beatByBand.sub ? 1 : 0;
    case 'onset':
      return clamp01(frame.flux);
    case 'section':
      return clamp01((inputs.sectionContrast + 1) / 2);
    case 'lfoSine':
      return 0.5 + 0.5 * Math.sin(2 * Math.PI * rate * t);
    case 'lfoSaw':
      return clamp01(((t * rate) % 1 + 1) % 1);
    case 'lfoRandom':
      return hash01(Math.floor(t * rate * 2)); // new value every half cycle
    case 'time':
      return clamp01(((t % 60) + 60) % 60 / 60);
  }
}

/** Keeps the smoothed state of every link. One runner per preset is enough. */
export class LinkRunner {
  private state = new Map<string, number>();

  /**
   * Resolves one group of settings (a layer, or feedback). `scope` must be unique per group,
   * for example "L0" for the first layer. Settings without a link come back unchanged.
   */
  resolve(scope: string, settings: Settings, specs: readonly ParamSpec[], inputs: LinkInputs, dtSec: number): Record<string, ParamValue> {
    const out: Record<string, ParamValue> = {};
    for (const spec of specs) {
      const setting = settings[spec.name];
      if (!setting) continue;
      const base = setting.value;
      const link = setting.link;
      if (spec.type !== 'float' && spec.type !== 'int') {
        out[spec.name] = base;
        continue;
      }
      const morph = setting.morph;
      if (!link && !morph) {
        out[spec.name] = base;
        continue;
      }
      // With a morph, the link (if any) starts from the morphed value.
      const start: ParamValue = morph && typeof base === 'number' ? morphValue(base, morph, inputs.timeSec) : base;
      if (!link) {
        // Morph only: no smoothing. Clamp to the range and round for ints.
        let value = Math.min(spec.max, Math.max(spec.min, typeof start === 'number' ? start : spec.default));
        if (spec.type === 'int') value = Math.round(value);
        out[spec.name] = value;
        continue;
      }
      out[spec.name] = this.linked(`${scope}.${spec.name}`, start, link, spec, inputs, dtSec);
    }
    return out;
  }

  private linked(key: string, base: ParamValue, link: AudioLink, spec: { type: 'float' | 'int'; default: number; min: number; max: number }, inputs: LinkInputs, dtSec: number): number {
    const target = sourceValue(link.source, inputs, link.rate);
    const prev = this.state.get(key) ?? target;
    const tau = 0.02 + link.smooth * 0.5; // seconds; smooth 0 follows within about 20 ms
    const alpha = 1 - Math.exp(-Math.max(0, dtSec) / tau);
    const shaped = prev + (target - prev) * alpha;
    this.state.set(key, shaped);
    const start = typeof base === 'number' ? base : spec.default;
    let value = Math.min(spec.max, Math.max(spec.min, start + link.amount * (spec.max - spec.min) * shaped));
    if (spec.type === 'int') value = Math.round(value);
    return value;
  }

  /** The last shaped value of a link, 0..1 (for the Studio meter). Key is `${scope}.${name}`. */
  meterByKey(key: string): number | undefined {
    return this.state.get(key);
  }
}

export { AUDIO_SOURCES };
