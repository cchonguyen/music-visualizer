// Preset session (slices S2 and S3): the working copy of every preset, the saved copy used to
// show "unsaved changes", user presets in the browser (localStorage), and JSON export/import.
// Scenes are built on demand from the working copies. Layer-list changes rebuild the scene.
import { buildScene, applyPresetToScene } from './loader';
import { parsePreset, PresetFormatError, type Preset, type SchemaRegistry } from './format';
import type { Scene } from '../render/scene';
import { valuesOf } from './loader';
import type { ParamValue } from './schema';

export const USER_PRESETS_KEY = 'mv.userPresets';

/** The compositor operations the session needs. Compositor implements them. */
export interface SceneHost {
  setScene(scene: Scene): void;
  removeScene(name: string): void;
  setFadeSeconds(seconds: number): void;
  setWeights(weights: Record<string, number>): void;
  setPost(values: Record<string, ParamValue>): void;
  setTransition(style: string): void;
}

export interface SessionEntry {
  id: string;
  builtin: boolean;
  preset: Preset; // working copy (what the Studio edits)
  savedJson: string; // last saved state, to detect unsaved changes
}

const HISTORY_LIMIT = 100;
/** Edits closer together than this count as one undo step (a slider drag is one step). */
const COALESCE_MS = 600;

export class PresetSession {
  private entries = new Map<string, SessionEntry>();
  private scenes = new Map<string, Scene>();
  private current: string | null = null;
  // Undo history (slice S4): JSON snapshots of the working copy, per preset.
  private committed = new Map<string, string>();
  private lastPushAt = new Map<string, number>();
  private undoStack = new Map<string, string[]>();
  private redoStack = new Map<string, string[]>();

  constructor(
    private readonly host: SceneHost,
    private readonly registry: SchemaRegistry,
    private readonly storage: Storage | undefined,
  ) {}

  addBuiltin(id: string, preset: Preset): void {
    this.entries.set(id, { id, builtin: true, preset: structuredClone(preset), savedJson: JSON.stringify(preset) });
  }

  /** Loads user presets saved in this browser. Bad entries are skipped, not fatal. */
  loadUserPresets(): string[] {
    const skipped: string[] = [];
    let raw: unknown = [];
    try {
      raw = JSON.parse(this.storage?.getItem(USER_PRESETS_KEY) ?? '[]');
    } catch {
      return ['saved presets are not readable and were ignored'];
    }
    if (!Array.isArray(raw)) return ['saved presets have an unexpected shape and were ignored'];
    for (const item of raw) {
      try {
        const id = String((item as { id: unknown }).id);
        const { preset } = parsePreset((item as { preset: unknown }).preset, this.registry);
        this.entries.set(id, { id, builtin: false, preset, savedJson: JSON.stringify(preset) });
      } catch (err) {
        skipped.push((err as Error).message);
      }
    }
    return skipped;
  }

  /** The id of the preset on screen, or null before the first show(). */
  get shownId(): string | null {
    return this.current;
  }

  get(id: string): SessionEntry | undefined {
    return this.entries.get(id);
  }

  list(): SessionEntry[] {
    return [...this.entries.values()];
  }

  isDirty(id: string): boolean {
    const e = this.entries.get(id);
    return !!e && JSON.stringify(e.preset) !== e.savedJson;
  }

