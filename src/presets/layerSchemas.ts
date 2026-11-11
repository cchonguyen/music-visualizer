// Settings for each built-in layer (slice 4.2). Each layer reads its values from here,
// so a number in the layer code is never a hidden constant. Defaults equal the values
// the layers used before 4.2, so the look is unchanged until a preset changes them.
// Ranges are proposals; the owner confirms them in the Studio (S1).
import { COLOUR_MAP_INDEXES, GRADIENT_DEFAULT_A, GRADIENT_DEFAULT_B, GRADIENT_NAMES } from '../render/colourMap';
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

export const TUNNEL_DEFAULTS: TunnelParams = {
  ringDensity: 0.5,
  beatAttackSec: 0.08,
  ringContrast: 0.5,
  ringContrastCalm: 0.25,
  pattern: 'rings',
  sides: 0,
  twist: 0,
  texture: false,
  textureGain: 1,
  flightMode: 'dropReverse',
  reverseOnBreakdown: true,
  hueSpread: 0.55,
  wallTexture: 0.55,
  zoomPunch: 0.0,
  swirlPulse: 0.35,
  horizonDrift: 0.40,
  beatReactivity: 0.5,
};

export const TUNNEL_SPECS: readonly ParamSpec[] = [
  { type: 'float', name: 'ringDensity', label: 'Ring density', group: 'Walls', default: TUNNEL_DEFAULTS.ringDensity, min: 0.1, max: 2, step: 0.01, description: 'Controls the spatial frequency of concentric tunnel depth segments.' },
  { type: 'float', name: 'beatAttackSec', label: 'Beat swell attack (s)', group: 'Beat', default: TUNNEL_DEFAULTS.beatAttackSec, min: 0.01, max: 0.5, step: 0.01, description: 'Sets the attack response duration for beat-driven tunnel dilation.' },
  { type: 'float', name: 'ringContrast', label: 'Ring contrast', group: 'Walls', default: TUNNEL_DEFAULTS.ringContrast, min: 0, max: 1, step: 0.01, description: 'Adjusts depth ring brightness contrast during active musical passages.' },
  { type: 'float', name: 'ringContrastCalm', label: 'Ring contrast (calm)', group: 'Walls', default: TUNNEL_DEFAULTS.ringContrastCalm, min: 0, max: 1, step: 0.01, description: 'Adjusts depth ring brightness contrast during quiet breakdown sections.' },
  { type: 'enum', name: 'pattern', label: 'Wall pattern', group: 'Walls', default: TUNNEL_DEFAULTS.pattern, options: ['rings', 'grid', 'spokes', 'checker', 'stripes'], description: 'Selects geometric wall texture patterns drawn along the tunnel cylinder.' },
  { type: 'int', name: 'sides', label: 'Cross-section sides (0 = classic)', group: 'Shape', default: TUNNEL_DEFAULTS.sides, min: 0, max: 12, step: 1, description: 'Sets the polygonal cross-section side count, where 0 produces a smooth cylinder.' },
  { type: 'float', name: 'twist', label: 'Spiral twist', group: 'Shape', default: TUNNEL_DEFAULTS.twist, min: -1, max: 1, step: 0.01, description: 'Applies continuous angular torsion and spiral twisting along tunnel depth.' },
  { type: 'bool', name: 'texture', label: 'Band texture on', group: 'Texture', default: TUNNEL_DEFAULTS.texture, description: 'Enables audio-reactive texture modulation across tunnel surfaces.' },
  { type: 'float', name: 'textureGain', label: 'Texture strength', group: 'Texture', default: TUNNEL_DEFAULTS.textureGain, min: 0, max: 2, step: 0.01, description: 'Scales the modulation intensity of audio-reactive wall textures.' },
  { type: 'enum', name: 'flightMode', label: 'Flight mode', group: 'Motion', default: TUNNEL_DEFAULTS.flightMode, options: ['dropReverse', 'forward', 'reverse', 'pendulum'], description: 'Chooses camera navigation trajectory and flight reversal behavior.' },
  { type: 'bool', name: 'reverseOnBreakdown', label: 'Breakdown reverse flight', group: 'Motion', default: TUNNEL_DEFAULTS.reverseOnBreakdown, description: 'Automatically reverses camera flight direction during musical breakdowns.' },
  { type: 'float', name: 'hueSpread', label: 'Multi-color depth rainbow', group: 'Colour', default: TUNNEL_DEFAULTS.hueSpread, min: 0, max: 1, step: 0.05, description: 'Controls multi-color chromatic dispersion across tunnel depth.' },
  { type: 'float', name: 'wallTexture', label: 'Cosmic star-streaks & wall glow', group: 'Texture', default: TUNNEL_DEFAULTS.wallTexture, min: 0, max: 1, step: 0.05, description: 'Adjusts cosmic star-streak density and ambient wall glow luminescence.' },
  { type: 'float', name: 'zoomPunch', label: 'Kick FOV warp & depth ripple', group: 'Motion', default: TUNNEL_DEFAULTS.zoomPunch, min: 0, max: 1, step: 0.05, description: 'Modulates kick drum field-of-view shock compression.' },
  { type: 'float', name: 'swirlPulse', label: 'Mid corkscrew swirl', group: 'Motion', default: TUNNEL_DEFAULTS.swirlPulse, min: 0, max: 1, step: 0.05, description: 'Couples mid-frequency energy into rotational corkscrew swirling.' },
  { type: 'float', name: 'horizonDrift', label: 'Bass horizon curve sway', group: 'Motion', default: TUNNEL_DEFAULTS.horizonDrift, min: 0, max: 1, step: 0.05, description: 'Sways tunnel horizon alignment based on sub-bass oscillations.' },
  { type: 'float', name: 'beatReactivity', label: 'Beat glow & pulse', group: 'Beat', default: TUNNEL_DEFAULTS.beatReactivity ?? 0.5, min: 0, max: 2, step: 0.05, description: 'Scales visual pulsation and glow sensitivity to musical beats.' },
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
  count: number; // 50..4000: how many particles (600 = as before); thinned on weaker devices
  spawnArea: string; // centre | ring | fullScreen | edges
  twinkleRate: number; // 0..3: multiplies twinkle speed (1 = as before)
  twinkleDepth: number; // 0..1: how far a twinkle dims a particle (0.55 = as before)
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
  texture: true,
  textureGain: 1,
  size: 2,
  followScene: false,
  beatReactivity: 1.0,
  count: 600,
  spawnArea: 'centre',
  twinkleRate: 1,
  twinkleDepth: 0.55,
};

