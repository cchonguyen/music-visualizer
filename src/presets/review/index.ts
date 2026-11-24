// Retired or near-duplicate presets kept for later tuning (moved out of the default list in Slice 15.10).
// Only tests import this module, so these presets are not in the app bundle (Slice 31.3).
import { parsePreset, type PresetMood, type PresetTheme } from '../format';
import { SCHEMAS, type BuiltinPresetEntry } from '../builtin';
import { migrateWaveformsInPreset } from '../legacyShapeMigration';
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
import tex_neon_weave from './tex-neon-weave.json';
import preset12 from './12-reaction-diffusion-coral.json';

export const REVIEW_PRESETS: readonly BuiltinPresetEntry[] = [
  { id: '12-reaction-diffusion-coral', group: 'flagship', subfolder: 'flagship', ...parsePreset(preset12, SCHEMAS) },
  { id: 'starter-honeycomb', group: 'archive', subfolder: 'classics', ...parsePreset(starter_honeycomb, SCHEMAS) },
  { id: 'starter-pentagon-pulse', group: 'archive', subfolder: 'classics', ...parsePreset(starter_pentagon_pulse, SCHEMAS) },
  { id: 'starter-checker-warp', group: 'archive', subfolder: 'classics', ...parsePreset(starter_checker_warp, SCHEMAS) },
  { id: 'starter-stripe-drift', group: 'archive', subfolder: 'classics', ...parsePreset(starter_stripe_drift, SCHEMAS) },
  { id: 'starter-kaleido', group: 'archive', subfolder: 'classics', ...parsePreset(starter_kaleido, SCHEMAS) },
  { id: 'starter-soft-smoke', group: 'archive', subfolder: 'classics', ...parsePreset(starter_soft_smoke, SCHEMAS) },
  { id: 'starter-circle-wave', group: 'archive', subfolder: 'classics', ...migrateWaveformsInPreset(parsePreset(starter_circle_wave, SCHEMAS)) },
  { id: 'starter-ember', group: 'archive', subfolder: 'classics', ...parsePreset(starter_ember, SCHEMAS) },
  { id: 'starter-quiet-tunnel', group: 'archive', subfolder: 'classics', ...parsePreset(starter_quiet_tunnel, SCHEMAS) },
  { id: 'tex-glass-tunnel', group: 'textures', subfolder: 'classics', ...parsePreset(tex_glass_tunnel, SCHEMAS) },
  { id: 'tex-sub-bloom', group: 'textures', subfolder: 'classics', ...parsePreset(tex_sub_bloom, SCHEMAS) },
  { id: 'tex-silk-rings', group: 'textures', subfolder: 'classics', ...parsePreset(tex_silk_rings, SCHEMAS) },
  { id: 'tex-static-rain', group: 'textures', subfolder: 'classics', ...parsePreset(tex_static_rain, SCHEMAS) },
  { id: 'tex-prism-bars', group: 'textures', subfolder: 'classics', ...parsePreset(tex_prism_bars, SCHEMAS) },
  { id: 'tex-pulse-skin', group: 'textures', subfolder: 'classics', ...parsePreset(tex_pulse_skin, SCHEMAS) },
  { id: 'tex-grain-crown', group: 'textures', subfolder: 'classics', ...parsePreset(tex_grain_crown, SCHEMAS) },
  { id: 'tex-neon-weave', group: 'textures', subfolder: 'classics', ...parsePreset(tex_neon_weave, SCHEMAS) },
];

/** Theme and mood of each review preset, so it is tagged if it returns to the default list. */
export const REVIEW_TAXONOMY: Readonly<Record<string, { theme: PresetTheme; mood: PresetMood }>> = {
  '12-reaction-diffusion-coral': { theme: 'fluid', mood: 'dreamy' },
  'starter-honeycomb': { theme: 'geometric', mood: 'calm' },
  'starter-pentagon-pulse': { theme: 'geometric', mood: 'driving' },
  'starter-checker-warp': { theme: 'hypnotic', mood: 'driving' },
  'starter-stripe-drift': { theme: 'hypnotic', mood: 'calm' },
  'starter-kaleido': { theme: 'geometric', mood: 'dreamy' },
  'starter-soft-smoke': { theme: 'fluid', mood: 'calm' },
  'starter-circle-wave': { theme: 'waveform', mood: 'calm' },
  'starter-ember': { theme: 'particles', mood: 'dark' },
  'starter-quiet-tunnel': { theme: 'hypnotic', mood: 'calm' },
  'tex-glass-tunnel': { theme: 'hypnotic', mood: 'calm' },
  'tex-sub-bloom': { theme: 'hypnotic', mood: 'dark' },
  'tex-silk-rings': { theme: 'geometric', mood: 'calm' },
  'tex-static-rain': { theme: 'particles', mood: 'dark' },
  'tex-prism-bars': { theme: 'waveform', mood: 'bright' },
  'tex-pulse-skin': { theme: 'hypnotic', mood: 'driving' },
  'tex-grain-crown': { theme: 'geometric', mood: 'calm' },
  'tex-neon-weave': { theme: 'hypnotic', mood: 'bright' },
};

for (const entry of REVIEW_PRESETS) {
  const tag = REVIEW_TAXONOMY[entry.id];
  if (!tag) continue;
  if (!entry.preset.theme) entry.preset.theme = tag.theme;
  if (!entry.preset.mood) entry.preset.mood = tag.mood;
}
