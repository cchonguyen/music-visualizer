// Display labels for Studio dropdowns: audio sources, transition styles, enum options, and reaction triggers and responses.
import { type AudioSource, type Transition } from '../presets/format';
import { type ResponseType, type TriggerType } from '../presets/reactions';

/** Human-readable display labels for Audio Link modulation sources. */
export const AUDIO_SOURCE_LABELS: Readonly<Record<AudioSource, string>> = {
  sub: 'Sub Bass',
  bass: 'Bass',
  mid: 'Mid',
  high: 'High / Treble',
  energy: 'Overall Energy',
  loudness: 'Loudness',
  beat: 'Beat Pulse',
  onset: 'Onset / Transient',
  section: 'Section Energy',
  beatStrength: 'Beat Strength',
  brightness: 'Brightness',
  subFlux: 'Sub Flux',
  midFlux: 'Mid Flux',
  highFlux: 'High Flux',
  lfoSine: 'LFO · Sine',
  lfoSaw: 'LFO · Saw',
  lfoRandom: 'LFO · Random',
  time: 'Time',
  kickEnv: 'Kick Envelope',
  centroid: 'Spectral Centroid',
  drop: 'Drop Surge',
  breakdown: 'Breakdown',
  phrase16: 'Phrase (16 Beats)',
  phrase32: 'Phrase (32 Beats)',
  energySlow: 'Energy Arc (Slow)',
};

/** Human-readable display labels for preset transition styles. */
export const TRANSITION_STYLE_LABELS: Readonly<Record<Transition, string>> = {
  crossfade: 'Crossfade',
  wipe: 'Wipe',
  dissolve: 'Dissolve',
  zoom: 'Zoom',
  morph: 'Morph',
};

/** Explicit human-readable display labels for schema enum options (with camelCase fallback). */
export const ENUM_OPTION_LABELS: Readonly<Record<string, string>> = {
  isometricPlate: 'Isometric Plate',
  radialMandala: 'Radial Mandala',
  starMandala: 'Star Mandala',
  polarFold: 'Polar Fold (Mandala)',
  rgbSplit: 'RGB Split',
  alpha: 'Alpha',
  add: 'Additive',
  max: 'Maximum',
  screen: 'Screen',
  classic: 'Classic',
  curl: 'Curl',
  mobius: 'Mobius',
  fullscreen: 'Fullscreen',
  hexagon: 'Hexagon',
  triangle: 'Triangle',
  morph: 'Morph',
  crossfade: 'Crossfade',
  wipe: 'Wipe',
  dissolve: 'Dissolve',
  zoom: 'Zoom',
  cw: 'Clockwise',
  ccw: 'Counter-clockwise',
  knot3d: '3D Knot',
  figure8: 'Figure 8',
  golden137_5: 'Golden (137.5°)',
  'golden137.5': 'Golden (137.5°)',
  'lucas99.5': 'Lucas (99.5°)',
  'fibonacci137.6': 'Fibonacci (137.6°)',
  'rosette137.3': 'Rosette (137.3°)',
  starburst144: 'Starburst (144°)',
  sub: 'Sub Bass',
  bass: 'Bass',
  mid: 'Mid',
  high: 'High / Treble',
  energy: 'Overall Energy',
  kick: 'Kick',
};

/** Convert an enum option key into a human-readable Studio dropdown label. */
export function formatEnumOptionLabel(value: string): string {
  if (!value) return '';
  if (ENUM_OPTION_LABELS[value]) return ENUM_OPTION_LABELS[value];
  if (/^\d+(:\d+)?$/.test(value)) return value;
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export const TRIGGER_LABELS: Readonly<Record<TriggerType, string>> = {
  beat: 'Every beat',
  strongBeat: 'Every strong beat',
  everyNBeats: 'Every N beats',
  everyNSeconds: 'Every N seconds',
  section: 'Section change',
  loudJump: 'Quiet-to-loud jump',
};

export const RESPONSE_LABELS: Readonly<Record<ResponseType, string>> = {
  kick: 'Kick (jump, then ease back)',
  step: 'Step (move and hold)',
  flip: 'Flip (reverse direction)',
  drift: 'Drift (slow wander)',
  pick: 'Pick (random value)',
};
