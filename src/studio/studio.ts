// Preset Studio panel. Built with Tweakpane (MIT), which is loaded only here; the renderer does not use it.
// Sections: preset bar (switch, folders, favourite and skip tags, save, save as, duplicate, delete,
// export, import, library, undo, redo, admin promote), vary (randomise, mutate, mashup, lock per layer),
// Global Director, layer stack (select, enable, solo, mute, duplicate, add, remove, reorder), settings for
// every enabled layer plus Feedback, Warp field and Post (built from the schema, each with its ⚡ music
// link drawer from reactiveSlider.ts), links, reactions, morphs, ⚡ Active Links and a frame-time readout.
// Value edits go straight to the live layers. Layer-list edits rebuild the scene.
import { Pane, type ButtonApi } from 'tweakpane';
import '../ui/style.css';
import { assetImportMessage, isLayerRendered } from '../presets/session';
import { LAYER_FACTORIES, applyPresetToScene, applyValues, hasLinks, readWarpOps, valuesOf } from '../presets/loader';
import { WARP_OP_LABELS, WARP_OP_MAX, WARP_OP_TYPES, isWarpOpType, warpOpSpecs, type WarpOpType } from '../presets/warpOps';
import { LAYER_SPECS, tierOf } from '../presets/layerSchemas';
import { SCHEMAS, SYSTEM_SUBFOLDER_LABELS, formatLayerType, getSystemSubfolder, type SystemSubfolder } from '../presets/builtin';
import { AUDIO_SOURCES, BLEND_MODES, BLEND_SECONDS_SPEC, BLEND_SPEC, LFO_RATE_DEFAULT, LFO_RATE_MAX, LFO_RATE_MIN, LINK_COOLDOWN_DEFAULT, MORPH_RATE_DEFAULT, MORPH_RATE_MAX, MORPH_RATE_MIN, OPACITY_SPEC, PRESET_BLEND_MAX_SEC, PRESET_BLEND_MIN_SEC, PRESET_DISPLAY_MAX_SEC, PRESET_DISPLAY_MIN_SEC, SECONDS_SPEC, STYLE_SPEC, TRAILS_SPEC, TRANSITION_STYLES, clampBlendSec, clampDisplaySec, type AudioLink, type AudioSource, type LayerEntry, type Preset, type Settings, type Setting, type Transition, type WarpOperator } from '../presets/format';
import { summarizeAudioLink } from '../presets/linkRecipes';
import { attachReactiveSlider, type ReactiveSliderHandle } from './reactiveSlider';
import type { Scene } from '../render/scene';
import { MAX_LAYER_SEED, applyMashup, mutateSettings, newLayerSeed, randomiseLayerSettings, randomiseSettings } from '../presets/variation';
import type { PresetSession, SessionEntry, UserPresetFolder } from '../presets/session';
import { attachSwipeDismiss, exportLibraryFile, importLibraryFromPicker } from '../ui/controls';
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
  DEFAULT_CUSTOM_SHADOW_TINT,
  DEFAULT_CUSTOM_HIGHLIGHT_TINT,
  getGlobalDirector,
  type ExperienceMode,
  type CameraMode,
  type ColorMood,
  type TriggerCadence,
} from '../render/globalDirector';
import { type IAdminGateway, adminGateway as defaultAdminGateway } from '../presets/adminGateway';
import {
  ADMIN_BADGE_LABEL,
  DELETE_LABEL,
  DELETE_ARMED_LABEL,
  SYSTEM_SUBFOLDER_OPTIONS,
  getAdminActionLabel,
  renderAdminBadge,
  promptAdminLogin,
  adminLogout,
  saveSystemPresetAction,
  deleteSystemPresetAction,
  setSystemPresetSubfolderAction,
  promoteUserPresetAction,
  createStudioIconSvg,
  attachButtonIcon,
} from './adminControls';

export { EXPERIENCE_MODES, CAMERA_MODES, COLOR_MOODS, TRIGGER_CADENCES, ADMIN_BADGE_LABEL };

/** Human-readable display labels for Audio Link modulation sources. */
export const AUDIO_SOURCE_LABELS: Readonly<Record<AudioSource, string>> = {
  sub: 'Sub Bass',
  bass: 'Bass',
  mid: 'Mid',
  high: 'High / Treble',
  energy: 'Overall Energy',
  loudness: 'Loudness',
  beat: 'Beat Pulse',
  onset: 'Onset / Transient',
  section: 'Section Energy',
  beatStrength: 'Beat Strength',
  brightness: 'Brightness',
  subFlux: 'Sub Flux',
  midFlux: 'Mid Flux',
  highFlux: 'High Flux',
  lfoSine: 'LFO · Sine',
  lfoSaw: 'LFO · Saw',
  lfoRandom: 'LFO · Random',
  time: 'Time',
  kickEnv: 'Kick Envelope',
  centroid: 'Spectral Centroid',
  drop: 'Drop Surge',
  breakdown: 'Breakdown',
  phrase16: 'Phrase (16 Beats)',
  phrase32: 'Phrase (32 Beats)',
  energySlow: 'Energy Arc (Slow)',
};

/** Human-readable display labels for preset transition styles. */
export const TRANSITION_STYLE_LABELS: Readonly<Record<Transition, string>> = {
  crossfade: 'Crossfade',
  wipe: 'Wipe',
  dissolve: 'Dissolve',
  zoom: 'Zoom',
  morph: 'Morph',
};

/** Explicit human-readable display labels for schema enum options (with camelCase fallback). */
export const ENUM_OPTION_LABELS: Readonly<Record<string, string>> = {
  isometricPlate: 'Isometric Plate',
  radialMandala: 'Radial Mandala',
  starMandala: 'Star Mandala',
  polarFold: 'Polar Fold (Mandala)',
  rgbSplit: 'RGB Split',
  alpha: 'Alpha',
  add: 'Additive',
  max: 'Maximum',
  screen: 'Screen',
  classic: 'Classic',
  curl: 'Curl',
  mobius: 'Mobius',
  fullscreen: 'Fullscreen',
  hexagon: 'Hexagon',
  triangle: 'Triangle',
  morph: 'Morph',
  crossfade: 'Crossfade',
  wipe: 'Wipe',
  dissolve: 'Dissolve',
  zoom: 'Zoom',
  cw: 'Clockwise',
  ccw: 'Counter-clockwise',
  knot3d: '3D Knot',
  figure8: 'Figure 8',
  golden137_5: 'Golden (137.5°)',
  'golden137.5': 'Golden (137.5°)',
  'lucas99.5': 'Lucas (99.5°)',
  'fibonacci137.6': 'Fibonacci (137.6°)',
  'rosette137.3': 'Rosette (137.3°)',
  starburst144: 'Starburst (144°)',
  sub: 'Sub Bass',
  bass: 'Bass',
  mid: 'Mid',
  high: 'High / Treble',
  energy: 'Overall Energy',
  kick: 'Kick',
};

/** Convert an enum option key into a human-readable Studio dropdown label. */
export function formatEnumOptionLabel(value: string): string {
  if (!value) return '';
  if (ENUM_OPTION_LABELS[value]) return ENUM_OPTION_LABELS[value];
  if (/^\d+(:\d+)?$/.test(value)) return value;
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** One control change, reported through StudioOptions.onEdit. layerIndex is the index in preset.layers, or null outside layers. */
export interface StudioEdit {
  presetId: string;
  section: string;
  layerIndex: number | null;
  name: string;
  value: number | boolean | string;
}

export interface StudioOptions {
  session: PresetSession;
  /** Make a preset the one on screen (main.ts keeps the key handling and the toast). */
  switchTo: (id: string) => void;
  /** Called after a control changes. Used by the pop-out (slice 22.6). Unset in the main window, so nothing changes there. */
  onEdit?: (edit: StudioEdit) => void;
  /** Latest frame time in ms, for the readout. */
  frameMs?: () => number;
  /** Live link value (0..1) for a key `${presetId}L${layerIndexAmongEnabled}.${name}` or `${presetId}F.${name}`. */
  linkMeter?: (key: string) => number | undefined;
  /** Live resolved parameter value for a key `${presetId}L${k}.${name}`, `${presetId}F.${name}`, `${presetId}P.${name}`, or `${presetId}W${w}.${name}`. */
  linkResolved?: (key: string) => number | undefined;
  /** Current calm-mode flag for scaling modulation preview bands. */
  isCalm?: () => boolean;
  /** Optional custom Pane factory for testing in node / mock environments. */
  paneFactory?: (options: { container: HTMLElement; title: string }) => any;
  /** Optional Admin Gateway instance for verifying administrative capabilities. */
  adminGateway?: IAdminGateway;
}

export interface ReactiveSectionContext {
  scopePrefix: string;
  scopeForSpec?: (specName: string) => string;
  onDrawerToggle?: (handle: ReactiveSliderHandle | null) => void;
  registerHandle?: (handle: ReactiveSliderHandle) => void;
  onReactiveMutate?: (discrete: boolean, apply?: () => void) => void;
  onRegisterTarget?: (
    meterKey: string,
    handle: ReactiveSliderHandle,
    folders: Array<{ expanded: boolean }>,
    element?: HTMLElement,
    apply?: () => void,
  ) => void;
}

export interface OpacityReactiveOptions {
  meterKey: string;
  onMutate: (discrete: boolean) => void;
  onDrawerToggle?: (handle: ReactiveSliderHandle | null) => void;
  registerHandle?: (handle: ReactiveSliderHandle) => void;
  onRegisterTarget?: (handle: ReactiveSliderHandle, element?: HTMLElement) => void;
}

function isLinkableSpecType(t: ParamSpec['type']): boolean {
  return t === 'float' || t === 'int' || t === 'enum' || t === 'colour';
}

/** Frame budget at 60 fps. The readout turns into a warning above this. */
const FRAME_BUDGET_MS = 16.7;

/** A first Delete tap stays armed for this long. A second tap inside the window deletes. */
export const DELETE_CONFIRM_MS = 3000;

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

/** Descriptor for non-ParamSpec Studio controls wired to the bottom helper bar (Slice 25.6). */
export interface ControlHelperDescriptor {
  label: string;
  description: string;
  warning?: string;
  intense?: boolean;
}

/** Render parameter or control description and warning in the fixed helper bar element. */
export function renderHelperContent(helperBar: HTMLElement, spec: ParamSpec | ControlHelperDescriptor | null): void {
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
    const warnIcon = createStudioIconSvg(doc, 'alert-triangle');
    if (warnIcon) {
      warnRow.append(warnIcon);
    }
    const warnSpan = doc.createElement('span');
    warnSpan.textContent = warnText;
    warnRow.append(warnSpan);
    helperBar.append(warnRow);
  }
}

/** Generalized control helper: attaches optional badge and hover/focus listeners to any Studio blade or DOM element (Slice 25.6). */
export function attachControlHelper<T extends ParamSpec | ControlHelperDescriptor>(
  elementOrBlade: any,
  info: T,
  onHelperUpdate?: (info: T | null) => void,
): void {
  if (!elementOrBlade || typeof elementOrBlade !== 'object') return;
  const el: HTMLElement | undefined =
    elementOrBlade.element ?? (typeof elementOrBlade.addEventListener === 'function' ? elementOrBlade : undefined);
  if (!el || typeof el !== 'object') return;

  const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);

  // 1. Intense / warning badge: (!) appended to label element or blade root
  if (info.intense || info.warning) {
    try {
      const hasBadge = typeof el.querySelector === 'function' && el.querySelector('.intense-badge');
      if (!hasBadge && doc && typeof doc.createElement === 'function') {
        const badge = doc.createElement('span');
        badge.className = 'intense-badge';
        badge.title = info.warning || 'High-intensity effect';
        badge.textContent = '(!)';
        const labelEl = typeof el.querySelector === 'function' ? el.querySelector('.tp-lblv_l, label') : null;
        if (labelEl && typeof labelEl.append === 'function') {
          labelEl.append(badge);
        } else if (typeof el.append === 'function') {
          el.append(badge);
        }
      }
    } catch {
      // Gracefully handle incomplete DOM mocks in test environments
    }
  }

  // 2. Reactive hover & focus tracking
  if (typeof el.addEventListener === 'function' && onHelperUpdate) {
    const activate = () => {
      el.classList?.add?.('studio-control-highlight');
      if (info.intense || info.warning) el.classList?.add?.('studio-control-highlight-intense');
      onHelperUpdate(info);
    };
    const deactivate = () => {
      el.classList?.remove?.('studio-control-highlight');
      el.classList?.remove?.('studio-control-highlight-intense');
      onHelperUpdate(null);
    };

    try {
      el.addEventListener('mouseenter', activate);
      el.addEventListener('focusin', activate);
      el.addEventListener('focus', activate);
      el.addEventListener('mouseleave', deactivate);
      el.addEventListener('blur', deactivate);
      el.addEventListener('focusout', (ev: FocusEvent) => {
        if (ev?.relatedTarget && typeof el.contains === 'function' && el.contains(ev.relatedTarget as Node)) {
          return;
        }
        deactivate();
      });
    } catch {
      // Gracefully handle incomplete DOM mocks in test environments
    }
  }
}

