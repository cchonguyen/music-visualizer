import { describe, it, expect, beforeEach } from 'vitest';
import {
  PresetSession,
  USER_PRESETS_KEY,
  USER_PRESET_FOLDERS_KEY,
  SYSTEM_TAG_OVERRIDES_KEY,
  type SceneHost,
} from './session';
import { parsePreset, PresetFormatError, PRESET_VERSION } from './format';
import { LAYER_SPECS } from './layerSchemas';
import { BUILTIN_PRESETS, SCHEMAS } from './builtin';
import type { Scene } from '../render/scene';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => void data.clear(),
    get length() { return data.size; },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
  } as unknown as Storage;
}

function fakeHost() {
  const calls: string[] = [];
  const host: SceneHost = {
    setScene: (s: Scene) => calls.push(`set:${s.name}`),
    removeScene: (n: string) => calls.push(`remove:${n}`),
    setFadeSeconds: (s: number) => calls.push(`fade:${s}`),
    setWeights: (w: Record<string, number>) => calls.push(`weights:${JSON.stringify(w)}`),
    setPost: () => calls.push('post'),
    setTransition: () => calls.push('transition'),
  };
  return { host, calls };
}

let storage: Storage;
let calls: string[];
let session: PresetSession;

beforeEach(() => {
  storage = memoryStorage();
  const fake = fakeHost();
  calls = fake.calls;
  session = new PresetSession(fake.host, SCHEMAS, storage);
  for (const b of BUILTIN_PRESETS) session.addBuiltin(b.id, b.preset);
});

describe('built-in presets', () => {
  it('are listed and start unchanged', () => {
    expect(session.list().slice(0, 3).map((e) => e.id)).toEqual(['crown', 'flight', 'bars']);
    expect(session.list()).toHaveLength(23);
    expect(session.isDirty('crown')).toBe(false);
  });

  it('cannot be saved over, renamed or deleted', () => {
    expect(() => session.save('crown')).toThrow(/read-only/);
    expect(() => session.rename('crown', 'x')).toThrow(/cannot be renamed/);
    expect(() => session.remove('crown')).toThrow(/cannot be deleted/);
    expect(() => session.setPresetFolder('crown', 'some-folder')).toThrow(/Cannot move built-in/);
  });
});

describe('editing and unsaved changes', () => {
  it('a working-copy edit marks the preset dirty, and saving clears it', () => {
    const entry = session.get('crown')!;
    const layer = entry.preset.layers.find((l) => l.type === 'tunnel')!;
    layer.params.ringDensity = { value: 1.2 };
    expect(session.isDirty('crown')).toBe(true);
    const id = session.saveAs('crown', 'My crown');
    expect(session.isDirty(id)).toBe(false);
  });
});

describe('save, duplicate, rename, delete', () => {
  it('saveAs makes a user preset and writes it to storage', () => {
    const id = session.saveAs('flight', 'Night flight');
    expect(session.get(id)!.preset.name).toBe('Night flight');
    const stored = JSON.parse(storage.getItem(USER_PRESETS_KEY)!);
    expect(stored.map((s: { id: string }) => s.id)).toEqual([id]);
  });

  it('a saved user preset loads back in a new session', () => {
    const id = session.saveAs('bars', 'Saved bars');
    const fresh = new PresetSession(fakeHost().host, SCHEMAS, storage);
    expect(fresh.loadUserPresets()).toEqual([]);
    expect(fresh.get(id)!.preset.name).toBe('Saved bars');
    expect(fresh.get(id)!.builtin).toBe(false);
  });

  it('skips a corrupt saved entry and reports it', () => {
    storage.setItem(USER_PRESETS_KEY, JSON.stringify([{ id: 'bad', preset: { version: 9 } }]));
    const fresh = new PresetSession(fakeHost().host, SCHEMAS, storage);
    const skipped = fresh.loadUserPresets();
    expect(skipped[0]).toMatch(/unsupported version/);
    expect(fresh.get('bad')).toBeUndefined();
  });

  it('survives unreadable storage', () => {
    storage.setItem(USER_PRESETS_KEY, '{not json');
    const fresh = new PresetSession(fakeHost().host, SCHEMAS, storage);
    expect(fresh.loadUserPresets()[0]).toMatch(/not readable/);
  });

  it('remove deletes a user preset, but not while it is on screen', () => {
    const id = session.saveAs('flight', 'Temp');
    session.show(id);
    expect(() => session.remove(id)).toThrow(/Switch to another/);
    session.show('crown');
    session.remove(id);
    expect(session.get(id)).toBeUndefined();
    expect(JSON.parse(storage.getItem(USER_PRESETS_KEY)!)).toEqual([]);
  });
});

