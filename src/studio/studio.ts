// Preset Studio panel. Built with Tweakpane (MIT), which is loaded only here; the renderer does not use it.
// Sections: preset bar (switch, save, save as, duplicate, delete, export, import, undo, redo),
// vary (randomise, mutate, lock per layer), layer stack (select, enable, add, remove, reorder),
// settings for every enabled layer (built from the schema), and a frame-time readout.
// Value edits go straight to the live layers. Layer-list edits rebuild the scene.
import { Pane, type ButtonApi } from 'tweakpane';
import '../ui/style.css';
import { isLayerRendered } from '../presets/session';
import { LAYER_FACTORIES, applyPresetToScene, applyValues, valuesOf } from '../presets/loader';
import { LAYER_SPECS, tierOf } from '../presets/layerSchemas';
import { SCHEMAS, SYSTEM_SUBFOLDER_LABELS, getSystemSubfolder, type SystemSubfolder } from '../presets/builtin';
import { AUDIO_SOURCES, BLEND_MODES, BLEND_SPEC, LFO_RATE_DEFAULT, LFO_RATE_MAX, LFO_RATE_MIN, MORPH_RATE_DEFAULT, MORPH_RATE_MAX, MORPH_RATE_MIN, OPACITY_SPEC, TRAILS_SPEC, TRANSITION_STYLES, type LayerEntry, type Preset, type Settings, type Setting } from '../presets/format';
import type { Scene } from '../render/scene';
import { mutateSettings, randomiseSettings } from '../presets/variation';
import type { PresetSession, SessionEntry, UserPresetFolder } from '../presets/session';
import { attachSwipeDismiss } from '../ui/controls';
import { isSpecVisible, layoutFeedbackPost, type ParamSpec, type ParamValue } from '../presets/schema';
import { showToast } from '../ui/toast';
import {
  MAX_REACTIONS,
  REACTION_AMOUNT_MAX,
  REACTION_EASE_MAX,
  REACTION_EVERY_BEATS_MAX,
  REACTION_EVERY_SECONDS_MAX,
  REACTION_EVERY_SECONDS_MIN,
  RESPONSE_TYPES,
  TRIGGER_TYPES,
  type Reaction,
  type ReactionGroup,
  type ResponseType,
  type TriggerType,
} from '../presets/reactions';
import { REACTION_STYLES, REACTION_STYLE_LABELS, parseReactionStyle } from '../presets/reactionStyles';
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
import { type IAdminGateway, adminGateway as defaultAdminGateway } from '../presets/adminGateway';
import {
  ADMIN_BADGE_LABEL,
  renderAdminBadge,
  promptAdminLogin,
  adminLogout,
  promoteUserPresetAction,
} from './adminControls';

export { EXPERIENCE_MODES, CAMERA_MODES, COLOR_MOODS, TRIGGER_CADENCES, ADMIN_BADGE_LABEL };

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
  /** Optional Admin Gateway instance for verifying administrative capabilities. */
  adminGateway?: IAdminGateway;
}

/** Frame budget at 60 fps. The readout turns into a warning above this. */
const FRAME_BUDGET_MS = 16.7;

/** A first Delete tap stays armed for this long. A second tap inside the window deletes. */
export const DELETE_CONFIRM_MS = 3000;
const DELETE_LABEL = 'Delete';
const DELETE_ARMED_LABEL = 'Tap again to delete';

/** Studio view choice (Slice 15.4). Stored under one key; every read and write tolerates missing or failing storage. */
export type StudioView = 'basic' | 'advanced';
export const STUDIO_VIEW_KEY = 'mv.studio.view';
const viewSubscribers = new Set<(v: StudioView) => void>();
let sessionView: StudioView | null = null;

export function loadStudioView(): StudioView {
  try {
    const raw = globalThis.localStorage?.getItem(STUDIO_VIEW_KEY);
    if (raw === 'basic' || raw === 'advanced') return raw;
  } catch {
    // storage unavailable: fall through
  }
  return sessionView ?? 'basic';
}

export function saveStudioView(view: StudioView): void {
  sessionView = view;
  try {
    globalThis.localStorage?.setItem(STUDIO_VIEW_KEY, view);
  } catch {
    // storage unavailable: the choice lasts for this session only
  }
}

/** True when a control shows in `view`: showWhen still decides first, then the tier (untiered = advanced). */
export function isSpecShown(spec: ParamSpec, values: Record<string, ParamValue>, view: StudioView): boolean {
  return isSpecVisible(spec, values) && (view === 'advanced' || tierOf(spec) === 'basic');
}

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

