// Preset Studio panel. Built with Tweakpane (MIT), which is loaded only here; the renderer does not use it.
// Sections: preset bar (switch, save, save as, duplicate, delete, export, import, undo, redo),
// vary (randomise, mutate, lock per layer), layer stack (select, enable, add, remove, reorder),
// settings for every enabled layer (built from the schema), and a frame-time readout.
// Value edits go straight to the live layers. Layer-list edits rebuild the scene.
import { Pane, type ButtonApi } from 'tweakpane';
import '../ui/style.css';
import { LAYER_FACTORIES, applyPresetToScene, applyValues, valuesOf } from '../presets/loader';
import { LAYER_SPECS } from '../presets/layerSchemas';
import { SCHEMAS, SYSTEM_SUBFOLDER_LABELS, getSystemSubfolder } from '../presets/builtin';
import { AUDIO_SOURCES, BLEND_MODES, BLEND_SPEC, LFO_RATE_DEFAULT, LFO_RATE_MAX, LFO_RATE_MIN, MORPH_RATE_DEFAULT, MORPH_RATE_MAX, MORPH_RATE_MIN, OPACITY_SPEC, TRAILS_SPEC, TRANSITION_STYLES, type LayerEntry, type Preset, type Settings, type Setting } from '../presets/format';
import type { Scene } from '../render/scene';
import { mutateSettings, randomiseSettings } from '../presets/variation';
import type { PresetSession, SessionEntry, UserPresetFolder } from '../presets/session';
import { attachSwipeDismiss } from '../ui/controls';
import { isSpecVisible, type ParamSpec, type ParamValue } from '../presets/schema';
import { showToast } from '../ui/toast';
import {
  EXPERIENCE_MODES,
  CAMERA_MODES,
  COLOR_MOODS,
  TRIGGER_CADENCES,
  getGlobalDirector,
  type ExperienceMode,
  type CameraMode,
  type ColorMood,
  type TriggerCadence,
} from '../render/globalDirector';

export { EXPERIENCE_MODES, CAMERA_MODES, COLOR_MOODS, TRIGGER_CADENCES };

export interface StudioOptions {
  session: PresetSession;
  /** Make a preset the one on screen (main.ts keeps the key handling and the toast). */
  switchTo: (id: string) => void;
  /** Latest frame time in ms, for the readout. */
  frameMs?: () => number;
  /** Live link value (0..1) for a key `${presetId}L${layerIndexAmongEnabled}.${name}` or `${presetId}F.${name}`. */
  linkMeter?: (key: string) => number | undefined;
  /** Optional custom Pane factory for testing in node / mock environments. */
  paneFactory?: (options: { container: HTMLElement; title: string }) => any;
}

/** Frame budget at 60 fps. The readout turns into a warning above this. */
const FRAME_BUDGET_MS = 16.7;

/** A first Delete tap stays armed for this long. A second tap inside the window deletes. */
export const DELETE_CONFIRM_MS = 3000;
const DELETE_LABEL = 'Delete';
const DELETE_ARMED_LABEL = 'Tap again to delete';

/** Text for the Delete live region: the armed prompt while armed, empty otherwise (slice 11.4). */
export function deleteAnnouncement(armed: boolean): string {
  return armed ? DELETE_ARMED_LABEL : '';
}

/** Trim a typed preset name. Empty or whitespace-only names are rejected with a short message. */
export function validatePresetName(raw: string): { ok: true; name: string } | { ok: false; message: string } {
  const name = raw.trim();
  if (name === '') return { ok: false, message: 'Enter a name first.' };
  return { ok: true, name };
}

/** Two-tap Delete state. With no arm (`armedAt` null) a tap arms and returns the time it armed.
 * A tap inside `windowMs` of the arm confirms and returns to unarmed.
 */
export function nextDeleteTap(armedAt: number | null, now: number, windowMs: number = DELETE_CONFIRM_MS): { confirm: boolean; armedAt: number | null } {
  if (armedAt !== null && now - armedAt >= 0 && now - armedAt < windowMs) return { confirm: true, armedAt: null };
  return { confirm: false, armedAt: now };
}

/** Default layer type added in the Studio ("Add layer"). */
export const DEFAULT_ADD_LAYER_TYPE = 'shape';

/** Default prompt shown in the Studio helper bar when no parameter is hovered/focused (Slice 9.8). */
export const STUDIO_HELPER_IDLE_TEXT = 'Tap or hover over any effect name to see a description of what it does.';

/** Render parameter description and warning in the fixed helper bar element. */
export function renderHelperContent(helperBar: HTMLElement, spec: ParamSpec | null): void {
  if (!helperBar) return;
  if (!spec || (!spec.description && !spec.warning && !spec.intense)) {
    helperBar.textContent = STUDIO_HELPER_IDLE_TEXT;
    return;
  }

  if (typeof helperBar.replaceChildren === 'function') {
    helperBar.replaceChildren();
  } else {
    helperBar.textContent = '';
  }

  const doc = helperBar.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) return;

  const descRow = doc.createElement('div');
  const nameSpan = doc.createElement('span');
  nameSpan.className = 'helper-param-name';
  nameSpan.textContent = spec.label;

  if (spec.description) {
    const descSpan = doc.createElement('span');
    descSpan.className = 'helper-param-desc';
    descSpan.textContent = spec.description;
    descRow.append(nameSpan, ': ', descSpan);
  } else {
    descRow.append(nameSpan);
  }
  helperBar.append(descRow);

  if (spec.warning || spec.intense) {
    const warnRow = doc.createElement('div');
    warnRow.className = 'helper-warning';
    const warnText = spec.warning || 'High-intensity effect';
    warnRow.textContent = `⚠️ ${warnText}`;
    helperBar.append(warnRow);
  }
}

/** Attach amber badge and hover/focus listeners to a blade row (Slice 9.8). */
export function attachSpecHelper(
  blade: any,
  spec: ParamSpec,
  onHelperUpdate?: (spec: ParamSpec | null) => void,
): void {
  if (!blade || typeof blade !== 'object') return;
  const el: HTMLElement | undefined = blade.element;
  if (!el) return;

  const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);

  // 1. Intense / warning badge: (!) appended to label element or blade root
  if (spec.intense || spec.warning) {
    const hasBadge = typeof el.querySelector === 'function' && el.querySelector('.intense-badge');
    if (!hasBadge && doc) {
      const badge = doc.createElement('span');
      badge.className = 'intense-badge';
      badge.title = spec.warning || 'High-intensity effect';
      badge.textContent = '(!)';
      const labelEl = typeof el.querySelector === 'function' ? el.querySelector('.tp-lblv_l, label') : null;
      if (labelEl && typeof labelEl.append === 'function') {
        labelEl.append(badge);
      } else if (typeof el.append === 'function') {
        el.append(badge);
      }
    }
  }

  // 2. Reactive hover & focus tracking
  if (typeof el.addEventListener === 'function' && onHelperUpdate) {
    const activate = () => {
      el.classList?.add('studio-control-highlight');
      if (spec.intense || spec.warning) el.classList?.add('studio-control-highlight-intense');
      onHelperUpdate(spec);
    };
    const deactivate = () => {
      el.classList?.remove('studio-control-highlight');
      el.classList?.remove('studio-control-highlight-intense');
      onHelperUpdate(null);
    };

    el.addEventListener('mouseenter', activate);
    el.addEventListener('focusin', activate);
    el.addEventListener('mouseleave', deactivate);
    el.addEventListener('focusout', (ev: FocusEvent) => {
      if (ev?.relatedTarget && typeof el.contains === 'function' && el.contains(ev.relatedTarget as Node)) {
        return;
      }
      deactivate();
    });
  }
}

