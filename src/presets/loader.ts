// Loader (slice 4.3): turns a validated Preset into a Scene. The layer registry maps a
// layer type name ("tunnel") to the class that draws it. Adding a layer type = one line here.
import type { RenderLayer } from '../render/layer';
import { Scene, type BlendMode, type SceneLayerConfig, FEEDBACK_WARP_DEFAULTS } from '../render/scene';
import { ShapeLayer } from '../render/layers/shape';
import { BarsLayer } from '../render/layers/bars';
import { BassPulseLayer } from '../render/layers/bassPulse';
import { CrownLayer } from '../render/layers/crown';
import { ParticleLayer } from '../render/layers/particles';
import { RingsLayer } from '../render/layers/rings';
import { ShockwaveLayer } from '../render/layers/shockwave';
import { TunnelLayer } from '../render/layers/tunnel';
import { WaveformLayer } from '../render/layers/waveform';
import { MoireLayer } from '../render/layers/moire';
import { SpectralTerrainLayer } from '../render/layers/spectralTerrain';
import { ChladniSandLayer } from '../render/layers/chladniSand';
import { FerrofluidLayer } from '../render/layers/ferrofluid';
import { ReactionDiffusionLayer } from '../render/layers/reactionDiffusion';
import type { Preset, Settings } from './format';
import type { ResolvedWarpOp } from '../render/warpField';
import { warpOpSpecs } from './warpOps';
import { LinkRunner, type LinkInputs } from './links';
import type { ReactionEngine } from './reactions';
import { FEEDBACK_DEFAULTS, FEEDBACK_SPECS, LAYER_SPECS, POST_SPECS } from './layerSchemas';
import { FEEDBACK_WARP_SPECS, MOIRE_SPECS, SPECTRAL_TERRAIN_SPECS, CHLADNI_SPECS, FERROFLUID_SPECS, REACTION_DIFFUSION_SPECS, PARTICLE_MODE_SPEC, type MoireParams, type SpectralTerrainParams, type ChladniSandParams, type FerrofluidParams, type ReactionDiffusionParams, type ParamSpec, type ParamValue } from './schema';
import type { BarsParams, BassPulseParams, CrownParams, ParticleParams, RingsParams, ShockwaveParams, TunnelParams, WaveformParams, ShapeParams } from './layerSchemas';
import { migrateLegacyLayers, migrateLegacyLayerToShape } from './legacyShapeMigration';

// Register moire and spectralTerrain in LAYER_SPECS for loader consumers
if (!LAYER_SPECS.moire) {
  (LAYER_SPECS as Record<string, readonly ParamSpec[]>).moire = MOIRE_SPECS;
}
if (!LAYER_SPECS.spectralTerrain) {
  (LAYER_SPECS as Record<string, readonly ParamSpec[]>).spectralTerrain = SPECTRAL_TERRAIN_SPECS;
}
if (!LAYER_SPECS.chladniSand) {
  (LAYER_SPECS as Record<string, readonly ParamSpec[]>).chladniSand = CHLADNI_SPECS;
}
if (!LAYER_SPECS.ferrofluid) {
  (LAYER_SPECS as Record<string, readonly ParamSpec[]>).ferrofluid = FERROFLUID_SPECS;
}
if (!LAYER_SPECS.reactionDiffusion) {
  (LAYER_SPECS as Record<string, readonly ParamSpec[]>).reactionDiffusion = REACTION_DIFFUSION_SPECS;
}
if (LAYER_SPECS.particles && !LAYER_SPECS.particles.some((s) => s.name === 'mode')) {
  (LAYER_SPECS.particles as ParamSpec[]).push(PARTICLE_MODE_SPEC);
}

// Extend FEEDBACK_SPECS with opt-in feedback warp parameters (Slice 7.11)
for (const spec of FEEDBACK_WARP_SPECS) {
  if (!FEEDBACK_SPECS.some((s) => s.name === spec.name)) {
    (FEEDBACK_SPECS as ParamSpec[]).push(spec);
  }
}

type LayerFactory = (params: Record<string, ParamValue>) => RenderLayer;

/** Flattens {value, link} settings to plain values. Links are not applied yet (slice E2). */
export function valuesOf(settings: Settings): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const [name, setting] of Object.entries(settings)) out[name] = setting.value;
  return out;
}

/** Reads and normalises feedback settings from a preset or settings object (Slice 7.22). */
export function readFeedbackSettings(feedbackOrPreset: Preset | Settings | Record<string, unknown>): Record<string, ParamValue> {
  const raw = (feedbackOrPreset && typeof feedbackOrPreset === 'object' && 'feedback' in feedbackOrPreset)
    ? (feedbackOrPreset as Preset).feedback
    : (feedbackOrPreset as Settings | Record<string, unknown>);
  const values: Record<string, ParamValue> = {};
  if (raw && typeof raw === 'object') {
    for (const [name, val] of Object.entries(raw)) {
      if (val && typeof val === 'object' && 'value' in val) {
        values[name] = (val as { value: ParamValue }).value;
      } else {
        values[name] = val as ParamValue;
      }
    }
  }
  return {
    ...FEEDBACK_DEFAULTS,
    ...FEEDBACK_WARP_DEFAULTS,
    ...values,
  };
}

