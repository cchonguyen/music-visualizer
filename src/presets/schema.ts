// Parameter schema: one entry per setting (a layer's radius, a feedback zoom, a colour...).
// The preset loader, the Preset Studio sliders and the randomiser all read these entries,
// so they always agree on each setting's name, default and safe range.

/** Every signal a setting can follow. Evaluated in links.ts. */
export const AUDIO_SOURCES = [
  "sub", "bass", "mid", "high", "energy", "loudness", "beat", "onset", "section",
  "beatStrength", "brightness", "subFlux", "midFlux", "highFlux",
  "lfoSine", "lfoSaw", "lfoRandom", "time",
  "kickEnv", "centroid",
] as const;
export type AudioSource = (typeof AUDIO_SOURCES)[number];

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
    description: "Selects the coordinate warp algorithm applied to feedback coordinates each frame.",
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
    description: "Sets the radius of the unwarped central portal disk.",
    showWhen: { warpMode: "polarFold" },
  },
  {
    type: "float",
    name: "mobiusPoleOffset",
    label: "Pole separation",
    group: "Warp",
    default: 0.48,
    min: 0.2,
    max: 0.85,
    step: 0.02,
    description: "Adjusts the spatial distance between the two Möbius vortex poles.",
    showWhen: { warpMode: "mobius" },
  },
  // Slice 7.22 additions
  {
    type: "int",
    name: "curlOctaves",
    label: "Curl octaves",
    group: "Warp",
    default: 2,
    min: 1,
    max: 3,
    step: 1,
    description: "Sets the number of noise octave layers used in the curl fluid simulation.",
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
    description: "Controls treble-reactive smoke turbulence chaos in curl warp.",
    showWhen: { warpMode: "curl" },
  },
  {
    type: "enum",
    name: "curlFlowPattern",
    label: "Curl flow style",
    group: "Warp",
    default: "plumes",
    options: ["plumes", "eddies", "outflow", "inflow"],
    description: "Chooses the fluid flow pattern style governing curl vector motion.",
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
    description: "Controls angular sector mirroring repetition around the center.",
    showWhen: { warpMode: "polarFold" },
  },
  {
    type: "float",
    name: "mandalaTile",
    label: "Wallpaper crystal tiling",
    group: "Warp",
    default: 0.0,
    min: 0.0,
    max: 1.0,
    step: 0.05,
    description: "Tiles the feedback buffer with crystal wallpaper symmetry.",
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
    description: "Sets counter-rotational spin speed across nested mandala rings.",
    showWhen: { warpMode: "polarFold" },
  },
  {
    type: "enum",
    name: "mandalaPattern",
    label: "Symmetry lock",
    group: "Warp",
    default: "auto",
    options: ["auto", "4", "6", "8", "12", "16"],
    description: "Locks the rotational symmetry order for crystal mandala tiling.",
    showWhen: { warpMode: "polarFold" },
  },
  {
    type: "float",
    name: "mobiusFlow",
    label: "Dipole flow speed",
    group: "Warp",
    default: 0.85,
    min: 0.0,
    max: 2.0,
    step: 0.05,
    description: "Controls the circulation flow velocity through Möbius vortex poles.",
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
    description: "Controls logarithmic spiral winding tightness around Möbius poles.",
    showWhen: { warpMode: "mobius" },
  },
  {
    type: "float",
    name: "mobiusWander",
    label: "Pole & screen drift",
    group: "Warp",
    default: 0.55,
    min: 0.0,
    max: 1.0,
    step: 0.05,
    description: "Modulates autonomous orbital wandering of Möbius poles across the screen.",
    showWhen: { warpMode: "mobius" },
  },
  {
    type: "enum",
    name: "mobiusMode",
    label: "Vortex flow mode",
    group: "Warp",
    default: "auto",
    options: ["auto", "dipoleFlow", "doubleVortex", "figureEight", "breathingOrbit"],
    description: "Chooses the automated trajectory pattern followed by Möbius poles.",
    showWhen: { warpMode: "mobius" },
  },
  // Warp group (high-intensity at bottom)
  {
    type: "int",
    name: "kaleidoN",
    label: "Kaleidoscope folds",
    group: "Warp",
    default: 6,
    min: 4,
    max: 16,
    step: 1,
    description: "Sets the number of radial reflection axes folded across the screen.",
    showWhen: { warpMode: "polarFold" },
    intense: true,
    warning: "Intense visual transform. Highly sensitive to small adjustments — use with care.",
  },
  {
    type: "float",
    name: "rgbSplit",
    label: "RGB split",
    group: "Warp",
    default: 0.0,
    min: 0.0,
    max: 0.08,
    step: 0.001,
    description: "Displaces red, green, and blue coordinates during coordinate warping.",
    showWhen: { warpMode: "rgbSplit" },
    intense: true,
    warning: "Intense visual transform. Highly sensitive to small adjustments — use with care.",
  },

  // Trail group (non-intense, then high-intensity at bottom)
  {
    type: "vec3",
    name: "decayRgb",
    label: "Decay RGB multiplier",
    group: "Trail",
    default: [1.0, 1.0, 1.0],
    min: 0.0,
    max: 2.0,
    step: 0.01,
    description: "Multiplies per-color-channel decay persistence rates independently.",
  },
  {
    type: "float",
    name: "sobel",
    label: "Sobel edge detect",
    group: "Trail",
    default: 0.0,
    min: 0.0,
    max: 1.0,
    step: 0.01,
    description: "Extracts high-contrast edge gradients using Sobel spatial filtering.",
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
    description: "Sets the spatial frequency and count of topographic contour bands.",
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
    description: "Adjusts the stroke thickness of topographic contour bands.",
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
    description: "Spreads palette hues across topographic contour gradient cycles.",
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
    description: "Inverts colors above a luminous threshold for a surreal solarized look.",
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
  description: "Switches between concentric rings, orbiting triangles, and polar grid layouts.",
};

