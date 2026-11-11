import { describe, it, expect } from 'vitest';
import {
  ALL_PRESETS,
  SYSTEM_PRESET_CATEGORIES,
  SYSTEM_SUBFOLDER_LABELS,
  getSystemSubfolder,
  type SystemSubfolder,
  SCHEMAS,
} from '../builtin';
import { PRESET_THEMES, PRESET_MOODS } from '../format';
import { PRESET_TAXONOMY } from '../builtin';
import { presetCost } from '../cost';
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
    '21-inhale-exhale',
    '22-ripple-pool',
    '23-gradient-storm',
    '24-mirror-tunnel',
    '25-deep-field',
    '26-scope-bloom',
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
    '12-reaction-diffusion-coral',
  ];

  const EXPECTED_CLASSICS_IDS = [
    'crown',
    'flight',
    'bars',
    'starter-vortex',
    'starter-honeycomb',
    'starter-pentagon-pulse',
    'starter-checker-warp',
    'starter-stripe-drift',
    'starter-kaleido',
    'starter-soft-smoke',
    'starter-circle-wave',
    'starter-ember',
    'starter-quiet-tunnel',
    'tex-glass-tunnel',
    'tex-sub-bloom',
    'tex-silk-rings',
    'tex-static-rain',
    'tex-prism-bars',
    'tex-pulse-skin',
    'tex-grain-crown',
    'tex-ripple-field',
    'tex-neon-weave',
    'tex-dust-wave',
  ];

  it('contains display labels for all three system subfolders', () => {
    expect(SYSTEM_SUBFOLDER_LABELS).toEqual({
      showcase: 'Stage 9 Showcase (13–20)',
      flagship: 'Flagship Generative (01–12)',
      classics: 'Classics & Textures',
    });
  });

  it('categorizes all 45+ built-in presets accurately into their subfolders', () => {
    expect(EXPECTED_SHOWCASE_IDS).toHaveLength(14);
    expect(EXPECTED_FLAGSHIP_IDS).toHaveLength(12);
    expect(EXPECTED_CLASSICS_IDS).toHaveLength(23);

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
    expect(ALL_PRESETS.length).toBeGreaterThanOrEqual(41);
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
});

describe('Stage 18 showcase presets 21 to 24 (Slice 18.10)', () => {
  const NEW_IDS = ['21-inhale-exhale', '22-ripple-pool', '23-gradient-storm', '24-mirror-tunnel'];
  const entry = (id: string) => ALL_PRESETS.find((p) => p.id === id)!;

  it('all four load with no warnings', () => {
    for (const id of NEW_IDS) {
      expect(entry(id), id).toBeDefined();
      expect(entry(id).warnings, id).toEqual([]);
    }
  });

  it('each uses a warp field stack, the colour map and bloom', () => {
    for (const id of NEW_IDS) {
      const { preset } = entry(id);
      expect(preset.warp?.length ?? 0, id).toBeGreaterThan(0);
      expect(preset.warp!.length, id).toBeLessThanOrEqual(4);
      expect(preset.post.colourMap!.value as number, id).toBeGreaterThan(0);
      expect(preset.post.bloom!.value as number, id).toBeGreaterThan(0);
    }
  });

  it('the Inhale Exhale radial operator pulls the middle in and pushes the edges out (positive amount)', () => {
    const radial = entry('21-inhale-exhale').preset.warp!.find((op) => op.type === 'radial')!;
    expect(radial.params.amount!.value as number).toBeGreaterThan(0);
  });

  it('exercises the wider options: tight, wide, tinted and pulsed bloom, curl, and the vignette shapes', () => {
    const post = (id: string) => entry(id).preset.post;
    expect(post('22-ripple-pool').bloomSize!.value as number).toBeLessThan(0);
    expect(post('21-inhale-exhale').bloomSize!.value as number).toBeGreaterThan(0);
    expect(post('21-inhale-exhale').bloomTintAmount!.value as number).toBeGreaterThan(0);
    expect(post('23-gradient-storm').bloomPulse!.value as number).toBeGreaterThan(0);
    expect(entry('23-gradient-storm').preset.warp!.some((op) => op.type === 'curl')).toBe(true);
    expect(post('22-ripple-pool').vignetteShape!.value).toBe('round');
    expect(post('24-mirror-tunnel').vignetteShape!.value).toBe('box');
  });

  it('every earlier preset is untouched: none has a warp stack, a colour map or a new bloom option', () => {
    for (const p of ALL_PRESETS) {
      if (NEW_IDS.includes(p.id)) continue;
      expect(p.preset.warp, p.id).toBeUndefined();
      expect(p.preset.post.colourMap!.value, p.id).toBe(0);
      expect(p.preset.post.bloomSize!.value, p.id).toBe(0);
      expect(p.preset.post.bloomPulse!.value, p.id).toBe(0);
    }
  });
});

