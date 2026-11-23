// Preset format: the shape of a preset as a JSON file, and the checker that turns
// any JSON (hand-edited, imported, or saved by an older version) into a safe Preset.
import { AUDIO_SOURCES, REMOVED_FEEDBACK_SETTINGS, REMOVED_POST_SETTINGS, type AudioSource, coerceValue, type ParamSpec, type ParamValue, type NumberSpec, type EnumSpec, type BoolSpec } from "./schema";
import type { GlobalDirectorSettings } from "../render/globalDirector";
import { parseReactions, type Reaction } from "./reactions";
import { parseReactionStyle, type ReactionStyle } from "./reactionStyles";
import { WARP_OP_MAX, isWarpOpType, warpOpSpecs, type WarpOpType } from "./warpOps";

/** Bump this when the shape changes, and add an upgrade step for the old version. */
export const PRESET_VERSION = 1 as const;

export { AUDIO_SOURCES, type AudioSource };

export const TRANSITION_STYLES = ["crossfade", "wipe", "dissolve", "zoom", "morph"] as const;
export type Transition = (typeof TRANSITION_STYLES)[number];

export const BLEND_MODES = ["max", "alpha", "add", "screen"] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const LINK_MODES = ["add", "bipolar", "flipOnBeat", "flipOnDrop", "flipOnSection"] as const;
export type LinkMode = (typeof LINK_MODES)[number];

export const LINK_CURVES = ["linear", "punch", "swell", "gate"] as const;
export type LinkCurve = (typeof LINK_CURVES)[number];

export const LINK_THRESHOLD_DEFAULT = 0.35;
export const LINK_THRESHOLD_MIN = 0.05;
export const LINK_THRESHOLD_MAX = 0.9;

export const LINK_FLIP_SLEW_DEFAULT = 0.45;
export const LINK_FLIP_SLEW_MIN = 0.1;
export const LINK_FLIP_SLEW_MAX = 3.0;

export const LINK_COOLDOWN_DEFAULT = 8;
export const LINK_COOLDOWN_MIN = 1;
export const LINK_COOLDOWN_MAX = 60;

/** Audio link: final = value + amount × shaped(source), then clamped to the setting's range. */
export interface AudioLink {
  source: AudioSource;
  amount: number; // -1..1
  smooth: number; // 0..1, how slowly the link follows the source
  /** LFO sources only: cycles per second, 0.05..8. Missing means the default (0.5 Hz). */
  rate?: number;
  mode?: LinkMode;
  curve?: LinkCurve;
  threshold?: number;
  flipSlew?: number;
  minBound?: number;
  maxBound?: number;
  cooldownSec?: number;
  enumOptions?: string[];
}

export const LFO_RATE_DEFAULT = 0.5;
export const LFO_RATE_MIN = 0.05;
export const LFO_RATE_MAX = 8;

/**
 * Morph (slice E-c): a number setting swings between its value and `to`, following a slow cosine
 * at `rate` Hz (value → to → value). Numeric settings only.
 */
export interface Morph {
  to: number;
  rate: number; // cycles per second
}

export const MORPH_RATE_DEFAULT = 0.1;
export const MORPH_RATE_MIN = 0.02;
export const MORPH_RATE_MAX = 4;

/** One setting as stored: its value, plus an optional audio link and morph. */
export interface Setting {
  value: ParamValue;
  link?: AudioLink;
  morph?: Morph;
}

export type Settings = Record<string, Setting>;

export interface LayerEntry {
  type: string;
  enabled: boolean;
  opacity: number; // 0..1
  opacityLink?: AudioLink;
  blend: BlendMode;
  trails?: boolean;
  params: Settings;
}

/** Slice 18.1: one warp field operator. Its settings (amount, scale, speed, centre) can have links and morphs. */
export interface WarpOperator {
  type: WarpOpType;
  enabled: boolean;
  params: Settings;
}

/**
 * Preset themes and moods (Slice 20.7). Both are optional, so old presets and user presets load exactly as before.
 * A theme says what the preset is mostly about; a mood says how it feels. The cost level is not stored: it is
 * worked out from the settings (see cost.ts).
 */
export const PRESET_THEMES = ["fluid", "fractal", "geometric", "hypnotic", "particles", "sparkle", "waveform", "terrain", "orbit", "architecture"] as const;
export type PresetTheme = (typeof PRESET_THEMES)[number];
export const PRESET_MOODS = ["calm", "dreamy", "driving", "intense", "bright", "dark"] as const;
export type PresetMood = (typeof PRESET_MOODS)[number];

