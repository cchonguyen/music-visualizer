// Slice 20.6: the Stage 20 generator layers (julia, orbit, architecture) are reachable from every place a layer type
// is used: the Studio's Add layer list, a layer's default settings, the preset reader, the scene builder and the
// cost tag. These tests run the same functions the app runs.
import { describe, expect, it } from 'vitest';
import { defaultLayer } from './studio';
import { LAYER_FACTORIES, applyValues, buildScene, valuesOf } from '../presets/loader';
import { PRESET_VERSION, parsePreset, type Preset } from '../presets/format';
import { SCHEMAS } from '../presets/builtin';
import { presetCost } from '../presets/cost';
import { JuliaLayer } from '../render/layers/julia';
import { OrbitLayer } from '../render/layers/orbit';
import { ArchitectureLayer } from '../render/layers/architecture';

const GENERATORS = [
  ['julia', JuliaLayer],
  ['orbit', OrbitLayer],
  ['architecture', ArchitectureLayer],
] as const;

function presetWith(type: string): Preset {
  const layer = defaultLayer(type);
  return {
    version: PRESET_VERSION,
    name: `check ${type}`,
    tags: [],
    transition: { style: 'crossfade', seconds: 1 },
    feedback: {},
    layers: [layer],
    post: {},
  };
}

describe('Stage 20 generator layers are registered everywhere', () => {
  it.each(GENERATORS)('%s is in the Add layer list and has default settings', (type) => {
    expect(Object.keys(LAYER_FACTORIES)).toContain(type);
    const layer = defaultLayer(type);
    expect(layer.type).toBe(type);
    expect(Object.keys(layer.params).length).toBeGreaterThan(3);
  });

  it.each(GENERATORS)('%s survives a save and load round trip with no warnings', (type, cls) => {
    const saved = JSON.parse(JSON.stringify(presetWith(type)));
    const { preset, warnings } = parsePreset(saved, SCHEMAS);
    expect(warnings).toEqual([]);
    expect(preset.layers).toHaveLength(1);
    expect(preset.layers[0]!.type).toBe(type);
    const scene = buildScene(`check ${type}`, preset);
    expect(scene.layers[0]).toBeInstanceOf(cls);
    expect(() => applyValues(scene.layers[0]!, valuesOf(preset.layers[0]!.params))).not.toThrow();
  });

  it.each(GENERATORS)('%s carries a cost tag above the 1 given to unknown layers', (type) => {
    const cost = presetCost(presetWith(type));
    expect(cost.score).toBeGreaterThan(1);
    expect(['light', 'medium', 'heavy']).toContain(cost.level);
  });

  it('a preset that uses a generator layer is read unchanged by an older preset with no generators', () => {
    const old = presetWith('shape');
    const { preset, warnings } = parsePreset(JSON.parse(JSON.stringify(old)), SCHEMAS);
    expect(warnings).toEqual([]);
    expect(preset.layers[0]!.type).toBe('shape');
  });
});