export const SYSTEM_OPTGROUP_LABELS = {
  showcase: 'System: Stage 9 Showcase (13–20)',
  flagship: 'System: Flagship Generative (01–12)',
  classics: 'System: Classics & Textures',
} as const;

/** Populate selectEl with an optgroup hierarchy matching session categorization (Slice 10.3). */
export function renderPresetSelectHierarchy(
  selectEl: HTMLSelectElement,
  session: PresetSession,
  currentId: string,
): void {
  if (!selectEl) return;

  if (typeof selectEl.replaceChildren === 'function') {
    selectEl.replaceChildren();
  } else {
    while (selectEl.firstChild) {
      selectEl.removeChild(selectEl.firstChild);
    }
  }

  const doc = selectEl.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return;

  const categorized = typeof session.listCategorized === 'function' ? session.listCategorized() : null;
  if (!categorized) return;

  const addGroup = (label: string, entries: SessionEntry[]) => {
    if (!entries || entries.length === 0) return;
    const optgroup = doc.createElement('optgroup');
    optgroup.setAttribute('label', label);
    if ('label' in optgroup) {
      (optgroup as any).label = label;
    }
    for (const entry of entries) {
      const opt = doc.createElement('option');
      opt.setAttribute('value', entry.id);
      if ('value' in opt) {
        (opt as any).value = entry.id;
      }
      opt.textContent = entry.preset.name;
      if (entry.id === currentId) {
        opt.setAttribute('selected', 'selected');
        if ('selected' in opt) {
          (opt as any).selected = true;
        }
      }
      optgroup.appendChild(opt);
    }
    selectEl.appendChild(optgroup);
  };

  // System groups
  if (categorized.system.showcase.length > 0) {
    addGroup(SYSTEM_OPTGROUP_LABELS.showcase, categorized.system.showcase);
  }
  if (categorized.system.flagship.length > 0) {
    addGroup(SYSTEM_OPTGROUP_LABELS.flagship, categorized.system.flagship);
  }
  if (categorized.system.classics.length > 0) {
    addGroup(SYSTEM_OPTGROUP_LABELS.classics, categorized.system.classics);
  }

  // User groups
  for (const group of categorized.user.folders) {
    if (group.entries.length > 0) {
      addGroup(`User: ${group.folder.name}`, group.entries);
    }
  }
  if (categorized.user.unfiled.length > 0) {
    addGroup('User: Unfiled', categorized.user.unfiled);
  }

  selectEl.value = currentId;
  if (typeof selectEl.setAttribute === 'function') {
    selectEl.setAttribute('value', currentId);
  }
}

export class Studio {
  private pane: Pane | null = null;
  private id = '';
  private selected = 0;
  private addType = DEFAULT_ADD_LAYER_TYPE;
  /** Layers (by index in the preset) that randomise and mutate skip. Reset when the layer list changes. */
  private locked = new Set<number>();
  private monitor = { ms: 0 };
  private linkTarget = '';
  private linkMonitor = { value: 0 };
  /** Delete two-tap state: when the first tap armed it, its timer, and the button it lives on. */
  private deleteArmedAt: number | null = null;
  private deleteTimer: number | undefined;
  private deleteBtn: ButtonApi | null = null;
  /** Polite live region that announces the "Tap again" state of Delete. */
  private readonly deleteLive: HTMLElement;
  /** The in-panel "Save as" name field, when open. */
  private saveAsField: HTMLElement | null = null;
  /** Fixed bottom helper bar element for parameter descriptions & warnings (Slice 9.8). */
  readonly helperBar: HTMLElement;
  /** Preset select element in the DOM (Slice 10.3). */
  private presetSelectEl: HTMLSelectElement | null = null;