export function isPresetTheme(value: unknown): value is PresetTheme {
  return typeof value === "string" && (PRESET_THEMES as readonly string[]).includes(value);
}

export function isPresetMood(value: unknown): value is PresetMood {
  return typeof value === "string" && (PRESET_MOODS as readonly string[]).includes(value);
}

/** Slice 23.2: per-preset display time in Timer mode, in seconds. Missing means the global timer. */
export const PRESET_DISPLAY_MIN_SEC = 5;
export const PRESET_DISPLAY_MAX_SEC = 300;

/** A finite number clamped to 5..300 and rounded to 0.1 s. Anything else gives undefined. */
export function clampDisplaySec(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const clamped = Math.min(PRESET_DISPLAY_MAX_SEC, Math.max(PRESET_DISPLAY_MIN_SEC, value));
  return Math.round(clamped * 10) / 10;
}

/** The preset's display time in seconds (clamped), or undefined when it uses the global timer. */
export function presetDisplaySec(preset: { displaySec?: number } | undefined): number | undefined {
  return clampDisplaySec(preset?.displaySec);
}

/** Slice 26.3: optional per-preset blend time override in seconds (0..10). Missing means use transition.seconds. */
export const PRESET_BLEND_MIN_SEC = 0;
export const PRESET_BLEND_MAX_SEC = 10;
export const BLEND_SEC_MIN = PRESET_BLEND_MIN_SEC;
export const BLEND_SEC_MAX = PRESET_BLEND_MAX_SEC;

/** A finite number clamped to 0..10 and rounded to 0.01 s. Anything else gives undefined. */
export function clampBlendSec(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const clamped = Math.min(PRESET_BLEND_MAX_SEC, Math.max(PRESET_BLEND_MIN_SEC, value));
  return Math.round(clamped * 100) / 100;
}

/** The preset's blend time in seconds (clamped), falling back to transition.seconds (or 1.2). */
export function presetBlendSec(preset: { blendSec?: number; transition: { seconds: number } } | undefined): number {
  return clampBlendSec(preset?.blendSec) ?? preset?.transition.seconds ?? 1.2;
}

export interface Preset {
  version: typeof PRESET_VERSION;
  name: string;
  tags: string[];
  /** Slice 23.2: how long this preset shows in Timer mode, 5..300 s. Missing means the global timer. */
  displaySec?: number;
  /** Slice 26.3: optional per-preset blend time override in seconds, 0..10. Missing means use transition.seconds. */
  blendSec?: number;
  /** Slice 20.7: what the preset is mostly about. Missing means untagged. */
  theme?: PresetTheme;
  /** Slice 20.7: how the preset feels. Missing means untagged. */
  mood?: PresetMood;
  transition: { style: Transition; seconds: number };
  feedback: Settings;
  layers: LayerEntry[];
  post: Settings;
  /** Slice 18.1: warp field operators, at most 4, applied in order. Missing means none (the picture is unchanged). */
  warp?: WarpOperator[];
  /** Slice 17.3: triggers that move Feedback and Post controls (kick, step, flip, drift, pick). Missing means none. */
  reactions?: Reaction[];
  /** Slice 17.5: this preset's reaction style. Missing means use the global setting (Off unless the viewer changes it). */
  reactionStyle?: ReactionStyle;
  directorProfile?: {
    cameraMode?: string;
    colorMood?: string;
    colorIntensity?: number;
    /** false: apply this preset's cameraMode on load. Missing means true (use the global camera). */
    useGlobalCamera?: boolean;
    /** false: apply this preset's colorMood and colorIntensity on load. Missing means true. */
    useGlobalColour?: boolean;
  };
}

export interface DirectorPaletteAsset {
  kind: 'mv-director-palette';
  version: 1;
  id: string;
  name: string;
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  spatialSpread: number;
}

export interface ExperienceBundleAsset {
  kind: 'mv-experience-bundle';
  version: 1;
  name: string;
  presets?: Preset[];
  directorPalettes?: DirectorPaletteAsset[];
  directorSettings?: Partial<GlobalDirectorSettings>;
}

export type VisualizerAsset = Preset | DirectorPaletteAsset | ExperienceBundleAsset;

