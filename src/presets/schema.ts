// Parameter schema: one entry per setting (a layer's radius, a feedback zoom, a colour...).
// The preset loader, the Preset Studio sliders and the randomiser all read these entries,
// so they always agree on each setting's name, default and safe range.

/** Every signal a setting can follow. Evaluated in links.ts. */
export const AUDIO_SOURCES = [
  "sub", "bass", "mid", "high", "energy", "loudness", "beat", "onset", "section",
  "beatStrength", "brightness", "subFlux", "midFlux", "highFlux",
  "lfoSine", "lfoSaw", "lfoRandom", "time",
  "kickEnv", "centroid",
  "drop", "breakdown", "phrase16", "phrase32", "energySlow",
] as const;
export type AudioSource = (typeof AUDIO_SOURCES)[number];

/** Audio sources available to drive feedback warp coordinate swells. */
export const WARP_AUDIO_SOURCES = ["sub", "bass", "mid", "high", "energy", "kick"] as const;
export type WarpAudioSource = (typeof WARP_AUDIO_SOURCES)[number];

export type Vec3 = [number, number, number];

export type ParamValue = number | boolean | string | Vec3 | undefined;

/** Numeric rule for showWhen: visible only while the controlling number is greater than `above`. */
export interface ShowWhenAbove {
  above: number;
}

export type ShowWhenCondition = Record<string, ParamValue | readonly ParamValue[] | ShowWhenAbove>;

export interface ParamSpecBase {
  name: string; // stable key used in preset files, e.g. "density"
  label: string; // text shown in the Studio, e.g. "Ring density"
  group: string; // section in the Studio, e.g. "Wall pattern"
  /** Concise 1-sentence action description explaining the parameter's visual effect. */
  description?: string;
  /** Warning message displayed when tweaking intense or sensitive parameters. */
  warning?: string;
  /** Whether this parameter produces extreme visual shifts and requires caution. */
  intense?: boolean;
  /** Optional declarative visibility rule: blade is visible only when every key in showWhen matches the current layer/section settings. */
  showWhen?: ShowWhenCondition;
  /** Studio-only section override (Slice 15.2). Never saved; preset keys use `name`. */
  uiGroup?: string;
}

type BaseSpec = ParamSpecBase;

export interface NumberSpec extends BaseSpec {
  type: "float" | "int";
  default: number;
  min: number;
  max: number;
  step: number; // slider increment in the Studio
}

export interface BoolSpec extends BaseSpec {
  type: "bool";
  default: boolean;
}

export interface EnumSpec extends BaseSpec {
  type: "enum";
  default: string;
  options: readonly string[];
}

export interface ColourSpec extends BaseSpec {
  type: "colour";
  default: string; // "#rrggbb"
}

export interface Vec3Spec extends BaseSpec {
  type: "vec3";
  default: Vec3;
  min?: number;
  max?: number;
  step?: number;
}

export type ParamSpec = NumberSpec | BoolSpec | EnumSpec | ColourSpec | Vec3Spec;

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

/**
 * Checks a schema entry written by a developer. Throws if the entry itself is wrong,
 * e.g. a default outside its min/max. Run in tests so a bad entry fails fast.
 */
export function assertValidSpec(spec: ParamSpec): void {
  const fail = (reason: string): never => {
    throw new Error(`Invalid parameter "${spec.name}": ${reason}`);
  };
  switch (spec.type) {
    case "float":
    case "int":
      if (![spec.default, spec.min, spec.max, spec.step].every(Number.isFinite)) {
        fail("default, min, max and step must be finite numbers");
      }
      if (spec.min > spec.max) fail("min is greater than max");
      if (spec.step <= 0) fail("step must be greater than 0");
      if (spec.default < spec.min || spec.default > spec.max) fail("default is outside min..max");
      return;
    case "bool":
      return;
    case "enum":
      if (spec.options.length === 0) fail("enum needs at least one option");
      if (!spec.options.includes(spec.default)) fail("default is not one of the options");
      return;
    case "colour":
      if (!HEX_COLOUR.test(spec.default)) fail('default must look like "#rrggbb"');
      return;
    case "vec3":
      if (!Array.isArray(spec.default) || spec.default.length !== 3 || !spec.default.every(Number.isFinite)) {
        fail("default must be an array of 3 finite numbers");
      }
      return;
  }
}

/**
 * Evaluates whether a parameter blade should be visible given current settings values.
 * If spec.showWhen is undefined, returns true (always visible).
 * If spec.showWhen is specified, every key must match the current value (or match one of the array elements).
 * Supports both raw values dictionary and Settings dictionary ({ value: ... }).
 */