/** Post CRT scanline and barrel distortion options (Slice 7.12). */
export const POST_CRT_SPECS: readonly ParamSpec[] = [
  {
    type: "float",
    name: "crtScanlines",
    label: "CRT scanlines",
    group: "CRT",
    default: 0.0,
    min: 0.0,
    max: 1.0,
    step: 0.01,
    description: "Overlays horizontal retro CRT television scanline rasterization.",
  },
  {
    type: "float",
    name: "crtBarrel",
    label: "CRT barrel distortion",
    group: "CRT",
    default: 0.0,
    min: 0.0,
    max: 0.2,
    step: 0.005,
    description: "Simulates curved glass cathode-ray tube screen barrel distortion.",
  },
];

import { LAYER_SPECS } from "./layerSchemas";

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
  { type: "float", name: "scale", label: "Grid scale", group: "Moiré", default: MOIRE_DEFAULTS.scale, min: 4.0, max: 75.0, step: 0.5, description: "Sets the density and spatial frequency of the moiré interference grid." },
  { type: "float", name: "speed", label: "Animation speed", group: "Moiré", default: MOIRE_DEFAULTS.speed, min: 0.0, max: 3.0, step: 0.05, description: "Controls rotation and phase animation velocity of the moiré lattice." },
  { type: "float", name: "lineWidth", label: "Line width", group: "Moiré", default: MOIRE_DEFAULTS.lineWidth, min: 0.1, max: 0.9, step: 0.05, description: "Adjusts the stroke thickness of the intersecting moiré lines." },
  { type: "float", name: "brightness", label: "Brightness", group: "Moiré", default: MOIRE_DEFAULTS.brightness, min: 0.1, max: 3.0, step: 0.05, description: "Scales overall luminosity of the moiré interference pattern." },
  { type: "float", name: "contrast", label: "Contrast", group: "Moiré", default: MOIRE_DEFAULTS.contrast, min: 0.1, max: 1.0, step: 0.05, description: "Enhances dynamic contrast between dark and bright interference bands." },
  { type: "float", name: "waveShape", label: "Edge softness / sharpness", group: "Moiré", default: MOIRE_DEFAULTS.waveShape, min: 0.0, max: 1.0, step: 0.05, description: "Shapes interference profile between smooth sine waves and sharp steps." },
  { type: "float", name: "colorSpread", label: "Two-tone color gradient", group: "Colour", default: MOIRE_DEFAULTS.colorSpread, min: 0.0, max: 1.0, step: 0.05, description: "Blends two-tone accent color spread across moiré interference fringes." },
  { type: "enum", name: "patternMode", label: "Loom pattern style", group: "Moiré", default: MOIRE_DEFAULTS.patternMode, options: ["starburstLoom", "twinCircles", "doubleSpirals", "warpedCrossGrid"], description: "Selects the geometric lattice structure for overlapping wave patterns." },
  { type: "float", name: "audioWarp", label: "Bass center sweep & kick ripple", group: "Moiré", default: MOIRE_DEFAULTS.audioWarp, min: 0.0, max: 1.0, step: 0.05, description: "Modulates lattice distortion depth from bass sweeps and kick ripples." },
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
  skirtOpacity: 0.90,
  colorSpread: 0.85,
  invertColors: false,
  terrainFlow: 0.35,
};