/** Which schema lists exist. Layers are looked up by their type name. */
export interface SchemaRegistry {
  feedback: readonly ParamSpec[];
  post: readonly ParamSpec[];
  layers: Readonly<Record<string, readonly ParamSpec[]>>;
}

export interface ParseResult {
  preset: Preset;
  /** Things that were fixed or dropped. Shown in the debug panel, never a crash. */
  warnings: string[];
}

/** Thrown only for problems we cannot repair: wrong version, not an object, no name. */
export class PresetFormatError extends Error {
  constructor(message: string) {
    super(`Preset error: ${message}`);
    this.name = "PresetFormatError";
  }
}

// Fixed specs for the fields every preset has. Same coercion rules as layer settings.
export const OPACITY_SPEC: NumberSpec = {
  type: "float",
  name: "opacity",
  label: "Opacity",
  group: "Layer",
  default: 1,
  min: 0,
  max: 1,
  step: 0.01,
  description: "Controls how visible this layer is when blended over earlier layers.",
};
export const SECONDS_SPEC: NumberSpec = {
  type: "float",
  name: "seconds",
  label: "Crossfade",
  group: "Transition",
  default: 0.32,
  min: 0.3,
  max: 10,
  step: 0.01,
  description: "Duration of the transition animation when switching to this preset, in seconds.",
};
export const BLEND_SECONDS_SPEC: NumberSpec = {
  type: "float",
  name: "blendSec",
  label: "Blend time",
  group: "Transition",
  default: 1.2,
  min: PRESET_BLEND_MIN_SEC,
  max: PRESET_BLEND_MAX_SEC,
  step: 0.05,
  description: "Optional per-preset blend time override in seconds (0 for an instant cut). Missing means use the transition crossfade.",
};
export const BLEND_SPEC: EnumSpec = {
  type: "enum",
  name: "blend",
  label: "Blend",
  group: "Layer",
  default: "max",
  options: BLEND_MODES,
  description: "Chooses how this layer combines with earlier layers (Max, Alpha, Add, or Screen).",
};
export const TRAILS_SPEC: BoolSpec = {
  type: "bool",
  name: "trails",
  label: "Trails",
  group: "Layer",
  default: true,
  description: "When on, this layer feeds into the feedback trail buffer instead of drawing only on the final pass.",
};
export const STYLE_SPEC: EnumSpec = {
  type: "enum",
  name: "style",
  label: "Style",
  group: "Transition",
  default: "crossfade",
  options: TRANSITION_STYLES,
  description: "Visual transition effect used when switching into this preset.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accepts either a plain value (`0.5`) or the full form (`{ "value": 0.5, "link": {...} }`). */
function readSetting(entry: unknown): { value: unknown; link: unknown; morph: unknown } {
  if (isRecord(entry) && "value" in entry) return { value: entry.value, link: entry.link, morph: entry.morph };
  return { value: entry, link: undefined, morph: undefined };
}

/** Reads an optional morph. Only numeric settings can morph; anything else is dropped with a warning. */
export function parseMorph(raw: unknown, spec: ParamSpec, where: string, warnings: string[]): Morph | undefined {
  if (raw === undefined) return undefined;
  if (spec.type !== "float" && spec.type !== "int") {
    warnings.push(`${where}: only number settings can morph, morph dropped`);
    return undefined;
  }
  if (!isRecord(raw) || typeof raw.to !== "number" || !Number.isFinite(raw.to)) {
    warnings.push(`${where}: morph needs a numeric "to", morph dropped`);
    return undefined;
  }
  const rate = typeof raw.rate === "number" && Number.isFinite(raw.rate)
    ? Math.min(MORPH_RATE_MAX, Math.max(MORPH_RATE_MIN, raw.rate))
    : MORPH_RATE_DEFAULT;
  return { to: Math.min(spec.max, Math.max(spec.min, raw.to)), rate };
}

function parseOptionalClampedNumber(
  raw: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  where: string,
  warnings: string[],
): number | undefined {
  const val = raw[field];
  if (val === undefined) return undefined;
  if (typeof val !== "number" || !Number.isFinite(val)) {
    warnings.push(`${where}: ${field} must be a finite number, ignored`);
    return undefined;
  }
  return Math.min(max, Math.max(min, val));
}

export function parseLink(raw: unknown, where: string, warnings: string[]): AudioLink | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    warnings.push(`${where}: link must be an object, link dropped`);
    return undefined;
  }
  const source = raw.source;
  if (typeof source !== "string" || !(AUDIO_SOURCES as readonly string[]).includes(source)) {
    warnings.push(`${where}: unknown audio source "${String(source)}", link dropped`);
    return undefined;
  }
  if (typeof raw.amount !== "number" || typeof raw.smooth !== "number" || !Number.isFinite(raw.amount) || !Number.isFinite(raw.smooth)) {
    warnings.push(`${where}: link amount and smooth must be numbers, link dropped`);
    return undefined;
  }
  const link: AudioLink = {
    source: source as AudioSource,
    amount: Math.min(1, Math.max(-1, raw.amount)),
    smooth: Math.min(1, Math.max(0, raw.smooth)),
  };
  if (typeof raw.rate === "number" && Number.isFinite(raw.rate)) {
    link.rate = Math.min(LFO_RATE_MAX, Math.max(LFO_RATE_MIN, raw.rate));
  }
  if (raw.mode !== undefined) {
    if (typeof raw.mode === "string" && (LINK_MODES as readonly string[]).includes(raw.mode)) {
      link.mode = raw.mode as LinkMode;
    } else {
      warnings.push(`${where}: unknown link mode "${String(raw.mode)}", ignored`);
    }
  }
  if (raw.curve !== undefined) {
    if (typeof raw.curve === "string" && (LINK_CURVES as readonly string[]).includes(raw.curve)) {
      link.curve = raw.curve as LinkCurve;
    } else {
      warnings.push(`${where}: unknown link curve "${String(raw.curve)}", ignored`);
    }
  }
  const threshold = parseOptionalClampedNumber(raw, "threshold", LINK_THRESHOLD_MIN, LINK_THRESHOLD_MAX, where, warnings);
  if (threshold !== undefined) link.threshold = threshold;
  const flipSlew = parseOptionalClampedNumber(raw, "flipSlew", LINK_FLIP_SLEW_MIN, LINK_FLIP_SLEW_MAX, where, warnings);
  if (flipSlew !== undefined) link.flipSlew = flipSlew;
  const cooldownSec = parseOptionalClampedNumber(raw, "cooldownSec", LINK_COOLDOWN_MIN, LINK_COOLDOWN_MAX, where, warnings);
  if (cooldownSec !== undefined) link.cooldownSec = cooldownSec;

  let minBound = parseOptionalClampedNumber(raw, "minBound", 0, 1, where, warnings);
  let maxBound = parseOptionalClampedNumber(raw, "maxBound", 0, 1, where, warnings);
  if (minBound !== undefined && maxBound !== undefined && minBound > maxBound) {
    [minBound, maxBound] = [maxBound, minBound];
  }
  if (minBound !== undefined) link.minBound = minBound;
  if (maxBound !== undefined) link.maxBound = maxBound;

  if (Array.isArray(raw.enumOptions)) {
    const opts = raw.enumOptions.filter((x): x is string => typeof x === "string" && x.length > 0);
    if (opts.length > 0) link.enumOptions = opts;
  }
  return link;
}