export function isSpecVisible(spec: ParamSpec, values: Record<string, ParamValue | any>): boolean {
  if (!spec.showWhen) return true;
  for (const [depKey, expected] of Object.entries(spec.showWhen)) {
    const raw = values[depKey];
    const actual = (raw !== null && typeof raw === 'object' && 'value' in raw && !Array.isArray(raw))
      ? (raw as { value: ParamValue }).value
      : (raw as ParamValue);
    if (expected !== null && typeof expected === 'object' && !Array.isArray(expected) && 'above' in expected) {
      if (!(typeof actual === 'number' && actual > (expected as ShowWhenAbove).above)) return false;
    } else if (Array.isArray(expected)) {
      if (!expected.includes(actual as never)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

/**
 * Slice 15.2: where each Feedback and Post control lives in the Studio. Preset keys did not change,
 * so old presets load as before with no warning and the same picture. This table is only the new
 * home of each key. The two kaleidoscopes stay separate settings (one folds the trail loop in
 * Polar fold mode, one folds the finished image) but now sit side by side under Warp.
 */
export const FEEDBACK_POST_LAYOUT: Readonly<Record<string, readonly string[]>> = {
  Motion: ["zoom", "rotate", "centreX", "centreY", "driftX", "driftY", "stretchX", "stretchY"],
  Warp: [
    "warpMode", "warp", "warpScale", "warpSpeed",
    "warpAudioSource", "warpReactivity", "warpAttackMs", "warpReleaseMs",
    "curlOctaves", "curlTurbulence", "curlFlowPattern",
    "portalRadius", "radialFold", "mandalaTile", "mandalaCounterSpin", "mandalaPattern",
    "mobiusPoleOffset", "mobiusFlow", "mobiusSwirl", "mobiusWander", "mobiusMode",
    "kaleidoN", "mirror", "rgbSplit", "chroma",
  ],
  Trails: ["decay", "fade", "wrap", "blur", "decayRgb", "sobel"],
  Colour: [
    "hueDrift", "hueShift", "saturation", "contrast", "gamma", "brightness",
    "contourFreq", "contourWidth", "colorSpread", "solarize",
    "bloom", "bloomThreshold", "bloomSize", "bloomTintAmount", "bloomTintHue", "bloomPulse", "colourMap", "colourMapBy", "colourMapGradient", "colourMapGradient2", "colourMapMix", "vignette", "vignetteShape", "vignetteSoftness", "vignetteBlend", "vignetteColour", "vignetteGradient",
    "invert",
  ],
};

/** New Studio group for a Feedback or Post key, or undefined when the key is not in the layout. */
export function feedbackPostGroupOf(name: string): string | undefined {
  for (const [group, names] of Object.entries(FEEDBACK_POST_LAYOUT)) {
    if (names.includes(name)) return group;
  }
  return undefined;
}

/**
 * Orders Feedback and Post specs into the four Studio groups. Listed keys come first in layout
 * order; any spec not in the layout keeps its own group after them. Returns copies with `uiGroup` set.
 */
export function layoutFeedbackPost(...lists: readonly (readonly ParamSpec[])[]): ParamSpec[] {
  const all = lists.flat();
  const byName = new Map(all.map((s) => [s.name, s] as const));
  const out: ParamSpec[] = [];
  const seen = new Set<string>();
  for (const [group, names] of Object.entries(FEEDBACK_POST_LAYOUT)) {
    for (const n of names) {
      const spec = byName.get(n);
      if (!spec) continue;
      out.push({ ...spec, uiGroup: group } as ParamSpec);
      seen.add(n);
    }
  }
  for (const spec of all) if (!seen.has(spec.name)) out.push(spec);
  return out;
}

export interface CoerceResult {
  value: ParamValue;
  /** Set when the input was changed (wrong type, out of range). Shown as a warning, never an error. */
  warning?: string;
}

/**
 * Turns an untrusted value into a safe one for this setting.
 * Wrong type -> default. Out of range -> clamped to the nearest limit.
 */
export function coerceValue(spec: ParamSpec, raw: unknown): CoerceResult {
  switch (spec.type) {
    case "float":
    case "int": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return { value: spec.default, warning: `not a number, using default ${spec.default}` };
      }
      const rounded = spec.type === "int" ? Math.round(raw) : raw;
      const clamped = Math.min(spec.max, Math.max(spec.min, rounded));
      if (clamped !== rounded) {
        return { value: clamped, warning: `${raw} is outside ${spec.min}..${spec.max}, clamped to ${clamped}` };
      }
      return { value: clamped };
    }
    case "bool":
      return typeof raw === "boolean"
        ? { value: raw }
        : { value: spec.default, warning: `not true/false, using default ${spec.default}` };
    case "enum":
      return typeof raw === "string" && spec.options.includes(raw)
        ? { value: raw }
        : { value: spec.default, warning: `"${String(raw)}" is not an allowed option, using "${spec.default}"` };
    case "colour":
      return typeof raw === "string" && HEX_COLOUR.test(raw)
        ? { value: raw.toLowerCase() }
        : { value: spec.default, warning: `not a "#rrggbb" colour, using ${spec.default}` };
    case "vec3": {
      if (Array.isArray(raw) && raw.length === 3 && raw.every((n) => typeof n === "number" && Number.isFinite(n))) {
        const min = spec.min ?? -Infinity;
        const max = spec.max ?? Infinity;
        const clamped: Vec3 = [
          Math.min(max, Math.max(min, raw[0])),
          Math.min(max, Math.max(min, raw[1])),
          Math.min(max, Math.max(min, raw[2])),
        ];
        return { value: clamped };
      }
      return { value: [...spec.default], warning: `not a 3-element numeric vector, using default [${spec.default.join(", ")}]` };
    }
  }
}

/** Default value for every entry in a list of specs, keyed by name. */
export function defaultsFor(specs: readonly ParamSpec[]): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const spec of specs) out[spec.name] = spec.default;
  return out;
}

