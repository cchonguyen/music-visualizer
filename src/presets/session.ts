// Preset session (slices S2 and S3): the working copy of every preset, the saved copy used to
// show "unsaved changes", user presets in the browser (localStorage), and JSON export/import.
// Scenes are built on demand from the working copies. Layer-list changes rebuild the scene.
import { buildScene, applyPresetToScene } from './loader';
import {
  parsePreset,
  PresetFormatError,
  type Preset,
  type SchemaRegistry,
  type DirectorPaletteAsset,
  type ExperienceBundleAsset,
} from './format';
import type { Scene } from '../render/scene';
import { valuesOf } from './loader';
import type { ParamValue } from './schema';
import {
  GlobalDirector,
  getGlobalDirector,
  DIRECTOR_PALETTES,
  type PaletteDef,
  type GlobalDirectorSettings,
} from '../render/globalDirector';
import { getSystemSubfolder } from './builtin';

if (!(GlobalDirector.prototype as any).registerPalette) {
  (GlobalDirector.prototype as any).registerPalette = function (this: GlobalDirector, palette: DirectorPaletteAsset) {
    (DIRECTOR_PALETTES as Record<string, PaletteDef>)[palette.id] = {
      shadowTint: palette.shadowTint,
      highlightTint: palette.highlightTint,
      spatialSpread: palette.spatialSpread,
    };
  };
}

if (!(GlobalDirector.prototype as any).getDirectorProfile) {
  (GlobalDirector.prototype as any).getDirectorProfile = function (this: GlobalDirector) {
    const s = this.getSettings();
    return {
      cameraMode: s.cameraMode,
      colorMood: s.colorMood,
      colorIntensity: s.colorIntensity,
    };
  };
}

export const USER_PRESETS_KEY = 'mv.userPresets';
export const CUSTOM_PALETTES_KEY = 'mv.customDirectorPalettes';
export const SYSTEM_TAG_OVERRIDES_KEY = 'mv.systemPresetTagOverrides';
export const USER_PRESET_FOLDERS_KEY = 'mv.userPresetFolders';

export interface UserPresetFolder {
  /** Unique stable ID, e.g. "folder-1731000000-abc123" */
  id: string;
  /** Display name shown in UI, e.g. "Chill Ambient" */
  name: string;
  /** Creation timestamp in epoch milliseconds */
  createdAt: number;
}

export interface StoredUserPreset {
  id: string;
  preset: Preset;
  folderId?: string;
}

export interface CategorizedPresets {
  system: {
    showcase: SessionEntry[];
    flagship: SessionEntry[];
    classics: SessionEntry[];
  };
  user: {
    folders: Array<{
      folder: UserPresetFolder;
      entries: SessionEntry[];
    }>;
    unfiled: SessionEntry[];
  };
}

