// Preset format: the shape of a preset as a JSON file, and the checker that turns
// any JSON (hand-edited, imported, or saved by an older version) into a safe Preset.
import { coerceValue, type ParamSpec, type ParamValue, type NumberSpec, type EnumSpec } from "./schema";

/** Bump this when the shape changes, and add an upgrade step for the old version. */
export const PRESET_VERSION = 1 as const;

/** Every signal a setting can follow (see docs/stage4-presets-plan.md §4). Only stored here in 4.1; evaluated in E2. */
export const AUDIO_SOURCES = [
  "sub", "bass", "mid", "high", "energy", "loudness", "beat", "onset", "section",
  "lfoSine", "lfoSaw", "lfoRandom", "time",
] as const;
export type AudioSource = (typeof AUDIO_SOURCES)[number];

export const TRANSITION_STYLES = ["crossfade", "wipe", "dissolve", "zoom"] as const;
export type Transition = (typeof TRANSITION_STYLES)[number];

export const BLEND_MODES = ["add", "max"] as const;
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

/** One setting as stored: its value, plus an optional audio link. */
export interface Setting {
  value: ParamValue;
  link?: AudioLink;
}

export type Settings = Record<string, Setting>;

export interface LayerEntry {
  type: string;
  enabled: boolean;
  opacity: number; // 0..1
  blend: BlendMode;
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
}

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
const OPACITY_SPEC: NumberSpec = { type: "float", name: "opacity", label: "Opacity", group: "Layer", default: 1, min: 0, max: 1, step: 0.01 };
const SECONDS_SPEC: NumberSpec = { type: "float", name: "seconds", label: "Crossfade", group: "Transition", default: 0.32, min: 0.3, max: 10, step: 0.01 };
const BLEND_SPEC: EnumSpec = { type: "enum", name: "blend", label: "Blend", group: "Layer", default: "add", options: BLEND_MODES };
const STYLE_SPEC: EnumSpec = { type: "enum", name: "style", label: "Style", group: "Transition", default: "crossfade", options: ["crossfade", "wipe", "dissolve", "zoom"] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accepts either a plain value (`0.5`) or the full form (`{ "value": 0.5, "link": {...} }`). */
function readSetting(entry: unknown): { value: unknown; link: unknown } {
  if (isRecord(entry) && "value" in entry) return { value: entry.value, link: entry.link };
  return { value: entry, link: undefined };
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
    const { value, link } = readSetting(entry);
    const coerced = coerceValue(spec, value);
    if (coerced.warning) warnings.push(`${where}.${spec.name}: ${coerced.warning}`);
    const setting: Setting = { value: coerced.value };
    const parsedLink = parseLink(link, `${where}.${spec.name}.link`, warnings);
    if (parsedLink) setting.link = parsedLink;
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
    const blend = coerceValue(BLEND_SPEC, rawLayer.blend ?? BLEND_SPEC.default);
    if (blend.warning) warnings.push(`${where}.blend: ${blend.warning}`);

    layers.push({
      type: rawLayer.type,
      enabled: rawLayer.enabled !== false,
      opacity: opacity.value as number,
      blend: blend.value as BlendMode,
      params: parseSettings(rawLayer.params, specs, `${where}.params`, warnings),
    });
  });

  const preset: Preset = {
    version: PRESET_VERSION,
    name: raw.name.trim(),
    tags,
    transition,
    feedback: parseSettings(raw.feedback, registry.feedback, "feedback", warnings),
    layers,
    post: parseSettings(raw.post, registry.post, "post", warnings),
  };
  return { preset, warnings };
}
