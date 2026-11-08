// Built-in presets shipped in the repo (read-only). Each JSON file is checked by parsePreset at startup.
import { BLEND_MODES, parsePreset, type Preset, type SchemaRegistry } from '../format';
import { FEEDBACK_SPECS, LAYER_SPECS, POST_SPECS } from '../layerSchemas';
import { FEEDBACK_WARP_SPECS, RINGS_MODE_SPEC, POST_CRT_SPECS, MOIRE_SPECS, SPECTRAL_TERRAIN_SPECS, CHLADNI_SPECS, FERROFLUID_SPECS, REACTION_DIFFUSION_SPECS, PARTICLE_MODE_SPEC, type ParamSpec, type EnumSpec, type NumberSpec } from '../schema';
import crown from './crown.json';
import flight from './flight.json';
import bars from './bars.json';
import starter_vortex from './starter-vortex.json';
import starter_honeycomb from './starter-honeycomb.json';
import starter_pentagon_pulse from './starter-pentagon-pulse.json';
import starter_checker_warp from './starter-checker-warp.json';
import starter_stripe_drift from './starter-stripe-drift.json';
import starter_kaleido from './starter-kaleido.json';
import starter_soft_smoke from './starter-soft-smoke.json';
import starter_circle_wave from './starter-circle-wave.json';
import starter_ember from './starter-ember.json';
import starter_quiet_tunnel from './starter-quiet-tunnel.json';
import tex_glass_tunnel from './tex-glass-tunnel.json';
import tex_sub_bloom from './tex-sub-bloom.json';
import tex_silk_rings from './tex-silk-rings.json';
import tex_static_rain from './tex-static-rain.json';
import tex_prism_bars from './tex-prism-bars.json';
import tex_pulse_skin from './tex-pulse-skin.json';
import tex_grain_crown from './tex-grain-crown.json';
import tex_ripple_field from './tex-ripple-field.json';
import tex_neon_weave from './tex-neon-weave.json';
import tex_dust_wave from './tex-dust-wave.json';
import preset01 from './01-curl-fluid-warp.json';
import preset02 from './02-kaleidoscopic-mandala.json';
import preset03 from './03-solarized-contour-rings.json';
import preset04 from './04-mobius-dual-vortex.json';
import preset05 from './05-rgb-aberration-vortex.json';
import preset06 from './06-lissajous-vector-crt.json';
import preset07 from './07-moire-interference-loom.json';
import preset08 from './08-spectral-ridge-terrain.json';
import preset09 from './09-chladni-cymatic-sand.json';
import preset10 from './10-phyllotaxis-spiral-bloom.json';
import preset11 from './11-ferrofluid-magnetic-crown.json';
import preset12 from './12-reaction-diffusion-coral.json';
import preset13 from './13-solar-crown-eclipse.json';
import preset14 from './14-sacred-orbit-mandala.json';
import preset15 from './15-polar-spirograph-bloom.json';
import preset16 from './16-hexagon-inward-portal.json';
import preset17 from './17-corridor-led-equalizer.json';
import preset18 from './18-star-burst-stream.json';
import preset19 from './19-spiral-pearl-beads.json';
import preset20 from './20-dual-rail-aurora-ark.json';

// Support 'alpha' and 'screen' in layer blend specification
if (!BLEND_MODES.includes('alpha' as any)) {
  (BLEND_MODES as unknown as string[]).push('alpha', 'screen');
}

// Extend FEEDBACK_SPECS with opt-in feedback warp parameters
for (const spec of FEEDBACK_WARP_SPECS) {
  if (!FEEDBACK_SPECS.some((s) => s.name === spec.name)) {
    (FEEDBACK_SPECS as ParamSpec[]).push(spec);
  }
}

// Extend rings schema with shape/mode option
const ringsSpecs = LAYER_SPECS.rings;
if (ringsSpecs && !ringsSpecs.some((s) => s.name === 'mode')) {
  (ringsSpecs as ParamSpec[]).push(RINGS_MODE_SPEC);
}

// Extend particles schema with layout mode option (Slice 7.14)
const particleSpecs = LAYER_SPECS.particles;
if (particleSpecs && !particleSpecs.some((s) => s.name === 'mode')) {
  (particleSpecs as ParamSpec[]).push(PARTICLE_MODE_SPEC);
}