  /** Makes `id` the preset on screen: builds its scene if needed, applies its settings, and fades to it. */
  show(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`show: unknown preset "${id}"`);
    if (!this.scenes.has(id)) this.buildAndRegister(id);
    applyPresetToScene(entry.preset, this.scenes.get(id)!);
    this.host.setFadeSeconds(entry.preset.transition.seconds);
    this.host.setWeights({ [id]: 1 });
    this.host.setPost(valuesOf(entry.preset.post));
    this.host.setTransition(entry.preset.transition.style);
    this.current = id;
  }

  /**
   * Record the working copy for undo. Call after an edit. Edits within COALESCE_MS of the last
   * recorded step merge into it. `force` records even inside that window (used by randomise).
   */
  commit(id: string, now = Date.now(), force = false): void {
    const entry = this.require(id);
    const current = JSON.stringify(entry.preset);
    const prev = this.committed.get(id);
    this.committed.set(id, current);
    if (prev === undefined || prev === current) return;
    const last = this.lastPushAt.get(id) ?? -Infinity;
    if (!force && now - last < COALESCE_MS) return;
    this.lastPushAt.set(id, now);
    pushCapped(this.undoStack, id, prev);
    this.redoStack.set(id, []);
  }

  canUndo(id: string): boolean {
    return (this.undoStack.get(id)?.length ?? 0) > 0;
  }

  canRedo(id: string): boolean {
    return (this.redoStack.get(id)?.length ?? 0) > 0;
  }

  undo(id: string): boolean {
    return this.step(id, this.undoStack, this.redoStack);
  }

  redo(id: string): boolean {
    return this.step(id, this.redoStack, this.undoStack);
  }

  private step(id: string, from: Map<string, string[]>, to: Map<string, string[]>): boolean {
    const entry = this.require(id);
    const target = from.get(id)?.pop();
    if (target === undefined) return false;
    pushCapped(to, id, JSON.stringify(entry.preset));
    entry.preset = JSON.parse(target) as Preset;
    this.committed.set(id, target);
    this.rebuild(id);
    return true;
  }

  /** A/B compare (slice S4): the saved copy, applied to the live scene while held. Only when the layers match. */
  compare(id: string, saved: boolean): void {
    const entry = this.require(id);
    const source = saved ? (JSON.parse(entry.savedJson) as Preset) : entry.preset;
    const sameLayers = source.layers.length === entry.preset.layers.length && source.layers.every((l, i) => l.type === entry.preset.layers[i]!.type);
    if (!sameLayers) return;
    if (!this.scenes.has(id)) this.buildAndRegister(id);
    applyPresetToScene(source, this.scenes.get(id)!);
  }

  /** Push the shown preset's post settings to the compositor (after the Studio edits them). */
  refreshPost(id: string): void {
    const entry = this.require(id);
    if (this.current === id) this.host.setPost(valuesOf(entry.preset.post));
  }

  /** The scene for a preset (built if needed). Used by the Studio to attach its controls. */
  sceneOf(id: string): Scene {
    if (!this.scenes.has(id)) this.buildAndRegister(id);
    return this.scenes.get(id)!;
  }

  /** Call after the layer list changes (add, remove, reorder, enable). Rebuilds the scene from the working copy. */
  rebuild(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`rebuild: unknown preset "${id}"`);
    if (!this.scenes.has(id)) return; // built next time it is shown
    this.buildAndRegister(id);
    applyPresetToScene(entry.preset, this.scenes.get(id)!);
  }

  private buildAndRegister(id: string): void {
    const entry = this.entries.get(id)!;
    const scene = buildScene(id, entry.preset);
    this.scenes.set(id, scene);
    this.host.setScene(scene);
  }

  /** Save the working copy. Built-ins are read-only: use saveAs. */
  save(id: string): void {
    const entry = this.require(id);
    if (entry.builtin) throw new Error('Built-in presets are read-only. Use "Save as" to keep a copy.');
    entry.savedJson = JSON.stringify(entry.preset);
    this.persist();
  }

  /** New user preset from the working copy of `fromId`. Returns the new id. */
  saveAs(fromId: string, name: string): string {
    const from = this.require(fromId);
    const preset = structuredClone(from.preset);
    preset.name = name.trim() || preset.name;
    const id = `user-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    this.entries.set(id, { id, builtin: false, preset, savedJson: JSON.stringify(preset) });
    this.persist();
    return id;
  }

  rename(id: string, name: string): void {
    const entry = this.require(id);
    if (entry.builtin) throw new Error('Built-in presets cannot be renamed.');
    entry.preset.name = name.trim() || entry.preset.name;
    this.save(id);
  }

  remove(id: string): void {
    const entry = this.require(id);
    if (entry.builtin) throw new Error('Built-in presets cannot be deleted.');
    if (this.scenes.has(id)) {
      if (this.current === id) throw new Error('Switch to another preset before deleting this one.');
    this.undoStack.delete(id);
    this.redoStack.delete(id);
    this.committed.delete(id);
      this.host.removeScene(id);
      this.scenes.delete(id);
    }
    this.entries.delete(id);
    this.persist();
  }

  /** The preset as a JSON file's text (the file format from format.ts). */
  exportJson(id: string): string {
    return JSON.stringify(this.require(id).preset, null, 2);
  }

  /** Reads a JSON text as a new user preset. Throws PresetFormatError if it cannot be repaired.
   *  Returns the new id and any warnings (values that were fixed on the way in). */
  importJson(text: string): { id: string; warnings: string[] } {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new PresetFormatError('the file is not valid JSON');
    }
    const { preset, warnings } = parsePreset(raw, this.registry);
    const id = `user-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    this.entries.set(id, { id, builtin: false, preset, savedJson: JSON.stringify(preset) });
    this.persist();
    return { id, warnings };
  }

  private require(id: string): SessionEntry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`unknown preset "${id}"`);
    return entry;
  }

  private persist(): void {
    const userPresets = [...this.entries.values()]
      .filter((e) => !e.builtin)
      .map((e) => ({ id: e.id, preset: e.savedJson ? JSON.parse(e.savedJson) : e.preset }));
    try {
      this.storage?.setItem(USER_PRESETS_KEY, JSON.stringify(userPresets));
    } catch {
      throw new Error('Could not save to this browser (storage full or blocked). Use Export to keep a copy.');
    }
  }
}

function pushCapped(stacks: Map<string, string[]>, id: string, value: string): void {
  const stack = stacks.get(id) ?? [];
  stack.push(value);
  if (stack.length > HISTORY_LIMIT) stack.shift();
  stacks.set(id, stack);
}
