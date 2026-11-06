import { describe, it, expect, beforeEach } from 'vitest';
import { PresetSession, USER_PRESETS_KEY, type SceneHost } from './session';
import { parsePreset, PresetFormatError, PRESET_VERSION } from './format';
import { LAYER_SPECS } from './layerSchemas';
import { BUILTIN_PRESETS, SCHEMAS } from './builtin';
import type { Scene } from '../render/scene';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
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
    expect(session.list()).toHaveLength(22);
    expect(session.isDirty('crown')).toBe(false);
  });

  it('cannot be saved over, renamed or deleted', () => {
    expect(() => session.save('crown')).toThrow(/read-only/);
    expect(() => session.rename('crown', 'x')).toThrow(/cannot be renamed/);
    expect(() => session.remove('crown')).toThrow(/cannot be deleted/);
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

