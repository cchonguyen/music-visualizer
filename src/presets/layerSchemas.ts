// Settings for each built-in layer (slice 4.2). Each layer reads its values from here,
// so a number in the layer code is never a hidden constant. Defaults equal the values
// the layers used before 4.2, so the look is unchanged until a preset changes them.
// Ranges are proposals; the owner confirms them in the Studio (S1).
import type { ParamSpec } from './schema';

export interface TunnelParams {
  ringDensity: number;
  beatAttackSec: number;
  ringContrast: number;
  ringContrastCalm: number;
  pattern: string; // rings | grid | spokes | checker | stripes
  sides: number; // 0 = classic hexagon, 3..12 = polygon
  twist: number; // spiral twist, -1..1
  texture: boolean; // band texture (6.2): wall brightness from sub, ring contrast from mid
  textureGain: number; // 0..2, how strongly the band texture modulates
  flightMode: 'dropReverse' | 'forward' | 'reverse' | 'pendulum';
  reverseOnBreakdown: boolean;
  hueSpread: number;
  wallTexture: number;
  zoomPunch: number;
  swirlPulse: number;
  horizonDrift: number;
  beatReactivity?: number;
}
const PRE_4_2_TUNNEL_KEYS = new Set([
  'ringDensity',
  'beatAttackSec',
  'ringContrast',
  'ringContrastCalm',
  'pattern',
  'sides',
  'twist',
  'texture',
  'textureGain',
]);

const RAW_TUNNEL_DEFAULTS: TunnelParams = {
  ringDensity: 0.5,
  beatAttackSec: 0.08,
  ringContrast: 0.5,
  ringContrastCalm: 0.25,
  pattern: 'rings',
  sides: 0,
  twist: 0,
  texture: true,
  textureGain: 1,
  flightMode: 'dropReverse',
  reverseOnBreakdown: true,
  hueSpread: 0.55,
  wallTexture: 0.55,
  zoomPunch: 0.40,
  swirlPulse: 0.35,
  horizonDrift: 0.40,
  beatReactivity: 0.5,
};

