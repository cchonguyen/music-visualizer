// Built-in presets shipped in the repo (read-only). Each JSON file is checked by parsePreset at startup.
import { parsePreset, type Preset, type SchemaRegistry } from '../format';
import { FEEDBACK_SPECS, LAYER_SPECS, POST_SPECS } from '../layerSchemas';
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

export const SCHEMAS: SchemaRegistry = { feedback: FEEDBACK_SPECS, post: POST_SPECS, layers: LAYER_SPECS };

/** Built-in presets in key order. The first three keep the old keys 0 / 1 / 2; the starter pack follows (drafts to tune). */
export const BUILTIN_PRESETS: readonly { id: string; preset: Preset; warnings: string[] }[] = [
  { id: 'crown', ...parsePreset(crown, SCHEMAS) },
  { id: 'flight', ...parsePreset(flight, SCHEMAS) },
  { id: 'bars', ...parsePreset(bars, SCHEMAS) },
  { id: 'starter-vortex', ...parsePreset(starter_vortex, SCHEMAS) },
  { id: 'starter-honeycomb', ...parsePreset(starter_honeycomb, SCHEMAS) },
  { id: 'starter-pentagon-pulse', ...parsePreset(starter_pentagon_pulse, SCHEMAS) },
  { id: 'starter-checker-warp', ...parsePreset(starter_checker_warp, SCHEMAS) },
  { id: 'starter-stripe-drift', ...parsePreset(starter_stripe_drift, SCHEMAS) },
  { id: 'starter-kaleido', ...parsePreset(starter_kaleido, SCHEMAS) },
  { id: 'starter-soft-smoke', ...parsePreset(starter_soft_smoke, SCHEMAS) },
  { id: 'starter-circle-wave', ...parsePreset(starter_circle_wave, SCHEMAS) },
  { id: 'starter-ember', ...parsePreset(starter_ember, SCHEMAS) },
  { id: 'starter-quiet-tunnel', ...parsePreset(starter_quiet_tunnel, SCHEMAS) },
  { id: 'tex-glass-tunnel', ...parsePreset(tex_glass_tunnel, SCHEMAS) },
  { id: 'tex-sub-bloom', ...parsePreset(tex_sub_bloom, SCHEMAS) },
  { id: 'tex-silk-rings', ...parsePreset(tex_silk_rings, SCHEMAS) },
  { id: 'tex-static-rain', ...parsePreset(tex_static_rain, SCHEMAS) },
  { id: 'tex-prism-bars', ...parsePreset(tex_prism_bars, SCHEMAS) },
  { id: 'tex-pulse-skin', ...parsePreset(tex_pulse_skin, SCHEMAS) },
  { id: 'tex-grain-crown', ...parsePreset(tex_grain_crown, SCHEMAS) },
  { id: 'tex-ripple-field', ...parsePreset(tex_ripple_field, SCHEMAS) },
  { id: 'tex-neon-weave', ...parsePreset(tex_neon_weave, SCHEMAS) },
];
