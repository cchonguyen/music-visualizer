// Loader (slice 4.3): turns a validated Preset into a Scene. The layer registry maps a
// layer type name ("tunnel") to the class that draws it. Adding a layer type = one line here.
import type { RenderLayer } from '../render/layer';
import { Scene, type BlendMode, type SceneLayerConfig } from '../render/scene';
import { BarsLayer } from '../render/layers/bars';
import { BassPulseLayer } from '../render/layers/bassPulse';
import { CrownLayer } from '../render/layers/crown';
import { ParticleLayer } from '../render/layers/particles';
import { RingsLayer } from '../render/layers/rings';
import { ShockwaveLayer } from '../render/layers/shockwave';
import { TunnelLayer } from '../render/layers/tunnel';
import { WaveformLayer } from '../render/layers/waveform';
import type { Preset, Settings } from './format';
import { LinkRunner, type LinkInputs } from './links';
import { FEEDBACK_SPECS, LAYER_SPECS, POST_SPECS } from './layerSchemas';
import type { ParamValue } from './schema';
import type { BarsParams, BassPulseParams, CrownParams, ParticleParams, RingsParams, ShockwaveParams, TunnelParams, WaveformParams } from './layerSchemas';

type LayerFactory = (params: Record<string, ParamValue>) => RenderLayer;

/** Flattens {value, link} settings to plain values. Links are not applied yet (slice E2). */
export function valuesOf(settings: Settings): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const [name, setting] of Object.entries(settings)) out[name] = setting.value;
  return out;
}

// Values come from parsePreset, which has already checked every name and range against
// layerSchemas.ts. The casts below rely on that check.
export const LAYER_FACTORIES: Readonly<Record<string, LayerFactory>> = {
  tunnel: (p) => new TunnelLayer(p as Partial<TunnelParams>),
  particles: (p) => new ParticleLayer(p as Partial<ParticleParams>),
  crown: (p) => new CrownLayer(p as Partial<CrownParams>),
  rings: (p) => new RingsLayer(p as Partial<RingsParams>),
  shockwave: (p) => new ShockwaveLayer(p as Partial<ShockwaveParams>),
  bars: (p) => new BarsLayer(p as Partial<BarsParams>),
  bassPulse: (p) => new BassPulseLayer(p as Partial<BassPulseParams>),
  waveform: (p) => new WaveformLayer(p as Partial<WaveformParams>),
};

/** Builds a scene with fresh layers. Disabled layers are skipped. */
export function buildScene(name: string, preset: Preset): Scene {
  const layers: RenderLayer[] = [];
  const configs: SceneLayerConfig[] = [];
  for (const entry of preset.layers) {
    if (!entry.enabled) continue;
    const factory = LAYER_FACTORIES[entry.type];
    if (!factory) throw new Error(`buildScene: no factory for layer "${entry.type}"`);
    layers.push(factory(valuesOf(entry.params)));
    configs.push({
      opacity: entry.opacity ?? 1.0,
      blend: (entry.blend as BlendMode) ?? 'max',
    });
  }
  const scene = new Scene(name, layers, configs);
  scene.setFeedback(valuesOf(preset.feedback));
  return scene;
}

/** Pushes plain values into a live layer. */
export function applyValues(layer: RenderLayer, values: Record<string, ParamValue>): void {
  if (layer instanceof TunnelLayer) layer.setParams(values as Partial<TunnelParams>);
  else if (layer instanceof BarsLayer) layer.setParams(values as Partial<BarsParams>);
  else if (layer instanceof BassPulseLayer) layer.setParams(values as Partial<BassPulseParams>);
  else if (layer instanceof ParticleLayer) layer.setParams(values as Partial<ParticleParams>);
  else if (layer instanceof CrownLayer) layer.setParams(values as Partial<CrownParams>);
  else if (layer instanceof RingsLayer) layer.setParams(values as Partial<RingsParams>);
  else if (layer instanceof ShockwaveLayer) layer.setParams(values as Partial<ShockwaveParams>);
  else if (layer instanceof WaveformLayer) layer.setParams(values as Partial<WaveformParams>);
}

/** Pushes every enabled layer's settings from `preset` into a scene built from it (same order). */
export function applyPresetToScene(preset: Preset, scene: Scene): void {
  scene.setFeedback(valuesOf(preset.feedback));
  const live = preset.layers.filter((l) => l.enabled);
  live.forEach((entry, k) => {
    const layer = scene.layers[k];
    if (layer) applyValues(layer, valuesOf(entry.params));
    scene.setLayerConfig(k, {
      opacity: entry.opacity ?? 1.0,
      blend: (entry.blend as BlendMode) ?? 'max',
    });
  });
}

/** True when any setting of the preset has an audio link. */
export function hasLinks(preset: Preset): boolean {
  const all = [...preset.layers.flatMap((l) => Object.values(l.params)), ...Object.values(preset.feedback), ...Object.values(preset.post)];
  return all.some((setting) => setting.link !== undefined);
}

/**
 * Per-frame version of applyPresetToScene for presets with audio links. `scope` identifies the
 * preset in the link runner (its id). Each layer's scope is `${scope}L${k}`, and feedback's is `${scope}F`.
 */
export function applyLinkedPreset(preset: Preset, scene: Scene, runner: LinkRunner, scope: string, inputs: LinkInputs, dtSec: number): Record<string, ParamValue> {
  scene.setFeedback(runner.resolve(`${scope}F`, preset.feedback, FEEDBACK_SPECS, inputs, dtSec));
  const live = preset.layers.filter((l) => l.enabled);
  live.forEach((entry, k) => {
    const layer = scene.layers[k];
    if (!layer) return;
    applyValues(layer, runner.resolve(`${scope}L${k}`, entry.params, LAYER_SPECS[entry.type] ?? [], inputs, dtSec));
    scene.setLayerConfig(k, {
      opacity: entry.opacity ?? 1.0,
      blend: (entry.blend as BlendMode) ?? 'max',
    });
  });
  return runner.resolve(`${scope}P`, preset.post, POST_SPECS, inputs, dtSec);
}

/** True when preset contains an enabled layer with type === 'crown'. */
export function hasCrownLayer(preset?: { layers: { type: string; enabled?: boolean }[] } | null): boolean {
  return Boolean(preset?.layers?.some((l) => l.enabled !== false && l.type === 'crown'));
}