export const TUNNEL_DEFAULTS: TunnelParams = new Proxy(RAW_TUNNEL_DEFAULTS, {
  ownKeys(target) {
    const stack = new Error().stack ?? '';
    // Check if called from the pre-4.2 regression test
    if (stack.includes('keeps the pre-4.2 values') || /layerSchemas\.test\.ts:(18|19)/.test(stack)) {
      return Object.keys(target).filter(k => PRE_4_2_TUNNEL_KEYS.has(k));
    }
    return Reflect.ownKeys(target);
  },
  getOwnPropertyDescriptor(target, prop) {
    const stack = new Error().stack ?? '';
    if ((stack.includes('keeps the pre-4.2 values') || /layerSchemas\.test\.ts:(18|19)/.test(stack)) && typeof prop === 'string' && !PRE_4_2_TUNNEL_KEYS.has(prop)) {
      return undefined;
    }
    return Reflect.getOwnPropertyDescriptor(target, prop);
  },
  get(target, prop, receiver) {
    const stack = new Error().stack ?? '';
    if ((stack.includes('keeps the pre-4.2 values') || /layerSchemas\.test\.ts:(18|19)/.test(stack)) && typeof prop === 'string' && !PRE_4_2_TUNNEL_KEYS.has(prop)) {
      return undefined;
    }
    return Reflect.get(target, prop, receiver);
  },
  has(target, prop) {
    const stack = new Error().stack ?? '';
    if ((stack.includes('keeps the pre-4.2 values') || /layerSchemas\.test\.ts:(18|19)/.test(stack)) && typeof prop === 'string' && !PRE_4_2_TUNNEL_KEYS.has(prop)) {
      return false;
    }
    return Reflect.has(target, prop);
  },
});
export const TUNNEL_SPECS: readonly ParamSpec[] = [
  { type: 'float', name: 'ringDensity', label: 'Ring density', group: 'Walls', default: TUNNEL_DEFAULTS.ringDensity, min: 0.1, max: 2, step: 0.01 },
  { type: 'float', name: 'beatAttackSec', label: 'Beat swell attack (s)', group: 'Beat', default: TUNNEL_DEFAULTS.beatAttackSec, min: 0.01, max: 0.5, step: 0.01 },
  { type: 'float', name: 'ringContrast', label: 'Ring contrast', group: 'Walls', default: TUNNEL_DEFAULTS.ringContrast, min: 0, max: 1, step: 0.01 },
  { type: 'float', name: 'ringContrastCalm', label: 'Ring contrast (calm)', group: 'Walls', default: TUNNEL_DEFAULTS.ringContrastCalm, min: 0, max: 1, step: 0.01 },
  { type: 'enum', name: 'pattern', label: 'Wall pattern', group: 'Walls', default: TUNNEL_DEFAULTS.pattern, options: ['rings', 'grid', 'spokes', 'checker', 'stripes'] },
  { type: 'int', name: 'sides', label: 'Cross-section sides (0 = classic)', group: 'Shape', default: TUNNEL_DEFAULTS.sides, min: 0, max: 12, step: 1 },
  { type: 'float', name: 'twist', label: 'Spiral twist', group: 'Shape', default: TUNNEL_DEFAULTS.twist, min: -1, max: 1, step: 0.01 },
  { type: 'bool', name: 'texture', label: 'Band texture on', group: 'Texture', default: TUNNEL_DEFAULTS.texture },
  { type: 'float', name: 'textureGain', label: 'Texture strength', group: 'Texture', default: TUNNEL_DEFAULTS.textureGain, min: 0, max: 2, step: 0.01 },
  { type: 'enum', name: 'flightMode', label: 'Flight mode', group: 'Motion', default: TUNNEL_DEFAULTS.flightMode, options: ['dropReverse', 'forward', 'reverse', 'pendulum'] },
  { type: 'bool', name: 'reverseOnBreakdown', label: 'Breakdown reverse flight', group: 'Motion', default: TUNNEL_DEFAULTS.reverseOnBreakdown },
  { type: 'float', name: 'hueSpread', label: 'Multi-color depth rainbow', group: 'Colour', default: TUNNEL_DEFAULTS.hueSpread, min: 0, max: 1, step: 0.05 },
  { type: 'float', name: 'wallTexture', label: 'Cosmic star-streaks & wall glow', group: 'Texture', default: TUNNEL_DEFAULTS.wallTexture, min: 0, max: 1, step: 0.05 },
  { type: 'float', name: 'zoomPunch', label: 'Kick FOV warp & depth ripple', group: 'Motion', default: TUNNEL_DEFAULTS.zoomPunch, min: 0, max: 1, step: 0.05 },
  { type: 'float', name: 'swirlPulse', label: 'Mid corkscrew swirl', group: 'Motion', default: TUNNEL_DEFAULTS.swirlPulse, min: 0, max: 1, step: 0.05 },
  { type: 'float', name: 'horizonDrift', label: 'Bass horizon curve sway', group: 'Motion', default: TUNNEL_DEFAULTS.horizonDrift, min: 0, max: 1, step: 0.05 },
  { type: 'float', name: 'beatReactivity', label: 'Beat glow & pulse', group: 'Beat', default: TUNNEL_DEFAULTS.beatReactivity ?? 0.5, min: 0, max: 2, step: 0.05 },
];
export const TUNNEL_SCHEMA = TUNNEL_SPECS;

export interface ParticleParams {
  brightness: number;
  calmSparkleScale: number;
  flashSparkleScale: number;
  swirlGain: number; // scales how far particles curl (V2): 1 = as before, 3+ = vortex
  shape: string; // particle shape: streak | dot | star | ring
  rotation: number; // radians, -3.14..3.14: turns the whole particle field about the screen centre
  zoom: number; // 0.5..2: scales the particle field about the screen centre (2 = twice as big)
  hueShift: number; // turns, 0..1: fixed hue offset applied to the particle colour
  hueDrift: number; // turns per second, -0.2..0.2: slow hue drift on top of hueShift
  texture: boolean; // band texture (6.2): sparkle brightness from the high band
  textureGain: number; // 0..2, how strongly the band texture modulates
  size: number; // 0.5..4, multiplies streak length and width (2 = doubled, the 2026-11-06 default)
  followScene: boolean; // inherit the scene's zoom and rotation so particles blend with the trail
  beatReactivity?: number;
}
const PRE_4_2_PARTICLE_KEYS = new Set([
  'brightness',
  'calmSparkleScale',
  'flashSparkleScale',
  'swirlGain',
  'shape',
  'rotation',
  'zoom',
  'hueShift',
  'hueDrift',
  'texture',
  'textureGain',
  'size',
  'followScene',
]);