/** Extended feedback warp parameters (Slice 7.11). */
/**
 * Feedback settings that no longer exist. Old presets may still carry them: the loader drops them
 * silently (no warning) so the preset loads and looks the same. `mandalaKickFlare` never reached the
 * shader's output (nothing multiplied it in), so removing it changes no pixels.
 */
export const REMOVED_FEEDBACK_SETTINGS: readonly string[] = ["mandalaKickFlare"];

export const FEEDBACK_WARP_SPECS: readonly ParamSpec[] = [
  // Warp group (non-intense)
  {
    type: "enum",
    name: "warpMode",
    label: "Warp mode",
    group: "Warp",
    default: "classic",
    options: ["classic", "curl", "polarFold", "mobius", "rgbSplit"],
    description: "The kind of warp applied to the trail every frame.",
  },
  {
    type: "enum",
    name: "warpAudioSource",
    label: "Warp audio source",
    group: "Warp",
    default: "sub",
    options: [...WARP_AUDIO_SOURCES],
    description: "What part of the music makes the warp swell.",
  },
  {
    type: "float",
    name: "warpReactivity",
    label: "Warp audio swell",
    group: "Warp",
    default: 0.0,
    min: 0.0,
    max: 1.0,
    step: 0.05,
    description: "How much the music strengthens and speeds up the warp. 0 ignores the music.",
  },
  {
    type: "float",
    name: "warpAttackMs",
    label: "Warp attack (ms)",
    group: "Warp",
    default: 15,
    min: 5,
    max: 200,
    step: 5,
    description: "How quickly the warp swells when the music hits, in milliseconds.",
  },
  {
    type: "float",
    name: "warpReleaseMs",
    label: "Warp release (ms)",
    group: "Warp",
    default: 250,
    min: 50,
    max: 1000,
    step: 10,
    description: "How slowly the warp settles back afterwards, in milliseconds.",
  },
  {
    type: "float",
    name: "portalRadius",
    label: "Portal radius",
    group: "Warp",
    default: 0.0,
    min: 0.0,
    max: 0.25,
    step: 0.005,
    description: "Size of the calm, unwarped circle in the middle.",
    showWhen: { warpMode: "polarFold" },
  },
  {
    type: "float",
    name: "mobiusPoleOffset",
    label: "Whirlpool spacing",
    group: "Warp",
    default: 0.48,
    min: 0.2,
    max: 0.85,
    step: 0.02,
    description: "How far apart the two whirlpool centres are.",
    showWhen: { warpMode: "mobius" },
  },
  // Slice 7.22 additions
  {
    type: "int",
    name: "curlOctaves",
    label: "Flow detail",
    group: "Warp",
    default: 2,
    min: 1,
    max: 3,
    step: 1,
    description: "Layers of detail in the fluid flow. More looks finer and costs more.",
    showWhen: { warpMode: "curl" },
  },
  {
    type: "float",
    name: "curlTurbulence",
    label: "Treble smoke turbulence",
    group: "Warp",
    default: 0.45,
    min: 0.0,
    max: 1.0,
    step: 0.05,
    description: "How much the treble stirs the flow into smoky turbulence.",
    showWhen: { warpMode: "curl" },
  },
  {
    type: "enum",
    name: "curlFlowPattern",
    label: "Curl flow style",
    group: "Warp",
    default: "plumes",
    options: ["plumes", "eddies", "outflow", "inflow"],
    description: "The overall shape of the fluid flow.",
    showWhen: { warpMode: "curl" },
  },
  {
    type: "float",
    name: "radialFold",
    label: "Radial fold repetition",
    group: "Warp",
    default: 0.0,
    min: 0.0,
    max: 1.0,
    step: 0.05,
    description: "Repeats the trail in mirrored slices around the centre.",
    showWhen: { warpMode: "polarFold" },
  },
  {
    type: "float",
    name: "mandalaTile",
    label: "Crystal tiling",
    group: "Warp",
    default: 0.0,
    min: 0.0,
    max: 1.0,
    step: 0.05,
    description: "Repeats the trail in a tiled, crystal-like pattern.",
    showWhen: { warpMode: "polarFold" },
  },
  {
    type: "float",
    name: "mandalaCounterSpin",
    label: "Counter-rotation speed",
    group: "Warp",
    default: 0.25,
    min: -1.0,
    max: 1.0,
    step: 0.05,
    description: "Spins inner and outer rings of the mandala in opposite directions.",
    showWhen: { warpMode: "polarFold" },
  },
  {
    type: "enum",
    name: "mandalaPattern",
    label: "Mandala repeats",
    group: "Warp",
    default: "auto",
    options: ["auto", "4", "6", "8", "12", "16"],
    description: "How many times the mandala pattern repeats around the circle.",
    showWhen: { warpMode: "polarFold" },
  },
  {
    type: "float",
    name: "mobiusFlow",
    label: "Whirlpool flow speed",
    group: "Warp",
    default: 0.85,
    min: 0.0,
    max: 2.0,
    step: 0.05,
    description: "How fast the trail flows between the two whirlpool centres.",
    showWhen: { warpMode: "mobius" },
  },
  {
    type: "float",
    name: "mobiusSwirl",
    label: "Spiral tightness",
    group: "Warp",
    default: 0.65,
    min: -2.0,
    max: 2.0,
    step: 0.05,
    description: "How tightly the trail spirals into each whirlpool centre.",
    showWhen: { warpMode: "mobius" },
  },
  {
    type: "float",
    name: "mobiusWander",
    label: "Whirlpool wander",
    group: "Warp",
    default: 0.55,
    min: 0.0,
    max: 1.0,
    step: 0.05,
    description: "How much the whirlpool centres wander around the screen.",
    showWhen: { warpMode: "mobius" },
  },
  {
    type: "enum",
    name: "mobiusMode",
    label: "Vortex flow mode",
    group: "Warp",
    default: "auto",
    options: ["auto", "dipoleFlow", "doubleVortex", "figureEight", "breathingOrbit"],
    description: "The path the whirlpool centres follow.",
    showWhen: { warpMode: "mobius" },
  },
  // Warp group (high-intensity at bottom)
  {
    type: "int",
    name: "kaleidoN",
    label: "Kaleidoscope, trail (Polar fold mode)",
    group: "Warp",
    default: 6,
    min: 4,
    max: 16,
    step: 1,
    description: "How many mirrored slices the trail is folded into.",
    showWhen: { warpMode: "polarFold" },
    intense: true,
    warning: "Intense visual transform. Highly sensitive to small adjustments — use with care.",
  },
  {
    type: "float",
    name: "rgbSplit",
    label: "Trail colour split (RGB)",
    group: "Warp",
    default: 0.0,
    min: 0.0,
    max: 0.08,
    step: 0.001,
    description: "Pulls the red, green and blue parts of the trail apart for a rainbow fringe.",
    showWhen: { warpMode: "rgbSplit" },
    intense: true,
    warning: "Intense visual transform. Highly sensitive to small adjustments — use with care.",
  },

  // Trail group (non-intense, then high-intensity at bottom)
  {
    type: "vec3",
    name: "decayRgb",
    label: "Trail colour fade (R, G, B)",
    group: "Trail",
    default: [1.0, 1.0, 1.0],
    min: 0.0,
    max: 2.0,
    step: 0.01,
    description: "Multiplies Trail length separately for red, green and blue. 1, 1, 1 means no tint; a lower value makes that colour's trail vanish sooner, so trails shift toward the other colours.",
  },
  {
    type: "float",
    name: "sobel",
    label: "Edge outline",
    group: "Trail",
    default: 0.0,
    min: 0.0,
    max: 1.0,
    step: 0.01,
    description: "Turns the trail into glowing outlines of its edges.",
    intense: true,
    warning: "Intense visual transform. Highly sensitive to small adjustments — use with care.",
  },

  // Colour group (non-intense, then high-intensity at bottom)
  {
    type: "float",
    name: "contourFreq",
    label: "Line count",
    group: "Colour",
    default: 7.85,
    min: 2.0,
    max: 16.0,
    step: 0.25,
    description: "How many contour lines are drawn, like a topographic map.",
    showWhen: { solarize: { above: 0 } },
  },
  {
    type: "float",
    name: "contourWidth",
    label: "Line thickness",
    group: "Colour",
    default: 0.45,
    min: 0.1,
    max: 1.0,
    step: 0.05,
    description: "How thick the contour lines are.",
    showWhen: { solarize: { above: 0 } },
  },
  {
    type: "float",
    name: "colorSpread",
    label: "Color spread",
    group: "Colour",
    default: 0.65,
    min: 0.0,
    max: 1.0,
    step: 0.05,
    description: "How many colours run through the contour lines.",
    showWhen: { solarize: { above: 0 } },
  },
  {
    type: "float",
    name: "solarize",
    label: "Solarize",
    group: "Colour",
    default: 0.0,
    min: 0.0,
    max: 1.0,
    step: 0.01,
    description: "Flips the brightest colours to their opposites for a solarized photo look.",
    intense: true,
    warning: "Intense visual transform. Highly sensitive to small adjustments — use with care.",
  },
];

