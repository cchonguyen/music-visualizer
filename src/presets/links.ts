// Audio links (slice E2). A setting with a link follows a signal:
//   final = base + amount × (max − min) × shaped(source), then clamped to the setting's range.
// `amount` is the share of the setting's full range (-1 .. 1). `shaped` is the source, smoothed
// with a one-pole filter (smooth 0 = quick, 1 = slow). Stage 29 added response curves (punch, swell, gate),
// bounds, bipolar and direction-flip modes, song-arc sources, Calm damping, and enum and colour targets.
// Pure logic, so it is unit tested.
import type { AudioFrame } from '../audio/types';
import {
  AUDIO_SOURCES,
  LFO_RATE_DEFAULT,
  LFO_RATE_MAX,
  LFO_RATE_MIN,
  LINK_COOLDOWN_DEFAULT,
  LINK_COOLDOWN_MAX,
  LINK_COOLDOWN_MIN,
  LINK_FLIP_SLEW_DEFAULT,
  LINK_FLIP_SLEW_MAX,
  LINK_FLIP_SLEW_MIN,
  LINK_THRESHOLD_DEFAULT,
  LINK_THRESHOLD_MAX,
  LINK_THRESHOLD_MIN,
  type AudioLink,
  type AudioSource,
  type LinkCurve,
  type Settings,
} from './format';
import type { ColourSpec, EnumSpec, ParamSpec, ParamValue } from './schema';
import { morphValue } from './morph';
import { ReactionEngine, type Reaction, type ReactionGroup } from './reactions';

export interface LinkInputs {
  frame: AudioFrame;
  /** Render clock, seconds. Drives the LFO and time sources. */
  timeSec: number;
  /** Section contrast from sectionContrast.ts, −1..1 (0 = no change). */
  sectionContrast: number;
  /** Calm mode flag: attenuates modulation depth and protects intense params. */
  calm?: boolean;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Shapes a 0..1 signal with an optional response curve. */
export function applyLinkCurve(x: number, curve?: LinkCurve, threshold = LINK_THRESHOLD_DEFAULT): number {
  const c = clamp01(x);
  switch (curve) {
    case 'punch':
      return Math.pow(c, 2.2);
    case 'swell':
      return Math.sqrt(c);
    case 'gate': {
      const th = Number.isFinite(threshold)
        ? Math.min(LINK_THRESHOLD_MAX, Math.max(LINK_THRESHOLD_MIN, threshold))
        : LINK_THRESHOLD_DEFAULT;
      return c <= th ? 0 : (c - th) / (1 - th);
    }
    case 'linear':
    default:
      return c;
  }
}

/** Returns the neutral pivot point used by direction-flipping link modes. */
export function neutralPointForSpec(spec: { name: string; default: number; min: number; max: number }): number {
  if (spec.name === 'zoom' && spec.min < 1 && spec.max > 1) return 1.0;
  if (spec.min < 0 && spec.max > 0) return 0.0;
  return spec.default;
}

const HEX6_RE = /^#([0-9a-f]{6})$/i;

/** Parses `#rrggbb` case-insensitively to `[h 0..360, s 0..1, l 0..1]`, or `null` if invalid. */
export function hexToHsl(hex: string): [number, number, number] | null {
  const m = HEX6_RE.exec(hex.trim());
  if (!m) return null;
  const raw = m[1]!;
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  } else if (max === g) {
    h = ((b - r) / d + 2) * 60;
  } else {
    h = ((r - g) / d + 4) * 60;
  }
  return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  let u = t;
  if (u < 0) u += 1;
  if (u > 1) u -= 1;
  if (u < 1 / 6) return p + (q - p) * 6 * u;
  if (u < 1 / 2) return q;
  if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
  return p;
}