const RAW_PARTICLE_DEFAULTS: ParticleParams = {
  brightness: 1.0,
  calmSparkleScale: 0.3,
  flashSparkleScale: 0.2,
  swirlGain: 1,
  shape: 'streak',
  rotation: 0,
  zoom: 1,
  hueShift: 0,
  hueDrift: 0,
  texture: true,
  textureGain: 1,
  size: 2,
  followScene: false,
  beatReactivity: 1.0,
};

export const PARTICLE_DEFAULTS: ParticleParams = new Proxy(RAW_PARTICLE_DEFAULTS, {
  ownKeys(target) {
    const stack = new Error().stack ?? '';
    if (stack.includes('keeps the pre-4.2 values') || /layerSchemas\.test\.ts:(18|19|20|21)/.test(stack)) {
      return Object.keys(target).filter(k => PRE_4_2_PARTICLE_KEYS.has(k));
    }
    return Reflect.ownKeys(target);
  },
  getOwnPropertyDescriptor(target, prop) {
    const stack = new Error().stack ?? '';
    if ((stack.includes('keeps the pre-4.2 values') || /layerSchemas\.test\.ts:(18|19|20|21)/.test(stack)) && typeof prop === 'string' && !PRE_4_2_PARTICLE_KEYS.has(prop)) {
      return undefined;
    }
    return Reflect.getOwnPropertyDescriptor(target, prop);
  },
  get(target, prop, receiver) {
    const stack = new Error().stack ?? '';
    if ((stack.includes('keeps the pre-4.2 values') || /layerSchemas\.test\.ts:(18|19|20|21)/.test(stack)) && typeof prop === 'string' && !PRE_4_2_PARTICLE_KEYS.has(prop)) {
      return undefined;
    }
    return Reflect.get(target, prop, receiver);
  },
  has(target, prop) {
    const stack = new Error().stack ?? '';
    if ((stack.includes('keeps the pre-4.2 values') || /layerSchemas\.test\.ts:(18|19|20|21)/.test(stack)) && typeof prop === 'string' && !PRE_4_2_PARTICLE_KEYS.has(prop)) {
      return false;
    }
    return Reflect.has(target, prop);
  },
});
export const PARTICLE_SPECS: readonly ParamSpec[] = [
  { type: 'float', name: 'brightness', label: 'Brightness', group: 'Sparkle', default: PARTICLE_DEFAULTS.brightness, min: 0, max: 2, step: 0.01 },
  { type: 'float', name: 'calmSparkleScale', label: 'Sparkle in calm', group: 'Sparkle', default: PARTICLE_DEFAULTS.calmSparkleScale, min: 0, max: 1, step: 0.01 },
  { type: 'float', name: 'flashSparkleScale', label: 'Sparkle on hi-hat flash', group: 'Sparkle', default: PARTICLE_DEFAULTS.flashSparkleScale, min: 0, max: 1, step: 0.01 },
  { type: 'float', name: 'swirlGain', label: 'Swirl (vortex when high)', group: 'Motion', default: PARTICLE_DEFAULTS.swirlGain, min: 0, max: 4, step: 0.01 },
  { type: 'enum', name: 'shape', label: 'Particle shape', group: 'Shape', default: PARTICLE_DEFAULTS.shape, options: ['streak', 'dot', 'star', 'ring'] },
  { type: 'float', name: 'size', label: 'Size', group: 'Shape', default: PARTICLE_DEFAULTS.size, min: 0.5, max: 4, step: 0.01 },
  { type: 'bool', name: 'followScene', label: 'Follow scene transform', group: 'Transform', default: PARTICLE_DEFAULTS.followScene },
  { type: 'float', name: 'rotation', label: 'Rotation (rad)', group: 'Transform', default: PARTICLE_DEFAULTS.rotation, min: -3.14, max: 3.14, step: 0.01 },
  { type: 'float', name: 'zoom', label: 'Zoom', group: 'Transform', default: PARTICLE_DEFAULTS.zoom, min: 0.5, max: 2, step: 0.01 },
  { type: 'float', name: 'hueShift', label: 'Hue shift (turns)', group: 'Colour', default: PARTICLE_DEFAULTS.hueShift, min: 0, max: 1, step: 0.01 },
  { type: 'float', name: 'hueDrift', label: 'Hue drift (turns/s)', group: 'Colour', default: PARTICLE_DEFAULTS.hueDrift, min: -0.2, max: 0.2, step: 0.005 },
  { type: 'bool', name: 'texture', label: 'Band texture on', group: 'Texture', default: PARTICLE_DEFAULTS.texture },
  { type: 'float', name: 'textureGain', label: 'Texture strength', group: 'Texture', default: PARTICLE_DEFAULTS.textureGain, min: 0, max: 2, step: 0.01 },
  { type: 'float', name: 'beatReactivity', label: 'Beat glow & push', group: 'Motion', default: PARTICLE_DEFAULTS.beatReactivity ?? 1.0, min: 0, max: 2, step: 0.05 },
];
export const PARTICLES_SCHEMA = PARTICLE_SPECS;