describe('export and import', () => {
  it('round-trips a preset through JSON text', () => {
    const text = session.exportJson('crown');
    const { id, warnings } = session.importJson(text);
    expect(warnings).toEqual([]);
    expect(session.get(id)!.preset).toEqual(session.get('crown')!.preset);
  });

  it('refuses text that is not JSON', () => {
    expect(() => session.importJson('{oops')).toThrow(PresetFormatError);
  });

  it('refuses a file with an unsupported version', () => {
    expect(() => session.importJson(JSON.stringify({ version: 42, name: 'x', layers: [] }))).toThrow(/unsupported version/);
  });
});

describe('show and rebuild', () => {
  it('show builds the scene once and fades to the preset', () => {
    session.show('flight');
    session.show('flight');
    expect(calls.filter((c) => c === 'set:flight')).toHaveLength(1);
    expect(calls).toContain('weights:{"flight":1}');
    expect(calls).toContain('fade:0.32');
  });

  it('rebuild after a layer change keeps the same name and swaps the scene', () => {
    session.show('crown');
    session.get('crown')!.preset.layers.pop();
    session.rebuild('crown');
    expect(calls.filter((c) => c === 'set:crown')).toHaveLength(2);
    expect(session.sceneOf('crown').layers).toHaveLength(3);
  });

  it('every layer type in the built-ins has a schema (sanity)', () => {
    for (const e of session.list()) {
      for (const l of e.preset.layers) expect(LAYER_SPECS[l.type]).toBeDefined();
    }
    expect(PRESET_VERSION).toBe(1);
    expect(parsePreset({ version: 1, name: 'n', layers: [] }, SCHEMAS).preset.version).toBe(1);
  });
});

describe('undo and redo', () => {
  it('a burst of edits within the window is one undo step', () => {
    session.commit('crown', 0); // baseline
    const layer = session.get('crown')!.preset.layers[0]!;
    layer.params.ringDensity = { value: 0.6 };
    session.commit('crown', 100);
    layer.params.ringDensity = { value: 0.7 };
    session.commit('crown', 200);
    expect(session.canUndo('crown')).toBe(true);
    expect(session.undo('crown')).toBe(true);
    expect(session.get('crown')!.preset.layers[0]!.params.ringDensity).toEqual({ value: 0.5 });
    expect(session.canUndo('crown')).toBe(false);
  });

  it('separate edits are separate steps; redo brings them back', () => {
    session.commit('crown', 0);
    const layer = session.get('crown')!.preset.layers[0]!;
    layer.params.ringDensity = { value: 0.6 };
    session.commit('crown', 1000);
    layer.params.ringDensity = { value: 0.9 };
    session.commit('crown', 3000);
    session.undo('crown');
    expect(session.get('crown')!.preset.layers[0]!.params.ringDensity).toEqual({ value: 0.6 });
    expect(session.canRedo('crown')).toBe(true);
    session.redo('crown');
    expect(session.get('crown')!.preset.layers[0]!.params.ringDensity).toEqual({ value: 0.9 });
  });

  it('a new edit after an undo clears the redo stack', () => {
    session.commit('crown', 0);
    const layer = session.get('crown')!.preset.layers[0]!;
    layer.params.ringDensity = { value: 0.6 };
    session.commit('crown', 1000);
    session.undo('crown');
    // undo swaps in a restored copy, so fetch the layer again before editing it
    session.get('crown')!.preset.layers[0]!.params.ringDensity = { value: 0.2 };
    session.commit('crown', 5000);
    expect(session.canRedo('crown')).toBe(false);
  });

  it('forced commits (randomise) always record a step', () => {
    session.commit('crown', 0);
    const layer = session.get('crown')!.preset.layers[0]!;
    layer.params.ringDensity = { value: 0.6 };
    session.commit('crown', 100, true);
    layer.params.ringDensity = { value: 0.7 };
    session.commit('crown', 150, true);
    session.undo('crown');
    expect(session.get('crown')!.preset.layers[0]!.params.ringDensity).toEqual({ value: 0.6 });
  });

  it('compare shows the saved copy and returns to the working copy', () => {
    const layer = session.get('crown')!.preset.layers[0]!;
    layer.params.ringDensity = { value: 0.9 };
    session.compare('crown', true);
    session.compare('crown', false);
    expect(session.isDirty('crown')).toBe(true); // compare changes no data
  });
});

