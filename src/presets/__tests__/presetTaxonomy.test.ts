import { describe, it, expect } from 'vitest';
import {
  ALL_PRESETS,
  REVIEW_PRESETS,
  SYSTEM_PRESET_CATEGORIES,
  SYSTEM_SUBFOLDER_LABELS,
  getSystemSubfolder,
  type SystemSubfolder,
  SCHEMAS,
} from '../builtin';
import { parsePreset } from '../format';
import { LAYER_FACTORIES, buildScene, takeRetiredLayerSkips } from '../loader';
import {
  PresetSession,
  type SceneHost,
} from '../session';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => void data.clear(),
  } as unknown as Storage;
}

function fakeHost(): SceneHost {
  return {
    setScene: () => {},
    removeScene: () => {},
    setFadeSeconds: () => {},
    setWeights: () => {},
    setPost: () => {},
    setTransition: () => {},
  };
}

describe('Preset Taxonomy & System Subfolder Categorization', () => {
  const EXPECTED_SHOWCASE_IDS = [
    '13-solar-crown-eclipse',
    '14-sacred-orbit-mandala',
    '15-polar-spirograph-bloom',
    '16-hexagon-inward-portal',
    '17-corridor-led-equalizer',
    '18-star-burst-stream',
    '19-spiral-pearl-beads',
    '20-dual-rail-aurora-ark',
  ];

  const EXPECTED_FLAGSHIP_IDS = [
    '01-curl-fluid-warp',
    '02-kaleidoscopic-mandala',
    '03-solarized-contour-rings',
    '04-mobius-dual-vortex',
    '05-rgb-aberration-vortex',
    '06-lissajous-vector-crt',
    '07-moire-interference-loom',
    '08-spectral-ridge-terrain',
    '09-chladni-cymatic-sand',
    '10-phyllotaxis-spiral-bloom',
    '11-ferrofluid-magnetic-crown',
  ];

  const EXPECTED_CLASSICS_IDS = [
    'crown',
    'flight',
    'bars',
    'starter-vortex',
    'tex-ripple-field',
    'tex-dust-wave',
  ];

  it('contains display labels for all three system subfolders', () => {
    expect(SYSTEM_SUBFOLDER_LABELS).toEqual({
      showcase: 'Stage 9 Showcase (13–20)',
      flagship: 'Flagship Generative (01–12)',
      classics: 'Classics & Textures',
    });
  });

  it('categorizes all 25 built-in presets accurately into their subfolders', () => {
    expect(EXPECTED_SHOWCASE_IDS).toHaveLength(8);
    expect(EXPECTED_FLAGSHIP_IDS).toHaveLength(11);
    expect(EXPECTED_CLASSICS_IDS).toHaveLength(6);

    // Verify showcase subfolder assignments
    for (const id of EXPECTED_SHOWCASE_IDS) {
      expect(SYSTEM_PRESET_CATEGORIES[id]).toBe('showcase');
      expect(getSystemSubfolder(id)).toBe('showcase');
    }

    // Verify flagship subfolder assignments
    for (const id of EXPECTED_FLAGSHIP_IDS) {
      expect(SYSTEM_PRESET_CATEGORIES[id]).toBe('flagship');
      expect(getSystemSubfolder(id)).toBe('flagship');
    }

    // Verify classics subfolder assignments
    for (const id of EXPECTED_CLASSICS_IDS) {
      expect(SYSTEM_PRESET_CATEGORIES[id]).toBe('classics');
      expect(getSystemSubfolder(id)).toBe('classics');
    }
  });

  it('ensures every built-in preset in ALL_PRESETS belongs to exactly one subfolder', () => {
    expect(ALL_PRESETS.length).toBe(25);
    const validSubfolders: SystemSubfolder[] = ['showcase', 'flagship', 'classics'];

    const seenIds = new Set<string>();
    for (const entry of ALL_PRESETS) {
      expect(seenIds.has(entry.id)).toBe(false);
      seenIds.add(entry.id);

      const category = getSystemSubfolder(entry.id);
      expect(category).toBeDefined();
      expect(validSubfolders).toContain(category);
      expect(entry.subfolder).toBe(category);
    }
  });

  it('returns undefined for unknown preset IDs', () => {
    expect(getSystemSubfolder('non-existent-preset')).toBeUndefined();
    expect(getSystemSubfolder('user-custom-123')).toBeUndefined();
  });

  it('listCategorized() partitions built-ins into showcase, flagship, and classics', () => {
    const storage = memoryStorage();
    const session = new PresetSession(fakeHost(), SCHEMAS, storage);
    for (const p of ALL_PRESETS) {
      session.addBuiltin(p.id, p.preset);
    }

    const categorized = session.listCategorized();

    expect(categorized.system.showcase.map((e) => e.id)).toEqual(EXPECTED_SHOWCASE_IDS);
    expect(categorized.system.flagship.map((e) => e.id)).toEqual(EXPECTED_FLAGSHIP_IDS);
    expect(categorized.system.classics.map((e) => e.id)).toEqual(EXPECTED_CLASSICS_IDS);
    expect(categorized.user.folders).toEqual([]);
    expect(categorized.user.unfiled).toEqual([]);
  });

  it('listCategorized() partitions user presets into folders and unfiled', () => {
    const storage = memoryStorage();
    const session = new PresetSession(fakeHost(), SCHEMAS, storage);
    for (const p of ALL_PRESETS) {
      session.addBuiltin(p.id, p.preset);
    }

    const folder1 = session.createFolder('Ambient Chill');
    const folder2 = session.createFolder('High Energy');

    // Create user presets
    const p1 = session.saveAs('crown', 'My Ambient Crown');
    const p2 = session.saveAs('flight', 'High Flight');
    const p3 = session.saveAs('bars', 'Unfiled Bars');

    session.setPresetFolder(p1, folder1.id);
    session.setPresetFolder(p2, folder2.id);
    // p3 remains unfiled

    const categorized = session.listCategorized();
    expect(categorized.user.folders).toHaveLength(2);

    const f1Group = categorized.user.folders.find((g) => g.folder.id === folder1.id)!;
    expect(f1Group.entries.map((e) => e.id)).toEqual([p1]);

    const f2Group = categorized.user.folders.find((g) => g.folder.id === folder2.id)!;
    expect(f2Group.entries.map((e) => e.id)).toEqual([p2]);

    expect(categorized.user.unfiled.map((e) => e.id)).toEqual([p3]);
  });

  it('moves retired and near-duplicate presets out of the default list into the review folder', () => {
    const REVIEW_IDS = [
      '12-reaction-diffusion-coral',
      'starter-honeycomb', 'starter-pentagon-pulse', 'starter-checker-warp', 'starter-stripe-drift',
      'starter-kaleido', 'starter-soft-smoke', 'starter-circle-wave', 'starter-ember', 'starter-quiet-tunnel',
      'tex-glass-tunnel', 'tex-sub-bloom', 'tex-silk-rings', 'tex-static-rain',
      'tex-prism-bars', 'tex-pulse-skin', 'tex-grain-crown', 'tex-neon-weave',
    ];
    expect(REVIEW_PRESETS.map((e) => e.id)).toEqual(REVIEW_IDS);
    const defaultIds = new Set(ALL_PRESETS.map((e) => e.id));
    for (const id of REVIEW_IDS) {
      expect(defaultIds.has(id)).toBe(false);
      expect(getSystemSubfolder(id)).toBeUndefined();
    }
  });

  it('keeps ReactionDiffusion out of the add-layer list', () => {
    expect(Object.keys(LAYER_FACTORIES)).not.toContain('reactionDiffusion');
  });

  it('skips a ReactionDiffusion layer in an old preset without crashing, and reports it once', () => {
    takeRetiredLayerSkips();
    const old = parsePreset(
      {
        version: 1,
        name: 'Old RD',
        layers: [
          { type: 'reactionDiffusion', enabled: true, params: {} },
          { type: 'rings', enabled: true, params: {} },
        ],
      },
      SCHEMAS,
    ).preset;
    expect(old.layers.map((l) => l.type)).toEqual(['reactionDiffusion', 'rings']);
    const scene = buildScene('old', old);
    expect(scene.layers).toHaveLength(1);
    expect(takeRetiredLayerSkips()).toEqual(['reactionDiffusion']);
    expect(takeRetiredLayerSkips()).toEqual([]);
  });
});