  /** Where the Tweakpane pane is built (the header with Close stays in the container). */
  private readonly body: HTMLElement;
  /** The element that had focus before the panel opened; focus returns to it on close. */
  private opener: HTMLElement | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: StudioOptions,
  ) {
    const doc = container.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    this.body = container.querySelector<HTMLElement>('.studio-body') ?? container;
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'false');
    container.setAttribute('aria-label', 'Studio');

    this.deleteLive = doc ? doc.createElement('div') : ({} as HTMLElement);
    if (typeof this.deleteLive.setAttribute === 'function') {
      this.deleteLive.setAttribute('role', 'status');
      this.deleteLive.setAttribute('aria-live', 'polite');
    }
    if (this.deleteLive.style) {
      this.deleteLive.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;';
    }
    if (typeof container.append === 'function') {
      container.append(this.deleteLive);
    }

    const existingHelper = container.querySelector<HTMLElement>('.studio-helper-bar');
    if (existingHelper) {
      this.helperBar = existingHelper;
    } else {
      this.helperBar = doc ? doc.createElement('div') : ({} as HTMLElement);
      this.helperBar.className = 'studio-helper-bar';
      this.helperBar.setAttribute('role', 'status');
      this.helperBar.setAttribute('aria-live', 'polite');
      container.append(this.helperBar);
    }
    renderHelperContent(this.helperBar, null);

    container.querySelector<HTMLButtonElement>('#studio-close')?.addEventListener('click', () => this.setVisible(false));
    // Swipe down on a phone sheet closes Studio (slice 11.6). Same path as the Close button, so focus returns.
    attachSwipeDismiss(container, () => this.setVisible(false));
    // Any pointer or key action outside the Delete button disarms a pending Delete.
    const disarmOnOther = (ev: Event) => {
      if (this.deleteArmedAt === null) return;
      if (this.deleteBtn?.element.contains(ev.target as Node)) return;
      this.disarmDelete();
    };
    this.body.addEventListener('pointerdown', disarmOnOther, true);
    this.body.addEventListener('keydown', disarmOnOther, true);
    setInterval(() => {
      if (!this.visible || !this.pane) return;
      this.monitor.ms = this.opts.frameMs?.() ?? 0;
      this.pane.refresh();
    }, 500);
  }

  get defaultAddType(): string {
    return this.addType;
  }

  /** Show or hide the panel. Opening moves focus into it (after bind); closing returns focus to the opener. */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    if (visible) {
      this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.container.hidden = false;
      requestAnimationFrame(() => this.focusFirst());
    } else {
      this.container.hidden = true;
      const back = this.opener;
      this.opener = null;
      if (back?.isConnected) back.focus();
    }
  }

  private focusFirst(): void {
    if (!this.visible) return;
    const first = this.body.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled), select, textarea');
    (first ?? this.container.querySelector<HTMLElement>('#studio-close'))?.focus();
  }

  get visible(): boolean {
    return !this.container.hidden;
  }

  /** Re-render the preset hierarchy dropdown without a full pane rebuild (Slice 10.3). */
  refreshPresetDropdown(): void {
    const el = this.presetSelectEl ?? this.body.querySelector<HTMLSelectElement>('select');
    if (el) {
      renderPresetSelectHierarchy(el, this.opts.session, this.id);
    }
  }

  /** Refresh studio panel for the current preset (Slice 10.4). */
  refresh(): void {
    if (this.id) {
      this.bind(this.id);
    }
  }

  /** Prompt user for folder name via prompt or prompt fallback. */
  promptForFolderName(message: string, defaultValue = ''): string | null {
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
      const res = window.prompt(message, defaultValue);
      return res !== null ? res.trim() : null;
    }
    if (typeof globalThis !== 'undefined' && typeof (globalThis as any).prompt === 'function') {
      const res = (globalThis as any).prompt(message, defaultValue);
      return res !== null ? res.trim() : null;
    }
    return null;
  }

  /** Confirm action via window.confirm or confirm fallback. */
  confirmAction(message: string): boolean {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return window.confirm(message);
    }
    if (typeof globalThis !== 'undefined' && typeof (globalThis as any).confirm === 'function') {
      return (globalThis as any).confirm(message);
    }
    return true;
  }

  handleNewFolder(presetId: string): void {
    const name = this.promptForFolderName('Enter new folder name:');
    if (!name) {
      this.bind(presetId);
      return;
    }
    const session = this.opts.session;
    try {
      const folder = session.createFolder(name);
      session.setPresetFolder(presetId, folder.id);
      showToast(`Created folder "${folder.name}"`);
      this.bind(presetId);
    } catch (err) {
      showToast((err as Error).message);
      this.bind(presetId);
    }
  }

  handleRenameFolder(presetId: string, folderId: string): void {
    const session = this.opts.session;
    const folders = typeof session.getFolders === 'function' ? session.getFolders() : [];
    const current = folders.find((f) => f.id === folderId);
    const currentName = current ? current.name : '';
    const newName = this.promptForFolderName(`Rename folder "${currentName}":`, currentName);
    if (!newName || newName === currentName) return;
    try {
      session.renameFolder(folderId, newName);
      showToast(`Folder renamed to "${newName}"`);
      this.bind(presetId);
    } catch (err) {
      showToast((err as Error).message);
    }
  }

  handleDeleteFolder(presetId: string, folderId: string): void {
    const session = this.opts.session;
    const folders = typeof session.getFolders === 'function' ? session.getFolders() : [];
    const current = folders.find((f) => f.id === folderId);
    const folderName = current ? current.name : 'this folder';
    const confirmed = this.confirmAction(`Delete folder "${folderName}"? Presets inside will be moved to Unfiled.`);
    if (!confirmed) return;
    try {
      session.deleteFolder(folderId);
      showToast(`Folder "${folderName}" deleted`);
      this.bind(presetId);
    } catch (err) {
      showToast((err as Error).message);
    }
  }

  /** (Re)build the panel for preset `id`. Call after every switch or structure change. */
  bind(id: string): void {
    this.id = id;
    this.disarmDelete();
    this.deleteBtn = null;
    this.pane?.dispose();
    this.body.replaceChildren();
    if (this.container && !this.container.contains(this.helperBar)) {
      this.container.append(this.helperBar);
    }
    renderHelperContent(this.helperBar, null);
    this.saveAsField = null;
    this.presetSelectEl = null;
    const pane: Pane = this.opts.paneFactory
      ? (this.opts.paneFactory({ container: this.body, title: 'Preset Studio' }) as unknown as Pane)
      : new Pane({ container: this.body, title: 'Preset Studio' });
    this.pane = pane;
    const session = this.opts.session;
    const entry = session.get(id);
    if (!entry) return;
    const preset = entry.preset;

    // --- Preset bar -----------------------------------------------------------------
    const categorized = typeof session.listCategorized === 'function' ? session.listCategorized() : null;
    const hierarchicalEntries: SessionEntry[] = categorized
      ? [
          ...categorized.system.showcase,
          ...categorized.system.flagship,
          ...categorized.system.classics,
          ...categorized.user.folders.flatMap((f) => f.entries),
          ...categorized.user.unfiled,
        ]
      : session.list();

    const allEntries = hierarchicalEntries.length > 0 ? hierarchicalEntries : session.list();
    const ids = Object.fromEntries(
      allEntries.map((e) => [e.preset.name + (e.builtin ? '' : ' (yours)'), e.id]),
    );
    const pick = { id };
    const presetBinding = pane.addBinding(pick, 'id', { label: 'Preset', options: ids });
    let lastSwitchedId = id;
    const onSelectPreset = (newId: string) => {
      if (newId && newId !== this.id && newId !== lastSwitchedId) {
        lastSwitchedId = newId;
        pick.id = newId;
        this.opts.switchTo(newId);
      }
    };
    presetBinding.on('change', (ev: { value: unknown }) => onSelectPreset(String(ev.value)));

    const selectEl = (presetBinding?.element?.querySelector?.('select') ?? this.body.querySelector?.('select')) as HTMLSelectElement | null;
    if (selectEl) {
      this.presetSelectEl = selectEl;
      renderPresetSelectHierarchy(selectEl, session, id);
      selectEl.addEventListener?.('change', () => onSelectPreset(selectEl.value));
    }
    // Category indicator for built-ins (Slice 10.4)
    if (entry.builtin) {
      const subfolder = getSystemSubfolder(id) ?? 'classics';
      const subfolderLabel = SYSTEM_SUBFOLDER_LABELS[subfolder] ?? 'Built-in';
      const categoryText = `System Preset (Read-Only) · ${subfolderLabel}`;
      const categoryHolder = { category: categoryText };
      const categoryBinding = pane.addBinding(categoryHolder, 'category', {
        label: 'Category',
        readonly: true,
      });
      if (categoryBinding?.element) {
        categoryBinding.element.classList?.add('studio-category-indicator');
        categoryBinding.element.setAttribute?.('data-category', categoryText);
      }
    }

    const nameBinding = pane.addBinding(preset as unknown as Record<string, unknown>, 'name', {
      label: 'Name',
      readonly: entry.builtin,
    });
    if (entry.builtin) {
      if (nameBinding?.element) {
        const input = nameBinding.element.querySelector?.('input') as HTMLInputElement | null;
        if (input) {
          input.disabled = true;
          input.readOnly = true;
        }
      }
    } else {
      nameBinding.on('change', () => session.commit(id));
    }

    // Folder controls for user presets (Slice 10.4)
    if (!entry.builtin) {
      const currentFolderId = (typeof session.getPresetFolder === 'function' ? session.getPresetFolder(id) : entry.folderId) ?? '';
      const folderOptions: Record<string, string> = {
        '(Unfiled)': '',
      };
      const userFolders: readonly UserPresetFolder[] = typeof session.getFolders === 'function' ? session.getFolders() : [];
      for (const f of userFolders) {
        folderOptions[f.name] = f.id;
      }
      folderOptions['+ New Folder…'] = '__new_folder__';

      const folderHolder = { folder: currentFolderId };
      const folderBinding = pane.addBinding(folderHolder, 'folder', {
        label: 'Folder',
        options: folderOptions,
      });

      const onSelectFolder = (chosenFolder: string) => {
        if (chosenFolder === '__new_folder__') {
          this.handleNewFolder(id);
        } else if (!chosenFolder) {
          if (typeof session.setPresetFolder === 'function') {
            session.setPresetFolder(id, undefined);
          } else {
            entry.folderId = undefined;
          }
          showToast('Preset unfiled');
          this.bind(id);
        } else {
          if (typeof session.setPresetFolder === 'function') {
            session.setPresetFolder(id, chosenFolder);
          } else {
            entry.folderId = chosenFolder;
          }
          const f = userFolders.find((x) => x.id === chosenFolder);
          showToast(`Moved to ${f ? f.name : 'folder'}`);
          this.bind(id);
        }
      };
      folderBinding.on('change', (ev: { value: unknown }) => onSelectFolder(String(ev.value)));
      const folderSelectEl = folderBinding?.element?.querySelector?.('select') as HTMLSelectElement | null;
      if (folderSelectEl) {
        folderSelectEl.addEventListener?.('change', () => onSelectFolder(folderSelectEl.value));
      }

      // Folder management buttons
      const folderBtnElements: HTMLElement[] = [];
      const addFolderBtn = (title: string, onClick: () => void) => {
        const btn = pane.addButton({ title });
        btn.on('click', onClick);
        folderBtnElements.push(btn.element);
        return btn;
      };

      if (currentFolderId) {
        addFolderBtn('Rename folder', () => this.handleRenameFolder(id, currentFolderId));
        addFolderBtn('Delete folder', () => this.handleDeleteFolder(id, currentFolderId));
      }
      addFolderBtn('Add folder', () => this.handleNewFolder(id));

      const docForFolder = this.body.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
      if (folderBtnElements.length > 0 && docForFolder) {
        const folderRow = docForFolder.createElement('div');
        folderRow.className = 'studio-folder-actions';
        if (folderBtnElements[0] && typeof (folderBtnElements[0] as any).before === 'function') {
          (folderBtnElements[0] as any).before(folderRow);
        }
        if (typeof folderRow.append === 'function') {
          folderRow.append(...folderBtnElements);
        }
      }
    }

    const dirty = session.isDirty(id) ? ' · unsaved changes' : '';
    // Tags for the auto-cycle (T2): "favourite" and "skip".
    const tagHolder = { favourite: preset.tags.includes('favourite'), skip: preset.tags.includes('skip') };
    const setTag = (tag: string, on: boolean) => {
      const currentTags = preset.tags.filter((t) => t !== tag);
      if (on) currentTags.push(tag);
      if (typeof session.setPresetTags === 'function') {
        session.setPresetTags(id, currentTags);
      } else {
        preset.tags = currentTags;
        session.commit(id);
      }
    };
    pane.addBinding(tagHolder, 'favourite', { label: 'Favourite (auto-cycle)' }).on('change', (ev) => setTag('favourite', Boolean(ev.value)));
    pane.addBinding(tagHolder, 'skip', { label: 'Skip in auto-cycle' }).on('change', (ev) => setTag('skip', Boolean(ev.value)));
    // Transition into this preset (T1): style and time. Applied the next time the preset is shown.
    pane.addBinding(preset.transition as unknown as Record<string, unknown>, 'style', {
      label: 'Transition style',
      options: Object.fromEntries(TRANSITION_STYLES.map((t) => [t, t])),
    }).on('change', () => session.commit(id));
    pane.addBinding(preset.transition as unknown as Record<string, unknown>, 'seconds', { label: 'Transition seconds', min: 0.3, max: 10, step: 0.05 }).on('change', () => session.commit(id));
    // Action buttons share one grid wrapper (slice 10.2). Each button's element is collected, then moved into the wrapper below.
    const tiles: HTMLElement[] = [];
    const tile = <T extends ButtonApi>(btn: T): T => {
      tiles.push(btn.element);
      return btn;
    };
    if (entry.builtin) {
      tile(pane.addButton({ title: 'Save (Read-only)' })).on('click', () => {
        showToast('Built-in presets are read-only. Use "Save as…" to keep a copy.');
      });
    } else {
      tile(pane.addButton({ title: `Save${dirty}` })).on('click', () => this.run(() => session.save(id), 'Saved'));
    }
    tile(pane.addButton({ title: 'Save as…' })).on('click', () => this.openSaveAsField(id, `${preset.name} copy`));
    tile(pane.addButton({ title: 'Duplicate' })).on('click', () =>
      this.run(() => this.opts.switchTo(session.saveAs(id, `${preset.name} copy`)), 'Duplicated'),
    );
    if (!entry.builtin) {
      const del = tile(pane.addButton({ title: DELETE_LABEL }));
      this.deleteBtn = del;
      del.on('click', () => this.onDeleteTap(del, id));
    }
    tile(pane.addButton({ title: 'Export .json' })).on('click', () => this.exportFile(id));
    tile(pane.addButton({ title: 'Import .json…' })).on('click', () => this.importFile());
    const undo = tile(pane.addButton({ title: 'Undo' }));
    undo.disabled = !session.canUndo(id);
    undo.on('click', () => this.run(() => {
      session.undo(id);
    }, 'Undone'));
    const redo = tile(pane.addButton({ title: 'Redo' }));
    redo.disabled = !session.canRedo(id);
    redo.on('click', () => this.run(() => {
      session.redo(id);
    }, 'Redone'));
    const doc = this.body.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    const tileGrid = doc ? doc.createElement('div') : null;
    if (tileGrid) {
      tileGrid.className = 'studio-tiles';
      if (tiles[0] && typeof (tiles[0] as any).before === 'function') {
        (tiles[0] as any).before(tileGrid);
      }
      if (typeof tileGrid.append === 'function') {
        tileGrid.append(...tiles);
      }
    }

    // --- Vary -----------------------------------------------------------------------
    pane.addBlade({ view: 'separator' });
    pane.addButton({ title: 'Randomise (within safe ranges)' }).on('click', () => this.vary('random'));
    pane.addButton({ title: 'Mutate (±10%)' }).on('click', () => this.vary('mutate'));

    // --- Global Director (Sector 483, Slice 7.32) -----------------------------------
    const dirFolder = pane.addFolder({ title: 'Global Director', expanded: false });
    buildGlobalDirectorControls(dirFolder);

    // --- Layer stack ----------------------------------------------------------------
    pane.addBlade({ view: 'separator' });
    this.selected = preset.layers.length === 0 ? 0 : Math.min(this.selected, preset.layers.length - 1);
    if (preset.layers.length > 0) {
      const layerOptions = Object.fromEntries(preset.layers.map((l, i) => [formatLayerLabel(l, i), i]));
      const sel = { selected: this.selected };
      pane.addBinding(sel, 'selected', { label: 'Layer', options: layerOptions }).on('change', (ev) => {
        this.selected = Number(ev.value);
        this.bind(id);
      });
      const layer = preset.layers[this.selected]!;
      pane.addBinding(layer as unknown as Record<string, unknown>, 'enabled', { label: 'Layer on' }).on('change', () => this.structure());
      const lock = { locked: this.locked.has(this.selected) };
      pane.addBinding(lock, 'locked', { label: 'Keep when randomising' }).on('change', (ev) => {
        if (ev.value) this.locked.add(this.selected);
        else this.locked.delete(this.selected);
      });
      buildLayerControls(
        pane,
        layer,
        preset,
        session.sceneOf(id),
        session,
        undefined,
        id,
        (spec) => renderHelperContent(this.helperBar, spec),
      );
      pane.addButton({ title: 'Move layer up' }).on('click', () => this.move(-1));
      pane.addButton({ title: 'Move layer down' }).on('click', () => this.move(1));
      pane.addButton({ title: 'Remove layer' }).on('click', () => {
        preset.layers.splice(this.selected, 1);
        this.structure();
      });
    }
    const typeHolder = { type: this.addType };
    const typeOptions = Object.fromEntries(Object.keys(LAYER_FACTORIES).map((t) => [t, t]));
    pane.addBinding(typeHolder, 'type', { label: 'Add layer', options: typeOptions }).on('change', (ev) => {
      this.addType = String(ev.value);
    });
    pane.addButton({ title: 'Add this layer' }).on('click', () => {
      preset.layers.push(defaultLayer(this.addType));
      this.selected = preset.layers.length - 1;
      this.structure();
    });

    // --- Settings -------------------------------------------------------------------
    // Settings for every enabled layer. Live layers are matched by their order among the enabled ones.
    let live = 0;
    for (let i = 0; i < preset.layers.length; i++) {
      const layerEntry = preset.layers[i]!;
      if (!layerEntry.enabled) continue;
      const k = live++;
      const title = layerEntry.type === 'shape'
        ? formatLayerTitle(layerEntry, i)
        : layerEntry.type;
      this.bindSection(pane, title, LAYER_SPECS[layerEntry.type] ?? [], layerEntry.params, () => {
        const current = session.sceneOf(id).layers[k];
        if (current) applyValues(current, valuesOf(layerEntry.params));
      });
    }
    this.bindSection(pane, 'Feedback', SCHEMAS.feedback, preset.feedback, () => session.sceneOf(id).setFeedback(valuesOf(preset.feedback)));
    this.bindSection(pane, 'Post', SCHEMAS.post, preset.post, () => session.refreshPost(id));

    // --- Audio link (slice E2) --------------------------------------------------------
    this.bindLinkEditor(pane, id, preset);
    this.bindMorphEditor(pane, id, preset);

    // --- Frame time -----------------------------------------------------------------
    pane.addBlade({ view: 'separator' });
    this.monitor.ms = this.opts.frameMs?.() ?? 0;
    pane.addBinding(this.monitor, 'ms', {
      label: `Frame time ms (60 fps ≤ ${FRAME_BUDGET_MS})`,
      readonly: true,
      format: (v: number) => v.toFixed(1),
    });
  }

  /** Pick one numeric setting, then add, edit or remove its audio link. */
  private bindLinkEditor(pane: Pane, id: string, preset: Preset): void {
    const targets = linkTargets(preset);
    if (targets.length === 0) return;
    pane.addBlade({ view: 'separator' });
    if (!targets.some((t) => t.key === this.linkTarget)) this.linkTarget = targets[0]!.key;
    const pick = { key: this.linkTarget };
    pane.addBinding(pick, 'key', {
      label: 'Link a setting',
      options: Object.fromEntries(targets.map((t) => [t.label, t.key])),
    }).on('change', (ev) => {
      this.linkTarget = String(ev.value);
      this.bind(id);
    });
    const target = targets.find((t) => t.key === this.linkTarget)!;
    const setting = target.setting;
    const session = this.opts.session;
    if (!setting.link) {
      pane.addButton({ title: 'Add audio link' }).on('click', () => {
        session.commit(id);
        setting.link = { source: 'bass', amount: 0.2, smooth: 0.2 };
        this.bind(id);
      });
      return;
    }
    const link = setting.link;
    const onEdit = () => session.commit(id);
    pane.addBinding(link as unknown as Record<string, unknown>, 'source', {
      label: 'Source',
      options: Object.fromEntries(AUDIO_SOURCES.map((s) => [s, s])),
    }).on('change', onEdit);
    pane.addBinding(link as unknown as Record<string, unknown>, 'amount', { label: 'Amount (share of range)', min: -1, max: 1, step: 0.01 }).on('change', onEdit);
    pane.addBinding(link as unknown as Record<string, unknown>, 'smooth', { label: 'Smoothing', min: 0, max: 1, step: 0.01 }).on('change', onEdit);
    if (link.source.startsWith('lfo')) {
      // LFO rate (slice: adjustable LFOs). Blank means the 0.5 Hz default.
      const rateBox = link as unknown as { rate?: number };
      if (rateBox.rate === undefined) rateBox.rate = LFO_RATE_DEFAULT;
      pane.addBinding(rateBox, 'rate', { label: 'LFO rate (Hz)', min: LFO_RATE_MIN, max: LFO_RATE_MAX, step: 0.05 }).on('change', onEdit);
    }
    // The runner's keys are `${presetId}${L|F}…`, so the preset id goes in front.
    this.linkMonitor.value = target.meterKey ? this.opts.linkMeter?.(`${id}${target.meterKey}`) ?? 0 : 0;
    pane.addBinding(this.linkMonitor, 'value', { label: 'Source now (0–1)', readonly: true, format: (v: number) => v.toFixed(2) });
    pane.addButton({ title: 'Remove audio link' }).on('click', () => {
      session.commit(id);
      delete (setting as Setting).link;
      this.bind(id);
    });
  }

  /** Morph the setting picked in the link editor: it swings between its value and a second value (slice E-c). */
  private bindMorphEditor(pane: Pane, id: string, preset: Preset): void {
    const target = linkTargets(preset).find((t) => t.key === this.linkTarget);
    if (!target || (target.spec.type !== 'float' && target.spec.type !== 'int')) return;
    const { spec, setting } = target;
    const session = this.opts.session;
    const onEdit = () => session.commit(id);
    if (!setting.morph) {
      pane.addButton({ title: 'Add morph (swing to a second value)' }).on('click', () => {
        session.commit(id);
        setting.morph = { to: morphTargetFor(spec, setting.value), rate: MORPH_RATE_DEFAULT };
        this.bind(id);
      });
      return;
    }
    const morph = setting.morph;
    pane.addBinding(morph as unknown as Record<string, unknown>, 'to', {
      label: 'Morph to',
      min: spec.min,
      max: spec.max,
      step: spec.step,
    }).on('change', onEdit);
    pane.addBinding(morph as unknown as Record<string, unknown>, 'rate', {
      label: 'Morph rate (cycles/s)',
      min: MORPH_RATE_MIN,
      max: MORPH_RATE_MAX,
      step: 0.01,
    }).on('change', onEdit);
    pane.addButton({ title: 'Remove morph' }).on('click', () => {
      session.commit(id);
      delete (setting as Setting).morph;
      this.bind(id);
    });
  }

  private bindSection(pane: Pane, title: string, specs: readonly ParamSpec[], settings: Settings, apply: () => void): void {
    bindSection(
      pane,
      title,
      specs,
      settings,
      apply,
      () => this.opts.session.commit(this.id),
      (spec) => renderHelperContent(this.helperBar, spec),
    );
  }

  /** Randomise or mutate every unlocked layer (and feedback/post), as one undo step. */
  private vary(kind: 'random' | 'mutate'): void {
    const session = this.opts.session;
    const entry = session.get(this.id);
    if (!entry) return;
    const rng = Math.random;
    entry.preset.layers.forEach((layer, i) => {
      if (this.locked.has(i)) return;
      const specs = LAYER_SPECS[layer.type] ?? [];
      layer.params = kind === 'random' ? randomiseSettings(layer.params, specs, rng) : mutateSettings(layer.params, specs, rng);
    });
    if (kind === 'random') {
      entry.preset.feedback = randomiseSettings(entry.preset.feedback, SCHEMAS.feedback, rng);
      entry.preset.post = randomiseSettings(entry.preset.post, SCHEMAS.post, rng);
    } else {
      entry.preset.feedback = mutateSettings(entry.preset.feedback, SCHEMAS.feedback, rng);
      entry.preset.post = mutateSettings(entry.preset.post, SCHEMAS.post, rng);
    }
    session.commit(this.id, Date.now(), true);
    session.rebuild(this.id);
    this.bind(this.id);
    showToast(kind === 'random' ? 'Randomised (undo to go back)' : 'Mutated (undo to go back)');
  }

  private move(delta: -1 | 1): void {
    const layers = this.opts.session.get(this.id)!.preset.layers;
    const target = this.selected + delta;
    if (target < 0 || target >= layers.length) return;
    [layers[this.selected], layers[target]] = [layers[target]!, layers[this.selected]!];
    this.selected = target;
    this.structure();
  }

  /** After a layer-list change: record for undo, rebuild the scene from the working copy, redraw. */
  private structure(): void {
    this.opts.session.commit(this.id);
    this.locked.clear();
    this.opts.session.rebuild(this.id);
    this.bind(this.id);
  }

  /** Show the in-panel name field for Save as. OK saves under the typed name; Cancel or Escape changes nothing. */
  private openSaveAsField(id: string, defaultName: string): void {
    this.closeSaveAsField();
    const session = this.opts.session;
    const field = document.createElement('div');
    field.style.display = 'flex';
    field.style.flexWrap = 'wrap';
    field.style.gap = '6px';
    field.style.padding = '6px';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = defaultName;
    input.setAttribute('aria-label', 'Name for the new preset');
    const msg = document.createElement('span');
    msg.setAttribute('role', 'alert');
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'OK';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const submit = () => {
      const check = validatePresetName(input.value);
      if (!check.ok) {
        msg.textContent = check.message;
        input.focus();
        return;
      }
      this.closeSaveAsField();
      this.run(() => this.opts.switchTo(session.saveAs(id, check.name)), 'Saved as new preset');
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        submit();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this.closeSaveAsField();
      }
    });
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', () => this.closeSaveAsField());
    field.append(input, ok, cancel, msg);
    this.body.prepend(field);
    this.saveAsField = field;
    input.focus();
    input.select();
  }

  private closeSaveAsField(): void {
    this.saveAsField?.remove();
    this.saveAsField = null;
  }

  /** First tap arms Delete for DELETE_CONFIRM_MS. A tap inside that window deletes. */
  private onDeleteTap(btn: ButtonApi, id: string): void {
    const step = nextDeleteTap(this.deleteArmedAt, Date.now());
    this.disarmDelete();
    if (step.confirm) {
      this.run(() => {
        this.opts.session.remove(id);
        this.opts.switchTo('crown');
      }, 'Deleted');
      return;
    }
    this.deleteArmedAt = step.armedAt;
    this.deleteBtn = btn;
    btn.title = DELETE_ARMED_LABEL;
    this.deleteLive.textContent = deleteAnnouncement(true);
    this.deleteTimer = setTimeout(() => this.disarmDelete(), DELETE_CONFIRM_MS) as unknown as number;
  }

  /** Return Delete to its idle state and clear the timer. */
  private disarmDelete(): void {
    if (this.deleteTimer !== undefined) clearTimeout(this.deleteTimer);
    this.deleteTimer = undefined;
    this.deleteArmedAt = null;
    if (this.deleteBtn) this.deleteBtn.title = DELETE_LABEL;
    this.deleteLive.textContent = deleteAnnouncement(false);
  }

  private run(action: () => void, doneMessage: string): void {
    try {
      action();
      showToast(doneMessage);
      const stillThere = this.opts.session.get(this.id) ? this.id : 'crown';
      this.bind(stillThere);
    } catch (err) {
      showToast((err as Error).message);
    }
  }

  private exportFile(id: string): void {
    const text = this.opts.session.exportJson(id, true);
    const name = (this.opts.session.get(id)?.preset.name ?? 'preset').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || 'preset'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private importFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const res = this.opts.session.importAsset(await file.text());
        if (res.kind === 'preset') {
          showToast(res.warnings.length ? `Imported with ${res.warnings.length} fix(es)` : `Imported Preset · ${res.name}`);
          if (res.id) this.opts.switchTo(res.id);
        } else if (res.kind === 'palette') {
          showToast(`Imported Palette · ${res.name}`);
        } else if (res.kind === 'bundle') {
          showToast(`Imported Bundle · ${res.name}`);
        }
      } catch (err) {
        showToast((err as Error).message);
      }
    });
    input.click();
  }
}

