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
];