export const PARTICLE_SPECS: readonly ParamSpec[] = [
  { type: 'float', name: 'brightness', label: 'Brightness', group: 'Sparkle', default: PARTICLE_DEFAULTS.brightness, min: 0, max: 2, step: 0.01, description: 'Sets overall particle field brightness.' },
  { type: 'float', name: 'calmSparkleScale', label: 'Sparkle in calm', group: 'Sparkle', default: PARTICLE_DEFAULTS.calmSparkleScale, min: 0, max: 1, step: 0.01, description: 'Controls particle sparkle intensity during calm passages.' },
  { type: 'float', name: 'flashSparkleScale', label: 'Sparkle on hi-hat flash', group: 'Sparkle', default: PARTICLE_DEFAULTS.flashSparkleScale, min: 0, max: 1, step: 0.01, description: 'Amplifies sparkle burst intensity on treble and hi-hat onsets.' },
  { type: 'float', name: 'swirlGain', label: 'Swirl (vortex when high)', group: 'Motion', default: PARTICLE_DEFAULTS.swirlGain, min: 0, max: 4, step: 0.01, description: 'Scales rotational vortex velocity swirling particles around screen center.' },
  { type: 'enum', name: 'shape', label: 'Particle shape', group: 'Shape', default: PARTICLE_DEFAULTS.shape, options: ['streak', 'dot', 'star', 'ring'], description: 'Selects the rendering morphology for individual particles.' },
  { type: 'float', name: 'size', label: 'Size', group: 'Shape', default: PARTICLE_DEFAULTS.size, min: 0.5, max: 4, step: 0.01, description: 'Scales particle dimensions, affecting streak length and point width.' },
  { type: 'bool', name: 'followScene', label: 'Follow scene transform', group: 'Transform', default: PARTICLE_DEFAULTS.followScene, description: 'Locks particle coordinate space to global scene rotation and zoom.' },
  { type: 'float', name: 'rotation', label: 'Rotation (rad)', group: 'Transform', default: PARTICLE_DEFAULTS.rotation, min: -3.14, max: 3.14, step: 0.01, description: 'Rotates the entire particle field about the viewport center.' },
  { type: 'float', name: 'zoom', label: 'Zoom', group: 'Transform', default: PARTICLE_DEFAULTS.zoom, min: 0.5, max: 2, step: 0.01, description: 'Magnifies or diminishes the particle coordinate space.' },
  { type: 'float', name: 'hueShift', label: 'Hue shift (turns)', group: 'Colour', default: PARTICLE_DEFAULTS.hueShift, min: 0, max: 1, step: 0.01, description: 'Applies a static base hue angle offset to particle colors.' },
  { type: 'float', name: 'hueDrift', label: 'Hue drift (turns/s)', group: 'Colour', default: PARTICLE_DEFAULTS.hueDrift, min: -0.2, max: 0.2, step: 0.005, description: 'Continuously cycles particle hue spectrum over time.' },
  { type: 'bool', name: 'texture', label: 'Band texture on', group: 'Texture', default: PARTICLE_DEFAULTS.texture, description: 'Enables high-frequency audio modulation of sparkle brightness.' },
  { type: 'float', name: 'textureGain', label: 'Texture strength', group: 'Texture', default: PARTICLE_DEFAULTS.textureGain, min: 0, max: 2, step: 0.01, description: 'Scales high-frequency texture modulation intensity.' },
  { type: 'float', name: 'beatReactivity', label: 'Beat glow & push', group: 'Motion', default: PARTICLE_DEFAULTS.beatReactivity ?? 1.0, min: 0, max: 2, step: 0.05, description: 'Scales particle outward explosive propulsion driven by musical beats.' },
  { type: 'int', name: 'count', label: 'Particle count', group: 'Shape', default: PARTICLE_DEFAULTS.count, min: 50, max: 4000, step: 50, description: 'Sets how many particles are drawn. Weaker devices draw fewer.' },
  { type: 'enum', name: 'spawnArea', label: 'Spawn area', group: 'Motion', default: PARTICLE_DEFAULTS.spawnArea, options: ['centre', 'ring', 'fullScreen', 'edges'], description: 'Chooses where particles are born: the centre, a ring, anywhere on screen, or the screen edges.' },
  { type: 'float', name: 'twinkleRate', label: 'Twinkle speed', group: 'Sparkle', default: PARTICLE_DEFAULTS.twinkleRate, min: 0, max: 3, step: 0.05, description: 'Multiplies how fast particles twinkle. 0 stops the twinkle.' },
  { type: 'float', name: 'twinkleDepth', label: 'Twinkle depth', group: 'Sparkle', default: PARTICLE_DEFAULTS.twinkleDepth, min: 0, max: 1, step: 0.01, description: 'Sets how far a twinkle dims a particle. 0 is steady, 1 blinks fully off.' },
];
export const PARTICLES_SCHEMA = PARTICLE_SPECS;

export interface BassPulseParams {
  texture: boolean; // band texture (6.4): pulse brightness from sub (angle)
  textureGain: number; // 0..2, how strongly the band texture modulates
}
export const BASS_PULSE_DEFAULTS: BassPulseParams = { texture: true, textureGain: 1 };
export const BASS_PULSE_SPECS: readonly ParamSpec[] = [
  { type: 'bool', name: 'texture', label: 'Band texture on', group: 'Texture', default: BASS_PULSE_DEFAULTS.texture, description: 'Enables sub-bass angular modulation across pulse rings.' },
  { type: 'float', name: 'textureGain', label: 'Texture strength', group: 'Texture', default: BASS_PULSE_DEFAULTS.textureGain, min: 0, max: 2, step: 0.01, description: 'Controls modulation sensitivity of sub-bass pulse textures.' },
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
  description: 'Scales the overall dimensions of the crown layer.',
};