export const SPECTRAL_TERRAIN_SPECS: readonly ParamSpec[] = [
  { type: "float", name: "elevation", label: "Peak elevation", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.elevation, min: 0.1, max: 2.0, step: 0.01, description: "Scales vertical peak elevation driven by audio frequency bands." },
  { type: "float", name: "width", label: "Terrain width", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.width, min: 0.5, max: 2.5, step: 0.01, description: "Controls horizontal camera span and width of the 3D terrain grid." },
  { type: "float", name: "horizonY", label: "Horizon Y", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.horizonY, min: -0.5, max: 0.8, step: 0.01, description: "Sets vertical positioning of the distant horizon vanishing line." },
  { type: "float", name: "foregroundY", label: "Foreground Y", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.foregroundY, min: -0.9, max: 0.2, step: 0.01, description: "Sets vertical positioning of the bottom foreground edge." },
  { type: "float", name: "brightness", label: "Ridge brightness", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.brightness, min: 0.1, max: 3.0, step: 0.01, description: "Scales luminous glow intensity of illuminated terrain ridges." },
  { type: "float", name: "lineThickness", label: "Line thickness", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.lineThickness, min: 0.5, max: 4.0, step: 0.1, description: "Sets stroke width of wireframe terrain ridge vectors." },
  { type: "enum", name: "ridgeShape", label: "Ridge profile", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.ridgeShape, options: ["smooth", "rounded", "pointed", "stepped"], description: "Selects geometric profile curve for frequency peak ridges." },
  { type: "enum", name: "layoutMode", label: "Mountain layout", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.layoutMode, options: ["fullHorizon", "centerPeak", "canyon"], description: "Configures geographic layout arrangement of mountain peaks." },
  { type: "int", name: "gridCols", label: "3D front-to-back grid lines", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.gridCols, min: 0, max: 32, step: 4, description: "Sets count of longitudinal depth grid lines spanning toward horizon." },
  { type: "float", name: "skirtOpacity", label: "Mountain fill opacity", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.skirtOpacity, min: 0.0, max: 1.0, step: 0.05, description: "Controls opacity of terrain body fill shading under the ridges." },
  { type: "float", name: "colorSpread", label: "Cyan-to-magenta gradient", group: "Colour", default: SPECTRAL_TERRAIN_DEFAULTS.colorSpread, min: 0.0, max: 1.0, step: 0.05, description: "Adjusts cyan-to-magenta color gradient spread across depth." },
  { type: "bool", name: "invertColors", label: "Invert colors", group: "Colour", default: SPECTRAL_TERRAIN_DEFAULTS.invertColors, description: "Inverts ridge and valley color assignments across the terrain." },
  { type: "float", name: "terrainFlow", label: "Downhill trail drift", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.terrainFlow, min: 0.0, max: 1.0, step: 0.05, description: "Controls continuous forward downhill drift velocity of the terrain." },
];

export const SPECTRAL_TERRAIN_SCHEMA = SPECTRAL_TERRAIN_SPECS;

/** Particle layout mode options (Slice 7.14). */
export const PARTICLE_MODE_SPEC: EnumSpec = {
  type: "enum",
  name: "mode",
  label: "Layout mode",
  group: "Shape",
  default: "radial",
  options: ["radial", "phyllotaxis"],
  description: "Selects particle distribution layout between radial explosion and phyllotaxis spiral.",
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
  description: "Chooses the geometric morphology of individual particle seeds.",
};