/** True when `value` differs from the spec default (arrays compare per item, text case-insensitively). */
export function isChangedFromDefault(spec: ParamSpec, value: unknown): boolean {
  const def = (spec as any).default as unknown;
  if (Array.isArray(def)) {
    return !Array.isArray(value) || def.length !== value.length || def.some((d, i) => d !== (value as unknown[])[i]);
  }
  if (typeof def === 'string' && typeof value === 'string') return def.toLowerCase() !== value.toLowerCase();
  return value !== def;
}

/**
 * Add a per-control reset button and a "changed" marker to the blade rows of one control (Slice 15.5).
 * Reset writes the spec default (never the current value) into the holder and then calls `onChange`,
 * the same callback a normal edit uses, so the preview and saved state update the same way.
 */
export function attachResetControl(
  blades: any[],
  spec: ParamSpec,
  holder: Record<string, any>,
  key: string,
  onChange: () => void,
): { update: () => void; reset: () => void } {
  const rows = blades.filter((b) => b && typeof b === 'object');
  const first: HTMLElement | undefined = rows[0]?.element;
  const doc = first?.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const update = () => {
    const changed = isChangedFromDefault(spec, holder[key]);
    for (const b of rows) {
      const el: HTMLElement | undefined = b.element;
      if (!el?.classList) continue;
      if (changed) el.classList.add('studio-changed');
      else el.classList.remove('studio-changed');
    }
    const btn = (first as any)?.__resetBtn as HTMLElement | undefined;
    if (btn) btn.hidden = !changed;
  };
  const reset = () => {
    const def = (spec as any).default as unknown;
    if (!isChangedFromDefault(spec, holder[key])) return;
    if (Array.isArray(def) && Array.isArray(holder[key])) {
      // Edit the vec3 in place: the three bindings point at its items.
      def.forEach((d, i) => { (holder[key] as unknown[])[i] = d; });
    } else {
      holder[key] = Array.isArray(def) ? [...def] : def;
    }
    for (const b of rows) b.refresh?.();
    update();
    onChange();
  };
  if (first && doc) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'studio-reset';
    btn.title = 'Reset to default';
    btn.setAttribute('aria-label', `Reset ${spec.label} to default`);
    btn.textContent = '\u21BA';
    btn.addEventListener('click', (ev: Event) => { ev.stopPropagation?.(); reset(); });
    first.appendChild(btn);
    (first as any).__resetBtn = btn;
  }
  for (const b of rows) b.on?.('change', update);
  update();
  return { update, reset };
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
  /** Which reaction is open in the reaction editor (Slice 17.6). */
  private reactionIndex = 0;
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
  /** Admin Gateway instance for verifying administrative capabilities (Slice 11.4). */
  private adminGateway: IAdminGateway;
  private adminUnsubscribe?: () => void;
  private adminBadgeEl: HTMLElement | null = null;
  private footerEl: HTMLElement | null = null;
  /** All collapsible section and group folders in the active panel. */
  private sectionFolders: Array<{ expanded: boolean }> = [];

  /** Where the Tweakpane pane is built (the header with Close stays in the container). */
  private readonly body: HTMLElement;
  /** The element that had focus before the panel opened; focus returns to it on close. */
  private opener: HTMLElement | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: StudioOptions,
  ) {
    this.adminGateway =
      this.opts.adminGateway ??
      this.opts.session.getAdminGateway?.() ??
      defaultAdminGateway;

    if (typeof this.opts.session.setAdminGateway === 'function' && !this.opts.session.getAdminGateway?.()) {
      this.opts.session.setAdminGateway(this.adminGateway);
    }

    if (this.adminGateway && typeof this.adminGateway.subscribe === 'function') {
      this.adminUnsubscribe = this.adminGateway.subscribe(() => {
        this.refreshPresetDropdown();
        this.refresh();
      });
    }

    const doc = container.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    this.body = container.querySelector<HTMLElement>('.studio-body') ?? container;
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'false');
    container.setAttribute('aria-label', 'Studio');

    this.adminBadgeEl = renderAdminBadge(container, this.isAdmin());

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
      this.opener =
        typeof document !== 'undefined' &&
        typeof HTMLElement !== 'undefined' &&
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      this.container.hidden = false;
      if (
        this.adminGateway &&
        !this.adminGateway.isAdmin() &&
        typeof this.adminGateway.checkCloudflareAccess === 'function'
      ) {
        void this.adminGateway.checkCloudflareAccess();
      }
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => this.focusFirst());
      }
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

  isAdmin(): boolean {
    return Boolean(this.adminGateway?.isAdmin());
  }

  getAdminGateway(): IAdminGateway {
    return this.adminGateway;
  }

  get adminBadge(): HTMLElement | null {
    return this.adminBadgeEl;
  }

  get footer(): HTMLElement | null {
    return this.footerEl;
  }

  /** Re-render the preset hierarchy dropdown without a full pane rebuild (Slice 10.3). */
  refreshPresetDropdown(): void {
    const el = this.presetSelectEl ?? this.body.querySelector<HTMLSelectElement>('select');
    if (el) {
      renderPresetSelectHierarchy(el, this.opts.session, this.id);
    }
  }

  /** Synchronize active preset state and optgroup hierarchy in the Studio UI (Slice 11.4). */
  syncActivePresetInUI(id?: string): void {
    const targetId = id ?? this.id;
    this.refreshPresetDropdown();
    if (targetId) {
      this.bind(targetId);
    }
  }

  /** Refresh studio panel for the current preset (Slice 10.4). */
  refresh(): void {
    if (this.id) {
      this.syncActivePresetInUI(this.id);
    }
  }

  /** Prompt user for administrator input (passkey secret or email). */
  promptForAdminInput(message: string, defaultValue = ''): string | null {
    return this.promptForFolderName(message, defaultValue);
  }

  /** Initiate administrator login flow. */
  async handleAdminLogin(): Promise<{ success: boolean; error?: string }> {
    const promptFn = (msg: string, d?: string) => this.promptForAdminInput(msg, d);
    return await promptAdminLogin(this.adminGateway, promptFn);
  }

  /** Promote a user preset to a system preset. */
  handlePromoteUserPreset(id: string): void {
    const promptFn = (msg: string, d?: string) => this.promptForAdminInput(msg, d);
    try {
      const newId = promoteUserPresetAction(this.opts.session, id, promptFn);
      if (newId) {
        this.refreshPresetDropdown();
        this.opts.switchTo(newId);
      }
    } catch (err) {
      showToast((err as Error).message);
    }
  }

  dispose(): void {
    if (this.adminUnsubscribe) {
      this.adminUnsubscribe();
      this.adminUnsubscribe = undefined;
    }
    this.pane?.dispose();
    this.pane = null;
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
    this.sectionFolders = [];
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
    // Admin mode status (Slice 11.4)
    const isAdmin = this.isAdmin();
    this.adminBadgeEl = renderAdminBadge(this.container, isAdmin);

    // Category / Subfolder controls for built-ins (Slice 10.4 & Slice 11.4)
    if (entry.builtin) {
      if (!isAdmin) {
        const subfolder = (typeof session.getSystemPresetSubfolder === 'function'
          ? session.getSystemPresetSubfolder(id)
          : entry.subfolder) ?? getSystemSubfolder(id) ?? 'classics';
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
      } else {
        const currentSubfolder = (typeof session.getSystemPresetSubfolder === 'function'
          ? session.getSystemPresetSubfolder(id)
          : entry.subfolder) ?? getSystemSubfolder(id) ?? 'classics';
        const subfolderOptions: Record<string, string> = {
          [SYSTEM_SUBFOLDER_LABELS.showcase]: 'showcase',
          [SYSTEM_SUBFOLDER_LABELS.flagship]: 'flagship',
          [SYSTEM_SUBFOLDER_LABELS.classics]: 'classics',
        };
        const subfolderHolder = { subfolder: currentSubfolder };
        const subfolderBinding = pane.addBinding(subfolderHolder, 'subfolder', {
          label: 'Subfolder',
          options: subfolderOptions,
        });
        const onSelectSubfolder = (chosenSubfolder: string) => {
          const normalized: SystemSubfolder =
            chosenSubfolder === 'showcase' || chosenSubfolder === 'flagship' || chosenSubfolder === 'classics'
              ? chosenSubfolder
              : 'classics';
          if (typeof session.setSystemPresetSubfolder === 'function') {
            session.setSystemPresetSubfolder(id, normalized);
          } else {
            entry.subfolder = normalized;
          }
          showToast(`Moved to ${SYSTEM_SUBFOLDER_LABELS[normalized] ?? normalized}`);
          this.refreshPresetDropdown();
          this.bind(id);
        };
        subfolderBinding.on('change', (ev: { value: unknown }) => onSelectSubfolder(String(ev.value)));
        const subfolderSelectEl = subfolderBinding?.element?.querySelector?.('select') as HTMLSelectElement | null;
        if (subfolderSelectEl) {
          subfolderSelectEl.addEventListener?.('change', () => onSelectSubfolder(subfolderSelectEl.value));
        }
      }
    }

    const nameBinding = pane.addBinding(preset as unknown as Record<string, unknown>, 'name', {
      label: 'Name',
      readonly: entry.builtin && !isAdmin,
    });
    if (entry.builtin && !isAdmin) {
      if (nameBinding?.element) {
        const input = nameBinding.element.querySelector?.('input') as HTMLInputElement | null;
        if (input) {
          input.disabled = true;
          input.readOnly = true;
        }
      }
    } else {
      nameBinding.on('change', () => {
        session.commit(id);
        if (entry.builtin && isAdmin) {
          this.refreshPresetDropdown();
        }
      });
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
      if (!isAdmin) {
        tile(pane.addButton({ title: 'Save (Read-only)' })).on('click', () => {
          showToast('Built-in presets are read-only. Use "Save as…" to keep a copy.');
        });
      } else {
        tile(pane.addButton({ title: `Save System Preset 👑${dirty}` })).on('click', () => {
          if (typeof session.saveSystemPreset === 'function') {
            this.run(() => session.saveSystemPreset(id), 'System preset saved');
          } else {
            this.run(() => session.save(id), 'System preset saved');
          }
        });
      }
    } else {
      tile(pane.addButton({ title: `Save${dirty}` })).on('click', () => this.run(() => session.save(id), 'Saved'));
    }
    tile(pane.addButton({ title: 'Save as…' })).on('click', () => this.openSaveAsField(id, `${preset.name} copy`));
    tile(pane.addButton({ title: 'Duplicate' })).on('click', () =>
      this.run(() => this.opts.switchTo(session.saveAs(id, `${preset.name} copy`)), 'Duplicated'),
    );
    if (!entry.builtin || isAdmin) {
      const del = tile(pane.addButton({ title: DELETE_LABEL }));
      this.deleteBtn = del;
      del.on('click', () => this.onDeleteTap(del, id));
    }
    if (!entry.builtin && isAdmin) {
      tile(pane.addButton({ title: 'Promote to System Preset 👑' })).on('click', () =>
        this.handlePromoteUserPreset(id),
      );
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
    this.sectionFolders.push(dirFolder);
    buildGlobalDirectorControls(dirFolder);
    // Per-preset: false applies this preset's own camera or colour profile on load (Slice 15.7).
    const profileFlags = {
      useGlobalCamera: preset.directorProfile?.useGlobalCamera !== false,
      useGlobalColour: preset.directorProfile?.useGlobalColour !== false,
    };
    const setProfileFlag = (key: 'useGlobalCamera' | 'useGlobalColour', value: boolean) => {
      if (!preset.directorProfile) {
        const g = getGlobalDirector().getSettings();
        preset.directorProfile = { cameraMode: g.cameraMode, colorMood: g.colorMood, colorIntensity: g.colorIntensity };
      }
      preset.directorProfile[key] = value;
      session.commit(id);
    };
    dirFolder.addBinding(profileFlags, 'useGlobalCamera', { label: 'Use global camera' })
      .on('change', (ev: { value: unknown }) => setProfileFlag('useGlobalCamera', Boolean(ev.value)));
    dirFolder.addBinding(profileFlags, 'useGlobalColour', { label: 'Use global colour' })
      .on('change', (ev: { value: unknown }) => setProfileFlag('useGlobalColour', Boolean(ev.value)));

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
      const mon = { solo: session.isSolo(id, this.selected), mute: session.isMuted(id, this.selected) };
      pane.addBinding(mon, 'solo', { label: 'Solo (preview only)' }).on('change', (ev) => {
        session.setSolo(id, this.selected, Boolean(ev.value));
        this.bind(id);
      });
      pane.addBinding(mon, 'mute', { label: 'Mute (preview only)' }).on('change', (ev) => {
        session.setMute(id, this.selected, Boolean(ev.value));
        this.bind(id);
      });
      pane.addButton({ title: 'Duplicate layer' }).on('click', () => {
        this.selected = session.duplicateLayer(id, this.selected);
        this.locked.clear();
        this.bind(id);
      });
      pane.addButton({ title: 'Move layer up' }).on('click', () => this.move(-1));
      pane.addButton({ title: 'Move layer down' }).on('click', () => this.move(1));
      pane.addButton({ title: 'Remove layer' }).on('click', () => {
        preset.layers.splice(this.selected, 1);
        session.shiftMonitorAfterRemove(id, this.selected);
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
    pane.addBlade({ view: 'separator' });
    const expandBtn = pane.addButton({ title: 'Expand All' });
    const collapseBtn = pane.addButton({ title: 'Collapse All' });
    expandBtn.on('click', () => this.expandAll());
    collapseBtn.on('click', () => this.collapseAll());

    const docForExpand = this.body.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    if (docForExpand) {
      const expandRow = docForExpand.createElement('div');
      expandRow.className = 'studio-folder-actions';
      if (expandBtn.element && typeof (expandBtn.element as any).before === 'function') {
        (expandBtn.element as any).before(expandRow);
      }
      if (typeof expandRow.append === 'function') {
        expandRow.append(expandBtn.element, collapseBtn.element);
      }
    }

    // Settings for every enabled layer. Live layers are matched by their order among the enabled ones.
    let live = 0;
    for (let i = 0; i < preset.layers.length; i++) {
      const layerEntry = preset.layers[i]!;
      if (!isLayerRendered(layerEntry, i, session.monitorOf(id))) continue;
      const k = live++;
      const title = layerEntry.type === 'shape'
        ? formatLayerTitle(layerEntry, i)
        : layerEntry.type;
      this.bindSection(pane, title, LAYER_SPECS[layerEntry.type] ?? [], layerEntry.params, () => {
        const current = session.sceneOf(id).layers[k];
        if (current) applyValues(current, valuesOf(layerEntry.params));
      });
    }
    // Slice 15.2: Feedback and Post share one section with four groups (Motion, Warp, Trails, Colour).
    const postNames = new Set(SCHEMAS.post.map((s) => s.name));
    this.bindSection(
      pane,
      'Feedback and post',
      layoutFeedbackPost(SCHEMAS.feedback, SCHEMAS.post),
      mergeSettings(preset.feedback, preset.post, postNames),
      () => {
        session.sceneOf(id).setFeedback(valuesOf(preset.feedback));
        session.refreshPost(id);
      },
    );

    // --- Audio link (slice E2) --------------------------------------------------------
    this.bindLinkEditor(pane, id, preset);
    this.bindMorphEditor(pane, id, preset);
    // --- Reactions (Slice 17.6) --------------------------------------------------------
    this.bindReactionEditor(pane, id, preset);

    // --- Frame time -----------------------------------------------------------------
    pane.addBlade({ view: 'separator' });
    this.monitor.ms = this.opts.frameMs?.() ?? 0;
    pane.addBinding(this.monitor, 'ms', {
      label: `Frame time ms (60 fps ≤ ${FRAME_BUDGET_MS})`,
      readonly: true,
      format: (v: number) => v.toFixed(1),
    });

    // --- Administrator Mode Access (Slice 11.4) -------------------------------------
    pane.addBlade({ view: 'separator' });
    const adminActionTitle = isAdmin ? 'Exit Admin Mode 👑' : 'Admin Access';
    pane.addButton({ title: adminActionTitle }).on('click', () => {
      if (this.isAdmin()) {
        adminLogout(this.adminGateway);
      } else {
        this.handleAdminLogin();
      }
    });

    this.renderFooter(isAdmin);
  }

  private renderFooter(isAdmin: boolean): void {
    const doc = this.container.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    let footer = this.container.querySelector<HTMLElement>('.studio-footer');
    if (!footer) {
      footer = doc.createElement('div');
      footer.className = 'studio-footer';
      this.container.append(footer);
    }
    this.footerEl = footer;

    if (typeof footer.replaceChildren === 'function') {
      footer.replaceChildren();
    } else {
      footer.textContent = '';
    }

    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'studio-admin-action-btn' + (isAdmin ? ' admin-active' : '');
    btn.textContent = isAdmin ? 'Exit Admin Mode 👑' : 'Admin Access';
    btn.addEventListener('click', () => {
      if (this.isAdmin()) {
        adminLogout(this.adminGateway);
      } else {
        this.handleAdminLogin();
      }
    });
    footer.append(btn);
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

  /**
   * Reactions (Slice 17.6): this preset's reaction style, and a list of its own reactions (when it happens, what
   * happens, which Feedback or Post control, how much, how long to ease). Edits are live: the render loop notices
   * the change on the next frame.
   */
  private bindReactionEditor(pane: Pane, id: string, preset: Preset): void {
    const session = this.opts.session;
    pane.addBlade({ view: 'separator' });
    const styleBox = { style: preset.reactionStyle ?? REACTION_STYLE_GLOBAL };
    pane.addBinding(styleBox, 'style', {
      label: 'Reaction style',
      options: reactionStyleOptions(),
    }).on('change', (ev) => {
      const style = parseReactionStyle(ev.value);
      if (style) preset.reactionStyle = style;
      else delete preset.reactionStyle;
      session.commit(id);
    });

    const list = preset.reactions ?? [];
    if (this.reactionIndex >= list.length) this.reactionIndex = Math.max(0, list.length - 1);
    const targets = reactionTargets(preset);
    if (list.length > 0) {
      const pick = { index: String(this.reactionIndex) };
      pane.addBinding(pick, 'index', {
        label: 'Reaction',
        options: Object.fromEntries(list.map((r, i) => [`${i + 1}. ${describeReaction(r)}`, String(i)])),
      }).on('change', (ev) => {
        this.reactionIndex = Number(ev.value);
        this.bind(id);
      });
    }
    if (list.length < MAX_REACTIONS) {
      pane.addButton({ title: 'Add reaction' }).on('click', () => {
        session.commit(id);
        const reactions = (preset.reactions ??= []);
        reactions.push(newReaction(targets[0]));
        this.reactionIndex = reactions.length - 1;
        this.bind(id);
      });
    }
    const reaction = list[this.reactionIndex];
    if (!reaction) return;

    const onEdit = () => session.commit(id);
    const trigger = { type: reaction.trigger.type as string };
    pane.addBinding(trigger, 'type', {
      label: 'When',
      options: Object.fromEntries(TRIGGER_TYPES.map((t) => [TRIGGER_LABELS[t], t])),
    }).on('change', (ev) => {
      reaction.trigger = triggerOf(String(ev.value) as TriggerType, reaction.trigger.n);
      onEdit();
      this.bind(id);
    });
    if (reaction.trigger.type === 'everyNBeats') {
      pane.addBinding(reaction.trigger as unknown as Record<string, unknown>, 'n', { label: 'Every how many beats', min: 1, max: REACTION_EVERY_BEATS_MAX, step: 1 }).on('change', onEdit);
    } else if (reaction.trigger.type === 'everyNSeconds') {
      pane.addBinding(reaction.trigger as unknown as Record<string, unknown>, 'n', { label: 'Every how many seconds', min: REACTION_EVERY_SECONDS_MIN, max: REACTION_EVERY_SECONDS_MAX, step: 0.25 }).on('change', onEdit);
    }
    pane.addBinding(reaction as unknown as Record<string, unknown>, 'response', {
      label: 'What happens',
      options: Object.fromEntries(RESPONSE_TYPES.map((r) => [RESPONSE_LABELS[r], r])),
    }).on('change', onEdit);
    const where = { key: reactionTargetKey(reaction.target) };
    // A control that is hidden right now (for example Warp in a mode that does not use it) stays pickable if it is already chosen.
    const options = Object.fromEntries(targets.map((t) => [t.label, t.key]));
    if (!targets.some((t) => t.key === where.key)) options[`${reaction.target.group === 'post' ? 'Post' : 'Feedback'} · ${reaction.target.name}`] = where.key;
    pane.addBinding(where, 'key', { label: 'Which control', options }).on('change', (ev) => {
      const next = parseReactionTargetKey(String(ev.value));
      if (next) reaction.target = next;
      onEdit();
    });
    pane.addBinding(reaction as unknown as Record<string, unknown>, 'amount', { label: 'Amount (share of range)', min: -REACTION_AMOUNT_MAX, max: REACTION_AMOUNT_MAX, step: 0.01 }).on('change', onEdit);
    pane.addBinding(reaction as unknown as Record<string, unknown>, 'ease', { label: 'Ease time (s)', min: 0, max: REACTION_EASE_MAX, step: 0.05 }).on('change', onEdit);
    pane.addButton({ title: 'Remove reaction' }).on('click', () => {
      session.commit(id);
      list.splice(this.reactionIndex, 1);
      if (list.length === 0) delete preset.reactions;
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
    const res = bindSection(
      pane,
      title,
      specs,
      settings,
      apply,
      () => this.opts.session.commit(this.id),
      (spec) => renderHelperContent(this.helperBar, spec),
    );
    if (res.folders) {
      this.sectionFolders.push(...res.folders);
    }
  }

  /** Expand all collapsible section and category headers in Studio. */
  expandAll(): void {
    for (const folder of this.sectionFolders) {
      folder.expanded = true;
    }
  }

  /** Collapse all collapsible section and category headers in Studio. */
  collapseAll(): void {
    for (const folder of this.sectionFolders) {
      folder.expanded = false;
    }
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
    this.opts.session.swapMonitor(this.id, this.selected, target);
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
      const isBuiltin = Boolean(this.opts.session.get(id)?.builtin);
      this.run(() => {
        if (isBuiltin) {
          if (typeof this.opts.session.removeSystemPreset === 'function') {
            this.opts.session.removeSystemPreset(id);
          } else {
            this.opts.session.remove(id);
          }
          const remaining = this.opts.session.list();
          const nextId = this.opts.session.shownId ?? remaining.find((e) => e.id !== id)?.id ?? 'crown';
          this.opts.switchTo(nextId);
        } else {
          this.opts.session.remove(id);
          this.opts.switchTo('crown');
        }
      }, isBuiltin ? 'System preset deleted' : 'Deleted');
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

// --- Reactions (Slice 17.6) --------------------------------------------------------------

/** The style box value that means "no style of its own; follow the global setting". */
export const REACTION_STYLE_GLOBAL = 'global';

export const TRIGGER_LABELS: Readonly<Record<TriggerType, string>> = {
  beat: 'Every beat',
  strongBeat: 'Every strong beat',
  everyNBeats: 'Every N beats',
  everyNSeconds: 'Every N seconds',
  section: 'Section change',
  loudJump: 'Quiet-to-loud jump',
};

export const RESPONSE_LABELS: Readonly<Record<ResponseType, string>> = {
  kick: 'Kick (jump, then ease back)',
  step: 'Step (move and hold)',
  flip: 'Flip (reverse direction)',
  drift: 'Drift (slow wander)',
  pick: 'Pick (random value)',
};

/** Style choices for one preset: follow the global setting, or one of the four styles. */
export function reactionStyleOptions(): Record<string, string> {
  const out: Record<string, string> = { 'Use the global setting': REACTION_STYLE_GLOBAL };
  for (const style of REACTION_STYLES) out[REACTION_STYLE_LABELS[style]] = style;
  return out;
}

export interface ReactionTargetChoice {
  key: string;
  label: string;
  group: ReactionGroup;
  name: string;
}

/** `feedback.zoom` style key for a target. */
export function reactionTargetKey(target: { group: ReactionGroup; name: string }): string {
  return `${target.group}.${target.name}`;
}

export function parseReactionTargetKey(key: string): { group: ReactionGroup; name: string } | null {
  const dot = key.indexOf('.');
  if (dot < 0) return null;
  const group = key.slice(0, dot);
  const name = key.slice(dot + 1);
  return (group === 'feedback' || group === 'post') && name ? { group, name } : null;
}

/** Feedback and Post number controls a reaction can move, skipping ones hidden by the current mode. */
export function reactionTargets(preset: Preset): ReactionTargetChoice[] {
  const out: ReactionTargetChoice[] = [];
  for (const spec of FEEDBACK_NUMBERS) {
    if (isSpecVisible(spec, preset.feedback)) out.push({ key: `feedback.${spec.name}`, label: `Feedback · ${spec.label}`, group: 'feedback', name: spec.name });
  }
  for (const spec of POST_NUMBERS) {
    if (isSpecVisible(spec, preset.post)) out.push({ key: `post.${spec.name}`, label: `Post · ${spec.label}`, group: 'post', name: spec.name });
  }
  return out;
}

/** A starting reaction: a kick on every beat. Defaults to the Feedback zoom. */
export function newReaction(target?: { group: ReactionGroup; name: string }): Reaction {
  return {
    trigger: { type: 'beat' },
    response: 'kick',
    target: target ? { group: target.group, name: target.name } : { group: 'feedback', name: 'zoom' },
    amount: 0.1,
    ease: 0.35,
  };
}

/** A trigger of the given type, with a sensible N when the type needs one. */
export function triggerOf(type: TriggerType, previousN?: number): Reaction['trigger'] {
  if (type === 'everyNBeats') return { type, n: Math.min(REACTION_EVERY_BEATS_MAX, Math.max(1, Math.round(previousN ?? 4))) };
  if (type === 'everyNSeconds') return { type, n: Math.min(REACTION_EVERY_SECONDS_MAX, Math.max(REACTION_EVERY_SECONDS_MIN, previousN ?? 4)) };
  return { type };
}

/** One line for the reaction list, for example "Every 8 beats: Flip, Feedback · Spin per frame (rad)". */
export function describeReaction(r: Reaction): string {
  const n = r.trigger.n;
  const when = r.trigger.type === 'everyNBeats' ? `Every ${n ?? 4} beats` : r.trigger.type === 'everyNSeconds' ? `Every ${n ?? 4} s` : TRIGGER_LABELS[r.trigger.type];
  const specs = r.target.group === 'post' ? POST_NUMBERS : FEEDBACK_NUMBERS;
  const label = specs.find((sp) => sp.name === r.target.name)?.label ?? r.target.name;
  const what = RESPONSE_LABELS[r.response].split(' (')[0];
  return `${when}: ${what}, ${r.target.group === 'post' ? 'Post' : 'Feedback'} · ${label}`;
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
  attachResetControl([opacityBinding], OPACITY_SPEC, entry as any, opacityKey, onLayerConfigChange);

  const blendKey = (BLEND_SPEC as any).key ?? BLEND_SPEC.name;
  const blendBinding = pane.addBinding(entry as unknown as Record<string, unknown>, blendKey, {
    label: BLEND_SPEC.label,
    options: Object.fromEntries(BLEND_MODES.map((b) => [b, b])),
  }).on('change', onLayerConfigChange);
  attachSpecHelper(blendBinding, BLEND_SPEC, onHelperUpdate);
  attachResetControl([blendBinding], BLEND_SPEC, entry as any, blendKey, onLayerConfigChange);

  if (entry.trails === undefined) {
    entry.trails = TRAILS_SPEC.default;
  }
  const trailsKey = (TRAILS_SPEC as any).key ?? TRAILS_SPEC.name;
  const trailsBinding = pane.addBinding(entry as unknown as Record<string, unknown>, trailsKey, {
    label: TRAILS_SPEC.label,
  }).on('change', onLayerConfigChange);
  attachSpecHelper(trailsBinding, TRAILS_SPEC, onHelperUpdate);
  attachResetControl([trailsBinding], TRAILS_SPEC, entry as any, trailsKey, onLayerConfigChange);

  return { opacityBinding, blendBinding, trailsBinding };
}

/**
 * Bind a list of parameter specs in a section, dynamically updating blade visibility
 * whenever any parameter changes via `isSpecVisible`.
 */
/**
 * One settings view over a feedback and a post settings bag. Reads and writes go to the post bag for
 * names in `postNames` and to the feedback bag for everything else, so keys and saved data are unchanged.
 */
export function mergeSettings(feedback: Settings, post: Settings, postNames: ReadonlySet<string>): Settings {
  const bagOf = (name: string | symbol): Settings => (typeof name === 'string' && postNames.has(name) ? post : feedback);
  return new Proxy({} as Settings, {
    get: (_t, name) => (bagOf(name) as any)[name],
    set: (_t, name, value) => { (bagOf(name) as any)[name] = value; return true; },
    has: (_t, name) => name in bagOf(name),
  });
}

export function bindSection(
  pane: any,
  title: string,
  specs: readonly ParamSpec[],
  settings: Settings | Record<string, any>,
  apply?: () => void,
  onCommit?: () => void,
  onHelperUpdate?: (spec: ParamSpec | null) => void,
): { specBindings: Array<{ spec: ParamSpec; blades: any[] }>; updateVisibility: () => void; folders: any[] } {
  if (specs.length === 0) return { specBindings: [], updateVisibility: () => {}, folders: [] };
  const folders: any[] = [];
  const sectionTitle = title.charAt(0).toUpperCase() + title.slice(1);
  const sectionFolder = typeof pane.addFolder === 'function'
    ? pane.addFolder({ title: sectionTitle, expanded: false })
    : pane;
  if (sectionFolder && sectionFolder !== pane) {
    folders.push(sectionFolder);
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
  const groupFolders: Array<{ folder: any; members: Array<{ spec: ParamSpec; blades: any[] }> }> = [];
  const viewHolder: { view: StudioView } = { view: loadStudioView() };
  // A section with no tiered controls (layers registered elsewhere) has no Basic view: show everything, no toggle.
  const tiered = specs.some((s) => tierOf(s) === 'basic');
  const hasAdvanced = tiered && specs.some((s) => tierOf(s) === 'advanced');
  const viewNow = (): StudioView => (tiered ? viewHolder.view : 'advanced');

  const updateVisibility = () => {
    for (const { spec, blades } of specBindings) {
      const visible = isSpecShown(spec, holder, viewNow());
      for (const b of blades) {
        if (b && typeof b === 'object') {
          b.hidden = !visible;
        }
      }
    }
    // A group folder with nothing to show hides too.
    for (const { folder, members } of groupFolders) {
      const any = members.some((m) => isSpecShown(m.spec, holder, viewNow()));
      if (folder && typeof folder === 'object') folder.hidden = !any;
    }
  };

  let viewBinding: any;
  if (hasAdvanced && typeof sectionFolder.addBinding === 'function') {
    viewBinding = sectionFolder.addBinding(viewHolder, 'view', {
      label: 'View',
      options: { Basic: 'basic', Advanced: 'advanced' },
    });
    viewBinding?.on?.('change', () => {
      saveStudioView(viewHolder.view);
      for (const notify of [...viewSubscribers]) notify(viewHolder.view);
    });
    const onView = (v: StudioView) => {
      try {
        if (viewHolder.view !== v) {
          viewHolder.view = v;
          viewBinding?.refresh?.();
        }
        updateVisibility();
      } catch {
        // section was disposed
      }
    };
    viewSubscribers.add(onView);
  }

  const groups = new Map<string, ParamSpec[]>();
  for (const spec of specs) {
    const gname = spec.uiGroup ?? spec.group;
    const list = groups.get(gname);
    if (list) {
      list.push(spec);
    } else {
      groups.set(gname, [spec]);
    }
  }

  for (const [groupName, groupSpecs] of groups) {
    const target = groupName && typeof sectionFolder.addFolder === 'function'
      ? sectionFolder.addFolder({ title: groupName, expanded: false })
      : sectionFolder;
    const members: Array<{ spec: ParamSpec; blades: any[] }> = [];
    if (target && target !== sectionFolder && target !== pane) {
      folders.push(target);
      groupFolders.push({ folder: target, members });
    }
    for (const spec of groupSpecs) {
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
      const binding = bindSpec(target, spec.label, spec, holder, push, onHelperUpdate);
      const blades = Array.isArray(binding) ? binding : [binding];
      const entry = { spec, blades };
      specBindings.push(entry);
      members.push(entry);
    }
  }

  updateVisibility();

  return { specBindings, updateVisibility, folders };
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
  attachResetControl(blades, spec, holder, key, onChange);

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