export const CROWN_SPECS: readonly ParamSpec[] = [
  { type: 'float', name: 'rimFactor', label: 'Sway amount on rim', group: 'Position', default: CROWN_DEFAULTS.rimFactor, min: 0, max: 1, step: 0.01, description: 'Controls how far radial sway displaces the crown rim relative to its radius.' },
  CROWN_SIZE_SPEC,
  { type: 'bool', name: 'texture', label: 'Band texture on', group: 'Texture', default: CROWN_DEFAULTS.texture, description: 'Enables mid-band angular texture modulation on crown bars.' },
  { type: 'float', name: 'textureGain', label: 'Texture strength', group: 'Texture', default: CROWN_DEFAULTS.textureGain, min: 0, max: 2, step: 0.01, description: 'Scales the strength of mid-frequency texture modulation.' },
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
export const RINGS_DEFAULTS: RingsParams = {
  maxRings: 6,
  maxRingsCalm: 3,
  strokeBase: 0.0035,
  strokeNormGain: 0.01,
  sides: 0,
  style: 'outline',
  texture: true,
  textureGain: 1,
};

export const RINGS_SPECS: readonly ParamSpec[] = [
  // max 6: the rings shader loops MAX_RINGS = 6 times; raising this needs a shader change.
  { type: 'int', name: 'maxRings', label: 'Max rings', group: 'Count', default: RINGS_DEFAULTS.maxRings, min: 1, max: 6, step: 1, description: 'Sets the maximum number of active concentric ring outlines.' },
  { type: 'int', name: 'maxRingsCalm', label: 'Max rings (calm)', group: 'Count', default: RINGS_DEFAULTS.maxRingsCalm, min: 1, max: 6, step: 1, description: 'Sets the reduced active ring count during calm musical passages.' },
  { type: 'float', name: 'strokeBase', label: 'Stroke width', group: 'Stroke', default: RINGS_DEFAULTS.strokeBase, min: 0, max: 0.02, step: 0.0005, description: 'Sets the resting baseline stroke width of ring outlines.' },
  { type: 'float', name: 'strokeNormGain', label: 'Stroke follows spectrum', group: 'Stroke', default: RINGS_DEFAULTS.strokeNormGain, min: 0, max: 0.05, step: 0.0005, description: 'Scales stroke width expansion driven by spectral energy.' },
  { type: 'int', name: 'sides', label: 'Shape sides (0 = circle)', group: 'Shape', default: RINGS_DEFAULTS.sides, min: 0, max: 12, step: 1, description: 'Sets the polygonal vertex count, where 0 produces smooth circles.' },
  { type: 'enum', name: 'style', label: 'Style', group: 'Shape', default: RINGS_DEFAULTS.style, options: ['outline', 'filled'], description: 'Toggles between hollow stroke outlines and solid filled polygons.' },
  { type: 'bool', name: 'texture', label: 'Band texture on', group: 'Texture', default: RINGS_DEFAULTS.texture, description: 'Enables sub-bass and mid-band texture modulation on strokes.' },
  { type: 'float', name: 'textureGain', label: 'Texture strength', group: 'Texture', default: RINGS_DEFAULTS.textureGain, min: 0, max: 2, step: 0.01, description: 'Controls the depth of audio texture modulation on ring strokes.' },
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
  { type: 'float', name: 'ringStart', label: 'Start radius', group: 'Size', default: SHOCKWAVE_DEFAULTS.ringStart, min: 0, max: 1, step: 0.01, description: 'Sets the initial inner radius where shockwave rings spawn.' },
  { type: 'float', name: 'ringEnd', label: 'End radius', group: 'Size', default: SHOCKWAVE_DEFAULTS.ringEnd, min: 0, max: 1, step: 0.01, description: 'Sets the outer terminal expansion radius for dissipated shockwaves.' },
  { type: 'float', name: 'ringSec', label: 'Travel time (s)', group: 'Timing', default: SHOCKWAVE_DEFAULTS.ringSec, min: 0.05, max: 2, step: 0.01, description: 'Controls shockwave propagation duration from spawn to dissipation.' },
  { type: 'enum', name: 'style', label: 'Kick style', group: 'Shape', default: SHOCKWAVE_DEFAULTS.style, options: ['ring', 'glow'], description: 'Selects between a crisp expanding ring outline and a diffused radial glow.' },
  { type: 'bool', name: 'texture', label: 'Band texture on', group: 'Texture', default: SHOCKWAVE_DEFAULTS.texture, description: 'Enables angular edge texture modulation on shockwaves.' },
  { type: 'float', name: 'textureGain', label: 'Texture strength', group: 'Texture', default: SHOCKWAVE_DEFAULTS.textureGain, min: 0, max: 2, step: 0.01, description: 'Controls modulation intensity on shockwave edges.' },
];

export interface BarsParams {
  texture: boolean; // band texture (6.3): bar height from mid (bar index), brightness from high (bar index)
  textureGain: number; // 0..2, how strongly the band texture modulates
}
export const BARS_DEFAULTS: BarsParams = { texture: true, textureGain: 1 };
export const BARS_SPECS: readonly ParamSpec[] = [
  { type: 'bool', name: 'texture', label: 'Band texture on', group: 'Texture', default: BARS_DEFAULTS.texture, description: 'Enables frequency-band texture modulation on visualizer bars.' },
  { type: 'float', name: 'textureGain', label: 'Texture strength', group: 'Texture', default: BARS_DEFAULTS.textureGain, min: 0, max: 2, step: 0.01, description: 'Scales the strength of frequency-band modulation on visualizer bars.' },
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
  description: 'Sets the radius for circular, star, and lissajous waveform modes.',
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
  description: 'Sets oscilloscope beam trace line thickness.',
};

export const WAVEFORM_SPECS: readonly ParamSpec[] = [
  { type: 'enum', name: 'mode', label: 'Wave shape', group: 'Waveform', default: WAVEFORM_DEFAULTS.mode, options: ['line', 'circle', 'star7', 'lissajous'], description: 'Selects waveform drawing topology between linear, circular, and geometric modes.' },
  { type: 'float', name: 'amplitude', label: 'Amplitude', group: 'Waveform', default: WAVEFORM_DEFAULTS.amplitude, min: 0, max: 1.5, step: 0.01, description: 'Scales vertical displacement amplitude of audio oscilloscope waves.' },
  WAVEFORM_RADIUS_SPEC,
  WAVEFORM_THICKNESS_SPEC,
  { type: 'bool', name: 'texture', label: 'Band texture on', group: 'Texture', default: WAVEFORM_DEFAULTS.texture, description: 'Enables high-frequency texture modulation on waveform brightness.' },
  { type: 'float', name: 'textureGain', label: 'Texture strength', group: 'Texture', default: WAVEFORM_DEFAULTS.textureGain, min: 0, max: 2, step: 0.01, description: 'Controls audio texture modulation strength on waveform lines.' },
  { type: 'enum', name: 'colorMode', label: 'Ink color mode', group: 'Colour', default: WAVEFORM_DEFAULTS.colorMode, options: ['white', 'palette', 'gradient'], description: 'Chooses color styling between monochrome white, active palette, and gradient.' },
];
export const WAVEFORM_SCHEMA: readonly ParamSpec[] & { radius: typeof WAVEFORM_RADIUS_SPEC; thickness: typeof WAVEFORM_THICKNESS_SPEC } = Object.assign(
  [...WAVEFORM_SPECS],
  {
    radius: WAVEFORM_RADIUS_SPEC,
    thickness: WAVEFORM_THICKNESS_SPEC,
  }
);

// Unified Composable Shape Layer (Stage 9 / Sector 485)
export type ShapeBaseType =
  | 'centerLine'
  | 'edgeLine'
  | 'circle'
  | 'arc'
  | 'polygon'
  | 'star'
  | 'spiral'
  | 'figure8';

export type ShapeEdgeMode =
  | 'bottom'
  | 'top'
  | 'dualHorizontal'
  | 'dualVertical'
  | 'frame';

export type ShapeEffectType =
  | 'solidLine'
  | 'pulsingLine'
  | 'waveform'
  | 'harmonicWave'
  | 'bars'
  | 'segmentedBars'
  | 'dots'
  | 'auroraFill';

export type ShapeExtrudeDirection =
  | 'outward'
  | 'inward'
  | 'bilateral'
  | 'alternating';

export type ShapeSymmetry =
  | 'wrap'
  | 'mirror'
  | 'repeat2'
  | 'repeat4';

export type ShapeNormalMode =
  | 'radial'
  | 'perpendicular';

export type ShapePropMode =
  | 'single'
  | 'concentric'
  | 'shockwave'
  | 'stream'
  | 'orbit'
  | 'polar';

export type ShapePropDirection =
  | 'outward'
  | 'inward'
  | 'cw'
  | 'ccw'
  | 'alternating';

export type ShapeAudioSource =
  | 'spectrum'
  | 'waveform'
  | 'sub'
  | 'bass'
  | 'mid'
  | 'treble'
  | 'energy'
  | 'scope';

export type ShapeColorMode =
  | 'solid'
  | 'palette'
  | 'frequencyGradient'
  | 'amplitudeHot';

export interface ShapeParams {
  // Category 1 — Base Geometry ("Base")
  baseShape: ShapeBaseType;
  edgeMode: ShapeEdgeMode;
  sides: number;          // 3..12
  starInner: number;      // 0.2..0.9
  cornerRadius: number;   // 0..0.5
  arcSweep: number;       // 0.1..1.0
  spiralTurns: number;    // 1..5
  size: number;           // 0.1..2.0
  posX: number;           // -0.8..0.8
  posY: number;           // -0.8..0.8
  rotation: number;       // -180..180 (degrees)
  spinSpeed: number;      // -2.0..2.0 (rad/s)
  basePulse: number;      // 0..1.0

  // Category 2 — Reactive Effect ("Effect")
  effectType: ShapeEffectType;
  sampleCount: number;    // 16..256
  effectLength: number;   // 0.05..1.5
  thickness: number;      // 0.5..10.0
  barGap: number;         // 0..0.8
  ledSegments: number;    // 2..24
  peakCaps: boolean;

  // Category 3 — Direction & Symmetry ("Direction")
  extrudeDirection: ShapeExtrudeDirection;
  symmetry: ShapeSymmetry;
  normalMode: ShapeNormalMode;

  // Category 4 — Propagation ("Propagation")
  propMode: ShapePropMode;
  propCount: number;      // 1..16
  propSpacing: number;    // 0.05..1.0
  propSpeed: number;      // -2.0..2.0
  propDirection: ShapePropDirection;
  propSelfSpin: number;   // -2.0..2.0
  propDelay: number;      // 0..1.0
  pathTravel: number;     // -2..2 (path laps per second the pattern slides; 0 = still)
  scaleWobble: number;    // 0..0.5 (breathing size change; 0 = off)
  copyRotation: number;   // -90..90 (degrees added per extra copy; 0 = off)

  // Category 5 — Audio & Style Tuning ("Audio & Style")
  audioSource: ShapeAudioSource;
  reactivity: number;     // 0..15.0 (old ceiling 3.0, raised 5x in Slice 15.8)
  attackMs: number;       // 5..200
  releaseMs: number;      // 20..600
  elementDelay: number;   // 0..1 (0 = every element reacts together)
  colorMode: ShapeColorMode;
  solidColor: string;     // "#rrggbb" (when colorMode === 'solid')
  glow: number;           // 0..2.0
}

export const SHAPE_DEFAULTS: ShapeParams = {
  baseShape: 'circle',
  edgeMode: 'bottom',
  sides: 6,
  starInner: 0.5,
  cornerRadius: 0.0,
  arcSweep: 0.75,
  spiralTurns: 2.5,
  size: 0.45,
  posX: 0.0,
  posY: 0.0,
  rotation: 0,
  spinSpeed: 0.0,
  basePulse: 0.15,

  effectType: 'bars',
  sampleCount: 64,
  effectLength: 0.35,
  thickness: 3.0,
  barGap: 0.25,
  ledSegments: 8,
  peakCaps: false,

  extrudeDirection: 'outward',
  symmetry: 'mirror',
  normalMode: 'radial',

  propMode: 'single',
  propCount: 4,
  propSpacing: 0.22,
  propSpeed: 0.65,
  propDirection: 'outward',
  propSelfSpin: 0.0,
  propDelay: 0.25,
  pathTravel: 0,
  scaleWobble: 0,
  copyRotation: 0,

  audioSource: 'spectrum',
  reactivity: 1.0,
  attackMs: 12,
  releaseMs: 180,
  elementDelay: 0,
  colorMode: 'palette',
  solidColor: '#00f0ff',
  glow: 0.6,
};

export const SHAPE_SPECS: readonly ParamSpec[] = [
  // Category 1 — Base Geometry ("Base")
  { type: 'enum', name: 'baseShape', label: 'Base shape', group: 'Base', default: SHAPE_DEFAULTS.baseShape, options: ['centerLine', 'edgeLine', 'circle', 'arc', 'polygon', 'star', 'spiral', 'figure8'], description: 'Selects the underlying geometric blueprint curve.' },
  { type: 'enum', name: 'edgeMode', label: 'Edge mode', group: 'Base', default: SHAPE_DEFAULTS.edgeMode, options: ['bottom', 'top', 'dualHorizontal', 'dualVertical', 'frame'], showWhen: { baseShape: 'edgeLine' }, description: 'Configures viewport edge alignment anchoring for line geometries.' },
  { type: 'int', name: 'sides', label: 'Sides', group: 'Base', default: SHAPE_DEFAULTS.sides, min: 3, max: 12, step: 1, showWhen: { baseShape: ['polygon', 'star'] }, description: 'Sets the number of polygonal vertices or star points.' },
  { type: 'float', name: 'starInner', label: 'Star inner ratio', group: 'Base', default: SHAPE_DEFAULTS.starInner, min: 0.2, max: 0.9, step: 0.05, showWhen: { baseShape: 'star' }, description: 'Adjusts the inner radius indentation ratio for star shapes.' },
  { type: 'float', name: 'cornerRadius', label: 'Corner radius', group: 'Base', default: SHAPE_DEFAULTS.cornerRadius, min: 0, max: 0.5, step: 0.02, showWhen: { baseShape: ['polygon', 'star', 'edgeLine'] }, description: 'Rounds sharp geometric vertices into smooth filleted corners.' },
  { type: 'float', name: 'arcSweep', label: 'Arc sweep', group: 'Base', default: SHAPE_DEFAULTS.arcSweep, min: 0.1, max: 1.0, step: 0.05, showWhen: { baseShape: 'arc' }, description: 'Sets the angular coverage fraction of arc curve segments.' },
  { type: 'float', name: 'spiralTurns', label: 'Spiral turns', group: 'Base', default: SHAPE_DEFAULTS.spiralTurns, min: 1, max: 5, step: 0.25, showWhen: { baseShape: 'spiral' }, description: 'Sets the number of concentric revolutions for spiral curves.' },
  { type: 'float', name: 'size', label: 'Size', group: 'Base', default: SHAPE_DEFAULTS.size, min: 0.1, max: 2.0, step: 0.02, description: 'Scales overall geometric blueprint dimensions.' },
  { type: 'float', name: 'posX', label: 'Position X', group: 'Base', default: SHAPE_DEFAULTS.posX, min: -0.8, max: 0.8, step: 0.02, description: 'Positions geometric center along the horizontal axis.' },
  { type: 'float', name: 'posY', label: 'Position Y', group: 'Base', default: SHAPE_DEFAULTS.posY, min: -0.8, max: 0.8, step: 0.02, description: 'Positions geometric center along the vertical axis.' },
  { type: 'float', name: 'rotation', label: 'Rotation', group: 'Base', default: SHAPE_DEFAULTS.rotation, min: -180, max: 180, step: 1, description: 'Rotates base geometry about its local origin in degrees.' },
  { type: 'float', name: 'spinSpeed', label: 'Spin speed', group: 'Base', default: SHAPE_DEFAULTS.spinSpeed, min: -2.0, max: 2.0, step: 0.05, description: 'Applies continuous angular spin velocity to base geometry.' },
  { type: 'float', name: 'basePulse', label: 'Base pulse', group: 'Base', default: SHAPE_DEFAULTS.basePulse, min: 0, max: 1.0, step: 0.05, description: 'Scales rhythmic geometric expansion driven by low-frequency pulses.' },

  // Category 2 — Reactive Effect ("Effect")
  { type: 'enum', name: 'effectType', label: 'Effect type', group: 'Effect', default: SHAPE_DEFAULTS.effectType, options: ['solidLine', 'pulsingLine', 'waveform', 'harmonicWave', 'bars', 'segmentedBars', 'dots', 'auroraFill'], description: 'Selects reactive visual rendering mode drawn along the blueprint curve.' },
  { type: 'int', name: 'sampleCount', label: 'Sample count', group: 'Effect', default: SHAPE_DEFAULTS.sampleCount, min: 16, max: 256, step: 4, showWhen: { effectType: ['waveform', 'harmonicWave', 'bars', 'segmentedBars', 'dots', 'auroraFill'] }, description: 'Sets the number of audio analysis bins sampled along the curve.' },
  { type: 'float', name: 'effectLength', label: 'Effect length', group: 'Effect', default: SHAPE_DEFAULTS.effectLength, min: 0.05, max: 1.5, step: 0.02, showWhen: { effectType: ['pulsingLine', 'waveform', 'harmonicWave', 'bars', 'segmentedBars', 'dots', 'auroraFill'] }, description: 'Controls maximum outward projection length of reactive visual elements.' },
  { type: 'float', name: 'thickness', label: 'Thickness', group: 'Effect', default: SHAPE_DEFAULTS.thickness, min: 0.5, max: 10.0, step: 0.25, description: 'Sets the stroke thickness of rendered reactive vectors.' },
  { type: 'float', name: 'barGap', label: 'Bar gap', group: 'Effect', default: SHAPE_DEFAULTS.barGap, min: 0, max: 0.8, step: 0.02, showWhen: { effectType: ['bars', 'segmentedBars'] }, description: 'Adjusts spacing gap width between adjacent frequency bars.' },
  { type: 'int', name: 'ledSegments', label: 'LED segments', group: 'Effect', default: SHAPE_DEFAULTS.ledSegments, min: 2, max: 24, step: 1, showWhen: { effectType: 'segmentedBars' }, description: 'Sets the number of discrete stepped LED blocks per bar.' },
  { type: 'bool', name: 'peakCaps', label: 'Peak caps', group: 'Effect', default: SHAPE_DEFAULTS.peakCaps, showWhen: { effectType: ['bars', 'segmentedBars'] }, description: 'Renders floating peak meter caps above audio-driven bars.' },

  // Category 3 — Direction & Symmetry ("Direction")
  { type: 'enum', name: 'extrudeDirection', label: 'Extrude direction', group: 'Direction', default: SHAPE_DEFAULTS.extrudeDirection, options: ['outward', 'inward', 'bilateral', 'alternating'], showWhen: { effectType: ['waveform', 'harmonicWave', 'bars', 'segmentedBars', 'dots', 'auroraFill'] }, description: 'Controls whether reactive visual elements extend outward, inward, or bilaterally.' },
  { type: 'enum', name: 'symmetry', label: 'Symmetry', group: 'Direction', default: SHAPE_DEFAULTS.symmetry, options: ['wrap', 'mirror', 'repeat2', 'repeat4'], description: 'Applies geometric reflection and rotational cloning across axes.' },
  { type: 'enum', name: 'normalMode', label: 'Normal mode', group: 'Direction', default: SHAPE_DEFAULTS.normalMode, options: ['radial', 'perpendicular'], showWhen: { baseShape: ['polygon', 'star', 'spiral', 'figure8', 'arc'] }, description: 'Determines vector orientation along surface normals or radial vectors.' },

  // Category 4 — Propagation ("Propagation")
  { type: 'enum', name: 'propMode', label: 'Propagation mode', group: 'Propagation', default: SHAPE_DEFAULTS.propMode, options: ['single', 'concentric', 'shockwave', 'stream', 'orbit', 'polar'], description: 'Configures instance propagation behavior through space and time.' },
  { type: 'int', name: 'propCount', label: 'Instance count', group: 'Propagation', default: SHAPE_DEFAULTS.propCount, min: 1, max: 16, step: 1, showWhen: { propMode: ['concentric', 'stream', 'orbit', 'polar'] }, description: 'Sets the number of duplicated propagating instances.' },
  { type: 'float', name: 'propSpacing', label: 'Instance spacing / Orbit distance', group: 'Propagation', default: SHAPE_DEFAULTS.propSpacing, min: 0.05, max: 1.5, step: 0.02, showWhen: { propMode: ['concentric', 'orbit', 'polar'] }, description: 'Adjusts spatial separation distance or orbit radius from center.' },
  { type: 'float', name: 'propSpeed', label: 'Propagation speed', group: 'Propagation', default: SHAPE_DEFAULTS.propSpeed, min: -2.0, max: 2.0, step: 0.05, showWhen: { propMode: ['shockwave', 'stream', 'orbit', 'polar'] }, description: 'Controls traveling velocity of propagating geometric waves.' },
  { type: 'enum', name: 'propDirection', label: 'Propagation direction', group: 'Propagation', default: SHAPE_DEFAULTS.propDirection, options: ['outward', 'inward', 'cw', 'ccw', 'alternating'], showWhen: { propMode: ['concentric', 'shockwave', 'stream', 'orbit', 'polar'] }, description: 'Chooses directional travel vector for propagating instances.' },
  { type: 'float', name: 'propSelfSpin', label: 'Instance self spin', group: 'Propagation', default: SHAPE_DEFAULTS.propSelfSpin, min: -2.0, max: 2.0, step: 0.05, showWhen: { propMode: ['orbit', 'polar'] }, description: 'Applies rotational velocity to individual propagating instances.' },
  { type: 'float', name: 'propDelay', label: 'Audio delay', group: 'Propagation', default: SHAPE_DEFAULTS.propDelay, min: 0, max: 1.0, step: 0.05, showWhen: { propMode: ['concentric', 'stream', 'orbit', 'polar'] }, description: 'Staggers audio reaction timing across successive propagated instances.' },
  { type: 'float', name: 'pathTravel', label: 'Travel along path', group: 'Propagation', default: SHAPE_DEFAULTS.pathTravel, min: -2, max: 2, step: 0.05, description: 'Slides the audio pattern along the shape path, in laps per second. 0 keeps it still.' },
  { type: 'float', name: 'scaleWobble', label: 'Scale wobble', group: 'Propagation', default: SHAPE_DEFAULTS.scaleWobble, min: 0, max: 0.5, step: 0.01, description: 'Makes the shape and each copy breathe in size over time. 0 is off.' },
  { type: 'float', name: 'copyRotation', label: 'Rotation per copy', group: 'Propagation', default: SHAPE_DEFAULTS.copyRotation, min: -90, max: 90, step: 1, showWhen: { propMode: ['concentric', 'shockwave', 'stream', 'orbit', 'polar'] }, description: 'Turns each extra copy by this many degrees more than the one before. 0 is off.' },

  // Category 5 — Audio & Style Tuning ("Audio & Style")
  { type: 'enum', name: 'audioSource', label: 'Audio source', group: 'Audio & Style', default: SHAPE_DEFAULTS.audioSource, options: ['spectrum', 'waveform', 'sub', 'bass', 'mid', 'treble', 'energy', 'scope'], description: 'Selects audio signal driving reactive modulation. Scope is a signed oscilloscope trace: silence draws a flat line and the signal swings both ways.' },
  { type: 'float', name: 'reactivity', label: 'Reactivity', group: 'Audio & Style', default: SHAPE_DEFAULTS.reactivity, min: 0, max: 15.0, step: 0.05, description: 'Scales overall dynamic sensitivity to audio input peaks.' },
  { type: 'float', name: 'attackMs', label: 'Attack (ms)', group: 'Audio & Style', default: SHAPE_DEFAULTS.attackMs, min: 5, max: 200, step: 5, description: 'Sets smoothing attack response time in milliseconds for transient swells.' },
  { type: 'float', name: 'releaseMs', label: 'Release (ms)', group: 'Audio & Style', default: SHAPE_DEFAULTS.releaseMs, min: 20, max: 600, step: 10, description: 'Sets smoothing decay release time in milliseconds for sustained tails.' },
  { type: 'float', name: 'elementDelay', label: 'Element delay', group: 'Audio & Style', default: SHAPE_DEFAULTS.elementDelay, min: 0, max: 1, step: 0.05, description: 'Lags each bar or dot behind the one before it, so the reaction ripples along the shape. 0 keeps every element in step.' },
  { type: 'enum', name: 'colorMode', label: 'Color mode', group: 'Audio & Style', default: SHAPE_DEFAULTS.colorMode, options: ['solid', 'palette', 'frequencyGradient', 'amplitudeHot'], description: 'Configures shader color mapping and palette gradient distribution.' },
  { type: 'colour', name: 'solidColor', label: 'Solid color', group: 'Audio & Style', default: SHAPE_DEFAULTS.solidColor, showWhen: { colorMode: 'solid' }, description: 'Sets uniform tint color when solid color mode is active.' },
  { type: 'float', name: 'glow', label: 'Glow bloom', group: 'Audio & Style', default: SHAPE_DEFAULTS.glow, min: 0, max: 2.0, step: 0.05, description: 'Controls bloom glow luminance around reactive vector outlines.' },
];

/** Julia set layer (Slice 20.3). */
export const JULIA_SHAPES = ['classic', 'dendrite', 'spiral', 'rabbit'] as const;
export interface JuliaParams {
  shape: string; // which family of Julia sets
  zoom: number; // 0.4..4
  speed: number; // 0..2, slow orbit of the constant, view turn and colour drift
  reactivity: number; // 0..1, how far mid and bass move the constant
  smoothing: number; // 0.2..3 s time constant for mid and bass (never below 0.2 s so the set cannot flash)
  iterations: number; // 16..96, capped lower on large targets
  brightness: number;
  colourSpread: number; // 0..1, how many colour bands
}
export const JULIA_DEFAULTS: JuliaParams = {
  shape: 'classic',
  zoom: 1,
  speed: 0.5,
  reactivity: 0.5,
  smoothing: 1,
  iterations: 48,
  brightness: 1,
  colourSpread: 0.5,
};
export const JULIA_SPECS: readonly ParamSpec[] = [
  { type: 'enum', name: 'shape', label: 'Set shape', group: 'Julia', default: JULIA_DEFAULTS.shape, options: JULIA_SHAPES, description: 'Chooses the family of Julia set: classic, dendrite, spiral or rabbit.' },
  { type: 'float', name: 'zoom', label: 'Zoom', group: 'Julia', default: JULIA_DEFAULTS.zoom, min: 0.4, max: 4, step: 0.05, description: 'Magnifies the set. Higher shows finer filaments.' },
  { type: 'float', name: 'speed', label: 'Drift speed', group: 'Julia', default: JULIA_DEFAULTS.speed, min: 0, max: 2, step: 0.05, description: 'Speed of the slow orbit, turn and colour drift. 0 holds the set still.' },
  { type: 'float', name: 'reactivity', label: 'Music reactivity', group: 'Audio', default: JULIA_DEFAULTS.reactivity, min: 0, max: 1, step: 0.05, description: 'How far the mids and bass move the set. 0 ignores the music.' },
  { type: 'float', name: 'smoothing', label: 'Smoothing (s)', group: 'Audio', default: JULIA_DEFAULTS.smoothing, min: 0.2, max: 3, step: 0.05, description: 'How slowly the set follows the music. Longer is calmer. Never faster than 0.2 s, so it cannot flash.' },
  { type: 'int', name: 'iterations', label: 'Detail (iterations)', group: 'Julia', default: JULIA_DEFAULTS.iterations, min: 16, max: 96, step: 8, description: 'More iterations draw finer detail and cost more. Large screens are capped lower.' },
  { type: 'float', name: 'brightness', label: 'Brightness', group: 'Colour', default: JULIA_DEFAULTS.brightness, min: 0.1, max: 3, step: 0.05, description: 'Scales the brightness of the filaments.' },
  { type: 'float', name: 'colourSpread', label: 'Colour bands', group: 'Colour', default: JULIA_DEFAULTS.colourSpread, min: 0, max: 1, step: 0.05, description: 'How many colour bands run through the filaments.' },
];

/** Orbit layer (Slice 20.4). */
export const ORBIT_SHAPES = ['dot', 'ring', 'diamond'] as const;
export interface OrbitParams {
  count: number; // 6..96 bodies in total
  orbits: number; // 1..5
  radius: number; // 0.2..1.2 of half the screen height
  tilt: number; // 0..1.4 rad
  depth: number; // 0..1 perspective: far bodies smaller and dimmer
  speed: number; // 0..3
  yawSpeed: number; // 0..1, slow turn of the whole system
  size: number; // 0.01..0.08 of screen height
  reactivity: number; // 0..2, size pulse from the music
  shape: string; // dot | ring | diamond
  brightness: number;
}
export const ORBIT_DEFAULTS: OrbitParams = {
  count: 32,
  orbits: 3,
  radius: 0.6,
  tilt: 0.6,
  depth: 0.6,
  speed: 0.5,
  yawSpeed: 0.2,
  size: 0.035,
  reactivity: 1,
  shape: 'dot',
  brightness: 1,
};
export const ORBIT_SPECS: readonly ParamSpec[] = [
  { type: 'int', name: 'count', label: 'Bodies', group: 'Orbit', default: ORBIT_DEFAULTS.count, min: 6, max: 96, step: 2, description: 'How many shapes ride the orbits in total.' },
  { type: 'int', name: 'orbits', label: 'Orbits', group: 'Orbit', default: ORBIT_DEFAULTS.orbits, min: 1, max: 5, step: 1, description: 'How many separate orbit rings there are.' },
  { type: 'float', name: 'radius', label: 'Radius', group: 'Orbit', default: ORBIT_DEFAULTS.radius, min: 0.2, max: 1.2, step: 0.02, description: 'Size of the outer orbit as a fraction of half the screen height.' },
  { type: 'float', name: 'tilt', label: 'Tilt', group: 'Orbit', default: ORBIT_DEFAULTS.tilt, min: 0, max: 1.4, step: 0.02, description: 'How far the orbit rings lean toward you. 0 is flat, like looking straight down on them.' },
  { type: 'float', name: 'depth', label: 'Depth', group: 'Orbit', default: ORBIT_DEFAULTS.depth, min: 0, max: 1, step: 0.05, description: 'How strongly distance changes size and brightness. 0 makes every shape the same.' },
  { type: 'float', name: 'speed', label: 'Orbit speed', group: 'Motion', default: ORBIT_DEFAULTS.speed, min: 0, max: 3, step: 0.05, description: 'How fast the shapes travel round. Louder passages run a little faster.' },
  { type: 'float', name: 'yawSpeed', label: 'Turn speed', group: 'Motion', default: ORBIT_DEFAULTS.yawSpeed, min: 0, max: 1, step: 0.02, description: 'How fast the whole system slowly turns.' },
  { type: 'float', name: 'size', label: 'Shape size', group: 'Shape', default: ORBIT_DEFAULTS.size, min: 0.01, max: 0.08, step: 0.002, description: 'Size of each shape as a fraction of the screen height.' },
  { type: 'enum', name: 'shape', label: 'Shape', group: 'Shape', default: ORBIT_DEFAULTS.shape, options: ORBIT_SHAPES, description: 'Dot, ring or diamond.' },
  { type: 'float', name: 'reactivity', label: 'Music reactivity', group: 'Audio', default: ORBIT_DEFAULTS.reactivity, min: 0, max: 2, step: 0.05, description: 'How much each shape swells with its own slice of the spectrum and with the kick. Only size changes, never brightness.' },
  { type: 'float', name: 'brightness', label: 'Brightness', group: 'Colour', default: ORBIT_DEFAULTS.brightness, min: 0.1, max: 3, step: 0.05, description: 'Scales the brightness of the shapes.' },
];

/** Architecture layer (Slice 20.5). The position in the mode list is the number the shader switches on. */
export const ARCHITECTURE_MODES = ['corridor', 'colonnade', 'floor'] as const;
export interface ArchitectureParams {
  mode: string; // corridor | colonnade | floor
  speed: number; // 0..3, how fast the camera glides forward
  gridSize: number; // 0.5..4, grid cell size on the floor and ceiling
  pillarSpacing: number; // 1..8, distance between pillars along the walls
  roomWidth: number; // 1..4, distance from the middle to each wall
  roomHeight: number; // 0.5..3, distance from the middle to the floor and ceiling
  lineWidth: number; // 0.02..0.3 of a cell
  reactivity: number; // 0..1, how much bass widens the lines
  fog: number; // 0..2, how quickly distant parts fade
  horizon: number; // -0.3..0.3, vertical shift of the horizon
  brightness: number;
}
export const ARCHITECTURE_DEFAULTS: ArchitectureParams = {
  mode: 'corridor',
  speed: 0.8,
  gridSize: 1.5,
  pillarSpacing: 3,
  roomWidth: 2,
  roomHeight: 1,
  lineWidth: 0.06,
  reactivity: 0.5,
  fog: 0.8,
  horizon: 0,
  brightness: 1,
};
export const ARCHITECTURE_SPECS: readonly ParamSpec[] = [
  { type: 'enum', name: 'mode', label: 'Room', group: 'Architecture', default: ARCHITECTURE_DEFAULTS.mode, options: ARCHITECTURE_MODES, description: 'Corridor has solid walls. Colonnade has pillars with open gaps. Floor draws a grid floor only.' },
  { type: 'float', name: 'speed', label: 'Glide speed', group: 'Motion', default: ARCHITECTURE_DEFAULTS.speed, min: 0, max: 3, step: 0.05, description: 'How fast the camera glides forward. Louder passages run a little faster. 0 holds still.' },
  { type: 'float', name: 'gridSize', label: 'Grid size', group: 'Architecture', default: ARCHITECTURE_DEFAULTS.gridSize, min: 0.5, max: 4, step: 0.1, description: 'Size of each square on the floor and ceiling.' },
  { type: 'float', name: 'pillarSpacing', label: 'Pillar spacing', group: 'Architecture', default: ARCHITECTURE_DEFAULTS.pillarSpacing, min: 1, max: 8, step: 0.25, description: 'Distance between pillars along the walls.' },
  { type: 'float', name: 'roomWidth', label: 'Room width', group: 'Architecture', default: ARCHITECTURE_DEFAULTS.roomWidth, min: 1, max: 4, step: 0.1, description: 'How far the walls are from the middle.' },
  { type: 'float', name: 'roomHeight', label: 'Room height', group: 'Architecture', default: ARCHITECTURE_DEFAULTS.roomHeight, min: 0.5, max: 3, step: 0.1, description: 'How far the floor and ceiling are from the middle.' },
  { type: 'float', name: 'lineWidth', label: 'Line width', group: 'Architecture', default: ARCHITECTURE_DEFAULTS.lineWidth, min: 0.02, max: 0.3, step: 0.01, description: 'Thickness of the grid lines as a fraction of a square.' },
  { type: 'float', name: 'reactivity', label: 'Music reactivity', group: 'Audio', default: ARCHITECTURE_DEFAULTS.reactivity, min: 0, max: 1, step: 0.05, description: 'How much the bass slowly widens the grid lines. 0 ignores the music for line width.' },
  { type: 'float', name: 'fog', label: 'Fog', group: 'Architecture', default: ARCHITECTURE_DEFAULTS.fog, min: 0, max: 2, step: 0.05, description: 'How quickly distant parts fade out.' },
  { type: 'float', name: 'horizon', label: 'Horizon height', group: 'Architecture', default: ARCHITECTURE_DEFAULTS.horizon, min: -0.3, max: 0.3, step: 0.01, description: 'Moves the horizon up or down the screen.' },
  { type: 'float', name: 'brightness', label: 'Brightness', group: 'Colour', default: ARCHITECTURE_DEFAULTS.brightness, min: 0.1, max: 3, step: 0.05, description: 'Scales the brightness of the lines and pillars.' },
];

export type LayerType =
  | 'shape'
  | 'tunnel'
  | 'particles'
  | 'crown'
  | 'rings'
  | 'shockwave'
  | 'bars'
  | 'bassPulse'
  | 'waveform'
  | 'julia'
  | 'orbit'
  | 'architecture';

/** Studio-only view tier (Slice 15.4). Never saved in presets. A spec with no tier counts as advanced. */
export type ControlTier = 'basic' | 'advanced';
export type TieredSpec = ParamSpec & { tier?: ControlTier };

export function tierOf(spec: ParamSpec): ControlTier {
  return (spec as TieredSpec).tier === 'basic' ? 'basic' : 'advanced';
}

/** Copies of `specs` with `tier: 'basic'` on the named ones; every other spec stays untiered (advanced). */
export function withTiers(specs: readonly ParamSpec[], basic: readonly string[]): ParamSpec[] {
  const set = new Set(basic);
  return specs.map((s) => (set.has(s.name) ? (Object.assign({}, s, { tier: 'basic' }) as ParamSpec) : s));
}

/** Small sections have nothing to hide: every control is basic. */
const allBasic = (specs: readonly ParamSpec[]): ParamSpec[] => withTiers(specs, specs.map((s) => s.name));

export const LAYER_SPECS: Readonly<Record<string, readonly ParamSpec[]>> = {
  shape: withTiers(SHAPE_SPECS, ['baseShape', 'size', 'rotation', 'effectType', 'thickness', 'colorMode', 'solidColor', 'glow']),
  tunnel: withTiers(TUNNEL_SPECS, ['ringDensity', 'ringContrast', 'pattern', 'sides', 'twist', 'flightMode', 'hueSpread', 'beatReactivity']),
  particles: withTiers(PARTICLE_SPECS, ['brightness', 'shape', 'size', 'rotation', 'zoom', 'hueShift', 'mode', 'beatReactivity']),
  crown: allBasic(CROWN_SPECS),
  rings: allBasic(RINGS_SPECS),
  shockwave: allBasic(SHOCKWAVE_SPECS),
  bars: allBasic(BARS_SPECS),
  bassPulse: allBasic(BASS_PULSE_SPECS),
  waveform: allBasic(WAVEFORM_SPECS),
  julia: allBasic(JULIA_SPECS),
  orbit: allBasic(ORBIT_SPECS),
  architecture: allBasic(ARCHITECTURE_SPECS),
};

/** Basic controls of the combined Feedback and post section (8). Applied in place below, these specs are not shared. */
export const FEEDBACK_POST_BASIC: readonly string[] = ['zoom', 'rotate', 'warp', 'decay', 'fade', 'hueShift', 'saturation', 'bloom'];

/** Every built-in layer's settings, keyed by layer type. Used by the loader in slice 4.3. */

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
/** Vignette shapes and blends (Slice 18.9). The position in each list is the number the post shader switches on. */
export const VIGNETTE_SHAPES = ['oval', 'round', 'box'] as const;
export const VIGNETTE_BLENDS = ['darken', 'tint', 'add', 'hueShift'] as const;

// Post chain (slice E4) and bloom (E5). Shown only, after the feedback trail. Defaults = no effect.
export const POST_SPECS: readonly ParamSpec[] = [
  { type: 'float', name: 'hueShift', label: 'Hue shift, whole image (rad)', group: 'Colour', default: 0, min: -3.14, max: 3.14, step: 0.01, description: 'Applies a global hue rotation offset to the rendered composition.' },
  { type: 'float', name: 'saturation', label: 'Saturation', group: 'Colour', default: 1, min: 0, max: 2, step: 0.01, description: 'Scales color chroma saturation intensity.' },
  { type: 'float', name: 'contrast', label: 'Contrast', group: 'Colour', default: 1, min: 0, max: 2, step: 0.01, description: 'Adjusts contrast distinction between dark and light tones.' },
  { type: 'float', name: 'gamma', label: 'Gamma', group: 'Colour', default: 1, min: 0.5, max: 2, step: 0.01, description: 'Applies non-linear power curve luminance correction.' },
  { type: 'float', name: 'brightness', label: 'Brightness', group: 'Colour', default: 0, min: -0.5, max: 0.5, step: 0.01, description: 'Adjusts global master image brightness offset.' },
  { type: 'float', name: 'vignette', label: 'Vignette', group: 'Shape', default: 0, min: 0, max: 1, step: 0.01, description: 'Darkens viewport corners with a soft radial falloff mask.' },
  { type: 'enum', name: 'vignetteShape', label: 'Vignette shape', group: 'Shape', default: 'oval', options: VIGNETTE_SHAPES, showWhen: { vignette: { above: 0 } }, description: 'Oval follows the screen shape (the classic vignette). Round is a true circle. Box hugs the edges.' },
  { type: 'float', name: 'vignetteSoftness', label: 'Vignette softness', group: 'Shape', default: 0.4, min: 0.02, max: 1, step: 0.01, showWhen: { vignette: { above: 0 } }, description: 'How gradually the vignette fades in from the middle to the edge.' },
  { type: 'enum', name: 'vignetteBlend', label: 'Vignette blend', group: 'Shape', default: 'darken', options: VIGNETTE_BLENDS, showWhen: { vignette: { above: 0 } }, description: 'Darken multiplies the picture, tint mixes toward the colour, add lights the edge with it, hue shift turns the colours around toward the edge.' },
  { type: 'colour', name: 'vignetteColour', label: 'Vignette colour', group: 'Shape', default: '#000000', showWhen: { vignette: { above: 0 }, vignetteGradient: 'none' }, description: 'Colour used by the vignette. Black with Darken is the classic look.' },
  { type: 'enum', name: 'vignetteGradient', label: 'Vignette gradient (or none)', group: 'Shape', default: 'none', options: ['none', ...GRADIENT_NAMES], showWhen: { vignette: { above: 0 } }, description: 'Colours the vignette from a gradient, running from the middle to the corner, instead of one colour.' },
  {
    type: 'int',
    name: 'mirror',
    label: 'Kaleidoscope, whole image (0 = off)',
    group: 'Shape',
    default: 0,
    min: 0,
    max: 8,
    step: 1,
    description: 'Folds the canvas into symmetric kaleidoscope reflection sectors.',
    intense: true,
    warning: 'Intense visual transform. Highly sensitive to small adjustments — use with care.',
  },
  {
    type: 'float',
    name: 'chroma',
    label: 'Red/blue edge split',
    group: 'Shape',
    default: 0,
    min: 0,
    max: 0.02,
    step: 0.0005,
    description: 'Separates red and blue channels with lateral chromatic aberration.',
    intense: true,
    warning: 'Intense visual transform. Highly sensitive to small adjustments — use with care.',
  },
  { type: 'float', name: 'bloom', label: 'Bloom amount', group: 'Glow', default: 0, min: 0, max: 2, step: 0.01, description: 'Controls diffuse luminous glow intensity over bright regions.' },
  { type: 'float', name: 'bloomThreshold', label: 'Bloom brightness cut-off', group: 'Glow', default: 0.6, min: 0, max: 1, step: 0.01, showWhen: { bloom: { above: 0 } }, description: 'Sets minimum luminance cut-off required to trigger bloom glow.' },
  { type: 'float', name: 'bloomSize', label: 'Bloom size (below 0 tight, above 0 wide)', group: 'Glow', default: 0, min: -1, max: 2, step: 0.01, showWhen: { bloom: { above: 0 } }, description: 'Sets how far the glow spreads. 0 is the usual glow, negative keeps it close to bright edges, positive spreads it wide.' },
  { type: 'float', name: 'bloomTintAmount', label: 'Bloom tint amount', group: 'Glow', default: 0, min: 0, max: 1, step: 0.01, showWhen: { bloom: { above: 0 } }, description: 'Mixes the glow toward a single colour. 0 keeps the glow in the picture colours.' },
  { type: 'float', name: 'bloomTintHue', label: 'Bloom tint colour (hue, rad)', group: 'Glow', default: 0, min: -3.14, max: 3.14, step: 0.01, showWhen: { bloom: { above: 0 }, bloomTintAmount: { above: 0 } }, description: 'Picks the colour the glow is tinted toward.' },
  { type: 'float', name: 'bloomPulse', label: 'Bloom beat pulse', group: 'Glow', default: 0, min: 0, max: 2, step: 0.01, showWhen: { bloom: { above: 0 } }, description: 'Makes the glow swell on each kick, then ease back.' },
  { type: 'float', name: 'colourMap', label: 'Colour map amount', group: 'Colour', default: 0, min: 0, max: 1, step: 0.01, description: 'Recolours the finished picture through a gradient. 0 leaves the colours alone.' },
  { type: 'enum', name: 'colourMapBy', label: 'Colour map reads by', group: 'Colour', default: 'brightness', options: COLOUR_MAP_INDEXES, showWhen: { colourMap: { above: 0 } }, description: 'Picks what chooses the colour: how bright a spot is, how far it is from the centre, or its angle around the centre.' },
  { type: 'enum', name: 'colourMapGradient', label: 'Colour map gradient', group: 'Colour', default: GRADIENT_DEFAULT_A, options: GRADIENT_NAMES, showWhen: { colourMap: { above: 0 } }, description: 'The first gradient.' },
  { type: 'enum', name: 'colourMapGradient2', label: 'Colour map second gradient', group: 'Colour', default: GRADIENT_DEFAULT_B, options: GRADIENT_NAMES, showWhen: { colourMap: { above: 0 } }, description: 'The gradient the mix moves toward.' },
  { type: 'float', name: 'colourMapMix', label: 'Colour map mix (0 first, 1 second)', group: 'Colour', default: 0, min: 0, max: 1, step: 0.01, showWhen: { colourMap: { above: 0 } }, description: 'Blends from the first gradient to the second. Morph it, link it to the music or react it to a trigger to change gradients over time.' },
];

export const FEEDBACK_SPECS: readonly ParamSpec[] = [
  { type: 'float', name: 'zoom', label: 'Zoom', group: 'Motion', default: 1, min: 0.85, max: 1.15, step: 0.001, description: 'Scales canvas coordinate magnification applied per feedback frame.' },
  { type: 'float', name: 'rotate', label: 'Spin per frame (rad)', group: 'Motion', default: 0, min: -0.04, max: 0.04, step: 0.0005, description: 'Applies rotational velocity to feedback coordinate space per frame.' },
  { type: 'float', name: 'centreX', label: 'Pivot X (centre of zoom and spin)', group: 'Motion', default: 0, min: -0.28, max: 0.28, step: 0.005, description: 'Shifts horizontal coordinate origin for feedback transforms.' },
  { type: 'float', name: 'centreY', label: 'Pivot Y (centre of zoom and spin)', group: 'Motion', default: 0, min: -0.28, max: 0.28, step: 0.005, description: 'Shifts vertical coordinate origin for feedback transforms.' },
  { type: 'float', name: 'driftX', label: 'Slide sideways', group: 'Motion', default: 0, min: -0.005, max: 0.005, step: 0.0001, description: 'Applies continuous horizontal directional translation drift per frame.' },
  { type: 'float', name: 'driftY', label: 'Slide up and down', group: 'Motion', default: 0, min: -0.005, max: 0.005, step: 0.0001, description: 'Applies continuous vertical directional translation drift per frame.' },
  { type: 'float', name: 'stretchX', label: 'Stretch wide', group: 'Motion', default: 1, min: 0.80, max: 1.40, step: 0.005, description: 'Applies horizontal aspect ratio coordinate elongation.' },
  { type: 'float', name: 'stretchY', label: 'Stretch tall', group: 'Motion', default: 1, min: 0.80, max: 1.40, step: 0.005, description: 'Applies vertical aspect ratio coordinate elongation.' },
  { type: 'float', name: 'warp', label: 'Wave warp amount', group: 'Warp', default: 0, min: 0, max: 1, step: 0.01, showWhen: { warpMode: ['classic', 'curl', 'mobius'] }, description: 'Controls wave distortion displacement depth across the feedback trail.' },
  { type: 'float', name: 'warpScale', label: 'Wave count', group: 'Warp', default: 1, min: 0.1, max: 4, step: 0.01, showWhen: { warpMode: ['classic', 'curl'] }, description: 'Sets spatial wave oscillation frequency in feedback warp. In Classic mode it needs Wave warp above 0.' },
  { type: 'float', name: 'warpSpeed', label: 'Wave speed', group: 'Warp', default: 1, min: 0, max: 15, step: 0.01, showWhen: { warpMode: ['classic', 'curl', 'rgbSplit'] }, description: 'Sets temporal oscillation speed of feedback wave deformation. In Classic mode it needs Wave warp above 0.' },
  { type: 'float', name: 'decay', label: 'Trail length', group: 'Trail', default: 0.92, min: 0.5, max: 1, step: 0.001, description: 'How much of the last frame stays each frame. 1 keeps everything; lower values make trails shrink faster. Works by multiplying, so bright trails fade smoothly.' },
  { type: 'float', name: 'fade', label: 'Trail fade-out', group: 'Trail', default: 0.004, min: 0, max: 0.1, step: 0.0005, description: 'Takes a fixed amount of brightness off every frame, so faint trails vanish completely instead of lingering. Use with Trail length: length shortens trails smoothly, fade-out clears what is left.' },
  { type: 'enum', name: 'wrap', label: 'Trail edges (clamp or wrap)', group: 'Trail', default: 'clamp', options: ['clamp', 'wrap'], description: 'Selects boundary behavior when feedback pixels exceed canvas edges.' },
  { type: 'float', name: 'hueDrift', label: 'Trail hue drift per frame (rad)', group: 'Colour', default: 0, min: -0.1, max: 0.1, step: 0.001, description: 'Continuously rotates feedback trail hue over successive frames.' },
  { type: 'float', name: 'blur', label: 'Trail blur', group: 'Colour', default: 0, min: 0, max: 1, step: 0.01, description: 'Applies spatial diffusion blur across historical feedback frames.' },
];
for (const spec of [...POST_SPECS, ...FEEDBACK_SPECS]) {
  if (FEEDBACK_POST_BASIC.includes(spec.name)) (spec as TieredSpec).tier = 'basic';
}

export const FEEDBACK_SCHEMA = FEEDBACK_SPECS;

export const CHLADNI_PLATE_MODE_SPEC = {
  type: 'enum' as const,
  name: 'plateMode' as const,
  label: 'Plate geometry',
  group: 'Sand',
  default: 'fullscreen',
  options: ['fullscreen', 'isometricPlate', 'radialMandala', 'hexagon', 'triangle', 'starMandala', 'morph'] as const,
  description: 'Chooses the boundary geometry of the vibrating resonant plate.',
};

export const CHLADNI_SAND_SCHEMA = {
  plateMode: CHLADNI_PLATE_MODE_SPEC,
};