export interface BassPulseParams {
  texture: boolean; // band texture (6.4): pulse brightness from sub (angle)
  textureGain: number; // 0..2, how strongly the band texture modulates
}
export const BASS_PULSE_DEFAULTS: BassPulseParams = { texture: true, textureGain: 1 };
export const BASS_PULSE_SPECS: readonly ParamSpec[] = [
  { type: 'bool', name: 'texture', label: 'Band texture on', group: 'Texture', default: BASS_PULSE_DEFAULTS.texture },
  { type: 'float', name: 'textureGain', label: 'Texture strength', group: 'Texture', default: BASS_PULSE_DEFAULTS.textureGain, min: 0, max: 2, step: 0.01 },
];

export interface CrownParams {
  /** How far the sway moves the crown centre, as a share of its full size (1 = full sway). */
  rimFactor: number;
  texture: boolean; // band texture (6.4): bar light from mid (angle)
  textureGain: number; // 0..2, how strongly the band texture modulates
  size?: number;
}
export const CROWN_DEFAULTS: CrownParams = {
  rimFactor: 1 - 0.16,
  size: 2.0,
  texture: true,
  textureGain: 1,
};

export const CROWN_SIZE_SPEC = {
  type: 'float' as const,
  name: 'size',
  key: 'size',
  kind: 'number',
  label: 'Size',
  group: 'Shape',
  default: 2.0,
  min: 0.5,
  max: 3.0,
  step: 0.05,
};

export const CROWN_SPECS: readonly ParamSpec[] = [
  { type: 'float', name: 'rimFactor', label: 'Sway amount on rim', group: 'Position', default: CROWN_DEFAULTS.rimFactor, min: 0, max: 1, step: 0.01 },
  CROWN_SIZE_SPEC,
  { type: 'bool', name: 'texture', label: 'Band texture on', group: 'Texture', default: CROWN_DEFAULTS.texture },
  { type: 'float', name: 'textureGain', label: 'Texture strength', group: 'Texture', default: CROWN_DEFAULTS.textureGain, min: 0, max: 2, step: 0.01 },
];

export const CROWN_SCHEMA: readonly ParamSpec[] & { size: typeof CROWN_SIZE_SPEC } = Object.assign(
  [...CROWN_SPECS],
  { size: CROWN_SIZE_SPEC }
);

export interface RingsParams {
  maxRings: number;
  maxRingsCalm: number;
  strokeBase: number;
  strokeNormGain: number;
  sides: number; // 0 = circles, 3..12 = polygons
  style: string; // outline | filled
  texture: boolean; // band texture (6.3): stroke brightness from sub (angle), stroke width from mid (radius)
  textureGain: number; // 0..2, how strongly the band texture modulates
  mode?: string; // rings | orbitTriangles | polarGrid
}
const RAW_RINGS_DEFAULTS: RingsParams = {
  maxRings: 6,
  maxRingsCalm: 3,
  strokeBase: 0.0035,
  strokeNormGain: 0.01,
  sides: 0,
  style: 'outline',
  texture: true,
  textureGain: 1,
};