/** Attach amber badge and hover/focus listeners to a blade row (Slice 9.8 wrapper for backwards compatibility). */
export function attachSpecHelper(
  blade: any,
  spec: ParamSpec,
  onHelperUpdate?: (spec: ParamSpec | null) => void,
): void {
  attachControlHelper(blade, spec, onHelperUpdate);
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

/** Preset picker group names: the system folder names with a "System:" prefix. */
export const SYSTEM_OPTGROUP_LABELS: Readonly<Record<SystemSubfolder, string>> = {
  showcase: `System: ${SYSTEM_SUBFOLDER_LABELS.showcase}`,
  flagship: `System: ${SYSTEM_SUBFOLDER_LABELS.flagship}`,
  classics: `System: ${SYSTEM_SUBFOLDER_LABELS.classics}`,
};

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

type FolderLike = { title?: string; expanded?: boolean; children?: unknown[] };

function folderChildren(node: unknown): FolderLike[] {
  const kids = (node as FolderLike | null | undefined)?.children;
  return Array.isArray(kids) ? (kids as FolderLike[]).filter((k) => typeof k?.expanded === 'boolean') : [];
}

/** Paths ("Section/Group") of every folder currently open, so a rebuild can reopen them. */
function collectOpenFolders(pane: unknown, prefix = '', out = new Set<string>()): Set<string> {
  for (const f of folderChildren(pane)) {
    const path = `${prefix}/${f.title ?? ''}`;
    if (f.expanded) out.add(path);
    collectOpenFolders(f, path, out);
  }
  return out;
}

function restoreOpenFolders(pane: unknown, open: Set<string>, prefix = ''): void {
  for (const f of folderChildren(pane)) {
    const path = `${prefix}/${f.title ?? ''}`;
    if (open.has(path)) f.expanded = true;
    restoreOpenFolders(f, open, path);
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
  /** Which warp operator is open in the warp editor, and which type "Add" creates (Slice 18.4). */
  private warpIndex = 0;
  private warpAddType: WarpOpType = 'radial';
  /** Which reaction is open in the reaction editor (Slice 17.6). */
  private reactionIndex = 0;
  private linkMonitor = { value: 0 };
  /** Delete two-tap state: when the first tap armed it, its timer, and the button it lives on. */
  private deleteArmedAt: number | null = null;
  private deleteTimer: number | undefined;
  private deleteBtn: ButtonApi | null = null;
  private saveBtn: ButtonApi | null = null;
  private undoBtn: ButtonApi | null = null;
  private redoBtn: ButtonApi | null = null;
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  /** Polite live region that announces the "Tap again" state of Delete. */
  private readonly deleteLive: HTMLElement;
  /** The in-panel "Save as" name field, when open. */
  private saveAsField: HTMLElement | null = null;
  /** The active inline prompt or confirmation row inside `.studio-body`, when open. */
  private inlinePromptEl: HTMLElement | null = null;
  /** Fixed bottom helper bar element for parameter descriptions & warnings (Slice 9.8). */
  readonly helperBar: HTMLElement;
  /** Preset select element in the DOM (Slice 10.3). */
  private presetSelectEl: HTMLSelectElement | null = null;
  /** Admin Gateway instance for verifying administrative capabilities (Slice 11.4). */
  private adminGateway: IAdminGateway;
  private adminUnsubscribe?: () => void;
  private directorUnsubscribe?: () => void;
  private adminBadgeEl: HTMLElement | null = null;
  /** All collapsible section and group folders in the active panel. */
  private sectionFolders: Array<{ expanded: boolean }> = [];
  /** Inline reactive slider handles bound in the current panel. */
  private reactiveHandles: ReactiveSliderHandle[] = [];
  private openReactiveDrawer: ReactiveSliderHandle | null = null;
  private switchingReactiveDrawer = false;
  private reactiveTargets = new Map<
    string,
    {
      handle: ReactiveSliderHandle;
      folders: Array<{ expanded: boolean }>;
      element?: HTMLElement;
      apply?: () => void;
    }
  >();
  private activeLinksHostEl: HTMLElement | null = null;
  private rafId: number | null = null;

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

    const closeBtn = container.querySelector<HTMLButtonElement>('#studio-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.setVisible(false));
      this.attachHelp(closeBtn, 'Close Studio', 'Close the Studio and go back to the visuals.');
    }
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
    this.frameTimer = setInterval(() => {
      if (!this.visible || !this.pane) return;
      this.monitor.ms = this.opts.frameMs?.() ?? 0;
      this.refreshDirtyState();
      this.pane.refresh();
    }, 500);
  }

  private readonly onHelper = (info: ParamSpec | ControlHelperDescriptor | null): void => {
    renderHelperContent(this.helperBar, info);
  };

  private attachHelp(
    elementOrBlade: any,
    label: string,
    description: string,
    extra?: { warning?: string; intense?: boolean },
  ): void {
    attachControlHelper(elementOrBlade, { label, description, ...extra }, this.onHelper);
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
      this.syncLiveOverlayLoop();
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => this.focusFirst());
      }
    } else {
      this.container.hidden = true;
      this.stopLiveOverlayLoop();
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
    return null;
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

  /** Initiate administrator login flow. */
  async handleAdminLogin(): Promise<{ success: boolean; error?: string }> {
    return await promptAdminLogin(this.adminGateway);
  }

  private getDoc(): Document | null {
    return this.body.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  }

  private insertPromptRow(row: HTMLElement): void {
    this.closeSaveAsField();
    this.closeInlinePrompt();
    if (typeof (this.body as any).prepend === 'function') {
      (this.body as any).prepend(row);
    } else if (this.body.firstChild && typeof (this.body.firstChild as any).before === 'function') {
      (this.body.firstChild as any).before(row);
    } else if (typeof this.body.append === 'function') {
      this.body.append(row);
    }
    this.inlinePromptEl = row;
  }

  private closeInlinePrompt(): void {
    if (!this.inlinePromptEl) return;
    if (typeof (this.inlinePromptEl as any).remove === 'function') {
      (this.inlinePromptEl as any).remove();
    } else {
      this.inlinePromptEl.parentElement?.removeChild?.(this.inlinePromptEl);
    }
    this.inlinePromptEl = null;
  }

  private openInlineTextPrompt(opts: {
    ariaLabel: string;
    labelText: string;
    confirmLabel: string;
    defaultValue?: string;
    helpLabel: string;
    helpDescription: string;
    onSubmit: (value: string) => string | void;
    onCancel?: () => void;
  }): void {
    const doc = this.getDoc();
    if (!doc) return;

    const row = doc.createElement('div');
    row.className = 'studio-inline-prompt';
    row.setAttribute('role', 'region');
    row.setAttribute('aria-label', opts.ariaLabel);

    const inputId = `studio-prompt-${Date.now()}`;
    const label = doc.createElement('label');
    label.className = 'studio-inline-prompt__label';
    label.setAttribute('for', inputId);
    label.textContent = opts.labelText;

    const input = doc.createElement('input');
    input.type = 'text';
    input.id = inputId;
    input.className = 'studio-inline-prompt__input';
    input.value = opts.defaultValue ?? '';
    input.setAttribute('aria-label', opts.labelText);

    const errorEl = doc.createElement('span');
    errorEl.className = 'studio-inline-prompt__error';
    errorEl.setAttribute('role', 'alert');

    const actions = doc.createElement('div');
    actions.className = 'studio-inline-prompt__actions';

    const confirmBtn = doc.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'ui-btn ui-btn--primary studio-inline-prompt__confirm';
    confirmBtn.textContent = opts.confirmLabel;

    const cancelBtn = doc.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ui-btn ui-btn--ghost studio-inline-prompt__cancel';
    cancelBtn.textContent = 'Cancel';

    const cancel = () => {
      this.closeInlinePrompt();
      opts.onCancel?.();
    };

    const submit = () => {
      const err = opts.onSubmit(input.value);
      if (typeof err === 'string' && err.length > 0) {
        errorEl.textContent = err;
        input.setAttribute('aria-invalid', 'true');
        (input as any).focus?.();
      }
    };

    input.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter') {
        ev.preventDefault?.();
        submit();
      } else if (ev.key === 'Escape') {
        ev.preventDefault?.();
        ev.stopPropagation?.();
        cancel();
      }
    });
    confirmBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', cancel);

    this.attachHelp(input, opts.helpLabel, opts.helpDescription);
    this.attachHelp(confirmBtn, opts.confirmLabel, opts.helpDescription);
    this.attachHelp(cancelBtn, 'Cancel', 'Close this prompt without making changes.');

    actions.append(confirmBtn, cancelBtn);
    row.append(label, input, errorEl, actions);
    this.insertPromptRow(row);
    (input as any).focus?.();
    (input as any).select?.();
  }

  /** Promote a user preset to a system preset via inline subfolder picker. */
  handlePromoteUserPreset(id: string): void {
    const doc = this.getDoc();
    if (!doc) return;

    const row = doc.createElement('div');
    row.className = 'studio-inline-prompt';
    row.setAttribute('role', 'region');
    row.setAttribute('aria-label', 'Promote to System Preset');

    const selectId = `studio-promote-${Date.now()}`;
    const label = doc.createElement('label');
    label.className = 'studio-inline-prompt__label';
    label.setAttribute('for', selectId);
    label.textContent = 'Promote to system subfolder';

    const select = doc.createElement('select');
    select.id = selectId;
    select.className = 'studio-inline-prompt__select';
    select.setAttribute('aria-label', 'Target system subfolder');

    for (const [optLabel, optValue] of Object.entries(SYSTEM_SUBFOLDER_OPTIONS)) {
      const opt = doc.createElement('option');
      opt.value = optValue;
      opt.setAttribute('value', optValue);
      opt.textContent = optLabel;
      if (optValue === 'classics') {
        opt.selected = true;
        opt.setAttribute('selected', 'selected');
      }
      select.append(opt);
    }
    select.value = 'classics';

    const actions = doc.createElement('div');
    actions.className = 'studio-inline-prompt__actions';

    const confirmBtn = doc.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'ui-btn ui-btn--primary studio-inline-prompt__confirm';
    confirmBtn.textContent = 'Promote preset';

    const cancelBtn = doc.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ui-btn ui-btn--ghost studio-inline-prompt__cancel';
    cancelBtn.textContent = 'Cancel';

    const cancel = () => this.closeInlinePrompt();

    const submit = () => {
      const chosen = select.value || 'classics';
      this.closeInlinePrompt();
      try {
        const newId = promoteUserPresetAction(this.opts.session, id, () => chosen);
        if (newId) {
          this.refreshPresetDropdown();
          this.opts.switchTo(newId);
        }
      } catch (err) {
        showToast((err as Error).message);
      }
    };

    select.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter') {
        ev.preventDefault?.();
        submit();
      } else if (ev.key === 'Escape') {
        ev.preventDefault?.();
        ev.stopPropagation?.();
        cancel();
      }
    });
    confirmBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', cancel);

    this.attachHelp(select, 'Target system subfolder', 'Choose which built-in system folder receives this promoted preset.');
    this.attachHelp(confirmBtn, 'Promote preset', 'Promote this user preset into the selected built-in system folder.');
    this.attachHelp(cancelBtn, 'Cancel', 'Close without promoting this preset.');

    actions.append(confirmBtn, cancelBtn);
    row.append(label, select, actions);
    this.insertPromptRow(row);
    (select as any).focus?.();
  }

  dispose(): void {
    if (this.frameTimer !== null) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
    this.stopLiveOverlayLoop();
    this.disposeReactiveHandles();
    this.closeSaveAsField();
    this.closeInlinePrompt();
    this.disarmDelete();
    if (this.directorUnsubscribe) {
      this.directorUnsubscribe();
      this.directorUnsubscribe = undefined;
    }
    if (this.adminUnsubscribe) {
      this.adminUnsubscribe();
      this.adminUnsubscribe = undefined;
    }
    this.pane?.dispose();
    this.pane = null;
  }

  handleNewFolder(presetId: string): void {
    this.openInlineTextPrompt({
      ariaLabel: 'New folder name',
      labelText: 'New folder name',
      confirmLabel: 'Create folder',
      defaultValue: '',
      helpLabel: 'New folder name',
      helpDescription: 'Enter a name for the new folder and move this preset into it.',
      onSubmit: (raw) => {
        const name = raw.trim();
        if (!name) return 'Enter a folder name.';
        this.closeInlinePrompt();
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
      },
      onCancel: () => {
        this.bind(presetId);
      },
    });
  }

  handleRenameFolder(presetId: string, folderId: string): void {
    const session = this.opts.session;
    const folders = typeof session.getFolders === 'function' ? session.getFolders() : [];
    const current = folders.find((f) => f.id === folderId);
    const currentName = current ? current.name : '';

    this.openInlineTextPrompt({
      ariaLabel: 'Rename folder',
      labelText: `Rename folder "${currentName}"`,
      confirmLabel: 'Rename folder',
      defaultValue: currentName,
      helpLabel: 'Rename folder',
      helpDescription: 'Enter a new name for this user preset folder.',
      onSubmit: (raw) => {
        const newName = raw.trim();
        if (!newName) return 'Enter a folder name.';
        this.closeInlinePrompt();
        if (newName === currentName) return;
        try {
          session.renameFolder(folderId, newName);
          showToast(`Folder renamed to "${newName}"`);
          this.bind(presetId);
        } catch (err) {
          showToast((err as Error).message);
        }
      },
    });
  }

  handleDeleteFolder(presetId: string, folderId: string): void {
    const doc = this.getDoc();
    if (!doc) return;
    const session = this.opts.session;
    const folders = typeof session.getFolders === 'function' ? session.getFolders() : [];
    const current = folders.find((f) => f.id === folderId);
    const folderName = current ? current.name : 'this folder';

    const row = doc.createElement('div');
    row.className = 'studio-inline-prompt studio-inline-prompt--danger';
    row.setAttribute('role', 'alertdialog');
    row.setAttribute('aria-label', 'Delete folder confirmation');

    const msg = doc.createElement('div');
    msg.className = 'studio-inline-prompt__label';
    msg.textContent = `Delete folder "${folderName}"? Presets inside will be moved to Unfiled.`;

    const actions = doc.createElement('div');
    actions.className = 'studio-inline-prompt__actions';

    // Safe choice on the left (Harness UI Dialog rule).
    const cancelBtn = doc.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ui-btn ui-btn--ghost studio-inline-prompt__cancel';
    cancelBtn.textContent = 'Cancel';

    const confirmBtn = doc.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'ui-btn ui-btn--danger studio-inline-prompt__confirm';
    confirmBtn.textContent = 'Delete folder';

    const cancel = () => this.closeInlinePrompt();
    const confirm = () => {
      this.closeInlinePrompt();
      try {
        session.deleteFolder(folderId);
        showToast(`Folder "${folderName}" deleted`);
        this.bind(presetId);
      } catch (err) {
        showToast((err as Error).message);
      }
    };

    row.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault?.();
        ev.stopPropagation?.();
        cancel();
      }
    });
    cancelBtn.addEventListener('click', cancel);
    confirmBtn.addEventListener('click', confirm);

    this.attachHelp(cancelBtn, 'Cancel', 'Keep this folder and its preset assignments.');
    this.attachHelp(confirmBtn, 'Delete folder', 'Delete this folder and move its presets to Unfiled.');

    actions.append(cancelBtn, confirmBtn);
    row.append(msg, actions);
    this.insertPromptRow(row);
    (cancelBtn as any).focus?.();
  }

  /** (Re)build the panel for preset `id`. Call after every switch or structure change. */
  bind(id: string): void {
    const scroller = this.container;
    const scrollTop = scroller?.scrollTop ?? 0;
    const open = collectOpenFolders(this.pane);
    this.buildPanel(id);
    if (open.size > 0) restoreOpenFolders(this.pane, open);
    if (scroller && scrollTop > 0) {
      scroller.scrollTop = scrollTop;
      // Folders animate open, so the content may still be short on this frame. Re-apply once it settles.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          scroller.scrollTop = scrollTop;
        });
      }
    }
  }

  private buildPanel(id: string): void {
    this.id = id;
    this.disarmDelete();
    this.deleteBtn = null;
    this.saveBtn = null;
    this.undoBtn = null;
    this.redoBtn = null;
    if (this.directorUnsubscribe) {
      this.directorUnsubscribe();
      this.directorUnsubscribe = undefined;
    }
    const staleFooter = this.container?.querySelector?.('.studio-footer');
    if (staleFooter && typeof (staleFooter as any).remove === 'function') {
      (staleFooter as any).remove();
    }
    this.stopLiveOverlayLoop();
    this.disposeReactiveHandles();
    this.openReactiveDrawer = null;
    this.reactiveTargets.clear();
    this.activeLinksHostEl = null;
    const oldPane = this.pane;
    this.pane = null;
    this.body.replaceChildren();
    if (oldPane) {
      const disposeOld = () => {
        try {
          oldPane.dispose();
        } catch {
          // Ignore views already disposed during teardown.
        }
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(disposeOld);
      else disposeOld();
    }
    if (this.container && !this.container.contains(this.helperBar)) {
      this.container.append(this.helperBar);
    }
    renderHelperContent(this.helperBar, null);
    this.saveAsField = null;
    this.inlinePromptEl = null;
    this.presetSelectEl = null;
    this.sectionFolders = [];
    const pane: Pane = this.opts.paneFactory
      ? (this.opts.paneFactory({ container: this.body, title: 'Preset Studio' }) as unknown as Pane)
      : new Pane({ container: this.body, title: 'Preset Studio' });
    this.pane = pane;
    if (
      this.opts.paneFactory &&
      (pane as any).element &&
      typeof this.body.contains === 'function' &&
      !this.body.contains((pane as any).element) &&
      typeof this.body.append === 'function'
    ) {
      this.body.append((pane as any).element);
    }
    const session = this.opts.session;
    const entry = session.get(id);
    if (!entry) return;
    const preset = entry.preset;
    const commitEdit = () => {
      session.commit(id);
      this.refreshDirtyState();
    };

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
    this.attachHelp(presetBinding, 'Preset', 'Switch to another preset. Built-in presets cannot be overwritten; your own presets can be edited and saved.');

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
        this.attachHelp(categoryBinding, 'Category', 'Shows the built-in category and read-only status of this system preset.');
        const hintDoc = this.getDoc();
        if (hintDoc) {
          const hint = hintDoc.createElement('div');
          hint.className = 'studio-readonly-hint';
          hint.setAttribute('role', 'status');
          hint.textContent =
            'Built-in presets are read-only. Slider edits preview live; Favourite and Skip choices save locally. Use Save as… to keep your own editable copy.';
          if (
            categoryBinding?.element?.parentElement &&
            typeof (categoryBinding.element as any).after === 'function'
          ) {
            (categoryBinding.element as any).after(hint);
          } else {
            this.body.append(hint);
          }
        }
      } else {
        const currentSubfolder = (typeof session.getSystemPresetSubfolder === 'function'
          ? session.getSystemPresetSubfolder(id)
          : entry.subfolder) ?? getSystemSubfolder(id) ?? 'classics';
        const subfolderHolder = { subfolder: currentSubfolder };
        const subfolderBinding = pane.addBinding(subfolderHolder, 'subfolder', {
          label: 'Subfolder',
          options: SYSTEM_SUBFOLDER_OPTIONS,
        });
        const onSelectSubfolder = (chosenSubfolder: string) => {
          const normalized: SystemSubfolder =
            chosenSubfolder === 'showcase' || chosenSubfolder === 'flagship' || chosenSubfolder === 'classics'
              ? chosenSubfolder
              : 'classics';
          if (typeof session.setSystemPresetSubfolder === 'function') {
            setSystemPresetSubfolderAction(session, id, normalized);
          } else {
            entry.subfolder = normalized;
            showToast(`Moved to ${SYSTEM_SUBFOLDER_LABELS[normalized] ?? normalized} locally (remote sync offline)`);
          }
          this.refreshPresetDropdown();
          this.bind(id);
        };
        subfolderBinding.on('change', (ev: { value: unknown }) => onSelectSubfolder(String(ev.value)));
        const subfolderSelectEl = subfolderBinding?.element?.querySelector?.('select') as HTMLSelectElement | null;
        if (subfolderSelectEl) {
          subfolderSelectEl.addEventListener?.('change', () => onSelectSubfolder(subfolderSelectEl.value));
        }
        this.attachHelp(subfolderBinding, 'Subfolder', 'Moves this system preset between Showcase, Flagship, and Classics folders.');
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
        commitEdit();
        if (entry.builtin && isAdmin) {
          this.refreshPresetDropdown();
        }
      });
    }
    this.attachHelp(
      nameBinding,
      'Name',
      entry.builtin && !isAdmin
        ? 'Display name of this built-in preset (read-only unless signed in as admin).'
        : 'Display name shown in the preset selector and on-screen display.',
    );

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
      this.attachHelp(folderBinding, 'Folder', 'Organise this user preset into a folder or move it back to Unfiled.');

      // Folder management buttons
      const folderBtnElements: HTMLElement[] = [];
      const addFolderBtn = (title: string, description: string, onClick: () => void) => {
        const btn = pane.addButton({ title });
        btn.on('click', onClick);
        this.attachHelp(btn, title, description);
        folderBtnElements.push(btn.element);
        return btn;
      };

      if (currentFolderId) {
        addFolderBtn('Rename folder', 'Rename the currently selected user preset folder.', () => this.handleRenameFolder(id, currentFolderId));
        addFolderBtn('Delete folder', 'Delete the current folder (presets inside are moved to Unfiled).', () => this.handleDeleteFolder(id, currentFolderId));
      }
      addFolderBtn('Add folder', 'Create a new folder and move this preset into it.', () => this.handleNewFolder(id));

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

    // Tags for the auto-cycle (T2): "favourite" and "skip".
    const tagHolder = { favourite: preset.tags.includes('favourite'), skip: preset.tags.includes('skip') };
    const setTag = (tag: string, on: boolean) => {
      const currentTags = preset.tags.filter((t) => t !== tag);
      if (on) currentTags.push(tag);
      if (typeof session.setPresetTags === 'function') {
        session.setPresetTags(id, currentTags);
      } else {
        preset.tags = currentTags;
        commitEdit();
      }
    };
    const favBinding = pane.addBinding(tagHolder, 'favourite', { label: 'Favourite' });
    favBinding.on('change', (ev) => setTag('favourite', Boolean(ev.value)));
    this.attachHelp(favBinding, 'Favourite', 'Mark this preset as a favourite. It shows a filled star in the preset browser.');
    const skipBinding = pane.addBinding(tagHolder, 'skip', { label: 'Skip in auto-cycle' });
    skipBinding.on('change', (ev) => setTag('skip', Boolean(ev.value)));
    this.attachHelp(skipBinding, 'Skip in auto-cycle', 'Exclude this preset from automatic cycling while keeping it selectable manually.');
    // Transition into this preset (T1): style and time. Applied the next time the preset is shown.
    const transStyleBinding = pane.addBinding(preset.transition as unknown as Record<string, unknown>, 'style', {
      label: 'Transition style',
      options: Object.fromEntries(TRANSITION_STYLES.map((t) => [TRANSITION_STYLE_LABELS[t] ?? formatEnumOptionLabel(t), t])),
    });
    transStyleBinding.on('change', commitEdit);
    attachControlHelper(transStyleBinding, { ...STYLE_SPEC, label: 'Transition style' }, this.onHelper);
    const transSecBinding = pane.addBinding(preset.transition as unknown as Record<string, unknown>, 'seconds', { label: 'Transition seconds', min: 0.3, max: 10, step: 0.05 });
    transSecBinding.on('change', commitEdit);
    attachControlHelper(transSecBinding, { ...SECONDS_SPEC, label: 'Transition seconds' }, this.onHelper);
    // Optional per-preset blend time override (slice 26.5): 0..10 s, or undefined to use transition.seconds.
    const initialBlend = clampBlendSec(preset.blendSec);
    const blendHolder = {
      customBlend: initialBlend !== undefined,
      blendSec: initialBlend ?? clampBlendSec(preset.transition.seconds) ?? 1.2,
    };
    const customBlendBinding = pane.addBinding(blendHolder, 'customBlend', { label: 'Custom blend time' });
    const blendSecBinding = pane.addBinding(blendHolder, 'blendSec', {
      label: 'Blend time (s)',
      min: PRESET_BLEND_MIN_SEC,
      max: PRESET_BLEND_MAX_SEC,
      step: 0.05,
    });
    blendSecBinding.hidden = !blendHolder.customBlend;
    customBlendBinding.on('change', (ev) => {
      const enabled = Boolean(ev.value);
      blendHolder.customBlend = enabled;
      blendSecBinding.hidden = !enabled;
      if (!enabled) {
        preset.blendSec = undefined;
      } else {
        const clamped = clampBlendSec(blendHolder.blendSec) ?? clampBlendSec(preset.transition.seconds) ?? 1.2;
        blendHolder.blendSec = clamped;
        preset.blendSec = clamped;
        blendSecBinding.refresh();
      }
      commitEdit();
    });
    blendSecBinding.on('change', (ev) => {
      if (!blendHolder.customBlend) return;
      const clamped = clampBlendSec(Number(ev.value));
      if (clamped !== undefined) {
        blendHolder.blendSec = clamped;
        preset.blendSec = clamped;
      }
      commitEdit();
    });
    attachControlHelper(
      customBlendBinding,
      {
        label: 'Custom blend time',
        description: 'Use your own fade time for switching into this preset instead of the usual fade. 0 s cuts instantly.',
      },
      this.onHelper,
    );
    attachControlHelper(blendSecBinding, { ...BLEND_SECONDS_SPEC, label: 'Blend time (s)' }, this.onHelper);
    // Display time (slice 23.3): 0 means auto-cycle timer. Values below the minimum remove the stored field.
    const displayHolder = { displaySec: preset.displaySec ?? 0 };
    const displayBinding = pane.addBinding(displayHolder, 'displaySec', { label: 'Display time (s, 0 = auto-cycle timer)', min: 0, max: PRESET_DISPLAY_MAX_SEC, step: 1 });
    displayBinding.on('change', (ev) => {
      const value = Number(ev.value);
      const clamped = clampDisplaySec(value);
      if (value < PRESET_DISPLAY_MIN_SEC || clamped === undefined) delete preset.displaySec;
      else preset.displaySec = clamped;
      commitEdit();
    });
    this.attachHelp(displayBinding, 'Display time', 'How long this preset stays on screen in Timer mode (5–300 s; 0 uses the global timer).');
    // Action buttons share one grid wrapper (slice 10.2). Each button's element is collected, then moved into the wrapper below.
    const tiles: HTMLElement[] = [];
    const tile = <T extends ButtonApi>(btn: T, label: string, description: string): T => {
      tiles.push(btn.element);
      this.attachHelp(btn, label, description);
      return btn;
    };
    if (entry.builtin) {
      if (!isAdmin) {
        tile(
          pane.addButton({ title: 'Save (built-in, read-only)' }),
          'Save (built-in, read-only)',
          'Built-in presets are read-only. Use "Save as…" to keep an editable copy.',
        ).on('click', () => {
          showToast('Built-in presets are read-only. Use "Save as…" to keep a copy.');
        });
      } else {
        const saveSysBtn = tile(
          pane.addButton({ title: this.formatSaveTitle(id, true) }),
          'Save System Preset',
          'Overwrite this built-in system preset with your current edits.',
        );
        attachButtonIcon(saveSysBtn, 'crown', true);
        this.saveBtn = saveSysBtn;
        saveSysBtn.on('click', () => {
          this.runAdmin(() => {
            if (typeof session.saveSystemPreset === 'function') {
              saveSystemPresetAction(session, id);
            } else {
              session.save(id);
              showToast('System preset saved locally (remote sync offline)');
            }
          });
        });
      }
    } else {
      const saveUserBtn = tile(
        pane.addButton({ title: this.formatSaveTitle(id, false) }),
        'Save',
        'Save changes to this user preset in your browser library.',
      );
      this.saveBtn = saveUserBtn;
      saveUserBtn.on('click', () => this.run(() => session.save(id), 'Saved'));
    }
    tile(
      pane.addButton({ title: 'Save as…' }),
      'Save as…',
      'Save the current settings as a new user preset under a new name.',
    ).on('click', () => this.openSaveAsField(id, `${preset.name} copy`));
    tile(
      pane.addButton({ title: 'Duplicate' }),
      'Duplicate',
      'Make a copy of this preset and switch to it.',
    ).on('click', () =>
      this.run(() => this.opts.switchTo(session.saveAs(id, `${preset.name} copy`)), 'Duplicated'),
    );
    if (!entry.builtin || isAdmin) {
      const del = tile(
        pane.addButton({ title: DELETE_LABEL }),
        'Delete',
        'Remove this preset (tap twice within 3 seconds to confirm).',
      );
      this.deleteBtn = del;
      del.on('click', () => this.onDeleteTap(del, id));
    }
    if (!entry.builtin && isAdmin) {
      const promoteBtn = tile(
        pane.addButton({ title: 'Promote to System Preset' }),
        'Promote to System Preset',
        'Promote this user preset into a built-in system preset.',
      );
      attachButtonIcon(promoteBtn, 'crown', true);
      promoteBtn.on('click', () =>
        this.handlePromoteUserPreset(id),
      );
    }
    tile(
      pane.addButton({ title: 'Export .json' }),
      'Export .json',
      'Download this preset as a portable JSON file.',
    ).on('click', () => this.exportFile(id));
    tile(
      pane.addButton({ title: 'Import .json…' }),
      'Import .json…',
      'Load a preset, palette or look from a .json file.',
    ).on('click', () => this.importFile());
    // Whole library (slice 21.9): every user preset, folder, favourite and tag in one file.
    tile(
      pane.addButton({ title: 'Export library' }),
      'Export library',
      'Download all user presets, folders, favourites, and tags in a single backup file.',
    ).on('click', () => exportLibraryFile(session));
    tile(
      pane.addButton({ title: 'Import library…' }),
      'Import library…',
      'Restore or merge presets and folders from a previously exported library file.',
    ).on('click', () =>
      importLibraryFromPicker(session, () => {
        this.refreshPresetDropdown();
        this.bind(id);
      }),
    );
    const undo = tile(
      pane.addButton({ title: 'Undo' }),
      'Undo',
      'Revert the most recent edit to this preset.',
    );
    this.undoBtn = undo;
    undo.disabled = !session.canUndo(id);
    undo.on('click', () => this.run(() => {
      session.undo(id);
    }, 'Undone'));
    const redo = tile(
      pane.addButton({ title: 'Redo' }),
      'Redo',
      'Reapply the most recently undone edit to this preset.',
    );
    this.redoBtn = redo;
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
    const randomBtn = pane.addButton({ title: 'Randomise (within safe ranges)' });
    randomBtn.on('click', () => this.vary('random'));
    this.attachHelp(randomBtn, 'Randomise', 'Randomise all unlocked layers, feedback, and post settings within safe visual ranges.');
    const mutateBtn = pane.addButton({ title: 'Mutate (±10%)' });
    mutateBtn.on('click', () => this.vary('mutate'));
    this.attachHelp(mutateBtn, 'Mutate (±10%)', 'Nudge all unlocked layers, feedback, and post settings slightly (±10%) for subtle variations.');

    // --- Mashup (Slice 20.10): keep these layers, take another preset's Feedback and Post look ---------
    const mashupOptions = this.mashupOptions();
    const mashupIds = Object.values(mashupOptions);
    if (mashupIds.length > 0) {
      if (!mashupIds.includes(this.mashupFrom)) this.mashupFrom = mashupIds[0]!;
      const holder = { from: this.mashupFrom };
      const lookFromBinding = pane.addBinding(holder, 'from', { label: 'Look from', options: mashupOptions });
      lookFromBinding.on('change', (ev) => {
        this.mashupFrom = String(ev.value);
      });
      this.attachHelp(lookFromBinding, 'Look from', 'Choose another preset whose Feedback, Post, Warp, and Reactions look you want to borrow.');
      const mashupBtn = pane.addButton({ title: 'Mashup: use that look on these layers' });
      mashupBtn.on('click', () => this.mashup());
      this.attachHelp(mashupBtn, 'Mashup', 'Copy the chosen preset’s Feedback, Post, Warp, and Reactions onto your current layers.');
    }

    // --- Global Director (Sector 483, Slice 7.32) -----------------------------------
    const dirFolder = pane.addFolder({ title: 'Global Director', expanded: false });
    this.sectionFolders.push(dirFolder);
    const dirControls = buildGlobalDirectorControls(dirFolder, undefined, this.onHelper);
    this.directorUnsubscribe = dirControls.unsubscribe;
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
      commitEdit();
    };
    const useGlobalCamBinding = dirFolder.addBinding(profileFlags, 'useGlobalCamera', { label: 'Use global camera' });
    useGlobalCamBinding.on('change', (ev: { value: unknown }) => setProfileFlag('useGlobalCamera', Boolean(ev.value)));
    this.attachHelp(useGlobalCamBinding, 'Use global camera', 'When on, Global Director controls camera motion; turn off to keep this preset’s own camera profile.');
    const useGlobalColBinding = dirFolder.addBinding(profileFlags, 'useGlobalColour', { label: 'Use global colour' });
    useGlobalColBinding.on('change', (ev: { value: unknown }) => setProfileFlag('useGlobalColour', Boolean(ev.value)));
    this.attachHelp(useGlobalColBinding, 'Use global colour', 'When on, Global Director applies its colour mood; turn off to keep this preset’s own palette.');

    const makeReactiveCtx = (
      scopePrefixOrFn: string | ((specName: string) => string),
      applyFn: () => void,
    ): ReactiveSectionContext => ({
      scopePrefix: typeof scopePrefixOrFn === 'string' ? scopePrefixOrFn : '',
      scopeForSpec: typeof scopePrefixOrFn === 'function' ? scopePrefixOrFn : undefined,
      onDrawerToggle: (handle) => {
        if (handle) {
          const prev = this.openReactiveDrawer;
          this.openReactiveDrawer = handle;
          if (prev && prev !== handle) {
            this.switchingReactiveDrawer = true;
            try {
              prev.closeDrawer();
            } finally {
              this.switchingReactiveDrawer = false;
            }
          }
        } else if (!this.switchingReactiveDrawer) {
          this.openReactiveDrawer = null;
        }
      },
      registerHandle: (handle) => {
        this.reactiveHandles.push(handle);
      },
      onReactiveMutate: (discrete, secApply) => {
        session.commit(id, Date.now(), discrete);
        this.refreshDirtyState();
        (secApply ?? applyFn)();
        this.refreshActiveLinksOverview(id, preset);
        this.syncLiveOverlayLoop();
      },
      onRegisterTarget: (meterKey, handle, folders, element, secApply) => {
        this.reactiveTargets.set(meterKey, {
          handle,
          folders,
          element,
          apply: secApply ?? applyFn,
        });
      },
    });

    // --- Layer stack ----------------------------------------------------------------
    pane.addBlade({ view: 'separator' });
    this.selected = preset.layers.length === 0 ? 0 : Math.min(this.selected, preset.layers.length - 1);
    if (preset.layers.length > 0) {
      const layerOptions = Object.fromEntries(preset.layers.map((l, i) => [formatLayerLabel(l, i), i]));
      const sel = { selected: this.selected };
      const layerSelectBinding = pane.addBinding(sel, 'selected', { label: 'Layer', options: layerOptions });
      layerSelectBinding.on('change', (ev) => {
        this.selected = Number(ev.value);
        this.bind(id);
      });
      this.attachHelp(layerSelectBinding, 'Layer', 'Select which layer in the stack to inspect, reorder, or modify.');
      const layer = preset.layers[this.selected]!;
      const layerOnBinding = pane.addBinding(layer as unknown as Record<string, unknown>, 'enabled', { label: 'Layer on' });
      layerOnBinding.on('change', () => this.structure());
      this.attachHelp(layerOnBinding, 'Layer on', 'Enable or disable the selected layer in the rendered scene.');
      const lock = { locked: this.locked.has(this.selected) };
      const lockBinding = pane.addBinding(lock, 'locked', { label: 'Keep when randomising' });
      lockBinding.on('change', (ev) => {
        if (ev.value) this.locked.add(this.selected);
        else this.locked.delete(this.selected);
      });
      this.attachHelp(lockBinding, 'Keep when randomising', 'Lock this layer so Randomise and Mutate leave its settings untouched.');
      const seedBox = { seed: this.layerSeed };
      const seedBinding = pane.addBinding(seedBox, 'seed', { label: 'Layer seed (0 = new each time)', min: 0, max: MAX_LAYER_SEED, step: 1 });
      seedBinding.on('change', (ev) => {
        this.layerSeed = Math.max(0, Math.min(MAX_LAYER_SEED, Math.round(Number(ev.value) || 0)));
      });
      this.attachHelp(seedBinding, 'Layer seed', 'Seed for "Randomise this layer" (0 picks a fresh random seed every click; non-zero repeats the exact result).');
      const varyLayerBtn = pane.addButton({ title: 'Randomise this layer' });
      varyLayerBtn.on('click', () => this.varyLayer());
      this.attachHelp(varyLayerBtn, 'Randomise this layer', 'Randomise only the currently selected layer using the Layer seed above.');
      const monitor = typeof session.monitorOf === 'function' ? session.monitorOf(id) : undefined;
      const liveIdx = isLayerRendered(layer, this.selected, monitor)
        ? preset.layers.slice(0, this.selected).filter((l, idx) => isLayerRendered(l, idx, monitor)).length
        : -1;
      const opacityMeterKey = liveIdx >= 0 ? `${id}L${liveIdx}.opacity` : `${id}L_off_${this.selected}.opacity`;
      const opacityTargetKey = `${id}L_opacity_${this.selected}`;
      const applyLayerConfig = () => applyPresetToScene(preset, session.sceneOf(id));
      const opacityCtx = makeReactiveCtx(opacityTargetKey, applyLayerConfig);
      buildLayerControls(
        pane,
        layer,
        preset,
        session.sceneOf(id),
        session,
        undefined,
        id,
        this.onHelper,
        () => this.refreshDirtyState(),
        {
          meterKey: opacityMeterKey,
          onMutate: (discrete) => opacityCtx.onReactiveMutate?.(discrete, applyLayerConfig),
          onDrawerToggle: opacityCtx.onDrawerToggle,
          registerHandle: opacityCtx.registerHandle,
          onRegisterTarget: (handle, element) => {
            opacityCtx.onRegisterTarget?.(opacityTargetKey, handle, [], element, applyLayerConfig);
          },
        },
      );
      const mon = { solo: session.isSolo(id, this.selected), mute: session.isMuted(id, this.selected) };
      const soloBinding = pane.addBinding(mon, 'solo', { label: 'Solo (preview only)' });
      soloBinding.on('change', (ev) => {
        session.setSolo(id, this.selected, Boolean(ev.value));
        this.bind(id);
      });
      this.attachHelp(soloBinding, 'Solo (preview only)', 'Temporarily isolate this layer in the preview without changing the saved preset.');
      const muteBinding = pane.addBinding(mon, 'mute', { label: 'Mute (preview only)' });
      muteBinding.on('change', (ev) => {
        session.setMute(id, this.selected, Boolean(ev.value));
        this.bind(id);
      });
      this.attachHelp(muteBinding, 'Mute (preview only)', 'Temporarily hide this layer in the preview without disabling it in the saved preset.');
      const dupLayerBtn = pane.addButton({ title: 'Duplicate layer' });
      dupLayerBtn.on('click', () => {
        this.selected = session.duplicateLayer(id, this.selected);
        this.locked.clear();
        this.bind(id);
      });
      this.attachHelp(dupLayerBtn, 'Duplicate layer', 'Insert a copy of the selected layer immediately after it.');
      const moveUpBtn = pane.addButton({ title: 'Move layer up' });
      moveUpBtn.on('click', () => this.move(-1));
      this.attachHelp(moveUpBtn, 'Move layer up', 'Move the selected layer earlier in the render order.');
      const moveDownBtn = pane.addButton({ title: 'Move layer down' });
      moveDownBtn.on('click', () => this.move(1));
      this.attachHelp(moveDownBtn, 'Move layer down', 'Move the selected layer later in the render order.');
      const removeLayerBtn = pane.addButton({ title: 'Remove layer' });
      removeLayerBtn.on('click', () => {
        preset.layers.splice(this.selected, 1);
        session.shiftMonitorAfterRemove(id, this.selected);
        this.structure();
      });
      this.attachHelp(removeLayerBtn, 'Remove layer', 'Delete the selected layer from this preset.');
    }
    const typeHolder = { type: this.addType };
    const typeOptions = Object.fromEntries(Object.keys(LAYER_FACTORIES).map((t) => [formatLayerType(t), t]));
    const addLayerTypeBinding = pane.addBinding(typeHolder, 'type', { label: 'Add layer', options: typeOptions });
    addLayerTypeBinding.on('change', (ev) => {
      this.addType = String(ev.value);
    });
    this.attachHelp(addLayerTypeBinding, 'Add layer', 'Choose the layer type to append when clicking "Add this layer".');
    const addLayerBtn = pane.addButton({ title: 'Add this layer' });
    addLayerBtn.on('click', () => {
      preset.layers.push(defaultLayer(this.addType));
      this.selected = preset.layers.length - 1;
      this.structure();
    });
    this.attachHelp(addLayerBtn, 'Add this layer', 'Append a new layer of the chosen type to the end of the stack.');

    // --- Settings -------------------------------------------------------------------
    pane.addBlade({ view: 'separator' });
    const expandBtn = pane.addButton({ title: 'Expand All' });
    const collapseBtn = pane.addButton({ title: 'Collapse All' });
    expandBtn.on('click', () => this.expandAll());
    collapseBtn.on('click', () => this.collapseAll());
    this.attachHelp(expandBtn, 'Expand All', 'Open all collapsible Studio parameter sections and groups.');
    this.attachHelp(collapseBtn, 'Collapse All', 'Close all collapsible Studio parameter sections and groups.');

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
      const monitorState = typeof session.monitorOf === 'function' ? session.monitorOf(id) : undefined;
      if (!isLayerRendered(layerEntry, i, monitorState)) continue;
      const k = live++;
      const title = formatLayerTitle(layerEntry, i);
      const applyLayer = () => {
        const current = session.sceneOf(id).layers[k];
        if (current) applyValues(current, valuesOf(layerEntry.params));
      };
      this.bindSection(
        pane,
        title,
        LAYER_SPECS[layerEntry.type] ?? [],
        layerEntry.params,
        applyLayer,
        { section: 'layer', layerIndex: i },
        makeReactiveCtx(`${id}L${k}`, applyLayer),
      );
    }
    // Slice 15.2: Feedback and Post share one section with four groups (Motion, Warp, Trails, Colour).
    const postNames = new Set(SCHEMAS.post.map((s) => s.name));
    const applyFeedbackPost = () => {
      session.sceneOf(id).setFeedback(valuesOf(preset.feedback));
      session.refreshPost(id);
    };
    this.bindSection(
      pane,
      'Feedback and post',
      layoutFeedbackPost(SCHEMAS.feedback, SCHEMAS.post),
      mergeSettings(preset.feedback, preset.post, postNames),
      applyFeedbackPost,
      { section: 'feedbackPost', layerIndex: null },
      makeReactiveCtx((name) => (postNames.has(name) ? `${id}P` : `${id}F`), applyFeedbackPost),
    );

    // --- Warp field operators (Slice 18.4) ----------------------------------------------
    this.bindWarpEditor(pane, id, preset, (applyWarp) => makeReactiveCtx(`${id}W${this.warpIndex}`, applyWarp));

    // --- Active Links Overview (Slice 29.2) ---------------------------------------------
    this.bindActiveLinksOverview(pane, id, preset);

    // --- Audio link (slice E2) --------------------------------------------------------
    this.bindLinkEditor(pane, id, preset);
    this.bindMorphEditor(pane, id, preset);
    // --- Reactions (Slice 17.6) --------------------------------------------------------
    this.bindReactionEditor(pane, id, preset);

    // --- Frame time -----------------------------------------------------------------
    pane.addBlade({ view: 'separator' });
    this.monitor.ms = this.opts.frameMs?.() ?? 0;
    const frameTimeBinding = pane.addBinding(this.monitor, 'ms', {
      label: `Frame time ms (60 fps ≤ ${FRAME_BUDGET_MS})`,
      readonly: true,
      format: (v: number) => v.toFixed(1),
    });
    this.attachHelp(frameTimeBinding, 'Frame time', `How long each frame takes to draw, in milliseconds. At or below ${FRAME_BUDGET_MS} ms keeps 60 frames per second.`);

    // --- Administrator Mode Access (Slice 11.4) -------------------------------------
    pane.addBlade({ view: 'separator' });
    const adminActionTitle = getAdminActionLabel(isAdmin);
    const adminBtn = pane.addButton({ title: adminActionTitle });
    attachButtonIcon(adminBtn, 'crown', isAdmin);
    adminBtn.on('click', () => {
      if (this.isAdmin()) {
        adminLogout(this.adminGateway);
      } else {
        void this.handleAdminLogin();
      }
    });
    this.attachHelp(
      adminBtn,
      adminActionTitle,
      isAdmin
        ? 'Sign out of Administrator Mode and return to standard user permissions.'
        : 'Sign in as an administrator to edit or promote built-in system presets.',
    );

    this.syncLiveOverlayLoop();
  }

  /** Pick one numeric setting, then add, edit or remove its audio link. */
  private bindLinkEditor(pane: Pane, id: string, preset: Preset): void {
    const targets = linkTargets(preset);
    if (targets.length === 0) return;
    pane.addBlade({ view: 'separator' });
    if (!targets.some((t) => t.key === this.linkTarget)) this.linkTarget = targets[0]!.key;
    const pick = { key: this.linkTarget };
    const linkTargetBinding = pane.addBinding(pick, 'key', {
      label: 'Link or morph a setting',
      options: Object.fromEntries(targets.map((t) => [t.label, t.key])),
    });
    linkTargetBinding.on('change', (ev) => {
      this.linkTarget = String(ev.value);
      this.bind(id);
    });
    this.attachHelp(linkTargetBinding, 'Link or morph a setting', 'Pick a number setting to drive with the music, a slow wave (LFO), or a morph between two values.');
    const target = targets.find((t) => t.key === this.linkTarget)!;
    const setting = target.setting;
    const session = this.opts.session;
    if (!setting.link) {
      const addLinkBtn = pane.addButton({ title: 'Add audio link' });
      addLinkBtn.on('click', () => {
        session.commit(id);
        setting.link = { source: 'bass', amount: 0.2, smooth: 0.2 };
        this.bind(id);
      });
      this.attachHelp(addLinkBtn, 'Add audio link', 'Make the chosen setting follow the music or a slow wave (LFO).');
      return;
    }
    const link = setting.link;
    const onEdit = () => {
      session.commit(id);
      this.refreshDirtyState();
    };
    const sourceBinding = pane.addBinding(link as unknown as Record<string, unknown>, 'source', {
      label: 'Source',
      options: Object.fromEntries(AUDIO_SOURCES.map((s) => [AUDIO_SOURCE_LABELS[s] ?? formatEnumOptionLabel(s), s])),
    });
    sourceBinding.on('change', onEdit);
    this.attachHelp(sourceBinding, 'Source', 'What moves the setting: a frequency band, the beat, a song signal like drops, or a slow wave (LFO).');
    const linkAmountBinding = pane.addBinding(link as unknown as Record<string, unknown>, 'amount', { label: 'Amount (share of range)', min: -1, max: 1, step: 0.01 });
    linkAmountBinding.on('change', onEdit);
    this.attachHelp(linkAmountBinding, 'Amount (share of range)', 'How far the link pushes the setting across its range (negative values invert the modulation).');
    const linkSmoothBinding = pane.addBinding(link as unknown as Record<string, unknown>, 'smooth', { label: 'Smoothing', min: 0, max: 1, step: 0.01 });
    linkSmoothBinding.on('change', onEdit);
    this.attachHelp(linkSmoothBinding, 'Smoothing', 'How smoothly the setting follows the source. 0 follows instantly, 1 is very smooth.');
    if (link.source.startsWith('lfo')) {
      // LFO rate (slice: adjustable LFOs). Blank means the 0.5 Hz default.
      const rateBox = link as unknown as { rate?: number };
      if (rateBox.rate === undefined) rateBox.rate = LFO_RATE_DEFAULT;
      const lfoRateBinding = pane.addBinding(rateBox, 'rate', { label: 'LFO rate (Hz)', min: LFO_RATE_MIN, max: LFO_RATE_MAX, step: 0.05 });
      lfoRateBinding.on('change', onEdit);
      this.attachHelp(lfoRateBinding, 'LFO rate (Hz)', 'How many times per second the slow wave goes up and down.');
    }
    // The runner's keys are `${presetId}${L|F}…`, so the preset id goes in front.
    this.linkMonitor.value = target.meterKey ? this.opts.linkMeter?.(`${id}${target.meterKey}`) ?? 0 : 0;
    const linkMonitorBinding = pane.addBinding(this.linkMonitor, 'value', { label: 'Source now (0–1)', readonly: true, format: (v: number) => v.toFixed(2) });
    this.attachHelp(linkMonitorBinding, 'Source now (0–1)', 'The source level right now, from 0 to 1.');
    const removeLinkBtn = pane.addButton({ title: 'Remove audio link' });
    removeLinkBtn.on('click', () => {
      session.commit(id);
      delete (setting as Setting).link;
      this.bind(id);
    });
    this.attachHelp(removeLinkBtn, 'Remove audio link', 'Disconnect the audio or LFO link from this setting.');
  }

  /**
   * Warp field (Slice 18.4): a stack of up to four operators that bend the picture. One operator is open at a time:
   * its type, an on/off switch, and its settings (amount, scale, speed, centre). Edits show on the next frame.
   */
  private bindWarpEditor(
    pane: Pane,
    id: string,
    preset: Preset,
    makeReactiveCtx?: (applyFn: () => void) => ReactiveSectionContext,
  ): void {
    const session = this.opts.session;
    const live = () => session.sceneOf(id).setWarpOps(readWarpOps(preset));
    pane.addBlade({ view: 'separator' });
    const list = preset.warp ?? [];
    if (this.warpIndex >= list.length) this.warpIndex = Math.max(0, list.length - 1);
    if (list.length > 0) {
      const pick = { index: String(this.warpIndex) };
      const warpPickBinding = pane.addBinding(pick, 'index', {
        label: 'Warp operator',
        options: Object.fromEntries(list.map((op, i) => [describeWarpOperator(op, i), String(i)])),
      });
      warpPickBinding.on('change', (ev) => {
        this.warpIndex = Number(ev.value);
        this.bind(id);
      });
      this.attachHelp(warpPickBinding, 'Warp operator', 'Select which warp field operator in the stack (up to 4) to edit or remove.');
    }
    if (list.length < WARP_OP_MAX) {
      const typeBox = { type: this.warpAddType as string };
      const newWarpTypeBinding = pane.addBinding(typeBox, 'type', { label: 'New warp operator', options: warpTypeOptions() });
      newWarpTypeBinding.on('change', (ev) => {
        if (isWarpOpType(ev.value)) this.warpAddType = ev.value;
      });
      this.attachHelp(newWarpTypeBinding, 'New warp operator', 'Choose the warp operator effect type to add to the stack.');
      const addWarpBtn = pane.addButton({ title: 'Add warp operator' });
      addWarpBtn.on('click', () => {
        session.commit(id);
        const ops = (preset.warp ??= []);
        ops.push(newWarpOperator(this.warpAddType));
        this.warpIndex = ops.length - 1;
        live();
        this.bind(id);
      });
      this.attachHelp(addWarpBtn, 'Add warp operator', 'Append the chosen warp operator to the preset’s warp field stack.');
    }
    const op = list[this.warpIndex];
    if (!op) return;

    const onEdit = () => {
      session.commit(id);
      this.refreshDirtyState();
    };
    const typeBox = { type: op.type as string };
    const opTypeBinding = pane.addBinding(typeBox, 'type', { label: 'Operator type', options: warpTypeOptions() });
    opTypeBinding.on('change', (ev) => {
      if (!isWarpOpType(ev.value)) return;
      op.type = ev.value;
      fillWarpParams(op);
      live();
      onEdit();
      this.bind(id);
    });
    this.attachHelp(opTypeBinding, 'Operator type', 'Change the effect type of the currently selected warp operator.');
    const opEnabledBinding = pane.addBinding(op as unknown as Record<string, unknown>, 'enabled', { label: 'Operator on' });
    opEnabledBinding.on('change', () => {
      live();
      onEdit();
    });
    this.attachHelp(opEnabledBinding, 'Operator on', 'Enable or bypass this warp operator without removing it from the stack.');
    this.bindSection(
      pane,
      `Warp operator ${this.warpIndex + 1}: ${WARP_OP_LABELS[op.type]}`,
      warpOpSpecs(op.type),
      op.params,
      live,
      { section: `warp${this.warpIndex}`, layerIndex: null },
      makeReactiveCtx?.(live),
    );
    const removeWarpBtn = pane.addButton({ title: 'Remove warp operator' });
    removeWarpBtn.on('click', () => {
      session.commit(id);
      list.splice(this.warpIndex, 1);
      if (list.length === 0) delete preset.warp;
      live();
      this.bind(id);
    });
    this.attachHelp(removeWarpBtn, 'Remove warp operator', 'Delete the selected warp operator from the stack.');
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
    const reactionStyleBinding = pane.addBinding(styleBox, 'style', {
      label: 'Reaction style',
      options: reactionStyleOptions(),
    });
    reactionStyleBinding.on('change', (ev) => {
      const style = parseReactionStyle(ev.value);
      if (style) preset.reactionStyle = style;
      else delete preset.reactionStyle;
      session.commit(id);
    });
    this.attachHelp(reactionStyleBinding, 'Reaction style', 'Override the global reaction style for this preset, or follow the global setting.');

    const list = preset.reactions ?? [];
    if (this.reactionIndex >= list.length) this.reactionIndex = Math.max(0, list.length - 1);
    const targets = reactionTargets(preset);
    if (list.length > 0) {
      const pick = { index: String(this.reactionIndex) };
      const reactionPickBinding = pane.addBinding(pick, 'index', {
        label: 'Reaction',
        options: Object.fromEntries(list.map((r, i) => [`${i + 1}. ${describeReaction(r)}`, String(i)])),
      });
      reactionPickBinding.on('change', (ev) => {
        this.reactionIndex = Number(ev.value);
        this.bind(id);
      });
      this.attachHelp(reactionPickBinding, 'Reaction', 'Select which beat or section reaction rule to inspect, edit, or remove.');
    }
    if (list.length < MAX_REACTIONS) {
      const addReactionBtn = pane.addButton({ title: 'Add reaction' });
      addReactionBtn.on('click', () => {
        session.commit(id);
        const reactions = (preset.reactions ??= []);
        reactions.push(newReaction(targets[0]));
        this.reactionIndex = reactions.length - 1;
        this.bind(id);
      });
      this.attachHelp(addReactionBtn, 'Add reaction', 'Add a rule that nudges a Feedback or Post setting on a beat, a section change or a timer.');
    }
    const reaction = list[this.reactionIndex];
    if (!reaction) return;

    const onEdit = () => {
      session.commit(id);
      this.refreshDirtyState();
    };
    const trigger = { type: reaction.trigger.type as string };
    const whenBinding = pane.addBinding(trigger, 'type', {
      label: 'When',
      options: Object.fromEntries(TRIGGER_TYPES.map((t) => [TRIGGER_LABELS[t], t])),
    });
    whenBinding.on('change', (ev) => {
      reaction.trigger = triggerOf(String(ev.value) as TriggerType, reaction.trigger.n);
      onEdit();
      this.bind(id);
    });
    this.attachHelp(whenBinding, 'When', 'Event or rhythmic cadence that fires this reaction.');
    if (reaction.trigger.type === 'everyNBeats') {
      const everyBeatsBinding = pane.addBinding(reaction.trigger as unknown as Record<string, unknown>, 'n', { label: 'Every how many beats', min: 1, max: REACTION_EVERY_BEATS_MAX, step: 1 });
      everyBeatsBinding.on('change', onEdit);
      this.attachHelp(everyBeatsBinding, 'Every how many beats', 'Number of detected beats between each reaction trigger.');
    } else if (reaction.trigger.type === 'everyNSeconds') {
      const everySecBinding = pane.addBinding(reaction.trigger as unknown as Record<string, unknown>, 'n', { label: 'Every how many seconds', min: REACTION_EVERY_SECONDS_MIN, max: REACTION_EVERY_SECONDS_MAX, step: 0.25 });
      everySecBinding.on('change', onEdit);
      this.attachHelp(everySecBinding, 'Every how many seconds', 'Interval in seconds between each periodic reaction trigger.');
    }
    const responseBinding = pane.addBinding(reaction as unknown as Record<string, unknown>, 'response', {
      label: 'What happens',
      options: Object.fromEntries(RESPONSE_TYPES.map((r) => [RESPONSE_LABELS[r], r])),
    });
    responseBinding.on('change', onEdit);
    this.attachHelp(responseBinding, 'What happens', 'How the target control responds when triggered (Kick, Step, Flip, Drift, or Pick).');
    const where = { key: reactionTargetKey(reaction.target) };
    // A control that is hidden right now (for example Warp in a mode that does not use it) stays pickable if it is already chosen.
    const options = Object.fromEntries(targets.map((t) => [t.label, t.key]));
    if (!targets.some((t) => t.key === where.key)) options[`${reaction.target.group === 'post' ? 'Post' : 'Feedback'} · ${reaction.target.name}`] = where.key;
    const whichControlBinding = pane.addBinding(where, 'key', { label: 'Which control', options });
    whichControlBinding.on('change', (ev) => {
      const next = parseReactionTargetKey(String(ev.value));
      if (next) reaction.target = next;
      onEdit();
    });
    this.attachHelp(whichControlBinding, 'Which control', 'Feedback or Post parameter driven by this reaction.');
    const reactionAmountBinding = pane.addBinding(reaction as unknown as Record<string, unknown>, 'amount', { label: 'Amount (share of range)', min: -REACTION_AMOUNT_MAX, max: REACTION_AMOUNT_MAX, step: 0.01 });
    reactionAmountBinding.on('change', onEdit);
    this.attachHelp(reactionAmountBinding, 'Amount (share of range)', 'Strength and direction of the reaction across the target control’s range.');
    const reactionEaseBinding = pane.addBinding(reaction as unknown as Record<string, unknown>, 'ease', { label: 'Ease time (s)', min: 0, max: REACTION_EASE_MAX, step: 0.05 });
    reactionEaseBinding.on('change', onEdit);
    this.attachHelp(reactionEaseBinding, 'Ease time (s)', 'Time in seconds for the reaction impulse to settle or transition.');
    const removeReactionBtn = pane.addButton({ title: 'Remove reaction' });
    removeReactionBtn.on('click', () => {
      session.commit(id);
      list.splice(this.reactionIndex, 1);
      if (list.length === 0) delete preset.reactions;
      this.bind(id);
    });
    this.attachHelp(removeReactionBtn, 'Remove reaction', 'Delete the selected reaction rule from this preset.');
  }

  /** Morph the setting picked in the link editor: it swings between its value and a second value (slice E-c). */
  private bindMorphEditor(pane: Pane, id: string, preset: Preset): void {
    const target = linkTargets(preset).find((t) => t.key === this.linkTarget);
    if (!target || (target.spec.type !== 'float' && target.spec.type !== 'int')) return;
    const { spec, setting } = target;
    const session = this.opts.session;
    const onEdit = () => {
      session.commit(id);
      this.refreshDirtyState();
    };
    if (!setting.morph) {
      const addMorphBtn = pane.addButton({ title: 'Add morph (swing to a second value)' });
      addMorphBtn.on('click', () => {
        session.commit(id);
        setting.morph = { to: morphTargetFor(spec, setting.value), rate: MORPH_RATE_DEFAULT };
        this.bind(id);
      });
      this.attachHelp(addMorphBtn, 'Add morph', 'Swing the chosen setting back and forth between its value and a second value.');
      return;
    }
    const morph = setting.morph;
    const morphToBinding = pane.addBinding(morph as unknown as Record<string, unknown>, 'to', {
      label: 'Morph to',
      min: spec.min,
      max: spec.max,
      step: spec.step,
    });
    morphToBinding.on('change', onEdit);
    this.attachHelp(morphToBinding, 'Morph to', 'Second target value that the setting smoothly swings toward and back from.');
    const morphRateBinding = pane.addBinding(morph as unknown as Record<string, unknown>, 'rate', {
      label: 'Morph rate (cycles/s)',
      min: MORPH_RATE_MIN,
      max: MORPH_RATE_MAX,
      step: 0.01,
    });
    morphRateBinding.on('change', onEdit);
    this.attachHelp(morphRateBinding, 'Morph rate (cycles/s)', 'How many full back-and-forth swings per second.');
    const removeMorphBtn = pane.addButton({ title: 'Remove morph' });
    removeMorphBtn.on('click', () => {
      session.commit(id);
      delete (setting as Setting).morph;
      this.bind(id);
    });
    this.attachHelp(removeMorphBtn, 'Remove morph', 'Stop morphing this setting and keep its base value.');
  }

  private bindActiveLinksOverview(pane: Pane, id: string, preset: Preset): void {
    const folder = pane.addFolder({ title: '⚡ Active Links', expanded: false });
    this.sectionFolders.push(folder);

    const folderEl = (folder as any).element as HTMLElement | undefined;
    const doc =
      folderEl?.ownerDocument ??
      this.body.ownerDocument ??
      (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    const host = doc.createElement('div');
    host.className = 'mv-active-links';
    const mount =
      (folderEl && typeof folderEl.querySelector === 'function' ? folderEl.querySelector('.tp-fldv_c') : null) ??
      folderEl ??
      this.body;
    if (mount && typeof mount.append === 'function') {
      mount.append(host);
    } else if (mount && typeof mount.appendChild === 'function') {
      mount.appendChild(host);
    }

    this.activeLinksHostEl = host;
    this.refreshActiveLinksOverview(id, preset);
  }

  private refreshActiveLinksOverview(id: string, preset: Preset): void {
    const host = this.activeLinksHostEl;
    if (!host) return;
    const doc =
      host.ownerDocument ??
      this.body.ownerDocument ??
      (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    if (typeof host.replaceChildren === 'function') {
      host.replaceChildren();
    } else {
      host.textContent = '';
    }

    const session = this.opts.session;
    const monitor = typeof session.monitorOf === 'function' ? session.monitorOf(id) : undefined;

    interface ActiveTargetEntry {
      label: string;
      setting: Setting;
      spec: ParamSpec;
      meterKey: string;
      warpIndex?: number;
    }

    const activeTargets: ActiveTargetEntry[] = [];
    let live = 0;
    preset.layers.forEach((layer, i) => {
      const k = isLayerRendered(layer, i, monitor) ? live++ : -1;
      const layerTitle = formatLayerTitle(layer, i);
      for (const spec of LAYER_SPECS[layer.type] ?? []) {
        if (!isLinkableSpecType(spec.type)) continue;
        const setting = layer.params[spec.name];
        if (!setting || (!setting.link && !setting.morph)) continue;
        activeTargets.push({
          label: `${layerTitle} · ${spec.label}`,
          setting,
          spec,
          meterKey: k >= 0 ? `L${k}.${spec.name}` : '',
        });
      }
    });
    (preset.warp ?? []).forEach((op, w) => {
      for (const spec of warpOpSpecs(op.type)) {
        if (!isLinkableSpecType(spec.type)) continue;
        const setting = op.params[spec.name];
        if (!setting || (!setting.link && !setting.morph)) continue;
        activeTargets.push({
          label: `Warp ${w + 1}. ${WARP_OP_LABELS[op.type]} · ${spec.label}`,
          setting,
          spec,
          meterKey: `W${w}.${spec.name}`,
          warpIndex: w,
        });
      }
    });
    for (const spec of SCHEMAS.feedback) {
      if (!isLinkableSpecType(spec.type)) continue;
      const setting = preset.feedback[spec.name];
      if (!setting || (!setting.link && !setting.morph)) continue;
      activeTargets.push({
        label: `Feedback · ${spec.label}`,
        setting,
        spec,
        meterKey: `F.${spec.name}`,
      });
    }
    for (const spec of SCHEMAS.post) {
      if (!isLinkableSpecType(spec.type)) continue;
      const setting = preset.post[spec.name];
      if (!setting || (!setting.link && !setting.morph)) continue;
      activeTargets.push({
        label: `Post · ${spec.label}`,
        setting,
        spec,
        meterKey: `P.${spec.name}`,
      });
    }

    const activeOpacityLayers = preset.layers
      .map((layer, index) => ({ layer, index }))
      .filter((item) => Boolean(item.layer.opacityLink));

    const totalActive = activeTargets.length + activeOpacityLayers.length;
    if (totalActive === 0) {
      const empty = doc.createElement('div');
      empty.className = 'mv-active-links-empty';
      empty.textContent = 'No reactive links yet. Tap ⚡ on any slider above.';
      host.append(empty);
      return;
    }

    const header = doc.createElement('div');
    header.className = 'mv-active-links-head';
    const count = doc.createElement('span');
    count.className = 'mv-active-links-count';
    count.textContent = `${totalActive} active`;

    const clearAllBtn = doc.createElement('button');
    clearAllBtn.type = 'button';
    clearAllBtn.className = 'mv-active-links-clear-all';
    clearAllBtn.textContent = 'Clear All';
    clearAllBtn.addEventListener?.('click', () => {
      for (const t of activeTargets) {
        delete t.setting.link;
        delete t.setting.morph;
      }
      for (const layer of preset.layers) {
        delete layer.opacityLink;
      }
      session.commit(id, Date.now(), true);
      this.refreshDirtyState();
      const scene = session.sceneOf(id);
      applyPresetToScene(preset, scene);
      scene.setWarpOps?.(readWarpOps(preset));
      session.refreshPost(id);
      for (const h of this.reactiveHandles) {
        h.syncVisual();
        h.updateLiveOverlay(undefined, false);
      }
      this.refreshActiveLinksOverview(id, preset);
      this.syncLiveOverlayLoop();
    });
    header.append(count, clearAllBtn);
    host.append(header);

    const items: Array<{
      label: string;
      summary: string;
      onJump: () => void;
      onRemove: () => void;
    }> = [];

    for (const { layer, index } of activeOpacityLayers) {
      const label = `${formatLayerTitle(layer, index)} · Opacity`;
      const summary = summarizeAudioLink(layer.opacityLink);
      items.push({
        label,
        summary,
        onJump: () => {
          if (this.selected !== index) {
            this.selected = index;
            this.bind(id);
          }
          const reg = this.reactiveTargets.get(`${id}L_opacity_${index}`);
          if (!reg) return;
          for (const f of reg.folders) {
            f.expanded = true;
          }
          reg.handle.openDrawer();
          if (reg.element && typeof (reg.element as any).scrollIntoView === 'function') {
            (reg.element as any).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        },
        onRemove: () => {
          delete layer.opacityLink;
          session.commit(id, Date.now(), true);
          this.refreshDirtyState();
          const reg = this.reactiveTargets.get(`${id}L_opacity_${index}`);
          if (reg?.apply) {
            reg.apply();
          } else {
            applyPresetToScene(preset, session.sceneOf(id));
          }
          if (reg) {
            reg.handle.syncVisual();
            reg.handle.updateLiveOverlay(undefined, false);
          }
          this.refreshActiveLinksOverview(id, preset);
          this.syncLiveOverlayLoop();
        },
      });
    }

    for (const target of activeTargets) {
      const summary =
        target.spec.type === 'enum' && target.setting.link && !target.setting.morph
          ? `${target.setting.link.source} · ${target.setting.link.cooldownSec ?? LINK_COOLDOWN_DEFAULT}s`
          : summarizeAudioLink(target.setting.link, target.setting.morph);
      items.push({
        label: target.label,
        summary,
        onJump: () => {
          if (target.warpIndex !== undefined && this.warpIndex !== target.warpIndex) {
            this.warpIndex = target.warpIndex;
            this.bind(id);
          }
          const reg = target.meterKey ? this.reactiveTargets.get(`${id}${target.meterKey}`) : undefined;
          if (!reg) return;
          for (const f of reg.folders) {
            f.expanded = true;
          }
          reg.handle.openDrawer();
          if (reg.element && typeof (reg.element as any).scrollIntoView === 'function') {
            (reg.element as any).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        },
        onRemove: () => {
          delete target.setting.link;
          delete target.setting.morph;
          session.commit(id, Date.now(), true);
          this.refreshDirtyState();
          const reg = target.meterKey ? this.reactiveTargets.get(`${id}${target.meterKey}`) : undefined;
          if (reg?.apply) {
            reg.apply();
          } else {
            const scene = session.sceneOf(id);
            applyPresetToScene(preset, scene);
            scene.setWarpOps?.(readWarpOps(preset));
            session.refreshPost(id);
          }
          if (reg) {
            reg.handle.syncVisual();
            reg.handle.updateLiveOverlay(undefined, false);
          }
          this.refreshActiveLinksOverview(id, preset);
          this.syncLiveOverlayLoop();
        },
      });
    }

    const list = doc.createElement('div');
    list.className = 'mv-active-links-list';
    for (const item of items) {
      const row = doc.createElement('div');
      row.className = 'mv-active-links-row';

      const jumpBtn = doc.createElement('button');
      jumpBtn.type = 'button';
      jumpBtn.className = 'mv-active-links-jump';
      jumpBtn.title = `Jump to ${item.label}`;

      const labelSpan = doc.createElement('span');
      labelSpan.className = 'mv-active-links-label';
      labelSpan.textContent = item.label;

      const summarySpan = doc.createElement('span');
      summarySpan.className = 'mv-active-links-summary';
      summarySpan.textContent = item.summary;

      jumpBtn.append(labelSpan, summarySpan);
      jumpBtn.addEventListener?.('click', item.onJump);

      const removeBtn = doc.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'mv-active-links-remove';
      removeBtn.textContent = '×';
      removeBtn.title = `Remove ${item.label} reactivity`;
      removeBtn.setAttribute?.('aria-label', `Remove ${item.label} reactivity`);
      removeBtn.addEventListener?.('click', item.onRemove);

      row.append(jumpBtn, removeBtn);
      list.append(row);
    }
    host.append(list);
  }

  private disposeReactiveHandles(): void {
    for (const h of this.reactiveHandles) {
      h.dispose();
    }
    this.reactiveHandles = [];
  }

  private hasActiveReactiveLinks(): boolean {
    if (!this.id || this.reactiveHandles.length === 0) return false;
    const entry = this.opts.session.get(this.id);
    return Boolean(entry && hasLinks(entry.preset));
  }

  private syncLiveOverlayLoop(): void {
    const shouldRun =
      this.visible &&
      typeof requestAnimationFrame === 'function' &&
      this.hasActiveReactiveLinks();
    if (!shouldRun) {
      this.stopLiveOverlayLoop();
      return;
    }
    if (this.rafId !== null) return;
    const tick = () => {
      if (!this.visible || !this.hasActiveReactiveLinks()) {
        this.rafId = null;
        return;
      }
      const calm = this.opts.isCalm?.() ?? false;
      for (const h of this.reactiveHandles) {
        h.updateLiveOverlay(this.opts.linkResolved?.(h.meterKey), calm);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLiveOverlayLoop(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    for (const h of this.reactiveHandles) {
      h.updateLiveOverlay(undefined, false);
    }
  }

  private bindSection(
    pane: Pane,
    title: string,
    specs: readonly ParamSpec[],
    settings: Settings,
    apply: () => void,
    edit: { section: string; layerIndex: number | null },
    reactiveCtx?: ReactiveSectionContext,
  ): void {
    const onEdit = this.opts.onEdit;
    const res = bindSection(
      pane,
      title,
      specs,
      settings,
      apply,
      () => {
        this.opts.session.commit(this.id);
        this.refreshDirtyState();
      },
      (spec) => renderHelperContent(this.helperBar, spec),
      onEdit
        ? (spec, value) => onEdit({ presetId: this.id, section: edit.section, layerIndex: edit.layerIndex, name: spec.name, value })
        : undefined,
      reactiveCtx,
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

  /** Preset whose Feedback and Post look the Mashup button copies. */
  private mashupFrom = '';

  /** Other presets the Mashup can copy a look from, as { label: id }. A repeated name gets its id added. */
  private mashupOptions(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.opts.session.list()) {
      if (e.id === this.id) continue;
      const label = out[e.preset.name] === undefined ? e.preset.name : `${e.preset.name} (${e.id})`;
      out[label] = e.id;
    }
    return out;
  }

  /** Copies the chosen preset's look (Feedback, Post, warp, reactions) onto this preset's layers, as one undo step. */
  private mashup(): void {
    const session = this.opts.session;
    const entry = session.get(this.id);
    const source = session.get(this.mashupFrom);
    if (!entry || !source || source.id === entry.id) {
      showToast('Pick a different preset to take the look from');
      return;
    }
    applyMashup(entry.preset, source.preset);
    session.commit(this.id, Date.now(), true);
    session.rebuild(this.id);
    this.bind(this.id);
    showToast(`Look taken from ${source.preset.name} (undo to go back)`);
  }

  /** Seed for "Randomise this layer". 0 picks a new one each click. */
  private layerSeed = 0;

  /** Randomise only the selected layer from a seed (repeatable), as one undo step. */
  private varyLayer(): void {
    const session = this.opts.session;
    const entry = session.get(this.id);
    const layer = entry?.preset.layers[this.selected];
    if (!entry || !layer) return;
    const seed = this.layerSeed > 0 ? this.layerSeed : newLayerSeed();
    layer.params = randomiseLayerSettings(layer.params, LAYER_SPECS[layer.type] ?? [], seed);
    session.commit(this.id, Date.now(), true);
    session.rebuild(this.id);
    this.bind(this.id);
    showToast(`Layer randomised with seed ${seed} (type it in Layer seed to repeat)`);
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
    this.closeInlinePrompt();
    const doc = this.getDoc();
    if (!doc) return;
    const session = this.opts.session;
    const field = doc.createElement('div');
    field.style.display = 'flex';
    field.style.flexWrap = 'wrap';
    field.style.gap = '6px';
    field.style.padding = '6px';
    const input = doc.createElement('input');
    input.type = 'text';
    input.value = defaultName;
    input.setAttribute('aria-label', 'Name for the new preset');
    const msg = doc.createElement('span');
    msg.setAttribute('role', 'alert');
    const ok = doc.createElement('button');
    ok.type = 'button';
    ok.textContent = 'OK';
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const submit = () => {
      const check = validatePresetName(input.value);
      if (!check.ok) {
        msg.textContent = check.message;
        (input as any).focus?.();
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
    this.attachHelp(input, 'New preset name', 'Enter a name for the new copy of this preset.');
    this.attachHelp(ok, 'Confirm Save as', 'Save the preset under the typed name.');
    this.attachHelp(cancel, 'Cancel Save as', 'Close the name prompt without saving a copy.');
    field.append(input, ok, cancel, msg);
    if (typeof (this.body as any).prepend === 'function') {
      (this.body as any).prepend(field);
    } else if (this.body.firstChild && typeof (this.body.firstChild as any).before === 'function') {
      (this.body.firstChild as any).before(field);
    } else {
      this.body.append(field);
    }
    this.saveAsField = field;
    (input as any).focus?.();
    (input as any).select?.();
  }

  private closeSaveAsField(): void {
    if (!this.saveAsField) return;
    if (typeof (this.saveAsField as any).remove === 'function') {
      (this.saveAsField as any).remove();
    } else {
      this.saveAsField.parentElement?.removeChild?.(this.saveAsField);
    }
    this.saveAsField = null;
  }

  /** First tap arms Delete for DELETE_CONFIRM_MS. A tap inside that window deletes. */
  private onDeleteTap(btn: ButtonApi, id: string): void {
    const step = nextDeleteTap(this.deleteArmedAt, Date.now());
    this.disarmDelete();
    if (step.confirm) {
      const isBuiltin = Boolean(this.opts.session.get(id)?.builtin);
      if (isBuiltin) {
        this.runAdmin(() => {
          if (typeof this.opts.session.removeSystemPreset === 'function') {
            deleteSystemPresetAction(this.opts.session, id);
          } else {
            this.opts.session.remove(id);
            showToast('System preset removed locally (remote sync offline)');
          }
          const remaining = this.opts.session.list();
          const nextId = this.opts.session.shownId ?? remaining.find((e) => e.id !== id)?.id ?? 'crown';
          this.opts.switchTo(nextId);
        });
      } else {
        this.run(() => {
          this.opts.session.remove(id);
          this.opts.switchTo('crown');
        }, 'Deleted');
      }
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

  private formatSaveTitle(id: string, isSystemAdmin: boolean): string {
    const dirty = this.opts.session.isDirty(id) ? ' *' : '';
    return isSystemAdmin ? `Save System Preset${dirty}` : `Save${dirty}`;
  }

  private refreshDirtyState(): void {
    if (!this.id) return;
    const entry = this.opts.session.get(this.id);
    if (!entry) return;
    if (this.saveBtn && !(entry.builtin && !this.isAdmin())) {
      const nextTitle = this.formatSaveTitle(this.id, entry.builtin && this.isAdmin());
      if (this.saveBtn.title !== nextTitle) {
        this.saveBtn.title = nextTitle;
      }
    }
    if (this.undoBtn && typeof this.opts.session.canUndo === 'function') {
      this.undoBtn.disabled = !this.opts.session.canUndo(this.id);
    }
    if (this.redoBtn && typeof this.opts.session.canRedo === 'function') {
      this.redoBtn.disabled = !this.opts.session.canRedo(this.id);
    }
  }

  private runAdmin(action: () => void): void {
    try {
      action();
      const stillThere = this.opts.session.get(this.id) ? this.id : 'crown';
      this.bind(stillThere);
    } catch (err) {
      showToast((err as Error).message);
    }
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
        showToast(assetImportMessage(res));
        if (res.kind === 'preset' && res.id) this.opts.switchTo(res.id);
      } catch (err) {
        showToast((err as Error).message);
      }
    });
    input.click();
  }
}

/** Descriptive title for layer settings sections (e.g. "1. Shape (circle · bars)", "2. Spectral Terrain"). */
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
  return `${index + 1}. ${formatLayerType(layer.type)}`;
}

/** Layer dropdown label in Studio (e.g. "1. Shape (circle · bars)" or "2. Spectral Terrain (off)"). */
export function formatLayerLabel(layer: LayerEntry, index: number): string {
  const off = layer.enabled ? '' : ' (off)';
  return `${formatLayerTitle(layer, index)}${off}`;
}

// --- Warp field (Slice 18.4) -------------------------------------------------------------

/** Operator type choices, labelled for people. */
export function warpTypeOptions(): Record<string, string> {
  return Object.fromEntries(WARP_OP_TYPES.map((t) => [WARP_OP_LABELS[t], t]));
}

/** A new operator with every setting at its default, switched on. */
export function newWarpOperator(type: WarpOpType): WarpOperator {
  const params: Settings = {};
  for (const spec of warpOpSpecs(type)) params[spec.name] = { value: spec.default };
  return { type, enabled: true, params };
}

/** After an operator's type changes: adds the settings the new type has and the old one did not (for example Curl noise's flow style). */
export function fillWarpParams(op: WarpOperator): void {
  for (const spec of warpOpSpecs(op.type)) {
    if (!(spec.name in op.params)) op.params[spec.name] = { value: spec.default };
  }
}

/** One line for the operator list, for example "2. Swirl (off)". */
export function describeWarpOperator(op: WarpOperator, index: number): string {
  return `${index + 1}. ${WARP_OP_LABELS[op.type]}${op.enabled ? '' : ' (off)'}`;
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

function formatLinkTargetLabel(baseLabel: string, setting: Setting): string {
  const hasLink = setting.link !== undefined;
  const hasMorph = setting.morph !== undefined;
  if (hasLink && hasMorph) return `[Linked & Morphed] ${baseLabel}`;
  if (hasLink) return `[Linked] ${baseLabel}`;
  if (hasMorph) return `[Morphed] ${baseLabel}`;
  return baseLabel;
}

/** Every numeric setting that can take a link, with the key used in the Studio and the link meter key. */
export function linkTargets(preset: Preset): { key: string; label: string; setting: Setting; meterKey: string; spec: ParamSpec }[] {
  const out: { key: string; label: string; setting: Setting; meterKey: string; spec: ParamSpec }[] = [];
  let live = 0;
  preset.layers.forEach((layer, i) => {
    const k = layer.enabled ? live++ : -1;
    const layerTitle = formatLayerTitle(layer, i);
    for (const spec of LAYER_SPECS[layer.type] ?? []) {
      if (spec.type !== 'float' && spec.type !== 'int') continue;
      if (!isSpecVisible(spec, layer.params)) continue;
      const setting = layer.params[spec.name];
      if (!setting) continue;
      out.push({
        key: `L${i}.${spec.name}`,
        label: formatLinkTargetLabel(`${layerTitle} · ${spec.label}`, setting),
        setting,
        meterKey: k >= 0 ? `L${k}.${spec.name}` : '',
        spec,
      });
    }
  });
  (preset.warp ?? []).forEach((op, i) => {
    for (const spec of warpOpSpecs(op.type)) {
      if (spec.type !== 'float' && spec.type !== 'int') continue;
      const setting = op.params[spec.name];
      if (!setting) continue;
      out.push({
        key: `W${i}.${spec.name}`,
        label: formatLinkTargetLabel(`Warp ${i + 1}. ${WARP_OP_LABELS[op.type]} · ${spec.label}`, setting),
        setting,
        meterKey: `W${i}.${spec.name}`,
        spec,
      });
    }
  });
  for (const spec of FEEDBACK_NUMBERS) {
    if (!isSpecVisible(spec, preset.feedback)) continue;
    const setting = preset.feedback[spec.name];
    if (setting) out.push({ key: `F.${spec.name}`, label: formatLinkTargetLabel(`Feedback · ${spec.label}`, setting), setting, meterKey: `F.${spec.name}`, spec });
  }
  for (const spec of POST_NUMBERS) {
    if (!isSpecVisible(spec, preset.post)) continue;
    const setting = preset.post[spec.name];
    if (setting) out.push({ key: `P.${spec.name}`, label: formatLinkTargetLabel(`Post · ${spec.label}`, setting), setting, meterKey: `P.${spec.name}`, spec });
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
  onEdit?: () => void,
  opacityReactive?: OpacityReactiveOptions,
): { opacityBinding: any; blendBinding: any; trailsBinding: any } {
  let opacityHandle: ReactiveSliderHandle | null = null;
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
    onEdit?.();
    opacityHandle?.syncVisual();
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

  if (opacityReactive && opacityBinding) {
    const opacitySetting: Setting = {
      get value() {
        return entry.opacity;
      },
      set value(v: ParamValue) {
        entry.opacity = Number(v);
      },
      get link() {
        return entry.opacityLink;
      },
      set link(l: AudioLink | undefined) {
        if (l) entry.opacityLink = l;
        else delete entry.opacityLink;
      },
    };
    opacityHandle = attachReactiveSlider({
      blade: opacityBinding,
      spec: OPACITY_SPEC,
      setting: opacitySetting,
      meterKey: opacityReactive.meterKey,
      allowMorph: false,
      onClear: () => {
        delete entry.opacityLink;
      },
      onMutate: opacityReactive.onMutate,
      onDrawerToggle: opacityReactive.onDrawerToggle,
    });
    opacityReactive.registerHandle?.(opacityHandle);
    opacityReactive.onRegisterTarget?.(opacityHandle, opacityBinding?.element);
  }

  const blendKey = (BLEND_SPEC as any).key ?? BLEND_SPEC.name;
  const blendBinding = pane.addBinding(entry as unknown as Record<string, unknown>, blendKey, {
    label: BLEND_SPEC.label,
    options: Object.fromEntries(BLEND_MODES.map((b) => [formatEnumOptionLabel(b), b])),
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
  onEdit?: (spec: ParamSpec, value: number | boolean | string) => void,
  reactiveCtx?: ReactiveSectionContext,
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
  const reactiveHandles: Array<{ spec: ParamSpec; handle: ReactiveSliderHandle }> = [];
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
    for (const { spec, handle } of reactiveHandles) {
      if (!isSpecShown(spec, holder, viewNow())) {
        handle.closeDrawer();
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
    attachControlHelper(
      viewBinding,
      {
        label: 'View',
        description: 'Basic shows the main controls. Advanced shows every setting in each section.',
      },
      onHelperUpdate as ((info: ParamSpec | ControlHelperDescriptor | null) => void) | undefined,
    );
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
      let reactiveHandle: ReactiveSliderHandle | null = null;
      const existingSetting = settings[spec.name];
      const settingObj: Setting =
        existingSetting !== null && typeof existingSetting === 'object' && 'value' in existingSetting
          ? (existingSetting as Setting)
          : { value: holder[spec.name] };
      const push = () => {
        onCommit?.();
        const s = settings[spec.name];
        if (s !== null && typeof s === 'object' && 'value' in s && !Array.isArray(s)) {
          s.value = holder[spec.name]!;
        } else if (reactiveCtx && isLinkableSpecType(spec.type)) {
          settingObj.value = holder[spec.name]!;
          (settings as Settings)[spec.name] = settingObj;
        } else {
          (settings as any)[spec.name] = holder[spec.name]!;
        }
        updateVisibility();
        apply?.();
        reactiveHandle?.syncVisual();
        const value = holder[spec.name];
        if (onEdit && (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')) {
          onEdit(spec, value);
        }
      };
      const binding = bindSpec(target, spec.label, spec, holder, push, onHelperUpdate);
      const blades = Array.isArray(binding) ? binding : [binding];
      const entry = { spec, blades };
      specBindings.push(entry);
      members.push(entry);

      if (reactiveCtx && isLinkableSpecType(spec.type) && blades[0]) {
        const scope = reactiveCtx.scopeForSpec ? reactiveCtx.scopeForSpec(spec.name) : reactiveCtx.scopePrefix;
        const meterKey = `${scope}.${spec.name}`;
        reactiveHandle = attachReactiveSlider({
          blade: blades[0],
          spec: spec as any,
          setting: settingObj,
          meterKey,
          onMutate: (discrete) => {
            if (settings[spec.name] !== settingObj) {
              settingObj.value = holder[spec.name]!;
              (settings as Settings)[spec.name] = settingObj;
            }
            reactiveCtx.onReactiveMutate?.(discrete, apply);
          },
          onDrawerToggle: reactiveCtx.onDrawerToggle,
        });
        reactiveHandles.push({ spec, handle: reactiveHandle });
        reactiveCtx.registerHandle?.(reactiveHandle);
        const owningFolders: Array<{ expanded: boolean }> = [];
        if (sectionFolder && sectionFolder !== pane) owningFolders.push(sectionFolder);
        if (target && target !== sectionFolder && target !== pane) owningFolders.push(target);
        reactiveCtx.onRegisterTarget?.(meterKey, reactiveHandle, owningFolders, blades[0]?.element, apply);
      }
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
      result = pane.addBinding(target, key, { label, options: Object.fromEntries(spec.options.map((o) => [formatEnumOptionLabel(o), o])) }).on('change', onChange);
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
  onHelperUpdate?: (info: ControlHelperDescriptor | null) => void,
) {
  const initial = director.getSettings();
  const settings = {
    ...initial,
    customTint: Boolean(initial.customTint),
    customShadowTint: initial.customShadowTint ?? DEFAULT_CUSTOM_SHADOW_TINT,
    customHighlightTint: initial.customHighlightTint ?? DEFAULT_CUSTOM_HIGHLIGHT_TINT,
  };
  let syncing = false;
  let experienceModeBinding: any;
  let cameraModeBinding: any;
  let cameraIntensityBinding: any;
  let colorMoodBinding: any;
  let colorIntensityBinding: any;
  let customTintBinding: any;
  let customShadowTintBinding: any;
  let customHighlightTintBinding: any;
  let triggerCadenceBinding: any;

  const updateCustomTintVisibility = () => {
    const show = Boolean(settings.customTint);
    if (customShadowTintBinding) customShadowTintBinding.hidden = !show;
    if (customHighlightTintBinding) customHighlightTintBinding.hidden = !show;
  };

  const syncFromDirector = () => {
    if (syncing) return;
    syncing = true;
    try {
      const next = director.getSettings();
      Object.assign(settings, next, {
        customTint: Boolean(next.customTint),
        customShadowTint: next.customShadowTint ?? DEFAULT_CUSTOM_SHADOW_TINT,
        customHighlightTint: next.customHighlightTint ?? DEFAULT_CUSTOM_HIGHLIGHT_TINT,
      });
      experienceModeBinding?.refresh?.();
      cameraModeBinding?.refresh?.();
      cameraIntensityBinding?.refresh?.();
      colorMoodBinding?.refresh?.();
      colorIntensityBinding?.refresh?.();
      customTintBinding?.refresh?.();
      customShadowTintBinding?.refresh?.();
      customHighlightTintBinding?.refresh?.();
      updateCustomTintVisibility();
      triggerCadenceBinding?.refresh?.();
    } finally {
      syncing = false;
    }
  };

  experienceModeBinding = folder.addBinding(settings, 'experienceMode', {
    label: 'Experience mode',
    options: {
      'Cinematic': 'cinematic',
      'Calm': 'calm',
      'Minimal': 'minimal',
      'Color Walk': 'colorWalk',
      'Custom': 'custom',
    },
  });
  experienceModeBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.setExperienceMode(ev.value as ExperienceMode);
    syncFromDirector();
  });
  attachControlHelper(
    experienceModeBinding,
    {
      label: 'Experience mode',
      description: 'A ready-made camera and colour setup. Cinematic moves and recolours, Calm is gentle, Minimal leaves the preset alone, Color Walk keeps still and shifts colour. Custom is your own mix.',
    },
    onHelperUpdate,
  );

  cameraModeBinding = folder.addBinding(settings, 'cameraMode', {
    label: 'Camera motion',
    options: {
      'Auto': 'auto',
      'Crane sway': 'craneSway',
      'Dutch roll': 'dutchRoll',
      'Push in and out': 'breathingPush',
      'Horizon tilt': 'horizonTilt',
      'Still anchor': 'stillAnchor',
      'Off': 'off',
    },
  });
  cameraModeBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.updateSettings({ cameraMode: ev.value as CameraMode });
    syncFromDirector();
  });
  attachControlHelper(
    cameraModeBinding,
    {
      label: 'Camera motion',
      description: 'How the camera moves over the picture. Auto picks a move that suits each preset.',
    },
    onHelperUpdate,
  );

  cameraIntensityBinding = folder.addBinding(settings, 'cameraIntensity', {
    label: 'Camera intensity',
    min: 0,
    max: 1,
    step: 0.05,
  });
  cameraIntensityBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.updateSettings({ cameraIntensity: Number(ev.value) });
    syncFromDirector();
  });
  attachControlHelper(
    cameraIntensityBinding,
    {
      label: 'Camera intensity',
      description: 'How far the camera moves. 0 keeps it still.',
    },
    onHelperUpdate,
  );

  colorMoodBinding = folder.addBinding(settings, 'colorMood', {
    label: 'Color mood',
    options: {
      'Auto-cycle': 'auto',
      'Native (preset)': 'native',
      'Cyberpunk': 'cyberpunk',
      'Ember': 'ember',
      'Bioluminescent': 'biolum',
      'Vapor': 'vapor',
      'Prismatic': 'prismatic',
      'Monochrome Noir': 'noir',
      'Acid Neon': 'acid',
      'Nordic Aurora': 'aurora',
      'Deep Sunset': 'sunset',
    },
  });
  colorMoodBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.updateSettings({ colorMood: ev.value as ColorMood });
    syncFromDirector();
  });
  attachControlHelper(
    colorMoodBinding,
    {
      label: 'Color mood',
      description: 'Tints the picture with a colour palette. Auto changes palettes over time; Native keeps the preset colours.',
    },
    onHelperUpdate,
  );

  colorIntensityBinding = folder.addBinding(settings, 'colorIntensity', {
    label: 'Color intensity',
    min: 0,
    max: 1,
    step: 0.05,
  });
  colorIntensityBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.updateSettings({ colorIntensity: Number(ev.value) });
    syncFromDirector();
  });
  attachControlHelper(
    colorIntensityBinding,
    {
      label: 'Color intensity',
      description: 'How strongly the palette tints the picture. 0 leaves the preset colours alone.',
    },
    onHelperUpdate,
  );

  customTintBinding = folder.addBinding(settings, 'customTint', {
    label: 'Custom tint',
  });
  customTintBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.updateSettings({ customTint: Boolean(ev.value) });
    syncFromDirector();
  });
  attachControlHelper(
    customTintBinding,
    {
      label: 'Custom tint',
      description: 'Use your own two colours instead of the palette: one for dark areas, one for bright areas.',
    },
    onHelperUpdate,
  );

  customShadowTintBinding = folder.addBinding(settings, 'customShadowTint', {
    label: 'Shadow tint',
    view: 'color',
  });
  customShadowTintBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.updateSettings({ customShadowTint: String(ev.value) });
    syncFromDirector();
  });
  attachControlHelper(
    customShadowTintBinding,
    {
      label: 'Shadow tint',
      description: 'The colour for dark areas when Custom tint is on.',
    },
    onHelperUpdate,
  );

  customHighlightTintBinding = folder.addBinding(settings, 'customHighlightTint', {
    label: 'Highlight tint',
    view: 'color',
  });
  customHighlightTintBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.updateSettings({ customHighlightTint: String(ev.value) });
    syncFromDirector();
  });
  attachControlHelper(
    customHighlightTintBinding,
    {
      label: 'Highlight tint',
      description: 'The colour for bright areas when Custom tint is on.',
    },
    onHelperUpdate,
  );

  updateCustomTintVisibility();

  triggerCadenceBinding = folder.addBinding(settings, 'triggerCadence', {
    label: 'Transition trigger',
    options: {
      'Song section (35s+)': 'section',
      'Every 32 beats': 'beats32',
      'Every 64 beats': 'beats64',
      'Every 128 beats': 'beats128',
      'Timer (45s)': 'timer45',
    },
  });
  triggerCadenceBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.updateSettings({ triggerCadence: ev.value as TriggerCadence });
    syncFromDirector();
  });
  attachControlHelper(
    triggerCadenceBinding,
    {
      label: 'Transition trigger',
      description: 'When Camera or Color mood is Auto, how often they change: at a new song section, every 32, 64 or 128 beats, or every 45 seconds. This does not switch presets.',
    },
    onHelperUpdate,
  );

  const unsubscribe =
    typeof director.subscribeExperienceChange === 'function'
      ? director.subscribeExperienceChange(() => {
          syncFromDirector();
        })
      : () => {};

  return {
    experienceModeBinding,
    cameraModeBinding,
    cameraIntensityBinding,
    colorMoodBinding,
    colorIntensityBinding,
    customTintBinding,
    customShadowTintBinding,
    customHighlightTintBinding,
    triggerCadenceBinding,
    unsubscribe,
  };
}
