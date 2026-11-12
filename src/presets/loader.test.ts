import { describe, it, expect } from 'vitest';
import { applyLinkedPreset, applyPresetToScene, buildScene, createLayersFromPreset, hasCrownLayer, hasLinks, LAYER_FACTORIES } from './loader';
import { LinkRunner, ReactionBank } from './links';
import { previewPreset } from './session';
import type { AudioFrame } from '../audio/types';
import type { Preset } from './format';
import { ALL_PRESETS, BUILTIN_PRESETS, REVIEW_PRESETS } from './builtin';
import { parsePreset, PRESET_VERSION } from './format';
import { LAYER_SPECS } from './layerSchemas';
import { defaultsFor } from './schema';
import { ShapeLayer } from '../render/layers/shape';
import { TunnelLayer } from '../render/layers/tunnel';
import { ParticleLayer } from '../render/layers/particles';
import { isShapeReadyWaveform, migrateLegacyLayerToShape, migrateLegacyLayers, migrateWaveformsInPreset } from './legacyShapeMigration';

const schemas = { feedback: [], post: [], layers: LAYER_SPECS };
const byId = (id: string) => BUILTIN_PRESETS.find((p) => p.id === id)!.preset;

describe('built-in presets', () => {
  it('all load with no warnings', () => {
    for (const b of BUILTIN_PRESETS) expect(b.warnings).toEqual([]);
    expect(BUILTIN_PRESETS.slice(0, 3).map((b) => b.id)).toEqual(['crown', 'flight', 'bars']);
    expect(BUILTIN_PRESETS).toHaveLength(6);
  });

  it('their tunnel and particle JSON values equal the schema defaults (so the look is unchanged)', () => {
    // Shape layers are excluded: the classics' shape layers carry deliberate non-default values.
    const layers = byId('crown').layers.concat(byId('flight').layers).filter((l) => l.type !== 'shape');
    expect(layers.map((l) => l.type)).toEqual(['tunnel', 'particles', 'tunnel', 'particles']);
    for (const layer of layers) {
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
    expect(scene.layers.map((l) => l.constructor)).toEqual([TunnelLayer, ShapeLayer, ParticleLayer, ShapeLayer]);
  });

  it('builds the flight and bars scenes', () => {
    expect(buildScene('flight', byId('flight')).layers.map((l) => l.constructor)).toEqual([TunnelLayer, ParticleLayer, ShapeLayer]);
    expect(buildScene('bars', byId('bars')).layers.map((l) => l.constructor)).toEqual([ShapeLayer, ShapeLayer]);
  });

  it('skips disabled layers', () => {
    const preset = parsePreset(
      { version: 1, name: 'x', layers: [{ type: 'bars', enabled: false }, { type: 'bars' }] },
      schemas,
    ).preset;
    expect(buildScene('x', preset).layers).toHaveLength(1);
  });

  it('every registered layer type has a factory and a schema', () => {
    // reactionDiffusion is retired (Slice 15.10): schema kept for old presets, no factory.
    expect(Object.keys(LAYER_FACTORIES).sort()).toEqual(Object.keys(LAYER_SPECS).filter((k) => k !== 'reactionDiffusion').sort());
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

  describe('Waveform to Shape (Slice 19.10)', () => {
    const waveform = (params: Record<string, { value: unknown; link?: unknown }>) => ({
      type: 'waveform',
      enabled: true,
      opacity: 0.9,
      blend: 'add' as const,
      params: params as never,
    });

    it('keeps the trace sharp: 256 points and fast attack and release (Slice 19.12)', () => {
      const m = migrateLegacyLayerToShape(waveform({ mode: { value: 'line' } }));
      expect(m.params.sampleCount?.value).toBe(256);
      expect(m.params.attackMs?.value).toBe(5);
      expect(m.params.releaseMs?.value).toBe(40);
    });

    it('uses the signed scope source so silence stays flat', () => {
      for (const mode of ['line', 'circle', 'star7']) {
        const m = migrateLegacyLayerToShape(waveform({ mode: { value: mode } }));
        expect(m.params.audioSource?.value).toBe('scope');
      }
    });

    it('maps lissajous to the 3D curve base', () => {
      expect(migrateLegacyLayerToShape(waveform({ mode: { value: 'lissajous' } })).params.baseShape?.value).toBe('knot3d');
    });

    it('carries band texture over as one strength, and 0 when it was off', () => {
      expect(migrateLegacyLayerToShape(waveform({ mode: { value: 'line' } })).params.bandTexture?.value).toBe(1);
      expect(migrateLegacyLayerToShape(waveform({ texture: { value: true }, textureGain: { value: 1.6 } })).params.bandTexture?.value).toBe(1.6);
      expect(migrateLegacyLayerToShape(waveform({ texture: { value: false }, textureGain: { value: 1.6 } })).params.bandTexture?.value).toBe(0);
    });

    it('keeps the layer settings and moves the amplitude, radius and texture links', () => {
      const link = { source: 'mid', gain: 1 } as never;
      const m = migrateLegacyLayerToShape(waveform({ amplitude: { value: 1.2, link }, radius: { value: 0.5, link }, textureGain: { value: 1, link }, thickness: { value: 3, link } }));
      expect(m.type).toBe('shape');
      expect(m.opacity).toBe(0.9);
      expect(m.blend).toBe('add');
      expect(m.params.reactivity?.link).toBe(link);
      expect(m.params.size?.link).toBe(link);
      expect(m.params.bandTexture?.link).toBe(link);
      expect(m.params.thickness?.link).toBe(link);
    });

    it('migrateWaveformsInPreset moves line, circle and star7 only', () => {
      const parsed = BUILTIN_PRESETS.find((p) => p.id === 'tex-dust-wave')!;
      const base = { ...parsed, preset: { ...parsed.preset, layers: [waveform({ mode: { value: 'line' } }), waveform({ mode: { value: 'circle' } }), waveform({ mode: { value: 'star7' } }), waveform({ mode: { value: 'lissajous' } }), ...parsed.preset.layers.filter((l) => l.type === 'particles')] } };
      const out = migrateWaveformsInPreset(base);
      expect(out.preset.layers.map((l) => l.type)).toEqual(['shape', 'shape', 'shape', 'waveform', 'particles']);
      expect(base.preset.layers[0]!.type).toBe('waveform'); // the input is not changed
    });

    it('returns the same object when there is nothing to migrate', () => {
      const parsed = BUILTIN_PRESETS.find((p) => p.id === 'crown')!;
      expect(migrateWaveformsInPreset(parsed)).toBe(parsed);
      expect(isShapeReadyWaveform(waveform({ mode: { value: 'lissajous' } }))).toBe(false);
      expect(isShapeReadyWaveform(waveform({}))).toBe(true);
    });

    it('the built-in presets with a Waveform line load as Shape layers and build a scene', () => {
      for (const id of ['tex-dust-wave', 'tex-ripple-field', 'starter-circle-wave']) {
        const preset = [...ALL_PRESETS, ...REVIEW_PRESETS].find((p) => p.id === id)!.preset;
        expect(preset.layers.some((l) => l.type === 'waveform')).toBe(false);
        expect(preset.layers.some((l) => l.type === 'shape')).toBe(true);
        expect(() => buildScene(id, preset)).not.toThrow();
      }
    });
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

describe('applyLinkedPreset with a muted layer', () => {
  const tunnel = (ringDensity: number) => ({
    type: 'tunnel',
    enabled: true,
    opacity: 1,
    blend: 'max' as const,
    params: { ringDensity: { value: ringDensity } },
  });
  const preset = {
    version: PRESET_VERSION,
    name: 'mute-test',
    tags: [],
    transition: { style: 'cut', seconds: 0 },
    feedback: {},
    post: {},
    layers: [tunnel(0.5), tunnel(1.5)],
  } as unknown as Preset;
  const inputs = { frame: {} as AudioFrame, timeSec: 0, sectionContrast: 0 };

  it('maps link values to the previewed layers, not the raw preset layers', () => {
    const state = { solo: new Set<number>(), mute: new Set<number>([0]) };
    const shownPreset = previewPreset(preset, state);
    const scene = buildScene('mute-test', shownPreset);
    expect(scene.layers).toHaveLength(1);
    applyLinkedPreset(shownPreset, scene, new LinkRunner(), 'mute-test', inputs, 0.016);
    expect((scene.layers[0] as unknown as { p: { ringDensity: number } }).p.ringDensity).toBe(1.5);
  });

  it('raw preset would feed the muted layer values to the surviving layer', () => {
    const state = { solo: new Set<number>(), mute: new Set<number>([0]) };
    const scene = buildScene('mute-test', previewPreset(preset, state));
    applyLinkedPreset(preset, scene, new LinkRunner(), 'mute-test', inputs, 0.016);
    expect((scene.layers[0] as unknown as { p: { ringDensity: number } }).p.ringDensity).toBe(0.5);
  });
});

describe('applyLinkedPreset with reactions (Slice 17.4)', () => {
  const preset = {
    version: PRESET_VERSION,
    name: 'react-test',
    tags: [],
    transition: { style: 'cut', seconds: 0 },
    feedback: { zoom: { value: 1 } },
    post: { hueShift: { value: 0 } },
    layers: [],
    reactions: [
      { trigger: { type: 'beat' }, response: 'kick', target: { group: 'feedback', name: 'zoom' }, amount: 0.2, ease: 0.3 },
      { trigger: { type: 'beat' }, response: 'step', target: { group: 'post', name: 'hueShift' }, amount: 0.5, ease: 0 },
    ],
  } as unknown as Preset;
  const frameWith = (beat: boolean) => ({ onset: beat, onsetStrength: 0.9, beat, beatStrength: 0.9 }) as unknown as AudioFrame;

  it('moves Feedback and Post values on a beat, and returns them to rest between beats', () => {
    const bank = new ReactionBank();
    const engine = bank.engineFor('r', preset.reactions)!;
    const applied: Record<string, unknown>[] = [];
    const scene = { setFeedback: (v: Record<string, unknown>) => applied.push(v), layers: [], setLayerConfig: () => {} } as never;
    const runner = new LinkRunner();
    const post = applyLinkedPreset(preset, scene, runner, 'r', { frame: frameWith(true), timeSec: 0, sectionContrast: 0 }, 1 / 60, engine);
    expect(applied[0]!.zoom as number).toBeGreaterThan(1.05);
    expect(post.hueShift as number).toBeGreaterThan(1);
    let last: Record<string, unknown> = applied[0]!;
    for (let i = 1; i < 120; i += 1) {
      applyLinkedPreset(preset, scene, runner, 'r', { frame: frameWith(false), timeSec: i / 60, sectionContrast: 0 }, 1 / 60, engine);
      last = applied[applied.length - 1]!;
    }
    expect(last.zoom as number).toBeCloseTo(1, 3);
  });

  it('does nothing different without an engine (Off)', () => {
    const applied: Record<string, unknown>[] = [];
    const scene = { setFeedback: (v: Record<string, unknown>) => applied.push(v), layers: [], setLayerConfig: () => {} } as never;
    const post = applyLinkedPreset(preset, scene, new LinkRunner(), 'r', { frame: frameWith(true), timeSec: 0, sectionContrast: 0 }, 1 / 60, null);
    expect(applied[0]!.zoom).toBe(1);
    expect(post.hueShift).toBe(0);
  });
});

describe('warp operator stack (Slice 18.2)', () => {
  const withWarp = (warp: unknown) => parsePreset({ version: PRESET_VERSION, name: 'warp-test', warp }, schemas).preset;
  const inputs = (timeSec: number) => ({ frame: {} as AudioFrame, timeSec, sectionContrast: 0 });

  it('a preset without a stack gives the scene no operators', () => {
    const scene = buildScene('plain', withWarp(undefined));
    expect(scene.getWarpOps()).toEqual([]);
  });

  it('buildScene passes the stack to the scene as plain values', () => {
    const scene = buildScene('w', withWarp([{ type: 'radial', params: { amount: 0.7 } }, { type: 'ripple', enabled: false }]));
    const ops = scene.getWarpOps();
    expect(ops.map((o) => o.type)).toEqual(['radial', 'ripple']);
    expect(ops[0]!.values.amount).toBe(0.7);
    expect(ops[1]!.enabled).toBe(false);
  });

  it('hasLinks sees a link on an operator setting', () => {
    const linked = withWarp([{ type: 'swirl', params: { amount: { value: 0.2, link: { source: 'lfoSine', amount: 1, smooth: 0 } } } }]);
    expect(hasLinks(linked)).toBe(true);
    expect(hasLinks(withWarp([{ type: 'swirl' }]))).toBe(false);
  });

  it('applyLinkedPreset resolves operator morphs each frame', () => {
    const preset = withWarp([{ type: 'swirl', params: { amount: { value: 0.1, morph: { to: 0.9, rate: 0.5 } } } }]);
    const scene = buildScene('w', preset);
    const runner = new LinkRunner();
    applyLinkedPreset(preset, scene, runner, 'w', inputs(0), 0.016);
    expect(scene.getWarpOps()[0]!.values.amount).toBeCloseTo(0.1, 5);
    let peak = 0;
    for (let i = 1; i <= 20; i++) {
      applyLinkedPreset(preset, scene, runner, 'w', inputs(i * 0.1), 0.1);
      peak = Math.max(peak, scene.getWarpOps()[0]!.values.amount as number);
    }
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(0.9 + 1e-9);
  });

  it('applyPresetToScene clears the stack when the preset has none', () => {
    const scene = buildScene('w', withWarp([{ type: 'radial' }]));
    expect(scene.getWarpOps()).toHaveLength(1);
    applyPresetToScene(withWarp(undefined), scene);
    expect(scene.getWarpOps()).toEqual([]);
  });
});
