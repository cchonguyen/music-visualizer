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
}
export const TUNNEL_DEFAULTS: TunnelParams = {
  ringDensity: 0.5,
  beatAttackSec: 0.08,
  ringContrast: 0.5,
  ringContrastCalm: 0.25,
  pattern: 'rings',
  sides: 0,
  twist: 0,
};
export const TUNNEL_SPECS: readonly ParamSpec[] = [
  { type: 'float', name: 'ringDensity', label: 'Ring density', group: 'Walls', default: TUNNEL_DEFAULTS.ringDensity, min: 0.1, max: 2, step: 0.01 },
  { type: 'float', name: 'beatAttackSec', label: 'Beat swell attack (s)', group: 'Beat', default: TUNNEL_DEFAULTS.beatAttackSec, min: 0.01, max: 0.5, step: 0.01 },
  { type: 'float', name: 'ringContrast', label: 'Ring contrast', group: 'Walls', default: TUNNEL_DEFAULTS.ringContrast, min: 0, max: 1, step: 0.01 },
  { type: 'float', name: 'ringContrastCalm', label: 'Ring contrast (calm)', group: 'Walls', default: TUNNEL_DEFAULTS.ringContrastCalm, min: 0, max: 1, step: 0.01 },
  { type: 'enum', name: 'pattern', label: 'Wall pattern', group: 'Walls', default: TUNNEL_DEFAULTS.pattern, options: ['rings', 'grid', 'spokes', 'checker', 'stripes'] },
  { type: 'int', name: 'sides', label: 'Cross-section sides (0 = classic)', group: 'Shape', default: TUNNEL_DEFAULTS.sides, min: 0, max: 12, step: 1 },
  { type: 'float', name: 'twist', label: 'Spiral twist', group: 'Shape', default: TUNNEL_DEFAULTS.twist, min: -1, max: 1, step: 0.01 },
];

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
}
export const PARTICLE_DEFAULTS: ParticleParams = {
  brightness: 1.0,
  calmSparkleScale: 0.3,
  flashSparkleScale: 0.2,
  swirlGain: 1,
  shape: 'streak',
  rotation: 0,
  zoom: 1,
  hueShift: 0,
  hueDrift: 0,
};
export const PARTICLE_SPECS: readonly ParamSpec[] = [
  { type: 'float', name: 'brightness', label: 'Brightness', group: 'Sparkle', default: PARTICLE_DEFAULTS.brightness, min: 0, max: 2, step: 0.01 },
  { type: 'float', name: 'calmSparkleScale', label: 'Sparkle in calm', group: 'Sparkle', default: PARTICLE_DEFAULTS.calmSparkleScale, min: 0, max: 1, step: 0.01 },
  { type: 'float', name: 'flashSparkleScale', label: 'Sparkle on hi-hat flash', group: 'Sparkle', default: PARTICLE_DEFAULTS.flashSparkleScale, min: 0, max: 1, step: 0.01 },
  { type: 'float', name: 'swirlGain', label: 'Swirl (vortex when high)', group: 'Motion', default: PARTICLE_DEFAULTS.swirlGain, min: 0, max: 4, step: 0.01 },
  { type: 'enum', name: 'shape', label: 'Particle shape', group: 'Shape', default: PARTICLE_DEFAULTS.shape, options: ['streak', 'dot', 'star', 'ring'] },
  { type: 'float', name: 'rotation', label: 'Rotation (rad)', group: 'Transform', default: PARTICLE_DEFAULTS.rotation, min: -3.14, max: 3.14, step: 0.01 },
  { type: 'float', name: 'zoom', label: 'Zoom', group: 'Transform', default: PARTICLE_DEFAULTS.zoom, min: 0.5, max: 2, step: 0.01 },
  { type: 'float', name: 'hueShift', label: 'Hue shift (turns)', group: 'Colour', default: PARTICLE_DEFAULTS.hueShift, min: 0, max: 1, step: 0.01 },
  { type: 'float', name: 'hueDrift', label: 'Hue drift (turns/s)', group: 'Colour', default: PARTICLE_DEFAULTS.hueDrift, min: -0.2, max: 0.2, step: 0.005 },
];

export interface CrownParams {
  /** How far the sway moves the crown centre, as a share of its full size (1 = full sway). */
  rimFactor: number;
}
export const CROWN_DEFAULTS: CrownParams = {
  rimFactor: 1 - 0.16,
};
export const CROWN_SPECS: readonly ParamSpec[] = [
  { type: 'float', name: 'rimFactor', label: 'Sway amount on rim', group: 'Position', default: CROWN_DEFAULTS.rimFactor, min: 0, max: 1, step: 0.01 },
];

export interface RingsParams {
  maxRings: number;
  maxRingsCalm: number;
  strokeBase: number;
  strokeNormGain: number;
  sides: number; // 0 = circles, 3..12 = polygons
  style: string; // outline | filled
}
export const RINGS_DEFAULTS: RingsParams = {
  maxRings: 6,
  maxRingsCalm: 3,
  strokeBase: 0.004,
  strokeNormGain: 0.01,
  sides: 0,
  style: 'outline',
};
export const RINGS_SPECS: readonly ParamSpec[] = [
  // max 6: the rings shader loops MAX_RINGS = 6 times; raising this needs a shader change.
  { type: 'int', name: 'maxRings', label: 'Max rings', group: 'Count', default: RINGS_DEFAULTS.maxRings, min: 1, max: 6, step: 1 },
  { type: 'int', name: 'maxRingsCalm', label: 'Max rings (calm)', group: 'Count', default: RINGS_DEFAULTS.maxRingsCalm, min: 1, max: 6, step: 1 },
  { type: 'float', name: 'strokeBase', label: 'Stroke width', group: 'Stroke', default: RINGS_DEFAULTS.strokeBase, min: 0, max: 0.02, step: 0.0005 },
  { type: 'float', name: 'strokeNormGain', label: 'Stroke follows spectrum', group: 'Stroke', default: RINGS_DEFAULTS.strokeNormGain, min: 0, max: 0.05, step: 0.0005 },
  { type: 'int', name: 'sides', label: 'Shape sides (0 = circle)', group: 'Shape', default: RINGS_DEFAULTS.sides, min: 0, max: 12, step: 1 },
  { type: 'enum', name: 'style', label: 'Style', group: 'Shape', default: RINGS_DEFAULTS.style, options: ['outline', 'filled'] },
];

