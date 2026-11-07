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

interface BaseSpec {
  name: string; // stable key used in preset files, e.g. "density"
  label: string; // text shown in the Studio, e.g. "Ring density"
  group: string; // section in the Studio, e.g. "Wall pattern"
}

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
export const FEEDBACK_WARP_SPECS: readonly ParamSpec[] = [
  {
    type: "enum",
    name: "warpMode",
    label: "Warp mode",
    group: "Warp",
    default: "classic",
    options: ["classic", "curl", "polarFold", "mobius", "rgbSplit"],
  },
  {
    type: "int",
    name: "kaleidoN",
    label: "Kaleidoscope folds",
    group: "Warp",
    default: 6,
    min: 4,
    max: 16,
    step: 1,
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
  },
  {
    type: "vec3",
    name: "decayRgb",
    label: "Decay RGB multiplier",
    group: "Trail",
    default: [1.0, 1.0, 1.0],
    min: 0.0,
    max: 2.0,
    step: 0.01,
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
  },
  {
    type: "float",
    name: "mobiusPoleOffset",
    label: "Möbius pole offset",
    group: "Warp",
    default: 0.35,
    min: 0.1,
    max: 0.8,
    step: 0.01,
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
  },
];

declare module "./layerSchemas" {
  interface RingsParams {
    mode?: string;
  }
  interface ParticleParams {
    mode?: 'radial' | 'phyllotaxis';
  }
  interface MoireParams {
    scale: number;
    speed: number;
    lineWidth: number;
    brightness: number;
  }
  interface SpectralTerrainParams {
    elevation: number;
    width: number;
    horizonY: number;
    foregroundY: number;
    brightness: number;
  }
  interface ChladniSandParams {
    scale: number;
    brightness: number;
    pointSize: number;
    attraction: number;
    jitter: number;
    color: string;
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

/** Moire parameters and schema (Slice 7.13). */
export interface MoireParams {
  scale: number;
  speed: number;
  lineWidth: number;
  brightness: number;
}

export const MOIRE_DEFAULTS: MoireParams = {
  scale: 30.0,
  speed: 0.5,
  lineWidth: 0.5,
  brightness: 1.0,
};

export const MOIRE_SPECS: readonly ParamSpec[] = [
  { type: "float", name: "scale", label: "Grid scale", group: "Moiré", default: MOIRE_DEFAULTS.scale, min: 4.0, max: 75.0, step: 0.5 },
  { type: "float", name: "speed", label: "Animation speed", group: "Moiré", default: MOIRE_DEFAULTS.speed, min: 0.0, max: 3.0, step: 0.05 },
  { type: "float", name: "lineWidth", label: "Line width", group: "Moiré", default: MOIRE_DEFAULTS.lineWidth, min: 0.1, max: 0.9, step: 0.05 },
  { type: "float", name: "brightness", label: "Brightness", group: "Moiré", default: MOIRE_DEFAULTS.brightness, min: 0.1, max: 3.0, step: 0.05 },
];

/** Spectral terrain parameters and schema (Slice 7.13). */
export interface SpectralTerrainParams {
  elevation: number;
  width: number;
  horizonY: number;
  foregroundY: number;
  brightness: number;
}

export const SPECTRAL_TERRAIN_DEFAULTS: SpectralTerrainParams = {
  elevation: 0.6,
  width: 1.3,
  horizonY: 0.35,
  foregroundY: -0.55,
  brightness: 1.2,
};

export const SPECTRAL_TERRAIN_SPECS: readonly ParamSpec[] = [
  { type: "float", name: "elevation", label: "Peak elevation", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.elevation, min: 0.1, max: 2.0, step: 0.01 },
  { type: "float", name: "width", label: "Terrain width", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.width, min: 0.5, max: 2.5, step: 0.01 },
  { type: "float", name: "horizonY", label: "Horizon Y", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.horizonY, min: -0.5, max: 0.8, step: 0.01 },
  { type: "float", name: "foregroundY", label: "Foreground Y", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.foregroundY, min: -0.9, max: 0.2, step: 0.01 },
  { type: "float", name: "brightness", label: "Ridge brightness", group: "Terrain", default: SPECTRAL_TERRAIN_DEFAULTS.brightness, min: 0.1, max: 3.0, step: 0.01 },
];

/** Particle layout mode options (Slice 7.14). */
export const PARTICLE_MODE_SPEC: EnumSpec = {
  type: "enum",
  name: "mode",
  label: "Layout mode",
  group: "Shape",
  default: "radial",
  options: ["radial", "phyllotaxis"],
};

/** Chladni sand parameters and schema (Slice 7.14). */
export interface ChladniSandParams {
  scale: number;
  brightness: number;
  pointSize: number;
  attraction: number;
  jitter: number;
  color: string;
}

export const CHLADNI_DEFAULTS: ChladniSandParams = {
  scale: 1.0,
  brightness: 1.2,
  pointSize: 1.0,
  attraction: 1.0,
  jitter: 1.0,
  color: "#f0c558",
};

export const CHLADNI_SPECS: readonly ParamSpec[] = [
  { type: "float", name: "scale", label: "Pattern scale", group: "Sand", default: CHLADNI_DEFAULTS.scale, min: 0.1, max: 3.0, step: 0.05 },
  { type: "float", name: "brightness", label: "Sand brightness", group: "Sand", default: CHLADNI_DEFAULTS.brightness, min: 0.1, max: 3.0, step: 0.05 },
  { type: "float", name: "pointSize", label: "Grain size", group: "Sand", default: CHLADNI_DEFAULTS.pointSize, min: 0.5, max: 4.0, step: 0.1 },
  { type: "float", name: "attraction", label: "Nodal attraction", group: "Sand", default: CHLADNI_DEFAULTS.attraction, min: 0.1, max: 3.0, step: 0.05 },
  { type: "float", name: "jitter", label: "Kick jitter", group: "Sand", default: CHLADNI_DEFAULTS.jitter, min: 0.0, max: 3.0, step: 0.05 },
  { type: "colour", name: "color", label: "Sand colour", group: "Colour", default: CHLADNI_DEFAULTS.color },
];

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
  { type: "float", name: "radius", label: "Base radius", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.radius, min: 0.2, max: 1.2, step: 0.01 },
  { type: "float", name: "spikeAmp", label: "Spike amplitude", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.spikeAmp, min: 0.0, max: 1.0, step: 0.01 },
  { type: "float", name: "spikeFreq", label: "Spike frequency", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.spikeFreq, min: 0.2, max: 3.0, step: 0.05 },
  { type: "float", name: "spikeSharp", label: "Spike sharpness", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.spikeSharp, min: 1.0, max: 8.0, step: 0.1 },
  { type: "float", name: "rotSpeed", label: "Rotation speed", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.rotSpeed, min: -2.0, max: 2.0, step: 0.05 },
  { type: "float", name: "brightness", label: "Brightness", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.brightness, min: 0.2, max: 3.0, step: 0.05 },
  { type: "float", name: "fresnelGain", label: "Fresnel halo", group: "Ferrofluid", default: FERROFLUID_DEFAULTS.fresnelGain, min: 0.0, max: 4.0, step: 0.1 },
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
  { type: "float", name: "speed", label: "Simulation speed", group: "Simulation", default: REACTION_DIFFUSION_DEFAULTS.speed, min: 0.1, max: 3.0, step: 0.05 },
  { type: "float", name: "feed", label: "Base feed rate", group: "Simulation", default: REACTION_DIFFUSION_DEFAULTS.feed, min: 0.01, max: 0.09, step: 0.001 },
  { type: "float", name: "kill", label: "Base kill rate", group: "Simulation", default: REACTION_DIFFUSION_DEFAULTS.kill, min: 0.04, max: 0.08, step: 0.001 },
  { type: "float", name: "du", label: "Diffusion rate U", group: "Simulation", default: REACTION_DIFFUSION_DEFAULTS.du, min: 0.05, max: 0.3, step: 0.01 },
  { type: "float", name: "dv", label: "Diffusion rate V", group: "Simulation", default: REACTION_DIFFUSION_DEFAULTS.dv, min: 0.02, max: 0.2, step: 0.01 },
  { type: "float", name: "brightness", label: "Brightness", group: "Appearance", default: REACTION_DIFFUSION_DEFAULTS.brightness, min: 0.1, max: 3.0, step: 0.05 },
  { type: "colour", name: "colorPink", label: "Coral pink", group: "Colour", default: REACTION_DIFFUSION_DEFAULTS.colorPink },
  { type: "colour", name: "colorCobalt", label: "Cobalt blue", group: "Colour", default: REACTION_DIFFUSION_DEFAULTS.colorCobalt },
  { type: "float", name: "specular", label: "Specular gain", group: "Appearance", default: REACTION_DIFFUSION_DEFAULTS.specular, min: 0.0, max: 3.0, step: 0.05 },
];