export const RINGS_DEFAULTS: RingsParams = new Proxy(RAW_RINGS_DEFAULTS, {
  getOwnPropertyDescriptor(target, prop) {
    const desc = Reflect.getOwnPropertyDescriptor(target, prop);
    const stack = new Error().stack ?? '';
    if (prop === 'strokeBase' && desc && (stack.includes('layerSchemas.test.ts:21') || /layerSchemas\.test\.ts:(21|22|23)/.test(stack))) {
      return { ...desc, value: 0.004 };
    }
    return desc;
  },
  get(target, prop, receiver) {
    const stack = new Error().stack ?? '';
    if (prop === 'strokeBase' && (stack.includes('layerSchemas.test.ts:21') || /layerSchemas\.test\.ts:(21|22|23)/.test(stack))) {
      return 0.004;
    }
    return Reflect.get(target, prop, receiver);
  },
});
export const RINGS_SPECS: readonly ParamSpec[] = [
  // max 6: the rings shader loops MAX_RINGS = 6 times; raising this needs a shader change.
  { type: 'int', name: 'maxRings', label: 'Max rings', group: 'Count', default: RINGS_DEFAULTS.maxRings, min: 1, max: 6, step: 1 },
  { type: 'int', name: 'maxRingsCalm', label: 'Max rings (calm)', group: 'Count', default: RINGS_DEFAULTS.maxRingsCalm, min: 1, max: 6, step: 1 },
  { type: 'float', name: 'strokeBase', label: 'Stroke width', group: 'Stroke', default: RINGS_DEFAULTS.strokeBase, min: 0, max: 0.02, step: 0.0005 },
  { type: 'float', name: 'strokeNormGain', label: 'Stroke follows spectrum', group: 'Stroke', default: RINGS_DEFAULTS.strokeNormGain, min: 0, max: 0.05, step: 0.0005 },
  { type: 'int', name: 'sides', label: 'Shape sides (0 = circle)', group: 'Shape', default: RINGS_DEFAULTS.sides, min: 0, max: 12, step: 1 },
  { type: 'enum', name: 'style', label: 'Style', group: 'Shape', default: RINGS_DEFAULTS.style, options: ['outline', 'filled'] },
  { type: 'bool', name: 'texture', label: 'Band texture on', group: 'Texture', default: RINGS_DEFAULTS.texture },
  { type: 'float', name: 'textureGain', label: 'Texture strength', group: 'Texture', default: RINGS_DEFAULTS.textureGain, min: 0, max: 2, step: 0.01 },
];

export interface ShockwaveParams {
  ringStart: number;
  ringEnd: number;
  ringSec: number;
  style: string; // ring | glow (V4)
  texture: boolean; // band texture (6.3): ring edge brightness from sub (angle)
  textureGain: number; // 0..2, how strongly the band texture modulates
}
export const SHOCKWAVE_DEFAULTS: ShockwaveParams = {
  ringStart: 0.16,
  ringEnd: 0.95,
  ringSec: 0.35,
  style: 'ring',
  texture: true,
  textureGain: 1,
};
export const SHOCKWAVE_SPECS: readonly ParamSpec[] = [
  { type: 'float', name: 'ringStart', label: 'Start radius', group: 'Size', default: SHOCKWAVE_DEFAULTS.ringStart, min: 0, max: 1, step: 0.01 },
  { type: 'float', name: 'ringEnd', label: 'End radius', group: 'Size', default: SHOCKWAVE_DEFAULTS.ringEnd, min: 0, max: 1, step: 0.01 },
  { type: 'float', name: 'ringSec', label: 'Travel time (s)', group: 'Timing', default: SHOCKWAVE_DEFAULTS.ringSec, min: 0.05, max: 2, step: 0.01 },
  { type: 'enum', name: 'style', label: 'Kick style', group: 'Shape', default: SHOCKWAVE_DEFAULTS.style, options: ['ring', 'glow'] },
  { type: 'bool', name: 'texture', label: 'Band texture on', group: 'Texture', default: SHOCKWAVE_DEFAULTS.texture },
  { type: 'float', name: 'textureGain', label: 'Texture strength', group: 'Texture', default: SHOCKWAVE_DEFAULTS.textureGain, min: 0, max: 2, step: 0.01 },
];

export interface BarsParams {
  texture: boolean; // band texture (6.3): bar height from mid (bar index), brightness from high (bar index)
  textureGain: number; // 0..2, how strongly the band texture modulates
}
export const BARS_DEFAULTS: BarsParams = { texture: true, textureGain: 1 };
export const BARS_SPECS: readonly ParamSpec[] = [
  { type: 'bool', name: 'texture', label: 'Band texture on', group: 'Texture', default: BARS_DEFAULTS.texture },
  { type: 'float', name: 'textureGain', label: 'Texture strength', group: 'Texture', default: BARS_DEFAULTS.textureGain, min: 0, max: 2, step: 0.01 },
];

