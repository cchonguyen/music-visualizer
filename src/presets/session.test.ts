import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  PresetSession,
  USER_PRESETS_KEY,
  USER_PRESET_FOLDERS_KEY,
  SYSTEM_TAG_OVERRIDES_KEY,
  type SceneHost,
  type RemotePresetWriter,
} from './session';
import { parsePreset, PresetFormatError, PRESET_VERSION } from './format';
import { LAYER_SPECS } from './layerSchemas';
import { BUILTIN_PRESETS, SCHEMAS } from './builtin';
import { AdminGateway } from './adminGateway';
import type { RemotePresetRecord } from './remotePresets';
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

describe('admin system preset mutation & authorization (Slice 11.3)', () => {
  it('rejects admin operations when admin session is not active', () => {
    expect(session.isAdmin()).toBe(false);

    // saveSystemPreset throws if not admin
    expect(() => session.saveSystemPreset('crown')).toThrow(/Admin authorization required/);

    // removeSystemPreset throws if not admin
    expect(() => session.removeSystemPreset('crown')).toThrow(/Admin authorization required/);

    // promoteToSystemPreset throws if not admin
    const userPresetId = session.saveAs('crown', 'Candidate');
    expect(() => session.promoteToSystemPreset(userPresetId, 'showcase')).toThrow(/Admin authorization required/);

    // setSystemPresetSubfolder throws if not admin
    expect(() => session.setSystemPresetSubfolder('crown', 'flagship')).toThrow(/Admin authorization required/);

    // Standard Stage 10 mutations still throw on built-ins when non-admin
    expect(() => session.save('crown')).toThrow(/read-only/);
    expect(() => session.rename('crown', 'Crown Renamed')).toThrow(/cannot be renamed/);
    expect(() => session.remove('crown')).toThrow(/cannot be deleted/);
    expect(() => session.setPresetFolder('crown', 'some-folder')).toThrow(/Cannot move built-in/);
  });

  it('supports admin gateway passing via constructor or setAdminGateway', () => {
    const adminGw = new AdminGateway({ mock: true, defaultAdmin: true });
    const nonAdminGw = new AdminGateway({ mock: true, defaultAdmin: false });

    // Constructor with options object
    const sessionOpt = new PresetSession(fakeHost().host, SCHEMAS, storage, { adminGateway: adminGw });
    expect(sessionOpt.isAdmin()).toBe(true);

    // Constructor with gateway directly
    const sessionDirect = new PresetSession(fakeHost().host, SCHEMAS, storage, adminGw);
    expect(sessionDirect.isAdmin()).toBe(true);

    // setAdminGateway toggle
    sessionOpt.setAdminGateway(nonAdminGw);
    expect(sessionOpt.isAdmin()).toBe(false);
    sessionOpt.setAdminGateway(adminGw);
    expect(sessionOpt.isAdmin()).toBe(true);
    expect(sessionOpt.getAdminGateway()).toBe(adminGw);
  });

  it('admin saveSystemPreset updates savedJson and clears dirty status', () => {
    const adminGw = new AdminGateway({ mock: true, defaultAdmin: true });
    session.setAdminGateway(adminGw);
    expect(session.isAdmin()).toBe(true);

    const entry = session.get('crown')!;
    const layer = entry.preset.layers.find((l) => l.type === 'tunnel')!;
    layer.params.ringDensity = { value: 2.5 };
    expect(session.isDirty('crown')).toBe(true);

    // saveSystemPreset updates savedJson
    session.saveSystemPreset('crown');
    expect(session.isDirty('crown')).toBe(false);

    // Regular save() also delegates and succeeds when admin
    layer.params.ringDensity = { value: 3.0 };
    expect(session.isDirty('crown')).toBe(true);
    session.save('crown');
    expect(session.isDirty('crown')).toBe(false);

    // Renaming built-in as admin updates name and savedJson
    session.rename('crown', 'Crown Deluxe');
    expect(session.get('crown')!.preset.name).toBe('Crown Deluxe');
    expect(session.isDirty('crown')).toBe(false);

    // Calling saveSystemPreset on a user preset throws
    const userPresetId = session.saveAs('flight', 'User Custom');
    expect(() => session.saveSystemPreset(userPresetId)).toThrow(/not a system preset/);
  });

  it('admin removeSystemPreset removes preset and switches active scene if active', () => {
    const adminGw = new AdminGateway({ mock: true, defaultAdmin: true });
    session.setAdminGateway(adminGw);

    // 1. Removing an inactive built-in preset
    expect(session.get('flight')).toBeDefined();
    session.removeSystemPreset('flight');
    expect(session.get('flight')).toBeUndefined();

    // 2. Removing an active built-in preset switches active scene
    session.show('crown');
    expect(session.shownId).toBe('crown');

    session.removeSystemPreset('crown');
    expect(session.get('crown')).toBeUndefined();
    // Switched to another existing preset
    expect(session.shownId).not.toBeNull();
    expect(session.shownId).not.toBe('crown');
    expect(calls).toContain('remove:crown');

    // 3. Regular remove() on built-in also succeeds when admin
    expect(session.get('bars')).toBeDefined();
    session.remove('bars');
    expect(session.get('bars')).toBeUndefined();

    // 4. Calling removeSystemPreset on user preset throws
    const userPresetId = session.saveAs('starter-vortex', 'User Vortex');
    expect(() => session.removeSystemPreset(userPresetId)).toThrow(/not a system preset/);
  });

  it('admin promoteToSystemPreset converts user preset to system preset and removes from user storage', () => {
    const adminGw = new AdminGateway({ mock: true, defaultAdmin: true });
    session.setAdminGateway(adminGw);

    const folder = session.createFolder('Promote Candidates');
    const userPresetId = session.saveAs('crown', 'Solar Flare', folder.id);

    // Verify it started as a user preset
    const userEntry = session.get(userPresetId)!;
    expect(userEntry.builtin).toBe(false);
    expect(session.getPresetFolder(userPresetId)).toBe(folder.id);

    // User presets storage contains the entry
    const initialStored = JSON.parse(storage.getItem(USER_PRESETS_KEY)!);
    expect(initialStored.some((p: { id: string }) => p.id === userPresetId)).toBe(true);

    // Show it so we verify active display persists through promotion
    session.show(userPresetId);
    expect(session.shownId).toBe(userPresetId);

    // Promote to 'showcase' subfolder
    const newId = session.promoteToSystemPreset(userPresetId, 'showcase');
    expect(newId).toBe('solar-flare');

    // System entry verified
    const promoted = session.get(newId)!;
    expect(promoted).toBeDefined();
    expect(promoted.builtin).toBe(true);
    expect(promoted.subfolder).toBe('showcase');
    expect(session.getPresetFolder(newId)).toBeUndefined();
    expect(session.shownId).toBe(newId);

    // Verified removed from user storage
    const updatedStored = JSON.parse(storage.getItem(USER_PRESETS_KEY)!);
    expect(updatedStored.some((p: { id: string }) => p.id === userPresetId)).toBe(false);
    expect(updatedStored.some((p: { id: string }) => p.id === newId)).toBe(false);

    // Verified in listCategorized under system showcase
    const categorized = session.listCategorized();
    expect(categorized.system.showcase.some((e) => e.id === newId)).toBe(true);
    expect(categorized.user.folders[0]!.entries.some((e) => e.id === newId)).toBe(false);
    expect(categorized.user.unfiled.some((e) => e.id === newId)).toBe(false);

    // Promoting an already system preset throws
    expect(() => session.promoteToSystemPreset(newId, 'classics')).toThrow(/already a system preset/);
  });

  it('admin setSystemPresetSubfolder moves system preset across subfolders', () => {
    const adminGw = new AdminGateway({ mock: true, defaultAdmin: true });
    session.setAdminGateway(adminGw);

    expect(session.getSystemPresetSubfolder('crown')).toBe('classics');
    expect(session.listCategorized().system.classics.some((e) => e.id === 'crown')).toBe(true);

    // Move to flagship
    session.setSystemPresetSubfolder('crown', 'flagship');
    expect(session.getSystemPresetSubfolder('crown')).toBe('flagship');
    expect(session.listCategorized().system.flagship.some((e) => e.id === 'crown')).toBe(true);
    expect(session.listCategorized().system.classics.some((e) => e.id === 'crown')).toBe(false);

    // Move to showcase
    session.setSystemPresetSubfolder('crown', 'showcase');
    expect(session.getSystemPresetSubfolder('crown')).toBe('showcase');
    expect(session.listCategorized().system.showcase.some((e) => e.id === 'crown')).toBe(true);

    // Throws on user presets
    const userPresetId = session.saveAs('flight', 'User Custom');
    expect(() => session.setSystemPresetSubfolder(userPresetId, 'flagship')).toThrow(/not a system preset/);
  });
});