describe('system preset tag overrides and categorization', () => {
  it('persists and hydrates system preset tag overrides', () => {
    session.setPresetTags('crown', ['favourite']);
    expect(session.get('crown')!.preset.tags).toEqual(['favourite']);
    expect(session.isDirty('crown')).toBe(false);

    // Verify stored in localStorage under SYSTEM_TAG_OVERRIDES_KEY
    const rawStored = storage.getItem(SYSTEM_TAG_OVERRIDES_KEY);
    expect(rawStored).toBeTruthy();
    expect(JSON.parse(rawStored!)).toEqual({ crown: ['favourite'] });

    // In a fresh session, addBuiltin rehydrates the tag override
    const fresh = new PresetSession(fakeHost().host, SCHEMAS, storage);
    for (const b of BUILTIN_PRESETS) fresh.addBuiltin(b.id, b.preset);
    expect(fresh.get('crown')!.preset.tags).toEqual(['favourite']);
  });

  it('sets and persists tags for user presets', () => {
    const id = session.saveAs('flight', 'Custom Flight');
    session.setPresetTags(id, ['favourite', 'night']);
    expect(session.get(id)!.preset.tags).toEqual(['favourite', 'night']);

    const fresh = new PresetSession(fakeHost().host, SCHEMAS, storage);
    fresh.loadUserPresets();
    expect(fresh.get(id)!.preset.tags).toEqual(['favourite', 'night']);
  });

  it('listCategorized() partitions presets into system and user categories', () => {
    const folder = session.createFolder('Favorites');
    const userPreset1 = session.saveAs('flight', 'Flight 1');
    const userPreset2 = session.saveAs('bars', 'Bars 2');
    session.setPresetFolder(userPreset1, folder.id);

    const categorized = session.listCategorized();
    expect(categorized.system.classics.map((e) => e.id)).toContain('crown');
    expect(categorized.system.classics.map((e) => e.id)).toContain('flight');

    expect(categorized.user.folders).toHaveLength(1);
    expect(categorized.user.folders[0]!.folder.name).toBe('Favorites');
    expect(categorized.user.folders[0]!.entries.map((e) => e.id)).toEqual([userPreset1]);

    expect(categorized.user.unfiled.map((e) => e.id)).toEqual([userPreset2]);
  });
});