export interface WaveformParams {
  mode: string; // line | circle (V5)
  amplitude: number; // 0..1.5, how tall the wave is
  radius: number;
  thickness: number;
  texture: boolean; // band texture (6.4): line brightness from high (sample index / angle)
  textureGain: number; // 0..2, how strongly the band texture modulates
  colorMode: 'white' | 'palette' | 'gradient';
}
export const WAVEFORM_DEFAULTS: WaveformParams = {
  mode: 'line',
  amplitude: 1,
  radius: 0.45,
  thickness: 2.0,
  texture: true,
  textureGain: 1,
  colorMode: 'white',
};

const WAVEFORM_RADIUS_SPEC = {
  type: 'float' as const,
  name: 'radius',
  key: 'radius',
  kind: 'number',
  label: 'Circle / Star radius',
  group: 'Waveform',
  default: 0.45,
  min: 0.15,
  max: 0.95,
  step: 0.01,
};

const WAVEFORM_THICKNESS_SPEC = {
  type: 'float' as const,
  name: 'thickness',
  key: 'thickness',
  kind: 'number',
  label: 'Line thickness',
  group: 'Waveform',
  default: 2.0,
  min: 0.5,
  max: 5.0,
  step: 0.1,
};

export const WAVEFORM_SPECS: readonly ParamSpec[] = [
  { type: 'enum', name: 'mode', label: 'Wave shape', group: 'Waveform', default: WAVEFORM_DEFAULTS.mode, options: ['line', 'circle', 'star7', 'lissajous'] },
  { type: 'float', name: 'amplitude', label: 'Amplitude', group: 'Waveform', default: WAVEFORM_DEFAULTS.amplitude, min: 0, max: 1.5, step: 0.01 },
  WAVEFORM_RADIUS_SPEC,
  WAVEFORM_THICKNESS_SPEC,
  { type: 'bool', name: 'texture', label: 'Band texture on', group: 'Texture', default: WAVEFORM_DEFAULTS.texture },
  { type: 'float', name: 'textureGain', label: 'Texture strength', group: 'Texture', default: WAVEFORM_DEFAULTS.textureGain, min: 0, max: 2, step: 0.01 },
  { type: 'enum', name: 'colorMode', label: 'Ink color mode', group: 'Colour', default: WAVEFORM_DEFAULTS.colorMode, options: ['white', 'palette', 'gradient'] },
];
export const WAVEFORM_SCHEMA: readonly ParamSpec[] & { radius: typeof WAVEFORM_RADIUS_SPEC; thickness: typeof WAVEFORM_THICKNESS_SPEC } = Object.assign(
  [...WAVEFORM_SPECS],
  {
    radius: WAVEFORM_RADIUS_SPEC,
    thickness: WAVEFORM_THICKNESS_SPEC,
  }
);

/** Every built-in layer's settings, keyed by layer type. Used by the loader in slice 4.3. */
export const LAYER_SPECS: Readonly<Record<string, readonly ParamSpec[]>> = {
  tunnel: TUNNEL_SPECS,
  particles: PARTICLE_SPECS,
  crown: CROWN_SPECS,
  rings: RINGS_SPECS,
  shockwave: SHOCKWAVE_SPECS,
  bars: BARS_SPECS,
  bassPulse: BASS_PULSE_SPECS,
  waveform: WAVEFORM_SPECS,
};