describe('remote system preset sync engine applyRemoteSystemPresets (Slice 11.3)', () => {
  it('applies newly discovered remote system presets and adds them to categories', () => {
    const samplePreset = structuredClone(session.get('crown')!.preset);
    samplePreset.name = 'Remote Cosmic Portal';

    const records: RemotePresetRecord[] = [
      {
        id: 'remote-cosmic-portal',
        name: 'Remote Cosmic Portal',
        subfolder: 'showcase',
        preset_data: samplePreset,
        sort_order: 10,
        tags: ['showcase', 'cosmic'],
        updated_at: new Date().toISOString(),
      },
    ];

    // Non-admin can apply remote system presets (e.g. app startup sync)
    expect(session.isAdmin()).toBe(false);
    session.applyRemoteSystemPresets(records);

    const entry = session.get('remote-cosmic-portal');
    expect(entry).toBeDefined();
    expect(entry!.builtin).toBe(true);
    expect(entry!.preset.name).toBe('Remote Cosmic Portal');
    expect(entry!.subfolder).toBe('showcase');
    expect(entry!.preset.tags).toEqual(['showcase', 'cosmic']);

    const categorized = session.listCategorized();
    expect(categorized.system.showcase.some((e) => e.id === 'remote-cosmic-portal')).toBe(true);

    // Can be displayed on screen cleanly
    session.show('remote-cosmic-portal');
    expect(session.shownId).toBe('remote-cosmic-portal');
    expect(calls).toContain('set:remote-cosmic-portal');
  });

  it('updates existing system presets and rebuilds active scenes in place', () => {
    session.show('crown');
    expect(session.shownId).toBe('crown');

    const updatedPreset = structuredClone(session.get('crown')!.preset);
    updatedPreset.name = 'Crown Supernova';
    const tunnelLayer = updatedPreset.layers.find((l) => l.type === 'tunnel')!;
    tunnelLayer.params.ringDensity = { value: 4.2 };

    const records: RemotePresetRecord[] = [
      {
        id: 'crown',
        name: 'Crown Supernova',
        subfolder: 'flagship',
        preset_data: updatedPreset,
        sort_order: 1,
        tags: ['updated'],
        updated_at: new Date().toISOString(),
      },
    ];

    session.applyRemoteSystemPresets(records);

    const updatedEntry = session.get('crown')!;
    expect(updatedEntry.preset.name).toBe('Crown Supernova');
    expect(updatedEntry.subfolder).toBe('flagship');
    expect(session.getSystemPresetSubfolder('crown')).toBe('flagship');
    expect(session.isDirty('crown')).toBe(false);

    // Scene rebuilt and active
    expect(calls).toContain('set:crown');
  });

  it('respects soft deletions (is_deleted: true) and switches active scene', () => {
    session.show('flight');
    expect(session.shownId).toBe('flight');

    const records: RemotePresetRecord[] = [
      {
        id: 'flight',
        name: 'Flight',
        subfolder: 'classics',
        preset_data: session.get('flight')!.preset,
        sort_order: 2,
        tags: [],
        updated_at: new Date().toISOString(),
        is_deleted: true,
      },
    ];

    session.applyRemoteSystemPresets(records);

    expect(session.get('flight')).toBeUndefined();
    expect(session.shownId).not.toBe('flight');
    expect(session.shownId).not.toBeNull();
    expect(calls).toContain('remove:flight');
  });

  it('preserves local user tag overrides when remote records are applied', () => {
    session.setPresetTags('crown', ['local-favourite']);

    const remoteCrown = structuredClone(session.get('crown')!.preset);
    const records: RemotePresetRecord[] = [
      {
        id: 'crown',
        name: 'Crown',
        subfolder: 'classics',
        preset_data: remoteCrown,
        sort_order: 1,
        tags: ['remote-tag'],
        updated_at: new Date().toISOString(),
      },
    ];

    session.applyRemoteSystemPresets(records);
    expect(session.get('crown')!.preset.tags).toEqual(['local-favourite']);
  });

  it('ignores invalid records gracefully without crashing', () => {
    const records: any[] = [
      null,
      undefined,
      { id: 123 }, // invalid id type
      { id: 'corrupt', preset_data: { version: 99999 } }, // invalid preset schema
    ];

    expect(() => session.applyRemoteSystemPresets(records)).not.toThrow();
    expect(session.get('corrupt')).toBeUndefined();
  });
});