// Values come from parsePreset, which has already checked every name and range against
// layerSchemas.ts. The casts below rely on that check.
export const LAYER_FACTORIES: Readonly<Record<string, LayerFactory>> = {
  shape: (p) => new ShapeLayer(p as Partial<ShapeParams>),
  tunnel: (p) => new TunnelLayer(p as Partial<TunnelParams>),
  particles: (p) => new ParticleLayer(p as Partial<ParticleParams>),
  crown: (p) => new CrownLayer(p as Partial<CrownParams>),
  rings: (p) => new RingsLayer(p as Partial<RingsParams>),
  shockwave: (p) => new ShockwaveLayer(p as Partial<ShockwaveParams>),
  bars: (p) => new BarsLayer(p as Partial<BarsParams>),
  bassPulse: (p) => new BassPulseLayer(p as Partial<BassPulseParams>),
  waveform: (p) => new WaveformLayer(p as Partial<WaveformParams>),
  moire: (p) => new MoireLayer(p as Partial<MoireParams>),
  spectralTerrain: (p) => new SpectralTerrainLayer(p as Partial<SpectralTerrainParams>),
  chladniSand: (p) => new ChladniSandLayer(p as Partial<ChladniSandParams>),
  ferrofluid: (p) => new FerrofluidLayer(p as Partial<FerrofluidParams>),
  reactionDiffusion: (p) => new ReactionDiffusionLayer(p as Partial<ReactionDiffusionParams>),
};

/** Builds a scene with fresh layers. Disabled layers are skipped. */
export function buildScene(name: string, preset: Preset): Scene {
  const layers: RenderLayer[] = [];
  const configs: SceneLayerConfig[] = [];
  for (const entry of preset.layers) {
    if (!entry.enabled) continue;
    let factory = LAYER_FACTORIES[entry.type];
    let params = entry.params;
    if (!factory) {
      const migrated = migrateLegacyLayerToShape(entry);
      factory = LAYER_FACTORIES[migrated.type];
      params = migrated.params;
    }
    if (!factory) throw new Error(`buildScene: no factory for layer "${entry.type}"`);
    layers.push(factory(valuesOf(params)));
    configs.push({
      opacity: entry.opacity ?? 1.0,
      blend: (entry.blend as BlendMode) ?? 'max',
      trails: entry.trails ?? true,
    });
  }
  const scene = new Scene(name, layers, configs);
  scene.setFeedback(readFeedbackSettings(preset));
  scene.setWarpOps(readWarpOps(preset));
  return scene;
}

export const buildSceneFromPreset = buildScene;

/**
 * Creates RenderLayer instances from a preset, supporting transparent migration of legacy layers.
 */
export function createLayersFromPreset(preset: Preset, options: { migrateLegacy?: boolean } = {}): RenderLayer[] {
  const entries = options.migrateLegacy ? migrateLegacyLayers(preset.layers) : preset.layers;
  const layers: RenderLayer[] = [];
  for (const entry of entries) {
    if (!entry.enabled) continue;
    let factory = LAYER_FACTORIES[entry.type];
    let params = entry.params;
    if (!factory) {
      const migrated = migrateLegacyLayerToShape(entry);
      factory = LAYER_FACTORIES[migrated.type];
      params = migrated.params;
    }
    if (!factory) throw new Error(`createLayersFromPreset: no factory for layer "${entry.type}"`);
    layers.push(factory(valuesOf(params)));
  }
  return layers;
}

/** Pushes plain values into a live layer. */
export function applyValues(layer: RenderLayer, values: Record<string, ParamValue>): void {
  if (layer instanceof ShapeLayer) layer.setParams(values as Partial<ShapeParams>);
  else if (layer instanceof TunnelLayer) layer.setParams(values as Partial<TunnelParams>);
  else if (layer instanceof BarsLayer) layer.setParams(values as Partial<BarsParams>);
  else if (layer instanceof BassPulseLayer) layer.setParams(values as Partial<BassPulseParams>);
  else if (layer instanceof ParticleLayer) layer.setParams(values as Partial<ParticleParams>);
  else if (layer instanceof CrownLayer) layer.setParams(values as Partial<CrownParams>);
  else if (layer instanceof RingsLayer) layer.setParams(values as Partial<RingsParams>);
  else if (layer instanceof ShockwaveLayer) layer.setParams(values as Partial<ShockwaveParams>);
  else if (layer instanceof WaveformLayer) layer.setParams(values as Partial<WaveformParams>);
  else if (layer instanceof MoireLayer) layer.setParams(values as Partial<MoireParams>);
  else if (layer instanceof SpectralTerrainLayer) layer.setParams(values as Partial<SpectralTerrainParams>);
  else if (layer instanceof ChladniSandLayer) layer.setParams(values as Partial<ChladniSandParams>);
  else if (layer instanceof FerrofluidLayer) layer.setParams(values as Partial<FerrofluidParams>);
  else if (layer instanceof ReactionDiffusionLayer) layer.setParams(values as Partial<ReactionDiffusionParams>);
}