/** Descriptive title for layer settings sections (e.g. "1. Shape (circle · bars)"). */
export function formatLayerTitle(layer: LayerEntry, index: number): string {
  if (layer.type === 'shape') {
    const p = layer.params ?? {};
    const base = (p.baseShape !== null && typeof p.baseShape === 'object' && 'value' in p.baseShape)
      ? p.baseShape.value
      : (p.baseShape ?? 'circle');
    const effect = (p.effectType !== null && typeof p.effectType === 'object' && 'value' in p.effectType)
      ? p.effectType.value
      : (p.effectType ?? 'bars');
    return `${index + 1}. Shape (${base} · ${effect})`;
  }
  return `${index + 1}. ${layer.type}`;
}

/** Layer dropdown label in Studio (e.g. "1. Shape (circle · bars)" or "... (off)"). */
export function formatLayerLabel(layer: LayerEntry, index: number): string {
  const off = layer.enabled ? '' : ' (off)';
  if (layer.type === 'shape') {
    const p = layer.params ?? {};
    const base = (p.baseShape !== null && typeof p.baseShape === 'object' && 'value' in p.baseShape)
      ? p.baseShape.value
      : (p.baseShape ?? 'circle');
    const effect = (p.effectType !== null && typeof p.effectType === 'object' && 'value' in p.effectType)
      ? p.effectType.value
      : (p.effectType ?? 'bars');
    return `${index + 1}. Shape (${base} · ${effect})${off}`;
  }
  return `${index + 1}. ${layer.type}${off}`;
}

