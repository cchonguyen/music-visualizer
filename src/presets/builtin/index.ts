// Built-in presets shipped in the repo (read-only). Each JSON file is checked by parsePreset at startup.
import { BLEND_MODES, parsePreset, type Preset, type SchemaRegistry } from '../format';
import { FEEDBACK_SPECS, LAYER_SPECS, POST_SPECS } from '../layerSchemas';
import { FEEDBACK_WARP_SPECS, RINGS_MODE_SPEC, POST_CRT_SPECS, MOIRE_SPECS, SPECTRAL_TERRAIN_SPECS, CHLADNI_SPECS, FERROFLUID_SPECS, PARTICLE_MODE_SPEC, type ParamSpec, type EnumSpec, type NumberSpec } from '../schema';
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
    moire: MOIRE_SPECS,
    spectralTerrain: SPECTRAL_TERRAIN_SPECS,
    chladniSand: CHLADNI_SPECS,
    ferrofluid: FERROFLUID_SPECS,
  },
};

export type PresetGroup = 'flagship' | 'textures' | 'classic' | 'archive';

export interface BuiltinPresetEntry {
  id: string;
  preset: Preset;
  warnings: string[];
  group: PresetGroup;
}

/** Built-in presets in key order. The first three keep the old keys 0 / 1 / 2; the starter pack follows (drafts to tune). */
export const BUILTIN_PRESETS: readonly BuiltinPresetEntry[] = [
  { id: 'crown', group: 'classic', ...parsePreset(crown, SCHEMAS) },
  { id: 'flight', group: 'classic', ...parsePreset(flight, SCHEMAS) },
  { id: 'bars', group: 'classic', ...parsePreset(bars, SCHEMAS) },
  { id: 'starter-vortex', group: 'archive', ...parsePreset(starter_vortex, SCHEMAS) },
  { id: 'starter-honeycomb', group: 'archive', ...parsePreset(starter_honeycomb, SCHEMAS) },
  { id: 'starter-pentagon-pulse', group: 'archive', ...parsePreset(starter_pentagon_pulse, SCHEMAS) },
  { id: 'starter-checker-warp', group: 'archive', ...parsePreset(starter_checker_warp, SCHEMAS) },
  { id: 'starter-stripe-drift', group: 'archive', ...parsePreset(starter_stripe_drift, SCHEMAS) },
  { id: 'starter-kaleido', group: 'archive', ...parsePreset(starter_kaleido, SCHEMAS) },
  { id: 'starter-soft-smoke', group: 'archive', ...parsePreset(starter_soft_smoke, SCHEMAS) },
  { id: 'starter-circle-wave', group: 'archive', ...parsePreset(starter_circle_wave, SCHEMAS) },
  { id: 'starter-ember', group: 'archive', ...parsePreset(starter_ember, SCHEMAS) },
  { id: 'starter-quiet-tunnel', group: 'archive', ...parsePreset(starter_quiet_tunnel, SCHEMAS) },
  { id: 'tex-glass-tunnel', group: 'textures', ...parsePreset(tex_glass_tunnel, SCHEMAS) },
  { id: 'tex-sub-bloom', group: 'textures', ...parsePreset(tex_sub_bloom, SCHEMAS) },
  { id: 'tex-silk-rings', group: 'textures', ...parsePreset(tex_silk_rings, SCHEMAS) },
  { id: 'tex-static-rain', group: 'textures', ...parsePreset(tex_static_rain, SCHEMAS) },
  { id: 'tex-prism-bars', group: 'textures', ...parsePreset(tex_prism_bars, SCHEMAS) },
  { id: 'tex-pulse-skin', group: 'textures', ...parsePreset(tex_pulse_skin, SCHEMAS) },
  { id: 'tex-grain-crown', group: 'textures', ...parsePreset(tex_grain_crown, SCHEMAS) },
  { id: 'tex-ripple-field', group: 'textures', ...parsePreset(tex_ripple_field, SCHEMAS) },
  { id: 'tex-neon-weave', group: 'textures', ...parsePreset(tex_neon_weave, SCHEMAS) },
  { id: 'tex-dust-wave', group: 'textures', ...parsePreset(tex_dust_wave, SCHEMAS) },
];

/** Flagship Presets 01–06 (Slice 7.12). */
export const FLAGSHIP_PRESETS: readonly BuiltinPresetEntry[] = [
  { id: '01-curl-fluid-warp', group: 'flagship', ...parsePreset(preset01, SCHEMAS) },
  { id: '02-kaleidoscopic-mandala', group: 'flagship', ...parsePreset(preset02, SCHEMAS) },
  { id: '03-solarized-contour-rings', group: 'flagship', ...parsePreset(preset03, SCHEMAS) },
  { id: '04-mobius-dual-vortex', group: 'flagship', ...parsePreset(preset04, SCHEMAS) },
  { id: '05-rgb-aberration-vortex', group: 'flagship', ...parsePreset(preset05, SCHEMAS) },
  { id: '06-lissajous-vector-crt', group: 'flagship', ...parsePreset(preset06, SCHEMAS) },
];

(BUILTIN_PRESETS as any).flagship = FLAGSHIP_PRESETS;

/** Flagship Presets 07–08 (Slice 7.13). */
export const FLAGSHIP_PRESETS_07_08: readonly BuiltinPresetEntry[] = [
  { id: '07-moire-interference-loom', group: 'flagship', ...parsePreset(preset07, SCHEMAS) },
  { id: '08-spectral-ridge-terrain', group: 'flagship', ...parsePreset(preset08, SCHEMAS) },
];

/** Flagship Presets 09–10 (Slice 7.14). */
export const FLAGSHIP_PRESETS_09_10: readonly BuiltinPresetEntry[] = [
  { id: '09-chladni-cymatic-sand', group: 'flagship', ...parsePreset(preset09, SCHEMAS) },
  { id: '10-phyllotaxis-spiral-bloom', group: 'flagship', ...parsePreset(preset10, SCHEMAS) },
];

/** Flagship Preset 11 (Slice 7.15). */
export const FLAGSHIP_PRESETS_11: readonly BuiltinPresetEntry[] = [
  { id: '11-ferrofluid-magnetic-crown', group: 'flagship', ...parsePreset(preset11, SCHEMAS) },
];

export const ALL_PRESETS: readonly BuiltinPresetEntry[] = [
  ...BUILTIN_PRESETS,
  ...FLAGSHIP_PRESETS,
  ...FLAGSHIP_PRESETS_07_08,
  ...FLAGSHIP_PRESETS_09_10,
  ...FLAGSHIP_PRESETS_11,
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