/** Retired layer params (Tunnel.horizonDrift, Crown.rimFactor): dropped silently so old presets load identically. */
const REMOVED_LAYER_SETTINGS: readonly string[] = ["horizonDrift", "rimFactor", "mandalaKickFlare"];

/** Fills every known setting (defaults for missing ones), and reports unknown or bad ones. */
function parseSettings(raw: unknown, specs: readonly ParamSpec[], where: string, warnings: string[], removed: readonly string[] = []): Settings {
  if (raw !== undefined && !isRecord(raw)) warnings.push(`${where}: expected an object, using defaults`);
  const input: Record<string, unknown> = isRecord(raw) ? raw : {};
  const knownNames = new Set(specs.map((spec) => spec.name));
  for (const key of Object.keys(input)) {
    if (!knownNames.has(key) && !removed.includes(key)) warnings.push(`${where}.${key}: unknown setting, ignored`);
  }

  const out: Settings = {};
  for (const spec of specs) {
    const entry = input[spec.name];
    if (entry === undefined) {
      out[spec.name] = { value: spec.default };
      continue;
    }
    const { value, link, morph } = readSetting(entry);
    const coerced = coerceValue(spec, value);
    if (coerced.warning) warnings.push(`${where}.${spec.name}: ${coerced.warning}`);
    const setting: Setting = { value: coerced.value };
    const parsedLink = parseLink(link, `${where}.${spec.name}.link`, warnings);
    if (parsedLink) setting.link = parsedLink;
    const parsedMorph = parseMorph(morph, spec, `${where}.${spec.name}.morph`, warnings);
    if (parsedMorph) setting.morph = parsedMorph;
    out[spec.name] = setting;
  }
  return out;
}