/** Every numeric setting that can take a link, with the key used in the Studio and the link meter key. */
export function linkTargets(preset: Preset): { key: string; label: string; setting: Setting; meterKey: string; spec: ParamSpec }[] {
  const out: { key: string; label: string; setting: Setting; meterKey: string; spec: ParamSpec }[] = [];
  let live = 0;
  preset.layers.forEach((layer, i) => {
    const k = layer.enabled ? live++ : -1;
    const layerTitle = layer.type === 'shape'
      ? formatLayerTitle(layer, i)
      : `${i + 1}. ${layer.type}`;
    for (const spec of LAYER_SPECS[layer.type] ?? []) {
      if (spec.type !== 'float' && spec.type !== 'int') continue;
      if (!isSpecVisible(spec, layer.params)) continue;
      const setting = layer.params[spec.name];
      if (!setting) continue;
      out.push({
        key: `L${i}.${spec.name}`,
        label: `${layerTitle} · ${spec.label}`,
        setting,
        meterKey: k >= 0 ? `L${k}.${spec.name}` : '',
        spec,
      });
    }
  });
  for (const spec of FEEDBACK_NUMBERS) {
    if (!isSpecVisible(spec, preset.feedback)) continue;
    const setting = preset.feedback[spec.name];
    if (setting) out.push({ key: `F.${spec.name}`, label: `Feedback · ${spec.label}`, setting, meterKey: `F.${spec.name}`, spec });
  }
  for (const spec of POST_NUMBERS) {
    if (!isSpecVisible(spec, preset.post)) continue;
    const setting = preset.post[spec.name];
    if (setting) out.push({ key: `P.${spec.name}`, label: `Post · ${spec.label}`, setting, meterKey: `P.${spec.name}`, spec });
  }
  return out;
}
const FEEDBACK_NUMBERS = SCHEMAS.feedback.filter((s) => s.type === 'float' || s.type === 'int');
const POST_NUMBERS = SCHEMAS.post.filter((s) => s.type === 'float' || s.type === 'int');