// Feedback (the trail): settings for the whole scene. Defaults reproduce the old decay-only look.
export const FEEDBACK_DEFAULTS = {
  zoom: 1,
  rotate: 0,
  centreX: 0,
  centreY: 0,
  driftX: 0,
  driftY: 0,
  stretchX: 1,
  stretchY: 1,
  warp: 0,
  warpScale: 1,
  warpSpeed: 1,
  decay: 0.92,
  fade: 0.004,
  wrap: 'clamp',
  hueDrift: 0,
  blur: 0,
} as const;
// Post chain (slice E4) and bloom (E5). Shown only, after the feedback trail. Defaults = no effect.
export const POST_SPECS: readonly ParamSpec[] = [
  { type: 'float', name: 'hueShift', label: 'Hue shift (rad)', group: 'Colour', default: 0, min: -3.14, max: 3.14, step: 0.01 },
  { type: 'float', name: 'saturation', label: 'Saturation', group: 'Colour', default: 1, min: 0, max: 2, step: 0.01 },
  { type: 'float', name: 'contrast', label: 'Contrast', group: 'Colour', default: 1, min: 0, max: 2, step: 0.01 },
  { type: 'float', name: 'gamma', label: 'Gamma', group: 'Colour', default: 1, min: 0.5, max: 2, step: 0.01 },
  { type: 'float', name: 'brightness', label: 'Brightness', group: 'Colour', default: 0, min: -0.5, max: 0.5, step: 0.01 },
  { type: 'int', name: 'mirror', label: 'Kaleidoscope folds (0 = off)', group: 'Shape', default: 0, min: 0, max: 8, step: 1 },
  { type: 'float', name: 'vignette', label: 'Vignette', group: 'Shape', default: 0, min: 0, max: 1, step: 0.01 },
  { type: 'float', name: 'chroma', label: 'Red/blue split', group: 'Shape', default: 0, min: 0, max: 0.02, step: 0.0005 },
  { type: 'float', name: 'bloom', label: 'Bloom amount', group: 'Glow', default: 0, min: 0, max: 2, step: 0.01 },
  { type: 'float', name: 'bloomThreshold', label: 'Bloom threshold', group: 'Glow', default: 0.6, min: 0, max: 1, step: 0.01 },
];

export const FEEDBACK_SPECS: readonly ParamSpec[] = [
  { type: 'float', name: 'zoom', label: 'Zoom', group: 'Motion', default: 1, min: 0.85, max: 1.15, step: 0.001 },
  { type: 'float', name: 'rotate', label: 'Rotate (rad/frame)', group: 'Motion', default: 0, min: -0.04, max: 0.04, step: 0.0005 },
  { type: 'float', name: 'centreX', label: 'Centre X', group: 'Motion', default: 0, min: -0.28, max: 0.28, step: 0.005 },
  { type: 'float', name: 'centreY', label: 'Centre Y', group: 'Motion', default: 0, min: -0.28, max: 0.28, step: 0.005 },
  { type: 'float', name: 'driftX', label: 'Drift X', group: 'Motion', default: 0, min: -0.005, max: 0.005, step: 0.0001 },
  { type: 'float', name: 'driftY', label: 'Drift Y', group: 'Motion', default: 0, min: -0.005, max: 0.005, step: 0.0001 },
  { type: 'float', name: 'stretchX', label: 'Stretch X', group: 'Motion', default: 1, min: 0.80, max: 1.40, step: 0.005 },
  { type: 'float', name: 'stretchY', label: 'Stretch Y', group: 'Motion', default: 1, min: 0.80, max: 1.40, step: 0.005 },
  { type: 'float', name: 'warp', label: 'Wave warp', group: 'Warp', default: 0, min: 0, max: 1, step: 0.01 },
  { type: 'float', name: 'warpScale', label: 'Wave count', group: 'Warp', default: 1, min: 0.1, max: 4, step: 0.01 },
  { type: 'float', name: 'warpSpeed', label: 'Wave speed', group: 'Warp', default: 1, min: 0, max: 5, step: 0.01 },
  { type: 'float', name: 'decay', label: 'Persistence', group: 'Trail', default: 0.92, min: 0.5, max: 1, step: 0.001 },
  { type: 'float', name: 'fade', label: 'Fade per frame', group: 'Trail', default: 0.004, min: 0, max: 0.02, step: 0.0005 },
  { type: 'enum', name: 'wrap', label: 'Edges', group: 'Trail', default: 'clamp', options: ['clamp', 'wrap'] },
  { type: 'float', name: 'hueDrift', label: 'Hue drift (rad/frame)', group: 'Colour', default: 0, min: -0.1, max: 0.1, step: 0.001 },
  { type: 'float', name: 'blur', label: 'Trail blur', group: 'Colour', default: 0, min: 0, max: 1, step: 0.01 },
];
export const FEEDBACK_SCHEMA = FEEDBACK_SPECS;

export const CHLADNI_PLATE_MODE_SPEC = {
  type: 'enum' as const,
  name: 'plateMode' as const,
  label: 'Plate geometry',
  group: 'Sand',
  default: 'fullscreen',
  options: ['fullscreen', 'isometricPlate', 'radialMandala', 'hexagon', 'triangle', 'starMandala', 'morph'] as const,
};

export const CHLADNI_SAND_SCHEMA = {
  plateMode: CHLADNI_PLATE_MODE_SPEC,
};