describe('Stage 19 showcase presets 25 and 26 (Slice 19.11)', () => {
  const entry = (id: string) => ALL_PRESETS.find((p) => p.id === id)!;

  it('both load with no warnings', () => {
    for (const id of ['25-deep-field', '26-scope-bloom']) {
      expect(entry(id), id).toBeDefined();
      expect(entry(id).warnings, id).toEqual([]);
    }
  });

  it('Deep Field is built from starfield particle layers', () => {
    const layers = entry('25-deep-field').preset.layers;
    expect(layers.length).toBeGreaterThan(0);
    for (const l of layers) {
      expect(l.type).toBe('particles');
      expect(l.params.mode!.value).toBe('field');
    }
  });

  it('Scope Bloom uses the signed scope source with additive blending and bloom', () => {
    const { preset } = entry('26-scope-bloom');
    for (const l of preset.layers) {
      expect(l.type).toBe('shape');
      expect(l.blend).toBe('add');
      expect(l.params.audioSource!.value).toBe('scope');
    }
    expect(preset.post.bloom!.value as number).toBeGreaterThan(0);
  });
});

describe('Slice 20.7: every built-in preset has a theme, a mood and a cost level', () => {
  it('tags every preset with a known theme and mood', () => {
    for (const entry of ALL_PRESETS) {
      expect(PRESET_THEMES, `${entry.id} theme`).toContain(entry.preset.theme);
      expect(PRESET_MOODS, `${entry.id} mood`).toContain(entry.preset.mood);
    }
  });

  it('has a cost level for every preset', () => {
    for (const entry of ALL_PRESETS) {
      expect(['light', 'medium', 'heavy'], entry.id).toContain(presetCost(entry.preset).level);
    }
  });

  it('keeps no table row for a preset that does not exist', () => {
    const ids = new Set(ALL_PRESETS.map((e) => e.id));
    for (const id of Object.keys(PRESET_TAXONOMY)) expect(ids.has(id), id).toBe(true);
    expect(Object.keys(PRESET_TAXONOMY).length).toBe(ALL_PRESETS.length);
  });

  it('spreads the set across several themes and moods', () => {
    const themes = new Set(ALL_PRESETS.map((e) => e.preset.theme));
    const moods = new Set(ALL_PRESETS.map((e) => e.preset.mood));
    expect(themes.size).toBeGreaterThanOrEqual(6);
    expect(moods.size).toBeGreaterThanOrEqual(5);
  });

  it('the built-in list reaches the session with the theme and mood intact', () => {
    const session = new PresetSession(fakeHost(), SCHEMAS, memoryStorage());
    for (const entry of ALL_PRESETS) session.addBuiltin(entry.id, entry.preset);
    const first = ALL_PRESETS[0]!;
    expect(session.get(first.id)!.preset.theme).toBe(first.preset.theme);
    expect(session.get(first.id)!.preset.mood).toBe(first.preset.mood);
  });
});