/** Converts `[h, s, l]` to lowercase `#rrggbb`, wrapping hue into `[0, 360)`, clamping `s`/`l`, and enforcing `#000000` dark floor. */
export function hslToHex(h: number, s: number, l: number): string {
  const lit = clamp01(l);
  if (lit <= 1e-4) return '#000000';
  const hue = Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0;
  const sat = clamp01(s);
  let r: number;
  let g: number;
  let b: number;
  if (sat === 0) {
    r = lit;
    g = lit;
    b = lit;
  } else {
    const q = lit < 0.5 ? lit * (1 + sat) : lit + sat - lit * sat;
    const p = 2 * lit - q;
    const hk = hue / 360;
    r = hue2rgb(p, q, hk + 1 / 3);
    g = hue2rgb(p, q, hk);
    b = hue2rgb(p, q, hk - 1 / 3);
  }
  const toHex = (c: number) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Shifts a `#rrggbb` colour's hue by `deltaDegrees`, preserving invalid, grayscale, and dark-floor inputs unchanged. */
export function shiftHexHue(hex: string, deltaDegrees: number): string {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  const [h, s, l] = hsl;
  if (s <= 1e-4 || l <= 1e-4) return hex;
  return hslToHex(h + deltaDegrees, s, l);
}

/** Last brightness result. A preset can ask for it many times per frame, so reuse it. */
let brightnessCache: { frameIndex: number; spectrum: Float32Array; value: number } | null = null;

const CENTROID_NOISE_FLOOR = 1e-4;

/** Spectral centroid of the frame, mapped to 0..1 (0 Hz..8 kHz). Cached per frame and spectrum. Holds 0.5 on silence. */
function brightnessOf(frame: AudioFrame): number {
  const spectrum = frame.spectrum;
  if (brightnessCache && brightnessCache.frameIndex === frame.frameIndex && brightnessCache.spectrum === spectrum) {
    return brightnessCache.value;
  }
  const binHz = frame.sampleRate / (2 * spectrum.length);
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < spectrum.length; i++) {
    const s = spectrum[i] ?? 0;
    weighted += i * binHz * s;
    total += s;
  }
  const value = total <= CENTROID_NOISE_FLOOR ? 0.5 : clamp01((weighted / total) / 8000);
  brightnessCache = { frameIndex: frame.frameIndex, spectrum, value };
  return value;
}

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
    case 'beatStrength':
      return clamp01(frame.beatStrength);
    case 'brightness':
    case 'centroid':
      return brightnessOf(frame);
    case 'kickEnv':
      return clamp01(frame.kickEnv);
    case 'subFlux':
      return clamp01(frame.fluxByBand.sub);
    case 'midFlux':
      return clamp01(frame.fluxByBand.mid);
    case 'highFlux':
      return clamp01(frame.fluxByBand.high);
    case 'lfoSine':
      return 0.5 + 0.5 * Math.sin(2 * Math.PI * rate * t);
    case 'lfoSaw':
      return clamp01(((t * rate) % 1 + 1) % 1);
    case 'lfoRandom':
      return hash01(Math.floor(t * rate * 2)); // new value every half cycle
    case 'time':
      return clamp01(((t % 60) + 60) % 60 / 60);
    case 'drop':
      return clamp01(inputs.sectionContrast * 2);
    case 'breakdown':
      return clamp01(-inputs.sectionContrast * 2);
    case 'phrase16':
      return clamp01(((t / 8) % 1 + 1) % 1);
    case 'phrase32':
      return clamp01(((t / 16) % 1 + 1) % 1);
    case 'energySlow':
      return clamp01(frame.energy);
  }
}

/** Which reaction engine to apply, and which group of controls the settings being resolved belong to. */
export interface ReactionTarget {
  engine: ReactionEngine;
  group: ReactionGroup;
}

const NO_REACTIONS: readonly Reaction[] = [];

function sameReaction(x: Reaction, y: Reaction): boolean {
  return (
    x.trigger.type === y.trigger.type && x.trigger.n === y.trigger.n &&
    x.response === y.response && x.amount === y.amount && x.ease === y.ease && x.seed === y.seed &&
    x.target.group === y.target.group && x.target.name === y.target.name
  );
}

/** True when `snapshot` equals `extra` followed by `own`, without building that joined list. */
function sameReactions(snapshot: readonly Reaction[], extra: readonly Reaction[], own: readonly Reaction[]): boolean {
  if (snapshot.length !== extra.length + own.length) return false;
  for (let i = 0; i < snapshot.length; i += 1) {
    const live = i < extra.length ? extra[i]! : own[i - extra.length]!;
    if (!sameReaction(snapshot[i]!, live)) return false;
  }
  return true;
}