/** Rings shape/mode options (Slice 7.12). */
export const RINGS_MODE_SPEC: ParamSpec = {
  type: "enum",
  name: "mode",
  label: "Ring mode",
  group: "Shape",
  default: "rings",
  options: ["rings", "orbitTriangles", "polarGrid"],
  description: "Concentric rings, orbiting triangles, or a polar grid.",
};

/** Retired post keys (CRT controls never reached the compositor); old presets still load silently. */
export const REMOVED_POST_SETTINGS: readonly string[] = ["crtScanlines", "crtBarrel"];

declare module "./layerSchemas" {
  interface RingsParams {
    mode?: string;
  }
  interface ParticleParams {
    mode?: 'radial' | 'phyllotaxis';
    seedShape?: 'orb' | 'petal' | 'star';
    phylloPattern?: 'auto' | 'golden137.5' | 'lucas99.5' | 'fibonacci137.6' | 'rosette137.3' | 'starburst144';
    petalStretch?: number;
    flowSpeed?: number;
    subTwist?: number;
  }
  interface MoireParams {
    scale: number;
    speed: number;
    lineWidth: number;
    brightness: number;
    contrast?: number;
    waveShape?: number;
    colorSpread?: number;
    patternMode?: 'starburstLoom' | 'twinCircles' | 'doubleSpirals' | 'warpedCrossGrid';
    audioWarp?: number;
  }
  interface SpectralTerrainParams {
    elevation: number;
    width: number;
    horizonY: number;
    foregroundY: number;
    brightness: number;
    lineThickness?: number;
    ridgeShape?: 'smooth' | 'rounded' | 'pointed' | 'stepped';
    layoutMode?: 'fullHorizon' | 'centerPeak' | 'canyon';
    gridCols?: number;
    skirtOpacity?: number;
    colorSpread?: number;
    invertColors?: boolean;
    terrainFlow?: number;
  }
  interface ChladniSandParams {
    scale: number;
    brightness: number;
    pointSize: number;
    attraction: number;
    jitter: number;
    color: string;
    plateMode?: ChladniPlateMode;
    harmonyMode?: ChladniHarmonyMode;
    nodalSharpness?: number;
    grainWarmth?: number;
  }
  interface FerrofluidParams {
    radius: number;
    spikeAmp: number;
    spikeFreq: number;
    spikeSharp: number;
    rotSpeed: number;
    brightness: number;
    fresnelGain: number;
  }
}