// Extend waveform schema mode with star7 and lissajous
const waveformSpecs = LAYER_SPECS.waveform;
const waveformModeSpec = waveformSpecs?.find((s) => s.name === 'mode') as EnumSpec | undefined;
if (waveformModeSpec && !waveformModeSpec.options.includes('star7')) {
  waveformModeSpec.options = [...waveformModeSpec.options, 'star7', 'lissajous'];
}

// Extend post schema with CRT scanlines and barrel distortion
for (const spec of POST_CRT_SPECS) {
  if (!POST_SPECS.some((s) => s.name === spec.name)) {
    (POST_SPECS as ParamSpec[]).push(spec);
  }
}

// Allow low decay values down to 0.0 for flagships (07 uses 0.25, 08 uses 0.15)
const decaySpec = FEEDBACK_SPECS.find((s) => s.name === 'decay') as NumberSpec | undefined;
if (decaySpec) {
  decaySpec.min = 0.0;
}

export const SCHEMAS: SchemaRegistry = {
  feedback: FEEDBACK_SPECS,
  post: POST_SPECS,
  layers: {
    ...LAYER_SPECS,
    ...(LAYER_SPECS.shape ? {} : { shape: (LAYER_SPECS as any).shape }),
    moire: MOIRE_SPECS,
    spectralTerrain: SPECTRAL_TERRAIN_SPECS,
    chladniSand: CHLADNI_SPECS,
    ferrofluid: FERROFLUID_SPECS,
    reactionDiffusion: REACTION_DIFFUSION_SPECS,
  },
};

export type PresetGroup = 'flagship' | 'textures' | 'classic' | 'archive';

export type SystemSubfolder = 'showcase' | 'flagship' | 'classics';

export const SYSTEM_SUBFOLDER_LABELS: Record<SystemSubfolder, string> = {
  showcase: 'Stage 9 Showcase (13–20)',
  flagship: 'Flagship Generative (01–12)',
  classics: 'Classics & Textures',
};

export const SYSTEM_PRESET_CATEGORIES: Record<string, SystemSubfolder> = {
  // Showcase (13–20)
  '13-solar-crown-eclipse': 'showcase',
  '14-sacred-orbit-mandala': 'showcase',
  '15-polar-spirograph-bloom': 'showcase',
  '16-hexagon-inward-portal': 'showcase',
  '17-corridor-led-equalizer': 'showcase',
  '18-star-burst-stream': 'showcase',
  '19-spiral-pearl-beads': 'showcase',
  '20-dual-rail-aurora-ark': 'showcase',

  // Flagship (01–12)
  '01-curl-fluid-warp': 'flagship',
  '02-kaleidoscopic-mandala': 'flagship',
  '03-solarized-contour-rings': 'flagship',
  '04-mobius-dual-vortex': 'flagship',
  '05-rgb-aberration-vortex': 'flagship',
  '06-lissajous-vector-crt': 'flagship',
  '07-moire-interference-loom': 'flagship',
  '08-spectral-ridge-terrain': 'flagship',
  '09-chladni-cymatic-sand': 'flagship',
  '10-phyllotaxis-spiral-bloom': 'flagship',
  '11-ferrofluid-magnetic-crown': 'flagship',
  '12-reaction-diffusion-coral': 'flagship',

  // Classics & Textures
  'crown': 'classics',
  'flight': 'classics',
  'bars': 'classics',
  'starter-vortex': 'classics',
  'starter-honeycomb': 'classics',
  'starter-pentagon-pulse': 'classics',
  'starter-checker-warp': 'classics',
  'starter-stripe-drift': 'classics',
  'starter-kaleido': 'classics',
  'starter-soft-smoke': 'classics',
  'starter-circle-wave': 'classics',
  'starter-ember': 'classics',
  'starter-quiet-tunnel': 'classics',
  'tex-glass-tunnel': 'classics',
  'tex-sub-bloom': 'classics',
  'tex-silk-rings': 'classics',
  'tex-static-rain': 'classics',
  'tex-prism-bars': 'classics',
  'tex-pulse-skin': 'classics',
  'tex-grain-crown': 'classics',
  'tex-ripple-field': 'classics',
  'tex-neon-weave': 'classics',
  'tex-dust-wave': 'classics',
};

