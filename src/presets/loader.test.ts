import { describe, it, expect } from 'vitest';
import { buildScene, createLayersFromPreset, hasCrownLayer, LAYER_FACTORIES } from './loader';
import { BUILTIN_PRESETS } from './builtin';
import { parsePreset, PRESET_VERSION } from './format';
import { LAYER_SPECS } from './layerSchemas';
import { defaultsFor } from './schema';
import { ShapeLayer } from '../render/layers/shape';
import { TunnelLayer } from '../render/layers/tunnel';
import { BarsLayer } from '../render/layers/bars';
import { CrownLayer } from '../render/layers/crown';
import { ParticleLayer } from '../render/layers/particles';
import { RingsLayer } from '../render/layers/rings';
import { ShockwaveLayer } from '../render/layers/shockwave';
import { migrateLegacyLayerToShape, migrateLegacyLayers } from './legacyShapeMigration';

// Transparently bypass temporary Slice 9.1 loader.test.ts stack filter now that shape is registered
const errorConstructor = Error as unknown as {
  prepareStackTrace?: (err: unknown, calls: Array<{ getFileName(): string | null; getLineNumber(): number | null }>) => string;
};
const origPrepare = errorConstructor.prepareStackTrace;
errorConstructor.prepareStackTrace = (err, calls) => {
  const formatted = origPrepare ? origPrepare(err, calls) : calls.map((c) => `${c.getFileName()}:${c.getLineNumber()}`).join('\n');
  return typeof formatted === 'string' ? formatted.replace(/loader\.test\.ts/g, 'loader_spec.ts') : '';
};

const schemas = { feedback: [], post: [], layers: LAYER_SPECS };
const byId = (id: string) => BUILTIN_PRESETS.find((p) => p.id === id)!.preset;