function seedOf(scope: string): number {
  let h = 2166136261;
  for (let i = 0; i < scope.length; i += 1) h = Math.imul(h ^ scope.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * One reaction engine per preset scope. An engine is rebuilt (and starts from rest) when the preset's reactions
 * change, which is checked field by field each frame so nothing is allocated while they stay the same.
 * The seed comes from the scope, so the same preset always reacts the same way.
 */
export class ReactionBank {
  private entries = new Map<string, { engine: ReactionEngine; snapshot: Reaction[] }>();

  /**
   * The engine for this preset, or null when it has no reactions. `own` is the preset's own list; `extra` is the
   * list from its reaction style (Slice 17.5), which runs first.
   */
  engineFor(scope: string, own: readonly Reaction[] | undefined, extra: readonly Reaction[] = NO_REACTIONS): ReactionEngine | null {
    const mine = own ?? NO_REACTIONS;
    if (mine.length + extra.length === 0) {
      this.entries.delete(scope);
      return null;
    }
    const known = this.entries.get(scope);
    if (known && sameReactions(known.snapshot, extra, mine)) return known.engine;
    const snapshot = [...extra, ...mine].map((r) => ({ ...r, trigger: { ...r.trigger }, target: { ...r.target } }));
    const engine = new ReactionEngine(snapshot, seedOf(scope));
    this.entries.set(scope, { engine, snapshot });
    return engine;
  }
}

/** Keeps the smoothed state of every link. One runner per preset is enough. */
export class LinkRunner {
  private state = new Map<string, number>();
  private resolved = new Map<string, number>();
  private resolvedStrings = new Map<string, string>();
  private enumState = new Map<string, { index: number; lastBase: string; lastSwitchTime: number; lastPhraseBucket: number }>();
  private polarity = new Map<string, { target: 1 | -1; current: number }>();

  private lastMacroFrame = -1;
  private lastMacroTime = Number.NaN;
  private prevBeatActive = false;
  private lastBeatTime = Number.NaN;
  private beatCount = 0;
  private beatEdge = false;
  private prevDropActive = false;
  private lastDropTime = Number.NaN;
  private dropEdge = false;
  private prevSectionActive = false;
  private lastSectionTime = Number.NaN;
  private lastContrastSign: -1 | 0 | 1 = 0;
  private sectionEdge = false;
  private energySlow = 0;
  private energySlowSeeded = false;

  private stepMacro(inputs: LinkInputs, dtSec: number): void {
    if (this.lastMacroFrame === inputs.frame.frameIndex && this.lastMacroTime === inputs.timeSec) {
      return;
    }
    this.lastMacroFrame = inputs.frame.frameIndex;
    this.lastMacroTime = inputs.timeSec;

    this.beatEdge = false;
    const beatActive = Boolean(inputs.frame.beatByBand?.sub || inputs.frame.kickPulse);
    if (
      !this.prevBeatActive &&
      beatActive &&
      (inputs.timeSec - this.lastBeatTime >= 0.18 || !Number.isFinite(this.lastBeatTime))
    ) {
      this.beatCount++;
      this.beatEdge = true;
      this.lastBeatTime = inputs.timeSec;
    }
    this.prevBeatActive = beatActive;

    this.dropEdge = false;
    const dropActive = inputs.sectionContrast >= 0.18;
    if (
      !this.prevDropActive &&
      dropActive &&
      (inputs.timeSec - this.lastDropTime >= 3.5 || !Number.isFinite(this.lastDropTime))
    ) {
      this.dropEdge = true;
      this.lastDropTime = inputs.timeSec;
    }
    this.prevDropActive = dropActive;

    this.sectionEdge = false;
    const sectionActive = Math.abs(inputs.sectionContrast) >= 0.22;
    const sign: -1 | 1 = inputs.sectionContrast >= 0 ? 1 : -1;
    if (
      sectionActive &&
      ((!this.prevSectionActive && (inputs.timeSec - this.lastSectionTime >= 6.0 || !Number.isFinite(this.lastSectionTime))) ||
        (this.lastContrastSign !== 0 && sign !== this.lastContrastSign && inputs.timeSec - this.lastSectionTime >= 1.0))
    ) {
      this.sectionEdge = true;
      this.lastSectionTime = inputs.timeSec;
      this.lastContrastSign = sign;
    }
    this.prevSectionActive = sectionActive;

    const targetEnergy = clamp01(inputs.frame.energy);
    if (!this.energySlowSeeded) {
      this.energySlow = targetEnergy;
      this.energySlowSeeded = true;
    } else {
      const alpha = 1 - Math.exp(-Math.max(0, dtSec) / 10.0);
      this.energySlow += (targetEnergy - this.energySlow) * alpha;
    }
  }

  private runnerSourceValue(source: AudioSource, inputs: LinkInputs, rateHz?: number): number {
    switch (source) {
      case 'energySlow':
        return this.energySlow;
      case 'phrase16':
        return this.beatCount > 0 ? (this.beatCount % 16) / 16 : sourceValue('phrase16', inputs, rateHz);
      case 'phrase32':
        return this.beatCount > 0 ? (this.beatCount % 32) / 32 : sourceValue('phrase32', inputs, rateHz);
      default:
        return sourceValue(source, inputs, rateHz);
    }
  }

  /**
   * Resolves one group of settings (a layer, or feedback). `scope` must be unique per group,
   * for example "L0" for the first layer. Settings without a link come back unchanged.
   * Order for a number setting: base value, morph, audio link, reaction, clamp to the setting's range.
   * `reactions` is passed only for Feedback and Post (Stage 17); the safety limiter still runs last in the compositor.
   */
  resolve(scope: string, settings: Settings, specs: readonly ParamSpec[], inputs: LinkInputs, dtSec: number, reactions?: ReactionTarget): Record<string, ParamValue> {
    this.stepMacro(inputs, dtSec);
    const out: Record<string, ParamValue> = {};
    for (const spec of specs) {
      const setting = settings[spec.name];
      if (!setting) continue;
      const base = setting.value;
      const link = setting.link;
      if (spec.type === 'enum') {
        out[spec.name] = link ? this.linkedEnum(`${scope}.${spec.name}`, base, link, spec, inputs) : base;
        continue;
      }
      if (spec.type === 'colour') {
        out[spec.name] = link ? this.linkedColour(`${scope}.${spec.name}`, base, link, spec, inputs, dtSec) : base;
        continue;
      }
      if (spec.type !== 'float' && spec.type !== 'int') {
        out[spec.name] = base;
        continue;
      }
      const morph = setting.morph;
      const reacts = reactions !== undefined && reactions.engine.targets(reactions.group, spec.name);
      if (!link && !morph && !reacts) {
        out[spec.name] = base;
        continue;
      }
      // With a morph, the link (if any) starts from the morphed value.
      const start: ParamValue = morph && typeof base === 'number' ? morphValue(base, morph, inputs.timeSec) : base;
      if (!link) {
        // Morph only: no smoothing. Clamp to the range and round for ints.
        let value = Math.min(spec.max, Math.max(spec.min, typeof start === 'number' ? start : spec.default));
        if (reacts) value = reactions.engine.apply(reactions.group, spec.name, value, spec);
        if (spec.type === 'int') value = Math.round(value);
        this.resolved.set(`${scope}.${spec.name}`, value);
        out[spec.name] = value;
        continue;
      }
      const key = `${scope}.${spec.name}`;
      let value = this.linked(key, start, link, spec, inputs, dtSec);
      if (reacts) {
        value = reactions.engine.apply(reactions.group, spec.name, value, spec);
        if (spec.type === 'int') value = Math.round(value);
        this.resolved.set(key, value);
      }
      out[spec.name] = value;
    }
    return out;
  }

  private smoothSource(key: string, link: AudioLink, inputs: LinkInputs, dtSec: number): number {
    const target = this.runnerSourceValue(link.source, inputs, link.rate);
    const prev = this.state.get(key) ?? target;
    const tau = 0.02 + link.smooth * 0.5; // seconds; smooth 0 follows within about 20 ms
    const alpha = 1 - Math.exp(-Math.max(0, dtSec) / tau);
    const shaped = prev + (target - prev) * alpha;
    this.state.set(key, shaped);
    return shaped;
  }

  private updatePolarity(key: string, link: AudioLink, dtSec: number): number {
    const mode = link.mode ?? 'add';
    if (mode !== 'flipOnBeat' && mode !== 'flipOnDrop' && mode !== 'flipOnSection') {
      return 1;
    }
    const pol = this.polarity.get(key) ?? { target: 1 as 1 | -1, current: 1 };
    const edge =
      (mode === 'flipOnBeat' && this.beatEdge) ||
      (mode === 'flipOnDrop' && this.dropEdge) ||
      (mode === 'flipOnSection' && this.sectionEdge);
    if (edge) {
      pol.target = pol.target === 1 ? -1 : 1;
    }
    const rawSlew = link.flipSlew ?? LINK_FLIP_SLEW_DEFAULT;
    const slew = Math.min(
      LINK_FLIP_SLEW_MAX,
      Math.max(LINK_FLIP_SLEW_MIN, Number.isFinite(rawSlew) ? rawSlew : LINK_FLIP_SLEW_DEFAULT),
    );
    const maxStep = (2 / slew) * Math.max(0, dtSec);
    const diff = pol.target - pol.current;
    if (Math.abs(diff) <= maxStep) {
      pol.current = pol.target;
    } else {
      pol.current += Math.sign(diff) * maxStep;
    }
    this.polarity.set(key, pol);
    return pol.current;
  }

  private linkedEnum(
    key: string,
    base: ParamValue,
    link: AudioLink,
    spec: EnumSpec,
    inputs: LinkInputs,
  ): string {
    const baseStr = typeof base === 'string' ? base : spec.default;
    const filtered = link.enumOptions?.length ? link.enumOptions.filter((o) => spec.options.includes(o)) : [];
    const pool = filtered.length > 0 ? filtered : spec.options;
    if (pool.length === 0) {
      this.resolvedStrings.set(key, baseStr);
      return baseStr;
    }

    let st = this.enumState.get(key);
    if (!st || st.lastBase !== baseStr) {
      const idx = pool.indexOf(baseStr);
      st = {
        index: idx >= 0 ? idx : 0,
        lastBase: baseStr,
        lastSwitchTime: -Infinity,
        lastPhraseBucket: -1,
      };
      this.enumState.set(key, st);
    } else if (st.index >= pool.length) {
      st.index = 0;
    }

    const rawCd = link.cooldownSec ?? LINK_COOLDOWN_DEFAULT;
    const clampedCd = Math.min(
      LINK_COOLDOWN_MAX,
      Math.max(LINK_COOLDOWN_MIN, Number.isFinite(rawCd) ? rawCd : LINK_COOLDOWN_DEFAULT),
    );
    const cooldownSec = clampedCd * (inputs.calm ? 2 : 1);

    let fired = false;
    switch (link.source) {
      case 'section':
        fired = this.sectionEdge;
        break;
      case 'drop':
        fired = this.dropEdge;
        break;
      case 'breakdown':
        fired = inputs.sectionContrast <= -0.18;
        break;
      case 'beat':
      case 'kickEnv':
      case 'onset':
        fired = this.beatEdge;
        break;
      case 'phrase16':
        if (this.beatCount > 0) {
          fired = this.beatEdge && this.beatCount % 16 === 0;
        } else {
          const bucket = Math.floor(Math.max(0, inputs.timeSec) / 8);
          if (st.lastPhraseBucket < 0) {
            st.lastPhraseBucket = bucket;
          } else if (bucket !== st.lastPhraseBucket) {
            st.lastPhraseBucket = bucket;
            fired = true;
          }
        }
        break;
      case 'phrase32':
        if (this.beatCount > 0) {
          fired = this.beatEdge && this.beatCount % 32 === 0;
        } else {
          const bucket = Math.floor(Math.max(0, inputs.timeSec) / 16);
          if (st.lastPhraseBucket < 0) {
            st.lastPhraseBucket = bucket;
          } else if (bucket !== st.lastPhraseBucket) {
            st.lastPhraseBucket = bucket;
            fired = true;
          }
        }
        break;
      default:
        fired = this.runnerSourceValue(link.source, inputs, link.rate) >= (link.threshold ?? LINK_THRESHOLD_DEFAULT);
        break;
    }

    if (fired && (!Number.isFinite(st.lastSwitchTime) || inputs.timeSec - st.lastSwitchTime >= cooldownSec) && pool.length > 1) {
      const step = link.amount < 0 ? -1 : 1;
      st.index = ((st.index + step) % pool.length + pool.length) % pool.length;
      st.lastSwitchTime = inputs.timeSec;
    }

    const chosen = pool[st.index] ?? baseStr;
    this.state.set(key, pool.length > 1 ? st.index / (pool.length - 1) : 0);
    this.resolvedStrings.set(key, chosen);
    return chosen;
  }

  private linkedColour(
    key: string,
    base: ParamValue,
    link: AudioLink,
    spec: ColourSpec,
    inputs: LinkInputs,
    dtSec: number,
  ): string {
    const shaped = this.smoothSource(key, link, inputs, dtSec);
    const curved = applyLinkCurve(shaped, link.curve, link.threshold);
    const polCurrent = this.updatePolarity(key, link, dtSec);
    const calmMult = inputs.calm ? (spec.intense ? 0.2 : 0.35) : 1.0;
    const effAmount = link.amount * calmMult;
    const mode = link.mode ?? 'add';
    let modFactor: number;
    if (mode === 'bipolar') {
      modFactor = curved * 2 - 1;
    } else if (mode === 'flipOnBeat' || mode === 'flipOnDrop' || mode === 'flipOnSection') {
      modFactor = curved * polCurrent;
    } else {
      modFactor = curved;
    }
    const baseHex = typeof base === 'string' ? base : spec.default;
    const shifted = shiftHexHue(baseHex, effAmount * 360 * modFactor);
    this.resolvedStrings.set(key, shifted);
    return shifted;
  }

  private linked(
    key: string,
    base: ParamValue,
    link: AudioLink,
    spec: { name: string; type: 'float' | 'int'; default: number; min: number; max: number; intense?: boolean },
    inputs: LinkInputs,
    dtSec: number,
  ): number {
    const shaped = this.smoothSource(key, link, inputs, dtSec);
    const mode = link.mode ?? 'add';
    const polCurrent = this.updatePolarity(key, link, dtSec);

    const curved = applyLinkCurve(shaped, link.curve, link.threshold);
    const calmMult = inputs.calm ? (spec.intense ? 0.2 : 0.35) : 1.0;
    const effAmount = link.amount * calmMult;
    const start = typeof base === 'number' ? base : spec.default;
    const span = spec.max - spec.min;

    let rawValue: number;
    if (mode === 'bipolar') {
      rawValue = start + effAmount * span * (curved * 2 - 1);
    } else if (mode === 'flipOnBeat' || mode === 'flipOnDrop' || mode === 'flipOnSection') {
      const neutral = neutralPointForSpec(spec);
      rawValue = neutral + (start - neutral + effAmount * span * curved) * polCurrent;
    } else {
      rawValue = start + effAmount * span * curved;
    }

    let lo = spec.min;
    let hi = spec.max;
    if (link.minBound !== undefined || link.maxBound !== undefined) {
      let loN = link.minBound !== undefined && Number.isFinite(link.minBound) ? clamp01(link.minBound) : 0;
      let hiN = link.maxBound !== undefined && Number.isFinite(link.maxBound) ? clamp01(link.maxBound) : 1;
      if (loN > hiN) [loN, hiN] = [hiN, loN];
      lo = spec.min + loN * span;
      hi = spec.min + hiN * span;
    }

    let value = Math.min(hi, Math.max(lo, rawValue));
    value = Math.min(spec.max, Math.max(spec.min, value));
    if (spec.type === 'int') value = Math.round(value);
    this.resolved.set(key, value);
    return value;
  }

  /** The last shaped value of a link, 0..1 (for the Studio meter). Key is `${scope}.${name}`. */
  meterByKey(key: string): number | undefined {
    return this.state.get(key);
  }

  /** The last resolved final parameter value for `${scope}.${name}`. */
  resolvedByKey(key: string): number | undefined {
    return this.resolved.get(key);
  }

  /** The last resolved final string parameter value (enum/colour) for `${scope}.${name}`. */
  resolvedStringByKey(key: string): string | undefined {
    return this.resolvedStrings.get(key);
  }

  /** Resets all cached link, polarity, resolved, and macro state. */
  clear(): void {
    this.state.clear();
    this.resolved.clear();
    this.resolvedStrings.clear();
    this.enumState.clear();
    this.polarity.clear();
    this.lastMacroFrame = -1;
    this.lastMacroTime = Number.NaN;
    this.prevBeatActive = false;
    this.lastBeatTime = Number.NaN;
    this.beatCount = 0;
    this.beatEdge = false;
    this.prevDropActive = false;
    this.lastDropTime = Number.NaN;
    this.dropEdge = false;
    this.prevSectionActive = false;
    this.lastSectionTime = Number.NaN;
    this.lastContrastSign = 0;
    this.sectionEdge = false;
    this.energySlow = 0;
    this.energySlowSeeded = false;
  }
}

export { AUDIO_SOURCES };