/** Moire parameters and schema (Slice 7.13, Slice 7.25). */
export type LoomPatternMode = 'starburstLoom' | 'twinCircles' | 'doubleSpirals' | 'warpedCrossGrid';

export interface MoireParams {
  scale: number;
  speed: number;
  lineWidth: number;
  brightness: number;
  contrast?: number;
  waveShape?: number;
  colorSpread?: number;
  patternMode?: LoomPatternMode;
  audioWarp?: number;
}

export const MOIRE_DEFAULTS: Required<MoireParams> = {
  scale: 30.0,
  speed: 0.5,
  lineWidth: 0.5,
  brightness: 1.0,
  contrast: 0.60,
  waveShape: 0.25,
  colorSpread: 0.80,
  patternMode: 'starburstLoom',
  audioWarp: 0.65,
};

export const MOIRE_SPECS: readonly ParamSpec[] = [
  { type: "float", name: "scale", label: "Grid scale", group: "Moiré", default: MOIRE_DEFAULTS.scale, min: 4.0, max: 75.0, step: 0.5, description: "How many lines are in each grid. More lines make finer patterns." },
  { type: "float", name: "speed", label: "Animation speed", group: "Moiré", default: MOIRE_DEFAULTS.speed, min: 0.0, max: 3.0, step: 0.05, description: "How fast the grids turn and slide past each other." },
  { type: "float", name: "lineWidth", label: "Line width", group: "Moiré", default: MOIRE_DEFAULTS.lineWidth, min: 0.1, max: 0.9, step: 0.05, description: "How thick the grid lines are." },
  { type: "float", name: "brightness", label: "Brightness", group: "Moiré", default: MOIRE_DEFAULTS.brightness, min: 0.1, max: 3.0, step: 0.05, description: "How bright the pattern is." },
  { type: "float", name: "contrast", label: "Contrast", group: "Moiré", default: MOIRE_DEFAULTS.contrast, min: 0.1, max: 1.0, step: 0.05, description: "How strongly the bright and dark bands stand apart." },
  { type: "float", name: "waveShape", label: "Edge softness / sharpness", group: "Moiré", default: MOIRE_DEFAULTS.waveShape, min: 0.0, max: 1.0, step: 0.05, description: "0 gives soft blurry bands, 1 gives crisp hard edges." },
  { type: "float", name: "colorSpread", label: "Two-tone color gradient", group: "Colour", default: MOIRE_DEFAULTS.colorSpread, min: 0.0, max: 1.0, step: 0.05, description: "Adds a second colour to the bands. 0 is one colour." },
  { type: "enum", name: "patternMode", label: "Loom pattern style", group: "Moiré", default: MOIRE_DEFAULTS.patternMode, options: ["starburstLoom", "twinCircles", "doubleSpirals", "warpedCrossGrid"], description: "The kind of grids that overlap." },
  { type: "float", name: "audioWarp", label: "Bass center sweep & kick ripple", group: "Moiré", default: MOIRE_DEFAULTS.audioWarp, min: 0.0, max: 1.0, step: 0.05, description: "How much the bass bends the grids and kicks send ripples through them." },
];

export const MOIRE_SCHEMA = MOIRE_SPECS;

/** Spectral terrain parameters and schema (Slice 7.13, Slice 7.26). */
export type SpectralTerrainRidgeShape = 'smooth' | 'rounded' | 'pointed' | 'stepped';
export type SpectralTerrainLayoutMode = 'fullHorizon' | 'centerPeak' | 'canyon';

export interface SpectralTerrainParams {
  elevation: number;
  width: number;
  horizonY: number;
  foregroundY: number;
  brightness: number;
  lineThickness?: number;
  ridgeShape?: SpectralTerrainRidgeShape;
  layoutMode?: SpectralTerrainLayoutMode;
  gridCols?: number;
  skirtOpacity?: number;
  colorSpread?: number;
  invertColors?: boolean;
  terrainFlow?: number;
}