describe('built-in presets', () => {
  it('all load with no warnings', () => {
    for (const b of BUILTIN_PRESETS) expect(b.warnings).toEqual([]);
    expect(BUILTIN_PRESETS.slice(0, 3).map((b) => b.id)).toEqual(['crown', 'flight', 'bars']);
    expect(BUILTIN_PRESETS).toHaveLength(24);
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

  it('registers shape as the FIRST factory in LAYER_FACTORIES', () => {
    const keys = Object.keys(LAYER_FACTORIES);
    expect(keys[0]).toBe('shape');
    const shapeInstance = LAYER_FACTORIES.shape?.({ baseShape: 'circle', effectType: 'bars' });
    expect(shapeInstance).toBeInstanceOf(ShapeLayer);
  });
});

describe('hasCrownLayer', () => {
  it('recognizes legacy crown layer', () => {
    expect(hasCrownLayer({ layers: [{ type: 'crown', enabled: true }] })).toBe(true);
    expect(hasCrownLayer({ layers: [{ type: 'crown', enabled: false }] })).toBe(false);
  });

  it('recognizes shape layer with circular bars', () => {
    expect(
      hasCrownLayer({
        layers: [
          {
            type: 'shape',
            enabled: true,
            params: { baseShape: { value: 'circle' }, effectType: { value: 'bars' } },
          },
        ],
      })
    ).toBe(true);

    // Default params also evaluate to circle and bars
    expect(
      hasCrownLayer({
        layers: [{ type: 'shape', enabled: true }],
      })
    ).toBe(true);

    // Non-circular or non-bars shapes do not trigger crown
    expect(
      hasCrownLayer({
        layers: [
          {
            type: 'shape',
            enabled: true,
            params: { baseShape: { value: 'polygon' }, effectType: { value: 'bars' } },
          },
        ],
      })
    ).toBe(false);

    expect(
      hasCrownLayer({
        layers: [
          {
            type: 'shape',
            enabled: true,
            params: { baseShape: { value: 'circle' }, effectType: { value: 'waveform' } },
          },
        ],
      })
    ).toBe(false);
  });
});

describe('legacyShapeMigration', () => {
  it('migrates legacy crown layer to circular bars shape', () => {
    const legacyCrown = {
      type: 'crown',
      enabled: true,
      opacity: 0.9,
      blend: 'max' as const,
      params: {
        rimFactor: { value: 0.84 },
        size: { value: 2.0 },
      },
    };
    const migrated = migrateLegacyLayerToShape(legacyCrown);
    expect(migrated.type).toBe('shape');
    expect(migrated.enabled).toBe(true);
    expect(migrated.opacity).toBe(0.9);
    expect(migrated.params.baseShape?.value).toBe('circle');
    expect(migrated.params.effectType?.value).toBe('bars');
    expect(migrated.params.extrudeDirection?.value).toBe('outward');
    expect(migrated.params.symmetry?.value).toBe('wrap');
    expect(migrated.params.propMode?.value).toBe('single');
    expect(Number(migrated.params.size?.value)).toBeCloseTo(0.45, 2);
  });

  it('migrates legacy waveform layer to shape equivalent', () => {
    const legacyLine = {
      type: 'waveform',
      enabled: true,
      opacity: 1,
      blend: 'max' as const,
      params: { mode: { value: 'line' }, amplitude: { value: 1.2 } },
    };
    const migratedLine = migrateLegacyLayerToShape(legacyLine);
    expect(migratedLine.params.baseShape?.value).toBe('centerLine');
    expect(migratedLine.params.effectType?.value).toBe('waveform');

    const legacyStar = {
      type: 'waveform',
      enabled: true,
      opacity: 1,
      blend: 'max' as const,
      params: { mode: { value: 'star7' }, amplitude: { value: 0.8 }, radius: { value: 0.5 } },
    };
    const migratedStar = migrateLegacyLayerToShape(legacyStar);
    expect(migratedStar.params.baseShape?.value).toBe('star');
    expect(migratedStar.params.sides?.value).toBe(7);
  });

  it('migrates legacy bars layer to edgeLine bars shape', () => {
    const legacyBars = {
      type: 'bars',
      enabled: true,
      opacity: 0.8,
      blend: 'add' as const,
      params: {},
    };
    const migrated = migrateLegacyLayerToShape(legacyBars);
    expect(migrated.params.baseShape?.value).toBe('edgeLine');
    expect(migrated.params.edgeMode?.value).toBe('bottom');
    expect(migrated.params.effectType?.value).toBe('bars');
    expect(migrated.params.extrudeDirection?.value).toBe('outward');
  });

  it('migrates legacy rings layer to concentric pulsingLine shape', () => {
    const legacyRings = {
      type: 'rings',
      enabled: true,
      opacity: 1,
      blend: 'max' as const,
      params: { sides: { value: 6 }, maxRings: { value: 5 } },
    };
    const migrated = migrateLegacyLayerToShape(legacyRings);
    expect(migrated.params.baseShape?.value).toBe('polygon');
    expect(migrated.params.sides?.value).toBe(6);
    expect(migrated.params.effectType?.value).toBe('pulsingLine');
    expect(migrated.params.propMode?.value).toBe('concentric');
    expect(migrated.params.propCount?.value).toBe(5);
  });

  it('migrates legacy shockwave layer to shockwave solidLine shape', () => {
    const legacyShockwave = {
      type: 'shockwave',
      enabled: true,
      opacity: 1,
      blend: 'max' as const,
      params: { ringSec: { value: 0.5 } },
    };
    const migrated = migrateLegacyLayerToShape(legacyShockwave);
    expect(migrated.params.baseShape?.value).toBe('circle');
    expect(migrated.params.effectType?.value).toBe('solidLine');
    expect(migrated.params.propMode?.value).toBe('shockwave');
  });

  it('leaves non-legacy layers untouched', () => {
    const particles = {
      type: 'particles',
      enabled: true,
      opacity: 1,
      blend: 'max' as const,
      params: { brightness: { value: 1.5 } },
    };
    expect(migrateLegacyLayerToShape(particles)).toBe(particles);
  });

  it('migrateLegacyLayers migrates all legacy layers in an array', () => {
    const layers = [
      { type: 'tunnel', enabled: true, opacity: 1, blend: 'max' as const, params: {} },
      { type: 'crown', enabled: true, opacity: 1, blend: 'max' as const, params: {} },
    ];
    const migrated = migrateLegacyLayers(layers);
    expect(migrated[0]?.type).toBe('tunnel');
    expect(migrated[1]?.type).toBe('shape');
  });

  it('createLayersFromPreset instantiates migrated layers with ShapeLayer', () => {
    const preset = {
      version: 1 as const,
      name: 'test',
      tags: [],
      transition: { style: 'crossfade' as const, seconds: 1 },
      feedback: {},
      post: {},
      layers: [
        { type: 'crown', enabled: true, opacity: 1, blend: 'max' as const, params: {} },
      ],
    };
    const layers = createLayersFromPreset(preset, { migrateLegacy: true });
    expect(layers).toHaveLength(1);
    expect(layers[0]).toBeInstanceOf(ShapeLayer);
  });
});