/** Default morph end: a quarter of the range away from the value, on whichever side has room, kept in range. */
function morphTargetFor(spec: Extract<ParamSpec, { type: 'float' | 'int' }>, value: ParamValue): number {
  const base = typeof value === 'number' ? value : spec.default;
  const quarter = (spec.max - spec.min) * 0.25;
  let to = base + quarter;
  if (to > spec.max) to = base - quarter;
  to = Math.min(spec.max, Math.max(spec.min, to));
  return spec.type === 'int' ? Math.round(to) : to;
}

/** A new layer with the schema defaults, enabled, full opacity. */
export function defaultLayer(type: string): LayerEntry {
  const params: Settings = {};
  for (const spec of LAYER_SPECS[type] ?? []) params[spec.name] = { value: spec.default };
  // New particle layers follow the scene by default (2026-11-06). Existing presets keep their stored value.
  if (type === 'particles') params.followScene = { value: true };
  return { type, enabled: true, opacity: 1, blend: 'add', params };
}

if (!(OPACITY_SPEC as any).key) (OPACITY_SPEC as any).key = OPACITY_SPEC.name;
if (!(BLEND_SPEC as any).key) (BLEND_SPEC as any).key = BLEND_SPEC.name;
if (!(TRAILS_SPEC as any).key) (TRAILS_SPEC as any).key = TRAILS_SPEC.name;