export const SPECTRAL_TERRAIN_DEFAULTS: Required<SpectralTerrainParams> = {
  elevation: 0.6,
  width: 1.3,
  horizonY: 0.35,
  foregroundY: -0.55,
  brightness: 1.2,
  lineThickness: 1.8,
  ridgeShape: 'smooth',
  layoutMode: 'fullHorizon',
  gridCols: 16,
  skirtOpacity: 0.15,
  colorSpread: 0.85,
  invertColors: false,
  terrainFlow: 0.35,
};

export const SPECTRAL_TERRAIN_SPECS: readonly ParamSpec[] = [
  { type: "float", name: "elevation", label: "Peak elevation", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.elevation, min: 0.1, max: 2.0, step: 0.01, description: "How tall the ridges grow with the music." },
  { type: "float", name: "width", label: "Terrain width", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.width, min: 0.5, max: 2.5, step: 0.01, description: "How wide the terrain stretches across the screen." },
  { type: "float", name: "horizonY", label: "Horizon Y", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.horizonY, min: -0.5, max: 0.8, step: 0.01, description: "Where the far edge of the terrain sits on screen." },
  { type: "float", name: "foregroundY", label: "Foreground Y", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.foregroundY, min: -0.9, max: 0.2, step: 0.01, description: "Where the near edge of the terrain sits on screen." },
  { type: "float", name: "brightness", label: "Ridge brightness", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.brightness, min: 0.1, max: 3.0, step: 0.01, description: "How brightly the ridge lines glow." },
  { type: "float", name: "lineThickness", label: "Line thickness", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.lineThickness, min: 0.5, max: 4.0, step: 0.1, description: "How thick the ridge lines are." },
  { type: "enum", name: "ridgeShape", label: "Ridge profile", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.ridgeShape, options: ["smooth", "rounded", "pointed", "stepped"], description: "The shape of each peak: smooth, rounded, pointed or stepped." },
  { type: "enum", name: "layoutMode", label: "Mountain layout", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.layoutMode, options: ["fullHorizon", "centerPeak", "canyon"], description: "Peaks across the whole horizon, one central peak, or a canyon." },
  { type: "int", name: "gridCols", label: "3D front-to-back grid lines", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.gridCols, min: 0, max: 32, step: 4, description: "How many lines run from the front toward the horizon." },
  { type: "float", name: "skirtOpacity", label: "Mountain fill opacity", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.skirtOpacity, min: 0.0, max: 1.0, step: 0.05, description: "How solid the dark fill under each ridge is. 0 shows only lines." },
  { type: "float", name: "colorSpread", label: "Cyan-to-magenta gradient", group: "Colour", default: SPECTRAL_TERRAIN_DEFAULTS.colorSpread, min: 0.0, max: 1.0, step: 0.05, description: "How much the colour shifts from cyan to magenta from near to far." },
  { type: "bool", name: "invertColors", label: "Invert colors", group: "Colour", default: SPECTRAL_TERRAIN_DEFAULTS.invertColors, description: "Swaps the colours of the peaks and valleys." },
  { type: "float", name: "terrainFlow", label: "Downhill trail drift", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.terrainFlow, min: 0.0, max: 1.0, step: 0.05, description: "How fast the terrain scrolls toward you." },
];

export const SPECTRAL_TERRAIN_SCHEMA = SPECTRAL_TERRAIN_SPECS;

/** Particle layout mode options (Slice 7.14). */
export const PARTICLE_MODE_SPEC: EnumSpec = {
  type: "enum",
  name: "mode",
  label: "Layout mode",
  group: "Shape",
  default: "radial",
  options: ["radial", "phyllotaxis", "field"],
  description: "Selects particle layout: radial explosion, phyllotaxis spiral, or a starfield (field) of stars flying toward you.",
};

/** Particle seed shape, phyllotaxis pattern, and petal stretch options (Slice 7.29). */
export type ParticleSeedShape = 'orb' | 'petal' | 'star';
export type ParticlePhylloPattern = 'auto' | 'golden137.5' | 'lucas99.5' | 'fibonacci137.6' | 'rosette137.3' | 'starburst144';

export const PARTICLE_SEED_SHAPE_SPEC: EnumSpec = {
  type: "enum",
  name: "seedShape",
  label: "Seed shape",
  group: "Shape",
  default: "petal",
  options: ["orb", "petal", "star"],
  description: "What each particle looks like.",
  showWhen: { mode: "phyllotaxis" },
};

export const PARTICLE_PHYLLO_PATTERN_SPEC: EnumSpec = {
  type: "enum",
  name: "phylloPattern",
  label: "Spiral divergence",
  group: "Shape",
  default: "auto",
  options: ["auto", "golden137.5", "lucas99.5", "fibonacci137.6", "rosette137.3", "starburst144"],
  description: "The turn between neighbouring particles, which sets the spiral pattern. Golden 137.5° is the sunflower look.",
  showWhen: { mode: "phyllotaxis" },
};