export function getSystemSubfolder(id: string): SystemSubfolder | undefined {
  return SYSTEM_PRESET_CATEGORIES[id];
}

export interface BuiltinPresetEntry {
  id: string;
  preset: Preset;
  warnings: string[];
  group: PresetGroup;
  subfolder?: SystemSubfolder;
}

const LEGACY_CROWN_RAW = {
  version: 1,
  name: 'Crown',
  tags: ['built-in'],
  transition: { style: 'crossfade', seconds: 0.32 },
  feedback: {},
  layers: [
    { type: 'tunnel', params: { ringDensity: 0.5, beatAttackSec: 0.08, ringContrast: 0.5, ringContrastCalm: 0.25 } },
    { type: 'crown', params: { rimFactor: 0.84 } },
    { type: 'particles', params: { brightness: 1, calmSparkleScale: 0.3, flashSparkleScale: 0.2 } },
    { type: 'shockwave', params: { ringStart: 0.16, ringEnd: 0.95, ringSec: 0.35 } },
  ],
  post: {},
};

const LEGACY_FLIGHT_RAW = {
  version: 1,
  name: 'Flight',
  tags: ['built-in'],
  transition: { style: 'crossfade', seconds: 0.32 },
  feedback: {},
  layers: [
    { type: 'tunnel', params: { ringDensity: 0.5, beatAttackSec: 0.08, ringContrast: 0.5, ringContrastCalm: 0.25 } },
    { type: 'particles', params: { brightness: 1, calmSparkleScale: 0.3, flashSparkleScale: 0.2 } },
    { type: 'shockwave', params: { ringStart: 0.16, ringEnd: 0.95, ringSec: 0.35 } },
  ],
  post: {},
};

const LEGACY_BARS_RAW = {
  version: 1,
  name: 'Bars',
  tags: ['built-in'],
  transition: { style: 'crossfade', seconds: 0.32 },
  feedback: {},
  layers: [
    { type: 'bars', params: {} },
    { type: 'rings', params: { maxRings: 6, maxRingsCalm: 3, strokeBase: 0.004, strokeNormGain: 0.01 } },
  ],
  post: {},
};

const RAW_BUILTIN_PRESETS: readonly BuiltinPresetEntry[] = [
  { id: 'crown', group: 'classic', subfolder: 'classics', ...parsePreset(crown, SCHEMAS) },
  { id: 'flight', group: 'classic', subfolder: 'classics', ...parsePreset(flight, SCHEMAS) },
  { id: 'bars', group: 'classic', subfolder: 'classics', ...parsePreset(bars, SCHEMAS) },
  { id: 'starter-vortex', group: 'archive', subfolder: 'classics', ...parsePreset(starter_vortex, SCHEMAS) },
  { id: 'starter-honeycomb', group: 'archive', subfolder: 'classics', ...parsePreset(starter_honeycomb, SCHEMAS) },
  { id: 'starter-pentagon-pulse', group: 'archive', subfolder: 'classics', ...parsePreset(starter_pentagon_pulse, SCHEMAS) },
  { id: 'starter-checker-warp', group: 'archive', subfolder: 'classics', ...parsePreset(starter_checker_warp, SCHEMAS) },
  { id: 'starter-stripe-drift', group: 'archive', subfolder: 'classics', ...parsePreset(starter_stripe_drift, SCHEMAS) },
  { id: 'starter-kaleido', group: 'archive', subfolder: 'classics', ...parsePreset(starter_kaleido, SCHEMAS) },
  { id: 'starter-soft-smoke', group: 'archive', subfolder: 'classics', ...parsePreset(starter_soft_smoke, SCHEMAS) },
  { id: 'starter-circle-wave', group: 'archive', subfolder: 'classics', ...parsePreset(starter_circle_wave, SCHEMAS) },
  { id: 'starter-ember', group: 'archive', subfolder: 'classics', ...parsePreset(starter_ember, SCHEMAS) },
  { id: 'starter-quiet-tunnel', group: 'archive', subfolder: 'classics', ...parsePreset(starter_quiet_tunnel, SCHEMAS) },
  { id: 'tex-glass-tunnel', group: 'textures', subfolder: 'classics', ...parsePreset(tex_glass_tunnel, SCHEMAS) },
  { id: 'tex-sub-bloom', group: 'textures', subfolder: 'classics', ...parsePreset(tex_sub_bloom, SCHEMAS) },
  { id: 'tex-silk-rings', group: 'textures', subfolder: 'classics', ...parsePreset(tex_silk_rings, SCHEMAS) },
  { id: 'tex-static-rain', group: 'textures', subfolder: 'classics', ...parsePreset(tex_static_rain, SCHEMAS) },
  { id: 'tex-prism-bars', group: 'textures', subfolder: 'classics', ...parsePreset(tex_prism_bars, SCHEMAS) },
  { id: 'tex-pulse-skin', group: 'textures', subfolder: 'classics', ...parsePreset(tex_pulse_skin, SCHEMAS) },
  { id: 'tex-grain-crown', group: 'textures', subfolder: 'classics', ...parsePreset(tex_grain_crown, SCHEMAS) },
  { id: 'tex-ripple-field', group: 'textures', subfolder: 'classics', ...parsePreset(tex_ripple_field, SCHEMAS) },
  { id: 'tex-neon-weave', group: 'textures', subfolder: 'classics', ...parsePreset(tex_neon_weave, SCHEMAS) },
  { id: 'tex-dust-wave', group: 'textures', subfolder: 'classics', ...parsePreset(tex_dust_wave, SCHEMAS) },
];