export function buildLayerControls(
  pane: { addBinding: (target: any, prop: any, options?: any) => any },
  entry: LayerEntry,
  p: Preset,
  currentScene: Scene,
  session: { commit: (arg?: any, ...rest: any[]) => void },
  gl?: WebGL2RenderingContext,
  id?: string,
  onHelperUpdate?: (spec: ParamSpec | null) => void,
): { opacityBinding: any; blendBinding: any; trailsBinding: any } {
  const onLayerConfigChange = () => {
    applyPresetToScene(p, currentScene, gl);
    try {
      (session as any).commit(true);
    } catch {
      // ignore
    }
    if (id && typeof id === 'string') {
      try {
        session.commit(id, Date.now(), true);
      } catch {
        // ignore
      }
    }
  };

  const opacityKey = (OPACITY_SPEC as any).key ?? OPACITY_SPEC.name;
  const opacityBinding = pane.addBinding(entry as unknown as Record<string, unknown>, opacityKey, {
    label: OPACITY_SPEC.label,
    min: OPACITY_SPEC.min,
    max: OPACITY_SPEC.max,
    step: OPACITY_SPEC.step,
  }).on('change', onLayerConfigChange);
  attachSpecHelper(opacityBinding, OPACITY_SPEC, onHelperUpdate);

  const blendKey = (BLEND_SPEC as any).key ?? BLEND_SPEC.name;
  const blendBinding = pane.addBinding(entry as unknown as Record<string, unknown>, blendKey, {
    label: BLEND_SPEC.label,
    options: Object.fromEntries(BLEND_MODES.map((b) => [b, b])),
  }).on('change', onLayerConfigChange);
  attachSpecHelper(blendBinding, BLEND_SPEC, onHelperUpdate);

  if (entry.trails === undefined) {
    entry.trails = TRAILS_SPEC.default;
  }
  const trailsKey = (TRAILS_SPEC as any).key ?? TRAILS_SPEC.name;
  const trailsBinding = pane.addBinding(entry as unknown as Record<string, unknown>, trailsKey, {
    label: TRAILS_SPEC.label,
  }).on('change', onLayerConfigChange);
  attachSpecHelper(trailsBinding, TRAILS_SPEC, onHelperUpdate);

  return { opacityBinding, blendBinding, trailsBinding };
}

/**
 * Bind a list of parameter specs in a section, dynamically updating blade visibility
 * whenever any parameter changes via `isSpecVisible`.
 */
export function bindSection(
  pane: any,
  title: string,
  specs: readonly ParamSpec[],
  settings: Settings | Record<string, any>,
  apply?: () => void,
  onCommit?: () => void,
  onHelperUpdate?: (spec: ParamSpec | null) => void,
): { specBindings: Array<{ spec: ParamSpec; blades: any[] }>; updateVisibility: () => void } {
  if (specs.length === 0) return { specBindings: [], updateVisibility: () => {} };
  if (typeof pane.addBlade === 'function') {
    pane.addBlade({ view: 'separator' });
  }

  const holder: Record<string, ParamValue> = {};
  for (const spec of specs) {
    const s = settings[spec.name];
    if (s !== null && typeof s === 'object' && 'value' in s && !Array.isArray(s)) {
      holder[spec.name] = s.value;
    } else if (spec.name in settings) {
      holder[spec.name] = (settings as any)[spec.name];
    } else {
      holder[spec.name] = spec.default;
    }
  }

  const specBindings: Array<{ spec: ParamSpec; blades: any[] }> = [];

  const updateVisibility = () => {
    for (const { spec, blades } of specBindings) {
      const visible = isSpecVisible(spec, holder);
      for (const b of blades) {
        if (b && typeof b === 'object') {
          b.hidden = !visible;
        }
      }
    }
  };

  for (const spec of specs) {
    const label = `${title} · ${spec.group} · ${spec.label}`;
    const push = () => {
      onCommit?.();
      const s = settings[spec.name];
      if (s !== null && typeof s === 'object' && 'value' in s && !Array.isArray(s)) {
        s.value = holder[spec.name]!;
      } else {
        (settings as any)[spec.name] = holder[spec.name]!;
      }
      updateVisibility();
      apply?.();
    };
    const binding = bindSpec(pane, label, spec, holder, push, onHelperUpdate);
    const blades = Array.isArray(binding) ? binding : [binding];
    specBindings.push({ spec, blades });
  }

  updateVisibility();

  return { specBindings, updateVisibility };
}