export const PARTICLE_PHYLLO_PATTERN_SPEC: EnumSpec = {
  type: "enum",
  name: "phylloPattern",
  label: "Spiral divergence",
  group: "Shape",
  default: "auto",
  options: ["auto", "golden137.5", "lucas99.5", "fibonacci137.6", "rosette137.3", "starburst144"],
  description: "Sets the mathematical divergence angle determining botanical spiral patterns.",
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
  description: "Elongates particle geometry along radial velocity vectors.",
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
  description: "Controls the outward bloom expansion velocity of the particle field.",
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
  description: "Couples sub-bass audio energy to rotational spiral vortex twisting.",
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

if (LAYER_SPECS && LAYER_SPECS.particles) {
  const existingNames = new Set(LAYER_SPECS.particles.map((s) => s.name));
  const newSpecs = [
    PARTICLE_MODE_SPEC,
    ...PHYLLOTAXIS_SPECS,
  ].filter((s) => !existingNames.has(s.name));
  (LAYER_SPECS as Record<string, readonly ParamSpec[]>).particles = [
    ...LAYER_SPECS.particles,
    ...newSpecs,
  ];
}

/** Chladni sand parameters and schema (Slice 7.14, Slice 7.28). */
export type ChladniPlateMode = 'fullscreen' | 'isometricPlate' | 'radialMandala';
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
  { type: "float", name: "scale", label: "Pattern scale", group: "Sand", default: CHLADNI_DEFAULTS.scale, min: 0.1, max: 3.0, step: 0.05, description: "Scales resonant acoustic nodal pattern frequency across the plate." },
  { type: "float", name: "brightness", label: "Sand brightness", group: "Sand", default: CHLADNI_DEFAULTS.brightness, min: 0.1, max: 3.0, step: 0.05, description: "Controls luminous intensity of sand grain particles." },
  { type: "float", name: "pointSize", label: "Grain size", group: "Sand", default: CHLADNI_DEFAULTS.pointSize, min: 0.5, max: 4.0, step: 0.1, description: "Adjusts rendered particle point diameter." },
  { type: "float", name: "attraction", label: "Nodal attraction", group: "Sand", default: CHLADNI_DEFAULTS.attraction, min: 0.1, max: 3.0, step: 0.05, description: "Sets gravitational velocity pulling sand toward nodal lines." },
  { type: "float", name: "jitter", label: "Kick jitter", group: "Sand", default: CHLADNI_DEFAULTS.jitter, min: 0.0, max: 3.0, step: 0.05, description: "Injects kinetic brownian dispersion into grains on bass kicks." },
  { type: "colour", name: "color", label: "Sand colour", group: "Colour", default: CHLADNI_DEFAULTS.color, description: "Sets base tint color of the resonant sand grains." },
  { type: "enum", name: "plateMode", label: "Plate geometry", group: "Sand", default: CHLADNI_DEFAULTS.plateMode, options: ["fullscreen", "isometricPlate", "radialMandala"], description: "Chooses the boundary geometry of the vibrating resonant plate." },
  { type: "enum", name: "harmonyMode", label: "Harmonic mode (n:m)", group: "Sand", default: CHLADNI_DEFAULTS.harmonyMode, options: ["auto", "1:2", "2:3", "3:4", "3:5", "4:5", "5:7", "6:8"], description: "Selects harmonic frequency integer ratios shaping nodal curves." },
  { type: "float", name: "nodalSharpness", label: "Nodal line sharpness", group: "Sand", default: CHLADNI_DEFAULTS.nodalSharpness, min: 0.2, max: 2.0, step: 0.05, description: "Sharpens acoustic potential wells defining nodal line boundaries." },
  { type: "float", name: "grainWarmth", label: "Amber/cyan color mix", group: "Colour", default: CHLADNI_DEFAULTS.grainWarmth, min: 0.0, max: 1.0, step: 0.05, description: "Blends between warm amber and cool spectral color tones." },
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
  { type: "float", name: "radius", label: "Base radius", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.radius, min: 0.2, max: 1.2, step: 0.01, description: "Sets base spherical radius of the magnetic fluid core." },
  { type: "float", name: "spikeAmp", label: "Spike amplitude", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.spikeAmp, min: 0.0, max: 1.0, step: 0.01, description: "Controls maximum outward projection height of magnetic spikes." },
  { type: "float", name: "spikeFreq", label: "Spike frequency", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.spikeFreq, min: 0.2, max: 3.0, step: 0.05, description: "Adjusts spatial distribution frequency and count of surface spikes." },
  { type: "float", name: "spikeSharp", label: "Spike sharpness", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.spikeSharp, min: 1.0, max: 8.0, step: 0.1, description: "Sharpens the curvature tip profile of ferrofluid spikes." },
  { type: "float", name: "rotSpeed", label: "Rotation speed", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.rotSpeed, min: -2.0, max: 2.0, step: 0.05, description: "Controls angular rotation velocity of the magnetic fluid body." },
  { type: "float", name: "brightness", label: "Brightness", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.brightness, min: 0.2, max: 3.0, step: 0.05, description: "Scales specular core luminescence of the ferrofluid material." },
  { type: "float", name: "fresnelGain", label: "Fresnel halo", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.fresnelGain, min: 0.0, max: 4.0, step: 0.1, description: "Increases grazing-angle edge lighting and specular halo intensity." },
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