export const PARTICLE_PETAL_STRETCH_SPEC: NumberSpec = {
  type: "float",
  name: "petalStretch",
  label: "Petal elongation",
  group: "Shape",
  default: 1.65,
  min: 0.5,
  max: 3.0,
  step: 0.05,
  description: "Stretches particles into streaks along their direction of travel.",
  showWhen: { mode: "phyllotaxis" },
};

export const PARTICLE_FLOW_SPEED_SPEC: NumberSpec = {
  type: "float",
  name: "flowSpeed",
  label: "Bloom flow speed",
  group: "Motion",
  default: 1.0,
  min: 0.1,
  max: 4.0,
  step: 0.05,
  description: "How fast the spiral blooms outward.",
  showWhen: { mode: "phyllotaxis" },
};

export const PARTICLE_SUB_TWIST_SPEC: NumberSpec = {
  type: "float",
  name: "subTwist",
  label: "Bass spin coupling",
  group: "Motion",
  default: 1.0,
  min: 0.0,
  max: 4.0,
  step: 0.05,
  description: "Lets the sub-bass twist the spiral.",
  showWhen: { mode: "phyllotaxis" },
};

export const PHYLLOTAXIS_SPECS: readonly ParamSpec[] = [
  PARTICLE_SEED_SHAPE_SPEC,
  PARTICLE_PHYLLO_PATTERN_SPEC,
  PARTICLE_PETAL_STRETCH_SPEC,
  PARTICLE_FLOW_SPEED_SPEC,
  PARTICLE_SUB_TWIST_SPEC,
];

export const PARTICLES_SCHEMA: readonly ParamSpec[] = [
  PARTICLE_MODE_SPEC,
  ...PHYLLOTAXIS_SPECS,
];

/** Chladni sand parameters and schema (Slice 7.14, Slice 7.28). */
export type ChladniPlateMode = 'fullscreen' | 'isometricPlate' | 'radialMandala' | 'hexagon' | 'triangle' | 'starMandala' | 'morph';
export type ChladniHarmonyMode = 'auto' | '1:2' | '2:3' | '3:4' | '3:5' | '4:5' | '5:7' | '6:8';

export interface ChladniSandParams {
  scale: number;
  brightness: number;
  pointSize: number;
  attraction: number;
  jitter: number;
  color: string;
  plateMode?: ChladniPlateMode;
  harmonyMode?: ChladniHarmonyMode;
  nodalSharpness?: number;
  grainWarmth?: number;
}

export const CHLADNI_DEFAULTS: Required<ChladniSandParams> = {
  scale: 1.0,
  brightness: 1.2,
  pointSize: 1.0,
  attraction: 1.0,
  jitter: 1.0,
  color: "#f0c558",
  plateMode: 'fullscreen',
  harmonyMode: 'auto',
  nodalSharpness: 1.25,
  grainWarmth: 0.75,
};

export const CHLADNI_SPECS: readonly ParamSpec[] = [
  { type: "float", name: "scale", label: "Pattern scale", group: "Sand", default: CHLADNI_DEFAULTS.scale, min: 0.1, max: 3.0, step: 0.05, description: "How busy the sand pattern is. Higher makes more, smaller cells." },
  { type: "float", name: "brightness", label: "Sand brightness", group: "Sand", default: CHLADNI_DEFAULTS.brightness, min: 0.1, max: 3.0, step: 0.05, description: "How bright the sand is." },
  { type: "float", name: "pointSize", label: "Grain size", group: "Sand", default: CHLADNI_DEFAULTS.pointSize, min: 0.5, max: 4.0, step: 0.1, description: "How big each grain is." },
  { type: "float", name: "attraction", label: "Nodal attraction", group: "Sand", default: CHLADNI_DEFAULTS.attraction, min: 0.1, max: 3.0, step: 0.05, description: "How fast the sand settles onto the pattern lines." },
  { type: "float", name: "jitter", label: "Kick jitter", group: "Sand", default: CHLADNI_DEFAULTS.jitter, min: 0.0, max: 3.0, step: 0.05, description: "How much bass kicks scatter the sand." },
  { type: "colour", name: "color", label: "Sand colour", group: "Colour", default: CHLADNI_DEFAULTS.color, description: "The colour of the sand." },
  { type: "enum", name: "plateMode", label: "Plate geometry", group: "Sand", default: CHLADNI_DEFAULTS.plateMode, options: ["fullscreen", "isometricPlate", "radialMandala", "hexagon", "triangle", "starMandala", "morph"], description: "The shape of the vibrating plate." },
  { type: "enum", name: "harmonyMode", label: "Harmonic mode (n:m)", group: "Sand", default: CHLADNI_DEFAULTS.harmonyMode, options: ["auto", "1:2", "2:3", "3:4", "3:5", "4:5", "5:7", "6:8"], description: "Which vibration pattern the plate makes." },
  { type: "float", name: "nodalSharpness", label: "Nodal line sharpness", group: "Sand", default: CHLADNI_DEFAULTS.nodalSharpness, min: 0.2, max: 2.0, step: 0.05, description: "How tightly the sand gathers on the lines. Higher gives thinner, sharper lines." },
  { type: "float", name: "grainWarmth", label: "Amber/cyan color mix", group: "Colour", default: CHLADNI_DEFAULTS.grainWarmth, min: 0.0, max: 1.0, step: 0.05, description: "Shifts the sand colour from warm amber toward cool tones." },
];