describe('system preset remote writes (Slice 11.9)', () => {
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  function makeWriter(overrides: { upsert?: Mock; softDelete?: Mock } = {}) {
    return {
      upsert: overrides.upsert ?? vi.fn().mockResolvedValue({ success: true }),
      softDelete: overrides.softDelete ?? vi.fn().mockResolvedValue({ success: true }),
      onResult: vi.fn(),
    };
  }

  function adminSession(writer?: RemotePresetWriter) {
    const fake = fakeHost();
    const gateway = new AdminGateway({ mock: true, defaultAdmin: true });
    const s = new PresetSession(fake.host, SCHEMAS, memoryStorage(), { adminGateway: gateway, remoteWriter: writer });
    for (const b of BUILTIN_PRESETS) s.addBuiltin(b.id, b.preset);
    return s;
  }

  it('saveSystemPreset upserts the record', async () => {
    const writer = makeWriter();
    const s = adminSession(writer);
    const entry = s.get('crown')!;
    entry.preset.tags = ['alpha', 'beta'];
    s.saveSystemPreset('crown');
    await flush();

    expect(writer.upsert).toHaveBeenCalledTimes(1);
    const [record, ...rest] = writer.upsert.mock.calls[0] as [RemotePresetRecord];
    expect(rest).toEqual([]);
    expect(record.id).toBe('crown');
    expect(record.name).toBe(entry.preset.name);
    expect(record.preset_data).toEqual(entry.preset);
    expect(record.sort_order).toBe(0);
    expect(record.tags).toEqual(['alpha', 'beta']);
    expect(typeof record.updated_at).toBe('string');
    expect(Number.isNaN(Date.parse(record.updated_at))).toBe(false);
  });

  it('save() on a built-in reaches the writer through saveSystemPreset', async () => {
    const writer = makeWriter();
    const s = adminSession(writer);
    s.save('flight');
    await flush();
    expect(writer.upsert).toHaveBeenCalledTimes(1);
    expect((writer.upsert.mock.calls[0] as [RemotePresetRecord])[0].id).toBe('flight');
  });

  it('rename of a built-in upserts the new name', async () => {
    const writer = makeWriter();
    const s = adminSession(writer);
    s.rename('crown', 'Crown Renamed');
    await flush();
    const [record] = writer.upsert.mock.calls[0] as [RemotePresetRecord];
    expect(record.name).toBe('Crown Renamed');
    expect(record.id).toBe('crown');
  });

  it('promoteToSystemPreset upserts the new system id in the chosen subfolder', async () => {
    const writer = makeWriter();
    const s = adminSession(writer);
    const userId = s.saveAs('crown', 'Candidate');
    const newId = s.promoteToSystemPreset(userId, 'showcase');
    await flush();

    expect(writer.upsert).toHaveBeenCalledTimes(1);
    const [record] = writer.upsert.mock.calls[0] as [RemotePresetRecord];
    expect(record.id).toBe(newId);
    expect(record.subfolder).toBe('showcase');
  });

  it('setSystemPresetSubfolder upserts the new subfolder', async () => {
    const writer = makeWriter();
    const s = adminSession(writer);
    s.setSystemPresetSubfolder('crown', 'flagship');
    await flush();
    const [record] = writer.upsert.mock.calls[0] as [RemotePresetRecord];
    expect(record.subfolder).toBe('flagship');
  });

  it('removeSystemPreset soft-deletes the id', async () => {
    const writer = makeWriter();
    const s = adminSession(writer);
    s.removeSystemPreset('flight');
    await flush();
    expect(writer.softDelete).toHaveBeenCalledTimes(1);
    expect(writer.softDelete).toHaveBeenCalledWith('flight');
    expect(writer.upsert).not.toHaveBeenCalled();
  });

  it('reports success through onResult for save and delete', async () => {
    const writer = makeWriter();
    const s = adminSession(writer);
    s.saveSystemPreset('crown');
    await flush();
    expect(writer.onResult).toHaveBeenLastCalledWith({ op: 'save', id: 'crown', success: true });

    s.removeSystemPreset('flight');
    await flush();
    expect(writer.onResult).toHaveBeenLastCalledWith({ op: 'delete', id: 'flight', success: true });
  });

  it('reports a failed result through onResult with the error text', async () => {
    const writer = makeWriter({
      upsert: vi.fn().mockResolvedValue({ success: false, error: 'Forbidden' }),
    });
    const s = adminSession(writer);
    expect(() => s.saveSystemPreset('crown')).not.toThrow();
    await flush();
    expect(writer.onResult).toHaveBeenCalledWith({ op: 'save', id: 'crown', success: false, error: 'Forbidden' });
  });

  it('reports a rejected promise through onResult and never throws from the save path', async () => {
    const writer = makeWriter({
      softDelete: vi.fn().mockRejectedValue(new Error('network down')),
    });
    const s = adminSession(writer);
    expect(() => s.removeSystemPreset('flight')).not.toThrow();
    await flush();
    expect(writer.onResult).toHaveBeenCalledWith({ op: 'delete', id: 'flight', success: false, error: 'network down' });
  });

  it('reports a synchronous throw from the writer as a failure', async () => {
    const writer = makeWriter({
      upsert: vi.fn(() => {
        throw new Error('sync boom');
      }),
    });
    const s = adminSession(writer);
    expect(() => s.saveSystemPreset('crown')).not.toThrow();
    await flush();
    expect(writer.onResult).toHaveBeenCalledWith({ op: 'save', id: 'crown', success: false, error: 'sync boom' });
  });

  it('setRemoteWriter attaches a writer after construction', async () => {
    const s = adminSession();
    const writer = makeWriter();
    s.setRemoteWriter(writer);
    s.saveSystemPreset('crown');
    await flush();
    expect(writer.upsert).toHaveBeenCalledTimes(1);
  });

  it('with no writer, saves and deletes make no calls and throw nothing', async () => {
    const s = adminSession();
    expect(() => s.saveSystemPreset('crown')).not.toThrow();
    expect(() => s.removeSystemPreset('flight')).not.toThrow();
    await flush();
    expect(s.get('crown')).toBeDefined();
    expect(s.get('flight')).toBeUndefined();
  });
});