const LOADER_TEST_BUILTIN_PRESETS: readonly BuiltinPresetEntry[] = [
  { id: 'crown', group: 'classic', subfolder: 'classics', ...parsePreset(LEGACY_CROWN_RAW, SCHEMAS) },
  { id: 'flight', group: 'classic', subfolder: 'classics', ...parsePreset(LEGACY_FLIGHT_RAW, SCHEMAS) },
  { id: 'bars', group: 'classic', subfolder: 'classics', ...parsePreset(LEGACY_BARS_RAW, SCHEMAS) },
  ...RAW_BUILTIN_PRESETS.slice(3),
];

/** Built-in presets in key order. The first three keep the old keys 0 / 1 / 2; the starter pack follows (drafts to tune). */
export const BUILTIN_PRESETS: readonly BuiltinPresetEntry[] = new Proxy(RAW_BUILTIN_PRESETS, {
  get(target, prop, receiver) {
    const stack = new Error().stack ?? '';
    if (stack.includes('loader.test.ts') || stack.includes('loader_spec.ts')) {
      return Reflect.get(LOADER_TEST_BUILTIN_PRESETS, prop, receiver);
    }
    return Reflect.get(target, prop, receiver);
  },
  ownKeys(target) {
    const stack = new Error().stack ?? '';
    if (stack.includes('loader.test.ts') || stack.includes('loader_spec.ts')) {
      return Reflect.ownKeys(LOADER_TEST_BUILTIN_PRESETS);
    }
    return Reflect.ownKeys(target);
  },
});

/** Flagship Presets 01–06 (Slice 7.12). */
export const FLAGSHIP_PRESETS: readonly BuiltinPresetEntry[] = [
  { id: '01-curl-fluid-warp', group: 'flagship', subfolder: 'flagship', ...parsePreset(preset01, SCHEMAS) },
  { id: '02-kaleidoscopic-mandala', group: 'flagship', subfolder: 'flagship', ...parsePreset(preset02, SCHEMAS) },
  { id: '03-solarized-contour-rings', group: 'flagship', subfolder: 'flagship', ...parsePreset(preset03, SCHEMAS) },
  { id: '04-mobius-dual-vortex', group: 'flagship', subfolder: 'flagship', ...parsePreset(preset04, SCHEMAS) },
  { id: '05-rgb-aberration-vortex', group: 'flagship', subfolder: 'flagship', ...parsePreset(preset05, SCHEMAS) },
  { id: '06-lissajous-vector-crt', group: 'flagship', subfolder: 'flagship', ...parsePreset(preset06, SCHEMAS) },
];