/** Reads the warp operator stack. Bad entries are skipped and extras beyond the limit are dropped, with warnings. */
function parseWarp(raw: unknown, warnings: string[]): WarpOperator[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push("warp: expected a list, ignored");
    return [];
  }
  const ops: WarpOperator[] = [];
  let warnedExtra = false;
  raw.forEach((entry, index) => {
    if (ops.length >= WARP_OP_MAX) {
      if (!warnedExtra) warnings.push(`warp: only ${WARP_OP_MAX} operators are allowed, extras dropped`);
      warnedExtra = true;
      return;
    }
    if (!isRecord(entry) || !isWarpOpType(entry.type)) {
      warnings.push(`warp[${index}]: unknown operator type "${isRecord(entry) ? String(entry.type) : String(entry)}", skipped`);
      return;
    }
    ops.push({
      type: entry.type,
      enabled: entry.enabled !== false,
      params: parseSettings(entry.params, warpOpSpecs(entry.type), `warp[${index}] (${entry.type}).params`, warnings),
    });
  });
  return ops;
}

/**
 * Slice 15.3: before, a warp amount of 0 in Curl and Mobius drew at full strength (1.0).
 * Now 0 means no warp in every mode, so stored zeros in those two modes become 1.0 to keep the same picture.
 */
function migrateWarpZero(feedback: Settings): void {
  const mode = feedback.warpMode?.value;
  if (mode !== "curl" && mode !== "mobius") return;
  const warp = feedback.warp;
  if (warp && warp.value === 0) warp.value = 1;
}

/**
 * Turns any JSON value into a valid Preset.
 * Throws PresetFormatError only if the file cannot be repaired.
 * Everything else (out-of-range numbers, unknown keys, unknown layer types) is fixed and listed in `warnings`.
 */