/** Pushes every enabled layer's settings from `preset` into a scene built from it (same order). */
export function applyPresetToScene(preset: Preset, scene: Scene, _gl?: WebGL2RenderingContext): void {
  scene.setFeedback(readFeedbackSettings(preset));
  scene.setWarpOps(readWarpOps(preset));
  const live = preset.layers.filter((l) => l.enabled);
  live.forEach((entry, k) => {
    const layer = scene.layers[k];
    if (layer) applyValues(layer, valuesOf(entry.params));
    scene.setLayerConfig(k, {
      opacity: entry.opacity ?? 1.0,
      blend: (entry.blend as BlendMode) ?? 'max',
      trails: entry.trails ?? true,
    });
  });
}

/** The preset's warp operator stack with plain values (Slice 18.2). Empty when the preset has none. */
export function readWarpOps(preset: Preset): ResolvedWarpOp[] {
  return (preset.warp ?? []).map((op) => ({ type: op.type, enabled: op.enabled, values: valuesOf(op.params) }));
}

/**
 * Puts a scene back to the preset's plain values and returns the plain Post values. Used when reactions stop
 * (the style was turned Off) so the scene does not keep the last reacted values.
 */
export function restoreBasePreset(preset: Preset, scene: Scene): Record<string, ParamValue> {
  applyPresetToScene(preset, scene);
  return valuesOf(preset.post);
}

/** True when the preset has reactions (Slice 17.4). */
export function hasReactions(preset: Preset): boolean {
  return (preset.reactions?.length ?? 0) > 0;
}

/** True when any setting of the preset has an audio link. */
export function hasLinks(preset: Preset): boolean {
  const all = [...preset.layers.flatMap((l) => Object.values(l.params)), ...Object.values(preset.feedback), ...Object.values(preset.post), ...(preset.warp ?? []).flatMap((op) => Object.values(op.params))];
  return all.some((setting) => setting.link !== undefined);
}

/**
 * Per-frame version of applyPresetToScene for presets with audio links. `scope` identifies the
 * preset in the link runner (its id). Each layer's scope is `${scope}L${k}`, and feedback's is `${scope}F`.
 */
export function applyLinkedPreset(preset: Preset, scene: Scene, runner: LinkRunner, scope: string, inputs: LinkInputs, dtSec: number, reactions?: ReactionEngine | null): Record<string, ParamValue> {
  // Reactions move Feedback and Post only. They are applied after the audio link and before the range clamp.
  reactions?.update(inputs.frame, inputs.timeSec, dtSec, inputs.sectionContrast);
  scene.setFeedback(runner.resolve(`${scope}F`, preset.feedback, FEEDBACK_SPECS, inputs, dtSec, reactions ? { engine: reactions, group: 'feedback' } : undefined));
  if (preset.warp && preset.warp.length > 0) {
    scene.setWarpOps(preset.warp.map((op, i) => ({
      type: op.type,
      enabled: op.enabled,
      values: runner.resolve(`${scope}W${i}`, op.params, warpOpSpecs(op.type), inputs, dtSec),
    })));
  }
  const live = preset.layers.filter((l) => l.enabled);
  live.forEach((entry, k) => {
    const layer = scene.layers[k];
    if (!layer) return;
    applyValues(layer, runner.resolve(`${scope}L${k}`, entry.params, LAYER_SPECS[entry.type] ?? [], inputs, dtSec));
    scene.setLayerConfig(k, {
      opacity: entry.opacity ?? 1.0,
      blend: (entry.blend as BlendMode) ?? 'max',
      trails: entry.trails ?? true,
    });
  });
  return runner.resolve(`${scope}P`, preset.post, POST_SPECS, inputs, dtSec, reactions ? { engine: reactions, group: 'post' } : undefined);
}

/** True when preset contains an enabled layer with type === 'crown' or circular bars 'shape'. */
export function hasCrownLayer(preset?: { layers: { type: string; enabled?: boolean; params?: unknown }[] } | null): boolean {
  return Boolean(
    preset?.layers?.some((l) => {
      if (l.enabled === false) return false;
      if (l.type === 'crown') return true;
      if (l.type === 'shape') {
        const raw = l.params as Record<string, unknown> | undefined;
        const base = (raw?.baseShape && typeof raw.baseShape === 'object' && 'value' in raw.baseShape)
          ? (raw.baseShape as { value: unknown }).value
          : raw?.baseShape ?? 'circle';
        const effect = (raw?.effectType && typeof raw.effectType === 'object' && 'value' in raw.effectType)
          ? (raw.effectType as { value: unknown }).value
          : raw?.effectType ?? 'bars';
        return base === 'circle' && effect === 'bars';
      }
      return false;
    })
  );
}