export function registerPaletteInDirector(palette: DirectorPaletteAsset, director = getGlobalDirector()): void {
  (DIRECTOR_PALETTES as Record<string, PaletteDef>)[palette.id] = {
    shadowTint: palette.shadowTint,
    highlightTint: palette.highlightTint,
    spatialSpread: palette.spatialSpread,
  };
  if (typeof (director as any).registerPalette === 'function') {
    (director as any).registerPalette(palette);
  }
}

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
  folderId?: string;
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
  private folders: UserPresetFolder[] = [];
  private systemTagOverrides: Record<string, string[]> = {};

  constructor(
    private readonly host: SceneHost,
    private readonly registry: SchemaRegistry,
    private readonly storage: Storage | undefined,
  ) {
    this.loadCustomPalettes();
    this.loadUserPresetFolders();
    this.loadSystemTagOverrides();
  }

  addBuiltin(id: string, preset: Preset): void {
    const clone = structuredClone(preset);
    if (this.systemTagOverrides[id]) {
      clone.tags = [...this.systemTagOverrides[id]];
    }
    this.entries.set(id, {
      id,
      builtin: true,
      preset: clone,
      savedJson: JSON.stringify(clone),
    });
  }

  /** Loads user presets saved in this browser. Bad entries are skipped, not fatal. */
  loadUserPresets(): string[] {
    this.loadUserPresetFolders();
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
        const rawFolderId = (item as { folderId?: unknown }).folderId;
        const folderId = typeof rawFolderId === 'string' && rawFolderId.trim() ? rawFolderId.trim() : undefined;
        const { preset } = parsePreset((item as { preset: unknown }).preset, this.registry);
        this.entries.set(id, {
          id,
          builtin: false,
          preset,
          savedJson: JSON.stringify(preset),
          folderId,
        });
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
  saveAs(fromId: string, name: string, folderId?: string): string {
    const from = this.require(fromId);
    const preset = structuredClone(from.preset);
    preset.name = name.trim() || preset.name;
    const id = `user-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    let effectiveFolderId = folderId !== undefined ? (folderId ? folderId.trim() : undefined) : from.folderId;
    if (effectiveFolderId && !this.folders.some((f) => f.id === effectiveFolderId)) {
      effectiveFolderId = undefined;
    }
    this.entries.set(id, { id, builtin: false, preset, savedJson: JSON.stringify(preset), folderId: effectiveFolderId });
    this.persist();
    return id;
  }

  /** Duplicates a preset, keeping it in the same folder if applicable. */
  duplicate(fromId: string, name?: string): string {
    const from = this.require(fromId);
    const newName = name ?? `${from.preset.name} copy`;
    return this.saveAs(fromId, newName, from.folderId);
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

  // --- Tag Customization for System Presets ---
  loadSystemTagOverrides(): Record<string, string[]> {
    let overrides: Record<string, string[]> = {};
    try {
      const raw = this.storage?.getItem(SYSTEM_TAG_OVERRIDES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          overrides = parsed as Record<string, string[]>;
        }
      }
    } catch {
      // ignore unreadable storage
    }
    this.systemTagOverrides = overrides;
    for (const [id, tags] of Object.entries(overrides)) {
      const entry = this.entries.get(id);
      if (entry && entry.builtin) {
        entry.preset.tags = [...tags];
        entry.savedJson = JSON.stringify(entry.preset);
      }
    }
    return overrides;
  }

  setPresetTags(presetId: string, tags: string[]): void {
    const entry = this.require(presetId);
    entry.preset.tags = [...tags];
    if (entry.savedJson) {
      try {
        const saved = JSON.parse(entry.savedJson);
        saved.tags = [...tags];
        entry.savedJson = JSON.stringify(saved);
      } catch {
        entry.savedJson = JSON.stringify(entry.preset);
      }
    } else {
      entry.savedJson = JSON.stringify(entry.preset);
    }
    if (entry.builtin) {
      this.systemTagOverrides[presetId] = [...tags];
      try {
        this.storage?.setItem(SYSTEM_TAG_OVERRIDES_KEY, JSON.stringify(this.systemTagOverrides));
      } catch {
        // ignore storage error
      }
    } else {
      this.persist();
    }
  }

  // --- Folder Management ---
  loadUserPresetFolders(): UserPresetFolder[] {
    let folders: UserPresetFolder[] = [];
    try {
      const raw = this.storage?.getItem(USER_PRESET_FOLDERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          folders = parsed.filter(
            (f) => f && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.createdAt === 'number',
          );
        }
      }
    } catch {
      // ignore unreadable storage
    }
    this.folders = folders;
    return folders;
  }

  private persistFolders(): void {
    try {
      this.storage?.setItem(USER_PRESET_FOLDERS_KEY, JSON.stringify(this.folders));
    } catch {
      // ignore
    }
  }

  getFolders(): readonly UserPresetFolder[] {
    return this.folders;
  }

  createFolder(name: string): UserPresetFolder {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Folder name cannot be empty.');
    const folder: UserPresetFolder = {
      id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmed,
      createdAt: Date.now(),
    };
    this.folders.push(folder);
    this.persistFolders();
    return folder;
  }

  renameFolder(folderId: string, newName: string): void {
    const trimmed = newName.trim();
    if (!trimmed) throw new Error('Folder name cannot be empty.');
    const folder = this.folders.find((f) => f.id === folderId);
    if (!folder) throw new Error(`Folder "${folderId}" not found.`);
    folder.name = trimmed;
    this.persistFolders();
  }

  deleteFolder(folderId: string): void {
    const idx = this.folders.findIndex((f) => f.id === folderId);
    if (idx === -1) return;
    this.folders.splice(idx, 1);
    for (const entry of this.entries.values()) {
      if (entry.folderId === folderId) {
        entry.folderId = undefined;
      }
    }
    this.persistFolders();
    this.persist();
  }

  setPresetFolder(presetId: string, folderId: string | undefined): void {
    const entry = this.entries.get(presetId);
    if (!entry) {
      throw new Error(`unknown preset "${presetId}"`);
    }
    if (entry.builtin) {
      throw new Error('Cannot move built-in system presets.');
    }
    let targetFolderId: string | undefined = undefined;
    if (folderId !== undefined && folderId !== null) {
      const clean = folderId.trim();
      if (clean) {
        const exists = this.folders.some((f) => f.id === clean);
        if (!exists) {
          throw new Error(`Folder "${clean}" not found.`);
        }
        targetFolderId = clean;
      }
    }
    entry.folderId = targetFolderId;
    this.persist();
  }

  getPresetFolder(presetId: string): string | undefined {
    const entry = this.entries.get(presetId);
    if (!entry || entry.builtin || !entry.folderId) return undefined;
    if (!this.folders.some((f) => f.id === entry.folderId)) return undefined;
    return entry.folderId;
  }

  // --- Categorized Querying ---
  listCategorized(): CategorizedPresets {
    const result: CategorizedPresets = {
      system: {
        showcase: [],
        flagship: [],
        classics: [],
      },
      user: {
        folders: this.folders.map((folder) => ({
          folder,
          entries: [],
        })),
        unfiled: [],
      },
    };

    const folderMap = new Map<string, SessionEntry[]>();
    for (const group of result.user.folders) {
      folderMap.set(group.folder.id, group.entries);
    }

    for (const entry of this.entries.values()) {
      if (entry.builtin) {
        const subfolder = getSystemSubfolder(entry.id) ?? 'classics';
        result.system[subfolder].push(entry);
      } else {
        if (entry.folderId && folderMap.has(entry.folderId)) {
          folderMap.get(entry.folderId)!.push(entry);
        } else {
          result.user.unfiled.push(entry);
        }
      }
    }

    return result;
  }

  /** Loads custom palettes saved in this browser and registers them with GlobalDirector. */
  loadCustomPalettes(): DirectorPaletteAsset[] {
    let palettes: DirectorPaletteAsset[] = [];
    try {
      const raw = JSON.parse(this.storage?.getItem(CUSTOM_PALETTES_KEY) ?? '[]');
      if (Array.isArray(raw)) {
        palettes = raw;
        for (const p of palettes) {
          if (p && p.id && p.shadowTint && p.highlightTint) {
            registerPaletteInDirector(p);
          }
        }
      }
    } catch {
      // ignore unreadable storage
    }
    return palettes;
  }

  saveCustomPalette(palette: DirectorPaletteAsset): void {
    let existing: DirectorPaletteAsset[] = [];
    try {
      existing = JSON.parse(this.storage?.getItem(CUSTOM_PALETTES_KEY) ?? '[]');
      if (!Array.isArray(existing)) existing = [];
    } catch {
      existing = [];
    }
    const filtered = existing.filter((p) => p.id !== palette.id);
    filtered.push(palette);
    try {
      this.storage?.setItem(CUSTOM_PALETTES_KEY, JSON.stringify(filtered));
    } catch {
      // ignore storage error
    }
    try {
      if (typeof localStorage !== 'undefined' && this.storage !== localStorage) {
        localStorage.setItem(CUSTOM_PALETTES_KEY, JSON.stringify(filtered));
      }
    } catch {
      // ignore
    }
    registerPaletteInDirector(palette);
  }

  /** Export user presets + custom palettes + director settings as an ExperienceBundleAsset JSON. */
  exportExperienceBundle(name: string): string {
    const userPresets = [...this.entries.values()]
      .filter((e) => !e.builtin)
      .map((e) => structuredClone(e.preset));

    let customPalettes: DirectorPaletteAsset[] = [];
    try {
      const raw = JSON.parse(this.storage?.getItem(CUSTOM_PALETTES_KEY) ?? '[]');
      if (Array.isArray(raw)) customPalettes = raw;
    } catch {
      customPalettes = [];
    }

    const bundle: ExperienceBundleAsset = {
      kind: 'mv-experience-bundle',
      version: 1,
      name: name.trim() || 'Experience Bundle',
      presets: userPresets,
      directorPalettes: customPalettes,
      directorSettings: getGlobalDirector().getSettings(),
    };
    return JSON.stringify(bundle, null, 2);
  }

  /** The preset as a JSON file's text (the file format from format.ts). */
  exportJson(id: string, includeActiveProfile: boolean = false): string {
    const entry = this.require(id);
    const clone = structuredClone(entry.preset);
    if (includeActiveProfile && !clone.directorProfile) {
      const director = getGlobalDirector();
      const profile = typeof (director as any).getDirectorProfile === 'function'
        ? (director as any).getDirectorProfile()
        : {
            cameraMode: director.getSettings().cameraMode,
            colorMood: director.getSettings().colorMood,
            colorIntensity: director.getSettings().colorIntensity,
          };
      clone.directorProfile = profile;
    }
    return JSON.stringify(clone, null, 2);
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

  /**
   * Imports a polymorphic visualizer asset (preset, custom palette, or experience bundle).
   */
  importAsset(jsonString: string): {
    kind: 'preset' | 'palette' | 'bundle';
    id?: string;
    name: string;
    warnings: string[];
  } {
    let raw: unknown;
    try {
      raw = JSON.parse(jsonString);
    } catch {
      throw new PresetFormatError('the file is not valid JSON');
    }

    if (!raw || typeof raw !== 'object') {
      throw new PresetFormatError('asset must be a JSON object');
    }

    const asset = raw as Record<string, unknown>;

    // 1. Standalone Director Palette
    if (asset.kind === 'mv-director-palette') {
      if (typeof asset.name !== 'string' || asset.name.trim() === '') {
        throw new PresetFormatError('palette requires a name');
      }
      if (
        !Array.isArray(asset.shadowTint) ||
        asset.shadowTint.length !== 3 ||
        !asset.shadowTint.every((n) => typeof n === 'number' && Number.isFinite(n))
      ) {
        throw new PresetFormatError('palette requires shadowTint [R, G, B]');
      }
      if (
        !Array.isArray(asset.highlightTint) ||
        asset.highlightTint.length !== 3 ||
        !asset.highlightTint.every((n) => typeof n === 'number' && Number.isFinite(n))
      ) {
        throw new PresetFormatError('palette requires highlightTint [R, G, B]');
      }

      const id = typeof asset.id === 'string' && asset.id.trim()
        ? asset.id.trim()
        : asset.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

      const palette: DirectorPaletteAsset = {
        kind: 'mv-director-palette',
        version: 1,
        id,
        name: asset.name.trim(),
        shadowTint: [
          Math.max(0, Math.min(1, Number(asset.shadowTint[0]))),
          Math.max(0, Math.min(1, Number(asset.shadowTint[1]))),
          Math.max(0, Math.min(1, Number(asset.shadowTint[2]))),
        ],
        highlightTint: [
          Math.max(0, Math.min(1, Number(asset.highlightTint[0]))),
          Math.max(0, Math.min(1, Number(asset.highlightTint[1]))),
          Math.max(0, Math.min(1, Number(asset.highlightTint[2]))),
        ],
        spatialSpread:
          typeof asset.spatialSpread === 'number' && Number.isFinite(asset.spatialSpread)
            ? Math.max(0, Math.min(1, asset.spatialSpread))
            : 0.45,
      };

      this.saveCustomPalette(palette);
      return { kind: 'palette', id: palette.id, name: palette.name, warnings: [] };
    }

    // 2. Experience Bundle
    if (asset.kind === 'mv-experience-bundle') {
      const warnings: string[] = [];
      const name = typeof asset.name === 'string' && asset.name.trim()
        ? asset.name.trim()
        : 'Experience Bundle';

      if (Array.isArray(asset.presets)) {
        for (const p of asset.presets) {
          try {
            const { preset, warnings: w } = parsePreset(p, this.registry);
            warnings.push(...w);
            const id = `user-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
            this.entries.set(id, { id, builtin: false, preset, savedJson: JSON.stringify(preset) });
          } catch (err) {
            warnings.push(`Preset skipped: ${(err as Error).message}`);
          }
        }
        this.persist();
      }

      if (Array.isArray(asset.directorPalettes)) {
        for (const pal of asset.directorPalettes) {
          try {
            if (pal && typeof pal === 'object' && pal.name && pal.shadowTint && pal.highlightTint) {
              const palObj = pal as Record<string, unknown>;
              const palId = typeof palObj.id === 'string' && palObj.id.trim()
                ? palObj.id.trim()
                : String(palObj.name).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
              const shadowTint = Array.isArray(palObj.shadowTint)
                ? [Number(palObj.shadowTint[0]) || 0, Number(palObj.shadowTint[1]) || 0, Number(palObj.shadowTint[2]) || 0] as [number, number, number]
                : [0, 0, 0] as [number, number, number];
              const highlightTint = Array.isArray(palObj.highlightTint)
                ? [Number(palObj.highlightTint[0]) || 1, Number(palObj.highlightTint[1]) || 1, Number(palObj.highlightTint[2]) || 1] as [number, number, number]
                : [1, 1, 1] as [number, number, number];
              const paletteAsset: DirectorPaletteAsset = {
                kind: 'mv-director-palette',
                version: 1,
                id: palId,
                name: String(palObj.name).trim(),
                shadowTint,
                highlightTint,
                spatialSpread: typeof palObj.spatialSpread === 'number' ? palObj.spatialSpread : 0.45,
              };
              this.saveCustomPalette(paletteAsset);
            }
          } catch (err) {
            warnings.push(`Palette skipped: ${(err as Error).message}`);
          }
        }
      }

      if (asset.directorSettings && typeof asset.directorSettings === 'object') {
        getGlobalDirector().updateSettings(asset.directorSettings as Partial<GlobalDirectorSettings>);
      }

      return { kind: 'bundle', name, warnings };
    }

    // 3. Standard Preset JSON
    const { id, warnings } = this.importJson(jsonString);
    const presetName = this.entries.get(id)?.preset.name ?? 'Preset';
    return { kind: 'preset', id, name: presetName, warnings };
  }

  private require(id: string): SessionEntry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`unknown preset "${id}"`);
    return entry;
  }

  private persist(): void {
    const userPresets = [...this.entries.values()]
      .filter((e) => !e.builtin)
      .map((e) => ({
        id: e.id,
        preset: e.savedJson ? JSON.parse(e.savedJson) : e.preset,
        ...(e.folderId ? { folderId: e.folderId } : {}),
      }));
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