export function parsePreset(raw: unknown, registry: SchemaRegistry): ParseResult {
  if (!isRecord(raw)) throw new PresetFormatError("a preset must be a JSON object");
  if (raw.version !== PRESET_VERSION) {
    throw new PresetFormatError(`unsupported version ${String(raw.version)} (this app reads version ${PRESET_VERSION})`);
  }
  if (typeof raw.name !== "string" || raw.name.trim() === "") {
    throw new PresetFormatError("name is missing or empty");
  }
  if (raw.layers !== undefined && !Array.isArray(raw.layers)) {
    throw new PresetFormatError("layers must be a list");
  }

  const warnings: string[] = [];

  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((tag): tag is string => typeof tag === "string")
    : [];

  const transitionRaw = isRecord(raw.transition) ? raw.transition : {};
  const style = coerceValue(STYLE_SPEC, transitionRaw.style ?? STYLE_SPEC.default);
  const seconds = coerceValue(SECONDS_SPEC, transitionRaw.seconds ?? SECONDS_SPEC.default);
  if (style.warning) warnings.push(`transition.style: ${style.warning}`);
  if (seconds.warning) warnings.push(`transition.seconds: ${seconds.warning}`);
  const transition = { style: style.value as Transition, seconds: seconds.value as number };

  const layers: LayerEntry[] = [];
  const rawLayers: unknown[] = Array.isArray(raw.layers) ? raw.layers : [];
  rawLayers.forEach((rawLayer, index) => {
    if (!isRecord(rawLayer) || typeof rawLayer.type !== "string") {
      warnings.push(`layers[${index}]: missing layer type, skipped`);
      return;
    }
    const specs = registry.layers[rawLayer.type];
    if (!specs) {
      warnings.push(`layers[${index}]: unknown layer type "${rawLayer.type}", skipped`);
      return;
    }
    const where = `layers[${index}] (${rawLayer.type})`;
    const opacity = coerceValue(OPACITY_SPEC, rawLayer.opacity ?? OPACITY_SPEC.default);
    if (opacity.warning) warnings.push(`${where}.opacity: ${opacity.warning}`);

    const blend = coerceValue(BLEND_SPEC, rawLayer.blend ?? BLEND_SPEC.default);
    if (blend.warning) warnings.push(`${where}.blend: ${blend.warning}`);
    const blendValue = blend.value as BlendMode;

    const trails = coerceValue(TRAILS_SPEC, rawLayer.trails ?? TRAILS_SPEC.default);
    if (trails.warning) warnings.push(`${where}.trails: ${trails.warning}`);

    const opacityLink = rawLayer.opacityLink !== undefined
      ? parseLink(rawLayer.opacityLink, `${where}.opacityLink`, warnings)
      : undefined;

    layers.push({
      type: rawLayer.type,
      enabled: rawLayer.enabled !== false,
      opacity: opacity.value as number,
      ...(opacityLink ? { opacityLink } : {}),
      blend: blendValue,
      trails: (trails.value as boolean) ?? true,
      params: parseSettings(rawLayer.params, specs, `${where}.params`, warnings, REMOVED_LAYER_SETTINGS),
    });
  });

  let directorProfile: NonNullable<Preset['directorProfile']> | undefined;
  if (isRecord(raw.directorProfile)) {
    const dp: NonNullable<Preset['directorProfile']> = {};
    if (typeof raw.directorProfile.cameraMode === "string" && raw.directorProfile.cameraMode.trim() !== "") {
      dp.cameraMode = raw.directorProfile.cameraMode.trim();
    }
    if (typeof raw.directorProfile.colorMood === "string" && raw.directorProfile.colorMood.trim() !== "") {
      dp.colorMood = raw.directorProfile.colorMood.trim();
    }
    if (typeof raw.directorProfile.colorIntensity === "number" && Number.isFinite(raw.directorProfile.colorIntensity)) {
      dp.colorIntensity = Math.max(0, Math.min(1, raw.directorProfile.colorIntensity));
    }
    if (typeof raw.directorProfile.useGlobalCamera === "boolean") {
      dp.useGlobalCamera = raw.directorProfile.useGlobalCamera;
    }
    if (typeof raw.directorProfile.useGlobalColour === "boolean") {
      dp.useGlobalColour = raw.directorProfile.useGlobalColour;
    }
    if (Object.keys(dp).length > 0) {
      directorProfile = dp;
    }
  }

  const feedback = parseSettings(raw.feedback, registry.feedback, "feedback", warnings, REMOVED_FEEDBACK_SETTINGS);
  migrateWarpZero(feedback);

  const reactionStyle = parseReactionStyle(raw.reactionStyle);
  if (raw.reactionStyle !== undefined && !reactionStyle) warnings.push(`reactionStyle: unknown style "${String(raw.reactionStyle)}", ignored`);
  const reactions = parseReactions(raw.reactions, { feedback: registry.feedback, post: registry.post }, warnings);

  const warp = parseWarp(raw.warp, warnings);

  const theme = isPresetTheme(raw.theme) ? raw.theme : undefined;
  if (raw.theme !== undefined && !theme) warnings.push(`theme: unknown theme "${String(raw.theme)}", ignored`);
  const mood = isPresetMood(raw.mood) ? raw.mood : undefined;
  if (raw.mood !== undefined && !mood) warnings.push(`mood: unknown mood "${String(raw.mood)}", ignored`);

  const displaySec = clampDisplaySec(raw.displaySec);
  if (raw.displaySec !== undefined && displaySec === undefined) warnings.push(`displaySec: not a number, ignored`);

  const blendSec = clampBlendSec(raw.blendSec);
  if (raw.blendSec !== undefined && blendSec === undefined) warnings.push(`blendSec: not a number, ignored`);

  const preset: Preset = {
    version: PRESET_VERSION,
    name: raw.name.trim(),
    tags,
    ...(theme ? { theme } : {}),
    ...(mood ? { mood } : {}),
    ...(displaySec !== undefined ? { displaySec } : {}),
    ...(blendSec !== undefined ? { blendSec } : {}),
    transition,
    feedback,
    layers,
    post: parseSettings(raw.post, registry.post, "post", warnings, REMOVED_POST_SETTINGS),
    ...(warp.length > 0 ? { warp } : {}),
    ...(reactions.length > 0 ? { reactions } : {}),
    ...(reactionStyle ? { reactionStyle } : {}),
    ...(directorProfile ? { directorProfile } : {}),
  };
  return { preset, warnings };
}