export interface ShockwaveParams {
  ringStart: number;
  ringEnd: number;
  ringSec: number;
  style: string; // ring | glow (V4)
}
export const SHOCKWAVE_DEFAULTS: ShockwaveParams = {
  ringStart: 0.16,
  ringEnd: 0.85,
  ringSec: 0.35,
  style: 'ring',
};
export const SHOCKWAVE_SPECS: readonly ParamSpec[] = [
  { type: 'float', name: 'ringStart', label: 'Start radius', group: 'Size', default: SHOCKWAVE_DEFAULTS.ringStart, min: 0, max: 1, step: 0.01 },
  { type: 'float', name: 'ringEnd', label: 'End radius', group: 'Size', default: SHOCKWAVE_DEFAULTS.ringEnd, min: 0, max: 1, step: 0.01 },
  { type: 'float', name: 'ringSec', label: 'Travel time (s)', group: 'Timing', default: SHOCKWAVE_DEFAULTS.ringSec, min: 0.05, max: 2, step: 0.01 },
  { type: 'enum', name: 'style', label: 'Kick style', group: 'Shape', default: SHOCKWAVE_DEFAULTS.style, options: ['ring', 'glow'] },
];

export interface WaveformParams {
  mode: string; // line | circle (V5)
  amplitude: number; // 0..1.5, how tall the wave is
}
export const WAVEFORM_DEFAULTS: WaveformParams = { mode: 'line', amplitude: 1 };
export const WAVEFORM_SPECS: readonly ParamSpec[] = [
  { type: 'enum', name: 'mode', label: 'Wave shape', group: 'Waveform', default: WAVEFORM_DEFAULTS.mode, options: ['line', 'circle'] },
  { type: 'float', name: 'amplitude', label: 'Amplitude', group: 'Waveform', default: WAVEFORM_DEFAULTS.amplitude, min: 0, max: 1.5, step: 0.01 },
];

/** Every built-in layer's settings, keyed by layer type. Used by the loader in slice 4.3. */
export const LAYER_SPECS: Readonly<Record<string, readonly ParamSpec[]>> = {
  tunnel: TUNNEL_SPECS,
  particles: PARTICLE_SPECS,
  crown: CROWN_SPECS,
  rings: RINGS_SPECS,
  shockwave: SHOCKWAVE_SPECS,
  // Bars have no settings yet (their count is still in barsState.ts).
  bars: [],
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
  { type: 'float', name: 'zoom', label: 'Zoom', group: 'Motion', default: 1, min: 0.8, max: 1.25, step: 0.001 },
  { type: 'float', name: 'rotate', label: 'Rotate (rad/frame)', group: 'Motion', default: 0, min: -0.05, max: 0.05, step: 0.0005 },
  { type: 'float', name: 'centreX', label: 'Centre X', group: 'Motion', default: 0, min: -0.5, max: 0.5, step: 0.01 },
  { type: 'float', name: 'centreY', label: 'Centre Y', group: 'Motion', default: 0, min: -0.5, max: 0.5, step: 0.01 },
  { type: 'float', name: 'driftX', label: 'Drift X', group: 'Motion', default: 0, min: -0.01, max: 0.01, step: 0.0001 },
  { type: 'float', name: 'driftY', label: 'Drift Y', group: 'Motion', default: 0, min: -0.01, max: 0.01, step: 0.0001 },
  { type: 'float', name: 'stretchX', label: 'Stretch X', group: 'Motion', default: 1, min: 0.5, max: 2, step: 0.01 },
  { type: 'float', name: 'stretchY', label: 'Stretch Y', group: 'Motion', default: 1, min: 0.5, max: 2, step: 0.01 },
  { type: 'float', name: 'warp', label: 'Wave warp', group: 'Warp', default: 0, min: 0, max: 1, step: 0.01 },
  { type: 'float', name: 'warpScale', label: 'Wave count', group: 'Warp', default: 1, min: 0.1, max: 4, step: 0.01 },
  { type: 'float', name: 'warpSpeed', label: 'Wave speed', group: 'Warp', default: 1, min: 0, max: 5, step: 0.01 },
  { type: 'float', name: 'decay', label: 'Persistence', group: 'Trail', default: 0.92, min: 0.5, max: 1, step: 0.001 },
  { type: 'float', name: 'fade', label: 'Fade per frame', group: 'Trail', default: 0.004, min: 0, max: 0.02, step: 0.0005 },
  { type: 'enum', name: 'wrap', label: 'Edges', group: 'Trail', default: 'clamp', options: ['clamp', 'wrap'] },
  { type: 'float', name: 'hueDrift', label: 'Hue drift (rad/frame)', group: 'Colour', default: 0, min: -0.1, max: 0.1, step: 0.001 },
  { type: 'float', name: 'blur', label: 'Trail blur', group: 'Colour', default: 0, min: 0, max: 1, step: 0.01 },
];