describe('user preset folders and organization', () => {
  it('creates folders, persists and reloads them across sessions', () => {
    const folder = session.createFolder('Ambient Vibes');
    expect(folder.id).toMatch(/^folder-/);
    expect(folder.name).toBe('Ambient Vibes');
    expect(typeof folder.createdAt).toBe('number');
    expect(session.getFolders()).toEqual([folder]);

    // Check localStorage
    const rawStored = storage.getItem(USER_PRESET_FOLDERS_KEY);
    expect(rawStored).toBeTruthy();
    expect(JSON.parse(rawStored!)).toEqual([folder]);

    // Reload in a fresh session
    const fresh = new PresetSession(fakeHost().host, SCHEMAS, storage);
    expect(fresh.getFolders()).toEqual([folder]);

    // Validation: empty or whitespace folder names throw
    expect(() => session.createFolder('')).toThrow(/cannot be empty/);
    expect(() => session.createFolder('   ')).toThrow(/cannot be empty/);
  });

  it('renames folders and persists the new name', () => {
    const folder = session.createFolder('Old Name');
    session.renameFolder(folder.id, 'New Name');
    expect(session.getFolders()[0]!.name).toBe('New Name');

    const rawStored = JSON.parse(storage.getItem(USER_PRESET_FOLDERS_KEY)!);
    expect(rawStored[0].name).toBe('New Name');

    // Throws on empty name or nonexistent folder
    expect(() => session.renameFolder(folder.id, '')).toThrow(/cannot be empty/);
    expect(() => session.renameFolder(folder.id, '   ')).toThrow(/cannot be empty/);
    expect(() => session.renameFolder('nonexistent-id', 'Name')).toThrow(/not found/);
  });

  it('deleting a folder unfiles presets without deleting them', () => {
    const folder = session.createFolder('Chill');
    const p1 = session.saveAs('flight', 'Preset 1', folder.id);
    const p2 = session.saveAs('bars', 'Preset 2', folder.id);
    expect(session.getPresetFolder(p1)).toBe(folder.id);
    expect(session.getPresetFolder(p2)).toBe(folder.id);

    session.deleteFolder(folder.id);
    expect(session.getFolders()).toHaveLength(0);

    // Presets are still present, but unfiled
    expect(session.get(p1)).toBeDefined();
    expect(session.get(p2)).toBeDefined();
    expect(session.getPresetFolder(p1)).toBeUndefined();
    expect(session.getPresetFolder(p2)).toBeUndefined();

    const categorized = session.listCategorized();
    expect(categorized.user.unfiled.map((e) => e.id)).toContain(p1);
    expect(categorized.user.unfiled.map((e) => e.id)).toContain(p2);

    // Fresh session also sees them unfiled
    const fresh = new PresetSession(fakeHost().host, SCHEMAS, storage);
    fresh.loadUserPresets();
    expect(fresh.getFolders()).toHaveLength(0);
    expect(fresh.getPresetFolder(p1)).toBeUndefined();
    expect(fresh.getPresetFolder(p2)).toBeUndefined();
  });

  it('moves user presets into folders and unfiles them', () => {
    const f1 = session.createFolder('Folder 1');
    const f2 = session.createFolder('Folder 2');
    const id = session.saveAs('flight', 'Moving Preset');

    expect(session.getPresetFolder(id)).toBeUndefined();

    // Move to Folder 1
    session.setPresetFolder(id, f1.id);
    expect(session.getPresetFolder(id)).toBe(f1.id);

    // Move to Folder 2
    session.setPresetFolder(id, f2.id);
    expect(session.getPresetFolder(id)).toBe(f2.id);

    // Unfile with undefined or empty string
    session.setPresetFolder(id, undefined);
    expect(session.getPresetFolder(id)).toBeUndefined();

    session.setPresetFolder(id, f1.id);
    session.setPresetFolder(id, '');
    expect(session.getPresetFolder(id)).toBeUndefined();

    // Throws on nonexistent folder or nonexistent preset
    expect(() => session.setPresetFolder(id, 'ghost-folder')).toThrow(/not found/);
    expect(() => session.setPresetFolder('nonexistent-preset', f1.id)).toThrow(/unknown preset/);
  });

  it('throws when attempting setPresetFolder on built-in presets', () => {
    const folder = session.createFolder('Folder');
    expect(() => session.setPresetFolder('crown', folder.id)).toThrow(/Cannot move built-in/);
    expect(() => session.setPresetFolder('flight', undefined)).toThrow(/Cannot move built-in/);
  });

  it('presets referencing deleted or nonexistent folders resolve to unfiled in listCategorized() and getPresetFolder()', () => {
    const folder = session.createFolder('To Disappear');
    const id = session.saveAs('crown', 'Ghost Child', folder.id);
    expect(session.getPresetFolder(id)).toBe(folder.id);

    // Corrupt storage or simulate external folder deletion without unlinking
    storage.setItem(USER_PRESET_FOLDERS_KEY, JSON.stringify([]));
    const fresh = new PresetSession(fakeHost().host, SCHEMAS, storage);
    fresh.loadUserPresets();

    // In the new session, the folder is gone, so the preset must resolve to unfiled
    expect(fresh.getPresetFolder(id)).toBeUndefined();
    const cat = fresh.listCategorized();
    expect(cat.user.folders).toHaveLength(0);
    expect(cat.user.unfiled.map((e) => e.id)).toContain(id);
  });

  it('backward compatibility: legacy user presets without folderId load cleanly as unfiled', () => {
    // Manually write legacy user presets into localStorage without folderId
    const legacyPresets = [
      {
        id: 'legacy-1',
        preset: session.get('crown')!.preset,
      },
      {
        id: 'legacy-2',
        preset: session.get('flight')!.preset,
      },
    ];
    storage.setItem(USER_PRESETS_KEY, JSON.stringify(legacyPresets));
    storage.removeItem(USER_PRESET_FOLDERS_KEY);

    const fresh = new PresetSession(fakeHost().host, SCHEMAS, storage);
    const errors = fresh.loadUserPresets();
    expect(errors).toEqual([]);

    expect(fresh.get('legacy-1')).toBeDefined();
    expect(fresh.get('legacy-2')).toBeDefined();
    expect(fresh.getPresetFolder('legacy-1')).toBeUndefined();
    expect(fresh.getPresetFolder('legacy-2')).toBeUndefined();

    const cat = fresh.listCategorized();
    expect(cat.user.unfiled.map((e) => e.id)).toEqual(['legacy-1', 'legacy-2']);
  });

  it('duplicate and saveAs preserve folder assignment for user presets', () => {
    const folder = session.createFolder('Set 1');
    const p1 = session.saveAs('crown', 'Base Preset', folder.id);
    expect(session.getPresetFolder(p1)).toBe(folder.id);

    // duplicate copies preset into the same folder
    const p2 = session.duplicate(p1);
    expect(session.getPresetFolder(p2)).toBe(folder.id);
    expect(session.get(p2)!.preset.name).toBe('Base Preset copy');

    // saveAs without specifying folderId preserves from's folderId
    const p3 = session.saveAs(p1, 'Manual Copy');
    expect(session.getPresetFolder(p3)).toBe(folder.id);

    // saveAs with explicit folderId overrides it
    const otherFolder = session.createFolder('Set 2');
    const p4 = session.saveAs(p1, 'Explicit Move', otherFolder.id);
    expect(session.getPresetFolder(p4)).toBe(otherFolder.id);

    // saveAs with nonexistent folder resolves to undefined (unfiled)
    const p5 = session.saveAs(p1, 'Ghost Folder Copy', 'ghost-folder');
    expect(session.getPresetFolder(p5)).toBeUndefined();
  });
});


