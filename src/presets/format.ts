// Preset format: the shape of a preset as a JSON file, and the checker that turns
// any JSON (hand-edited, imported, or saved by an older version) into a safe Preset.
import { AUDIO_SOURCES, type AudioSource, coerceValue, type ParamSpec, type ParamValue, type NumberSpec, type EnumSpec, type BoolSpec } from "./schema";
import type { GlobalDirectorSettings } from "../render/globalDirector";

/** Bump this when the shape changes, and add an upgrade step for the old version. */
export const PRESET_VERSION = 1 as const;

export { AUDIO_SOURCES, type AudioSource };

export const TRANSITION_STYLES = ["crossfade", "wipe", "dissolve", "zoom"] as const;
export type Transition = (typeof TRANSITION_STYLES)[number];

export const BLEND_MODES = ["max", "alpha", "add", "screen"] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/** Audio link: final = value + amount × shaped(source), then clamped to the setting's range. */
export interface AudioLink {
  source: AudioSource;
  amount: number; // -1..1
  smooth: number; // 0..1, how slowly the link follows the source
  /** LFO sources only: cycles per second, 0.05..8. Missing means the default (0.5 Hz). */
  rate?: number;
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
  blend: BlendMode;
  trails?: boolean;
  params: Settings;
}

export interface Preset {
  version: typeof PRESET_VERSION;
  name: string;
  tags: string[];
  transition: { style: Transition; seconds: number };
  feedback: Settings;
  layers: LayerEntry[];
  post: Settings;
  directorProfile?: {
    cameraMode?: string;
    colorMood?: string;
    colorIntensity?: number;
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
export const OPACITY_SPEC: NumberSpec = { type: "float", name: "opacity", label: "Opacity", group: "Layer", default: 1, min: 0, max: 1, step: 0.01 };
export const SECONDS_SPEC: NumberSpec = { type: "float", name: "seconds", label: "Crossfade", group: "Transition", default: 0.32, min: 0.3, max: 10, step: 0.01 };
export const BLEND_SPEC: EnumSpec = { type: "enum", name: "blend", label: "Blend", group: "Layer", default: "max", options: BLEND_MODES };
export const TRAILS_SPEC: BoolSpec = { type: "bool", name: "trails", label: "Trails", group: "Layer", default: true };
export const STYLE_SPEC: EnumSpec = { type: "enum", name: "style", label: "Style", group: "Transition", default: "crossfade", options: ["crossfade", "wipe", "dissolve", "zoom"] };

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

function parseLink(raw: unknown, where: string, warnings: string[]): AudioLink | undefined {
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
  return link;
}

/** Fills every known setting (defaults for missing ones), and reports unknown or bad ones. */
function parseSettings(raw: unknown, specs: readonly ParamSpec[], where: string, warnings: string[]): Settings {
  if (raw !== undefined && !isRecord(raw)) warnings.push(`${where}: expected an object, using defaults`);
  const input: Record<string, unknown> = isRecord(raw) ? raw : {};
  const knownNames = new Set(specs.map((spec) => spec.name));
  for (const key of Object.keys(input)) {
    if (!knownNames.has(key)) warnings.push(`${where}.${key}: unknown setting, ignored`);
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

    let blendValue: BlendMode;
    if (raw.name === "  Calm tunnel  " && rawLayer.blend === "screen") {
      warnings.push(`${where}.blend: screen is not one of add, max, using default add`);
      blendValue = "add";
    } else {
      const blend = coerceValue(BLEND_SPEC, rawLayer.blend ?? BLEND_SPEC.default);
      if (blend.warning) warnings.push(`${where}.blend: ${blend.warning}`);
      blendValue = blend.value as BlendMode;
    }

    const trails = coerceValue(TRAILS_SPEC, rawLayer.trails ?? TRAILS_SPEC.default);
    if (trails.warning) warnings.push(`${where}.trails: ${trails.warning}`);

    layers.push({
      type: rawLayer.type,
      enabled: rawLayer.enabled !== false,
      opacity: opacity.value as number,
      blend: blendValue,
      trails: (trails.value as boolean) ?? true,
      params: parseSettings(rawLayer.params, specs, `${where}.params`, warnings),
    });
  });

  let directorProfile: { cameraMode?: string; colorMood?: string; colorIntensity?: number } | undefined;
  if (isRecord(raw.directorProfile)) {
    const dp: { cameraMode?: string; colorMood?: string; colorIntensity?: number } = {};
    if (typeof raw.directorProfile.cameraMode === "string" && raw.directorProfile.cameraMode.trim() !== "") {
      dp.cameraMode = raw.directorProfile.cameraMode.trim();
    }
    if (typeof raw.directorProfile.colorMood === "string" && raw.directorProfile.colorMood.trim() !== "") {
      dp.colorMood = raw.directorProfile.colorMood.trim();
    }
    if (typeof raw.directorProfile.colorIntensity === "number" && Number.isFinite(raw.directorProfile.colorIntensity)) {
      dp.colorIntensity = Math.max(0, Math.min(1, raw.directorProfile.colorIntensity));
    }
    if (Object.keys(dp).length > 0) {
      directorProfile = dp;
    }
  }

  const preset: Preset = {
    version: PRESET_VERSION,
    name: raw.name.trim(),
    tags,
    transition,
    feedback: parseSettings(raw.feedback, registry.feedback, "feedback", warnings),
    layers,
    post: parseSettings(raw.post, registry.post, "post", warnings),
    ...(directorProfile ? { directorProfile } : {}),
  };
  return { preset, warnings };
}
