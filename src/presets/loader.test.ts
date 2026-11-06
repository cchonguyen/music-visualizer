import { describe, it, expect } from 'vitest';
import { buildScene, LAYER_FACTORIES } from './loader';
import { BUILTIN_PRESETS } from './builtin';
import { parsePreset, PRESET_VERSION } from './format';
import { LAYER_SPECS } from './layerSchemas';
import { defaultsFor } from './schema';
import { TunnelLayer } from '../render/layers/tunnel';
import { BarsLayer } from '../render/layers/bars';
import { CrownLayer } from '../render/layers/crown';
import { ParticleLayer } from '../render/layers/particles';
import { RingsLayer } from '../render/layers/rings';
import { ShockwaveLayer } from '../render/layers/shockwave';

const schemas = { feedback: [], post: [], layers: LAYER_SPECS };
const byId = (id: string) => BUILTIN_PRESETS.find((p) => p.id === id)!.preset;

describe('built-in presets', () => {
  it('all load with no warnings', () => {
    for (const b of BUILTIN_PRESETS) expect(b.warnings).toEqual([]);
    expect(BUILTIN_PRESETS.slice(0, 3).map((b) => b.id)).toEqual(['crown', 'flight', 'bars']);
    expect(BUILTIN_PRESETS).toHaveLength(16);
  });

  it('their JSON values equal the schema defaults (so the look is unchanged)', () => {
    for (const layer of byId('crown').layers.concat(byId('flight').layers)) {
      const values = Object.fromEntries(Object.entries(layer.params).map(([k, s]) => [k, s.value]));
      const defaults = defaultsFor(LAYER_SPECS[layer.type]!);
      expect(values).toEqual(defaults);
    }
  });

  it('each one is at the current format version', () => {
    for (const b of BUILTIN_PRESETS) expect(b.preset.version).toBe(PRESET_VERSION);
  });
});

describe('buildScene', () => {
  it('builds the crown scene with its layers in order', () => {
    const scene = buildScene('crown', byId('crown'));
    expect(scene.name).toBe('crown');
    expect(scene.layers.map((l) => l.constructor)).toEqual([TunnelLayer, CrownLayer, ParticleLayer, ShockwaveLayer]);
  });

  it('builds the flight and bars scenes', () => {
    expect(buildScene('flight', byId('flight')).layers.map((l) => l.constructor)).toEqual([TunnelLayer, ParticleLayer, ShockwaveLayer]);
    expect(buildScene('bars', byId('bars')).layers.map((l) => l.constructor)).toEqual([BarsLayer, RingsLayer]);
  });

  it('skips disabled layers', () => {
    const preset = parsePreset(
      { version: 1, name: 'x', layers: [{ type: 'bars', enabled: false }, { type: 'bars' }] },
      schemas,
    ).preset;
    expect(buildScene('x', preset).layers).toHaveLength(1);
  });

  it('every registered layer type has a factory and a schema', () => {
    expect(Object.keys(LAYER_FACTORIES).sort()).toEqual(Object.keys(LAYER_SPECS).sort());
  });
});