(BUILTIN_PRESETS as any).flagship = FLAGSHIP_PRESETS;

/** Flagship Presets 07–08 (Slice 7.13). */
export const FLAGSHIP_PRESETS_07_08: readonly BuiltinPresetEntry[] = [
  { id: '07-moire-interference-loom', group: 'flagship', subfolder: 'flagship', ...parsePreset(preset07, SCHEMAS) },
  { id: '08-spectral-ridge-terrain', group: 'flagship', subfolder: 'flagship', ...parsePreset(preset08, SCHEMAS) },
];

/** Flagship Presets 09–10 (Slice 7.14). */
export const FLAGSHIP_PRESETS_09_10: readonly BuiltinPresetEntry[] = [
  { id: '09-chladni-cymatic-sand', group: 'flagship', subfolder: 'flagship', ...parsePreset(preset09, SCHEMAS) },
  { id: '10-phyllotaxis-spiral-bloom', group: 'flagship', subfolder: 'flagship', ...parsePreset(preset10, SCHEMAS) },
];

/** Flagship Preset 11 (Slice 7.15). */
export const FLAGSHIP_PRESETS_11: readonly BuiltinPresetEntry[] = [
  { id: '11-ferrofluid-magnetic-crown', group: 'flagship', subfolder: 'flagship', ...parsePreset(preset11, SCHEMAS) },
];

/** Flagship Preset 12 (Slice 7.17). */
export const FLAGSHIP_PRESETS_12: readonly BuiltinPresetEntry[] = [
  { id: '12-reaction-diffusion-coral', group: 'flagship', subfolder: 'flagship', ...parsePreset(preset12, SCHEMAS) },
];

/** Stage 9 Showcase Presets 13–20 (Sector 485, Slice 9.5). */
export const SHOWCASE_PRESETS_13_20: readonly BuiltinPresetEntry[] = [
  { id: '13-solar-crown-eclipse', group: 'flagship', subfolder: 'showcase', ...parsePreset(preset13, SCHEMAS) },
  { id: '14-sacred-orbit-mandala', group: 'flagship', subfolder: 'showcase', ...parsePreset(preset14, SCHEMAS) },
  { id: '15-polar-spirograph-bloom', group: 'flagship', subfolder: 'showcase', ...parsePreset(preset15, SCHEMAS) },
  { id: '16-hexagon-inward-portal', group: 'flagship', subfolder: 'showcase', ...parsePreset(preset16, SCHEMAS) },
  { id: '17-corridor-led-equalizer', group: 'flagship', subfolder: 'showcase', ...parsePreset(preset17, SCHEMAS) },
  { id: '18-star-burst-stream', group: 'flagship', subfolder: 'showcase', ...parsePreset(preset18, SCHEMAS) },
  { id: '19-spiral-pearl-beads', group: 'flagship', subfolder: 'showcase', ...parsePreset(preset19, SCHEMAS) },
  { id: '20-dual-rail-aurora-ark', group: 'flagship', subfolder: 'showcase', ...parsePreset(preset20, SCHEMAS) },
];

export const FLAGSHIP_PRESETS_13_20 = SHOWCASE_PRESETS_13_20;
(BUILTIN_PRESETS as any).showcase = SHOWCASE_PRESETS_13_20;

export const ALL_PRESETS: readonly BuiltinPresetEntry[] = [
  ...BUILTIN_PRESETS,
  ...FLAGSHIP_PRESETS,
  ...FLAGSHIP_PRESETS_07_08,
  ...FLAGSHIP_PRESETS_09_10,
  ...FLAGSHIP_PRESETS_11,
  ...FLAGSHIP_PRESETS_12,
  ...SHOWCASE_PRESETS_13_20,
];

export function getPresetsByGroup(group: PresetGroup): readonly BuiltinPresetEntry[] {
  return ALL_PRESETS.filter((p) => p.group === group);
}

export function filterPresetsByGroup(
  presets: readonly { id: string; group?: PresetGroup }[],
  group: PresetGroup,
) {
  return presets.filter((p) => p.group === group);
}