export const CHLADNI_SAND_SCHEMA = CHLADNI_SPECS;
export const CHLADNI_SCHEMA = CHLADNI_SPECS;

/** Ferrofluid parameters and schema (Slice 7.15). */
export interface FerrofluidParams {
  radius: number;
  spikeAmp: number;
  spikeFreq: number;
  spikeSharp: number;
  rotSpeed: number;
  brightness: number;
  fresnelGain: number;
}

export const FERROFLUID_DEFAULTS: FerrofluidParams = {
  radius: 0.48,
  spikeAmp: 0.35,
  spikeFreq: 1.0,
  spikeSharp: 3.5,
  rotSpeed: 0.3,
  brightness: 1.2,
  fresnelGain: 1.5,
};

export const FERROFLUID_SPECS: readonly ParamSpec[] = [
  { type: "float", name: "radius", label: "Base radius", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.radius, min: 0.2, max: 1.2, step: 0.01, description: "Size of the blob." },
  { type: "float", name: "spikeAmp", label: "Spike amplitude", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.spikeAmp, min: 0.0, max: 1.0, step: 0.01, description: "How tall the spikes grow." },
  { type: "float", name: "spikeFreq", label: "Spike frequency", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.spikeFreq, min: 0.2, max: 3.0, step: 0.05, description: "How many spikes cover the surface." },
  { type: "float", name: "spikeSharp", label: "Spike sharpness", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.spikeSharp, min: 1.0, max: 8.0, step: 0.1, description: "How pointed the spike tips are." },
  { type: "float", name: "rotSpeed", label: "Rotation speed", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.rotSpeed, min: -2.0, max: 2.0, step: 0.05, description: "How fast the blob turns." },
  { type: "float", name: "brightness", label: "Brightness", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.brightness, min: 0.2, max: 3.0, step: 0.05, description: "How shiny and bright the blob is." },
  { type: "float", name: "fresnelGain", label: "Rim light", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.fresnelGain, min: 0.0, max: 4.0, step: 0.1, description: "Adds a bright rim of light around the blob edge." },
];

/** Reaction-diffusion simulation and rendering parameters (Slice 7.17). */
export interface ReactionDiffusionParams {
  speed: number;
  feed: number;
  kill: number;
  du: number;
  dv: number;
  brightness: number;
  colorPink: string;
  colorCobalt: string;
  specular: number;
}

export const REACTION_DIFFUSION_DEFAULTS: ReactionDiffusionParams = {
  speed: 1.0,
  feed: 0.042,
  kill: 0.062,
  du: 0.16,
  dv: 0.08,
  brightness: 1.25,
  colorPink: '#ff2a8d',
  colorCobalt: '#0044ff',
  specular: 1.0,
};

export const REACTION_DIFFUSION_SPECS: readonly ParamSpec[] = [
  { type: "float", name: "speed", label: "Simulation speed", group: "Simulation", default: REACTION_DIFFUSION_DEFAULTS.speed, min: 0.1, max: 3.0, step: 0.05, description: "Sets the chemical Gray-Scott simulation time step velocity." },
  { type: "float", name: "feed", label: "Base feed rate", group: "Simulation", default: REACTION_DIFFUSION_DEFAULTS.feed, min: 0.01, max: 0.09, step: 0.001, description: "Controls chemical nutrient replenishment feed rate U." },
  { type: "float", name: "kill", label: "Base kill rate", group: "Simulation", default: REACTION_DIFFUSION_DEFAULTS.kill, min: 0.04, max: 0.08, step: 0.001, description: "Controls chemical reaction removal kill rate V." },
  { type: "float", name: "du", label: "Diffusion rate U", group: "Simulation", default: REACTION_DIFFUSION_DEFAULTS.du, min: 0.05, max: 0.3, step: 0.01, description: "Sets spatial diffusion coefficient rate for chemical component U." },
  { type: "float", name: "dv", label: "Diffusion rate V", group: "Simulation", default: REACTION_DIFFUSION_DEFAULTS.dv, min: 0.02, max: 0.2, step: 0.01, description: "Sets spatial diffusion coefficient rate for chemical component V." },
  { type: "float", name: "brightness", label: "Brightness", group: "Appearance", default: REACTION_DIFFUSION_DEFAULTS.brightness, min: 0.1, max: 3.0, step: 0.05, description: "Scales overall rendered luminosity of reaction-diffusion textures." },
  { type: "colour", name: "colorPink", label: "Coral pink", group: "Colour", default: REACTION_DIFFUSION_DEFAULTS.colorPink, description: "Sets primary highlight tint for morphogenetic structures." },
  { type: "colour", name: "colorCobalt", label: "Cobalt blue", group: "Colour", default: REACTION_DIFFUSION_DEFAULTS.colorCobalt, description: "Sets background shadow tint for morphogenetic structures." },
  { type: "float", name: "specular", label: "Specular gain", group: "Appearance", default: REACTION_DIFFUSION_DEFAULTS.specular, min: 0.0, max: 3.0, step: 0.05, description: "Adjusts surface specular highlight reflection strength." },
];