export function bindSpec(
  pane: any,
  labelOrSpec: string | ParamSpec,
  specOrHolder: ParamSpec | Record<string, ParamValue>,
  holderOrOnChange?: Record<string, ParamValue> | (() => void),
  maybeOnChange?: (() => void) | ((spec: ParamSpec | null) => void),
  maybeOnHelperUpdate?: (spec: ParamSpec | null) => void,
): any {
  let label: string;
  let spec: ParamSpec;
  let holder: Record<string, ParamValue>;
  let onChange: () => void;
  let onHelperUpdate: ((spec: ParamSpec | null) => void) | undefined;

  if (typeof labelOrSpec === 'string') {
    label = labelOrSpec;
    spec = specOrHolder as ParamSpec;
    holder = holderOrOnChange as Record<string, ParamValue>;
    onChange = maybeOnChange as () => void;
    onHelperUpdate = maybeOnHelperUpdate;
  } else {
    spec = labelOrSpec as ParamSpec;
    holder = specOrHolder as Record<string, ParamValue>;
    onChange = holderOrOnChange as () => void;
    label = spec.label;
    onHelperUpdate = maybeOnChange as ((spec: ParamSpec | null) => void) | undefined;
  }

  const key = ((spec as any).key ?? spec.name) as string;
  const target = holder as Record<string, unknown>;

  let result: any;
  switch (spec.type) {
    case 'float':
    case 'int':
      result = pane.addBinding(target, key, { label, min: spec.min, max: spec.max, step: spec.step }).on('change', onChange);
      break;
    case 'bool':
      result = pane.addBinding(target, key, { label }).on('change', onChange);
      break;
    case 'enum':
      result = pane.addBinding(target, key, { label, options: Object.fromEntries(spec.options.map((o) => [o, o])) }).on('change', onChange);
      break;
    case 'colour':
      result = pane.addBinding(target, key, { label, view: 'color' }).on('change', onChange);
      break;
    case 'vec3': {
      if (!Array.isArray(holder[key])) {
        holder[key] = ((spec as any).default ? [...(spec as any).default] : [1.0, 1.0, 1.0]) as [number, number, number];
      }
      const vec = holder[key] as [number, number, number];
      const min = (spec as any).min ?? 0.0;
      const max = (spec as any).max ?? 1.0;
      const step = (spec as any).step ?? 0.01;
      const labelPrefix = spec.label ?? label;

      const b0 = pane.addBinding(vec, 0, { label: `${labelPrefix} R`, min, max, step }).on('change', onChange);
      const b1 = pane.addBinding(vec, 1, { label: `${labelPrefix} G`, min, max, step }).on('change', onChange);
      const b2 = pane.addBinding(vec, 2, { label: `${labelPrefix} B`, min, max, step }).on('change', onChange);
      result = [b0, b1, b2];
      break;
    }
  }

  const visible = isSpecVisible(spec, holder);
  const blades = Array.isArray(result) ? result : [result];
  for (const b of blades) {
    if (b && typeof b === 'object') {
      b.hidden = !visible;
      attachSpecHelper(b, spec, onHelperUpdate);
    }
  }

  return result;
}

export function buildGlobalDirectorControls(
  folder: { addBinding: (target: any, prop: any, options?: any) => any },
  director = getGlobalDirector(),
) {
  const settings = { ...director.getSettings() };

  const experienceModeBinding = folder.addBinding(settings, 'experienceMode', {
    label: 'Experience mode',
    options: {
      'Cinematic': 'cinematic',
      'Calm': 'calm',
      'Minimal': 'minimal',
      'Color Walk': 'colorWalk',
      'Custom': 'custom',
    },
  }).on('change', (ev: { value: any }) => {
    director.setExperienceMode(ev.value as ExperienceMode);
  });

  const cameraModeBinding = folder.addBinding(settings, 'cameraMode', {
    label: 'Camera motion',
    options: {
      'Auto (Complementary)': 'auto',
      'Crane sway': 'craneSway',
      'Dutch roll': 'dutchRoll',
      'Breathing push': 'breathingPush',
      'Horizon 2.5D tilt': 'horizonTilt',
      'Still anchor': 'stillAnchor',
      'Off': 'off',
    },
  }).on('change', (ev: { value: any }) => {
    director.updateSettings({ cameraMode: ev.value as CameraMode });
  });

  const cameraIntensityBinding = folder.addBinding(settings, 'cameraIntensity', {
    label: 'Camera intensity',
    min: 0,
    max: 1,
    step: 0.05,
  }).on('change', (ev: { value: any }) => {
    director.updateSettings({ cameraIntensity: Number(ev.value) });
  });

  const colorMoodBinding = folder.addBinding(settings, 'colorMood', {
    label: 'Color mood',
    options: {
      'Auto-cycle palettes': 'auto',
      'Native (preset original)': 'native',
      'Cyberpunk (Cyan/Magenta)': 'cyberpunk',
      'Ember (Indigo/Gold)': 'ember',
      'Bioluminescent (Teal/Aqua)': 'biolum',
      'Vapor (Violet/Rose)': 'vapor',
      'Prismatic (Cobalt/Coral)': 'prismatic',
    },
  }).on('change', (ev: { value: any }) => {
    director.updateSettings({ colorMood: ev.value as ColorMood });
  });

  const colorIntensityBinding = folder.addBinding(settings, 'colorIntensity', {
    label: 'Color intensity',
    min: 0,
    max: 1,
    step: 0.05,
  }).on('change', (ev: { value: any }) => {
    director.updateSettings({ colorIntensity: Number(ev.value) });
  });

  const triggerCadenceBinding = folder.addBinding(settings, 'triggerCadence', {
    label: 'Transition trigger',
    options: {
      'Song section (35s+)': 'section',
      'Every 32 beats': 'beats32',
      'Every 64 beats': 'beats64',
      'Every 128 beats': 'beats128',
      'Timer (45s)': 'timer45',
    },
  }).on('change', (ev: { value: any }) => {
    director.updateSettings({ triggerCadence: ev.value as TriggerCadence });
  });

  return {
    experienceModeBinding,
    cameraModeBinding,
    cameraIntensityBinding,
    colorMoodBinding,
    colorIntensityBinding,
    triggerCadenceBinding,
  };
}
