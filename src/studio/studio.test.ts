import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as toastModule from '../ui/toast';
import {
  DELETE_CONFIRM_MS,
  deleteAnnouncement,
  nextDeleteTap,
  validatePresetName,
  buildLayerControls,
  bindSpec,
  buildGlobalDirectorControls,
  DEFAULT_ADD_LAYER_TYPE,
  defaultLayer,
  formatLayerTitle,
  formatLayerLabel,
  bindSection,
  mergeSettings,
  linkTargets,
  STUDIO_HELPER_IDLE_TEXT,
  renderHelperContent,
  attachSpecHelper,
  SYSTEM_OPTGROUP_LABELS,
  renderPresetSelectHierarchy,
  Studio,
  loadStudioView,
  saveStudioView,
  isSpecShown,
  STUDIO_VIEW_KEY,
} from './studio';
import { getGlobalDirector, resetGlobalDirector } from '../render/globalDirector';
import { Scene } from '../render/scene';
import type { Preset, LayerEntry } from '../presets/format';
import type { Vec3Spec } from '../presets/schema';
import { LAYER_SPECS, POST_SPECS, tierOf } from '../presets/layerSchemas';
import type { ParamSpec } from '../presets/schema';
import { FEEDBACK_POST_LAYOUT, feedbackPostGroupOf, layoutFeedbackPost } from '../presets/schema';
import { ALL_PRESETS, SCHEMAS } from '../presets/builtin';
import { isMainSilent, NOOP_SCENE_HOST, POPOUT_WAITING_TEXT, readShownPreset } from './popoutMain';
import { parsePreset } from '../presets/format';
import { AdminGateway } from '../presets/adminGateway';
import {
  ADMIN_BADGE_LABEL,
  renderAdminBadge,
  promptAdminLogin,
  adminLogout,
  saveSystemPresetAction,
  deleteSystemPresetAction,
  promoteUserPresetAction,
  ADMIN_POPUP_TIMEOUT_MS,
  ADMIN_PRECHECK_TIMEOUT_MS,
} from './adminControls';

describe('deleteAnnouncement (slice 11.4)', () => {
  it('announces "Tap again" while Delete is armed', () => {
    expect(deleteAnnouncement(true)).toBe('Tap again to delete');
  });

  it('is empty when Delete is idle, so nothing is announced after a disarm', () => {
    expect(deleteAnnouncement(false)).toBe('');
  });
});

describe('validatePresetName', () => {
  it('trims a normal name', () => {
    expect(validatePresetName('  My preset  ')).toEqual({ ok: true, name: 'My preset' });
  });

  it('rejects an empty name', () => {
    expect(validatePresetName('').ok).toBe(false);
  });

  it('rejects a whitespace-only name', () => {
    expect(validatePresetName(' \t  ').ok).toBe(false);
  });

  it('gives a message when rejecting', () => {
    const r = validatePresetName('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message.length).toBeGreaterThan(0);
  });
});

describe('nextDeleteTap', () => {
  it('first tap arms and records the time', () => {
    expect(nextDeleteTap(null, 1000)).toEqual({ confirm: false, armedAt: 1000 });
  });

  it('second tap inside the window confirms and disarms', () => {
    expect(nextDeleteTap(1000, 1000 + DELETE_CONFIRM_MS - 1)).toEqual({ confirm: true, armedAt: null });
  });

  it('second tap at exactly the window edge does not confirm, and re-arms', () => {
    expect(nextDeleteTap(1000, 1000 + DELETE_CONFIRM_MS)).toEqual({ confirm: false, armedAt: 1000 + DELETE_CONFIRM_MS });
  });

  it('a tap after the window re-arms instead of deleting', () => {
    expect(nextDeleteTap(1000, 10_000)).toEqual({ confirm: false, armedAt: 10_000 });
  });

  it('a clock that goes backwards does not confirm', () => {
    expect(nextDeleteTap(5000, 1000).confirm).toBe(false);
  });

  it('the window is 3 seconds', () => {
    expect(DELETE_CONFIRM_MS).toBe(3000);
  });
});

interface MockElement {
  tagName: string;
  className: string;
  textContent: string;
  attributes: Record<string, string>;
  children: MockElement[];
  eventListeners: Record<string, ((ev: any) => void)[]>;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  append(...nodes: (MockElement | string)[]): void;
  appendChild(node: MockElement): MockElement;
  removeChild?(node: MockElement): MockElement;
  replaceChildren(...nodes: (MockElement | string)[]): void;
  addEventListener(evt: string, fn: (ev: any) => void): void;
  dispatchEvent(evt: { type: string; [key: string]: any }): boolean;
  querySelector(sel: string): MockElement | null;
  querySelectorAll(sel: string): MockElement[];
  contains(node: any): boolean;
  classList: {
    add(...cls: string[]): void;
    remove(...cls: string[]): void;
    contains(c: string): boolean;
  };
  title?: string;
  hidden?: boolean;
  ownerDocument?: any;
  value?: string;
  label?: string;
  selected?: boolean;
  firstChild?: MockElement | null;
  parentElement?: MockElement | null;
  before?(...nodes: any[]): void;
}

function createMockElement(tagName: string): MockElement {
  let _text = '';
  let _value = '';
  let _label = '';
  let _selected = false;
  const el: MockElement = {
    tagName: tagName.toUpperCase(),
    className: '',
    get textContent(): string {
      if (el.children.length > 0) {
        return el.children.map((c) => c.textContent).join('');
      }
      return _text;
    },
    set textContent(v: string) {
      _text = v;
      el.children = [];
    },
    get value(): string {
      return el.attributes['value'] ?? _value;
    },
    set value(v: string) {
      _value = v;
      el.attributes['value'] = v;
    },
    get label(): string {
      return el.attributes['label'] ?? _label;
    },
    set label(v: string) {
      _label = v;
      el.attributes['label'] = v;
    },
    get selected(): boolean {
      return el.attributes['selected'] !== undefined ? true : _selected;
    },
    set selected(v: boolean) {
      _selected = v;
      if (v) el.attributes['selected'] = 'selected';
      else delete el.attributes['selected'];
    },
    get firstChild(): MockElement | null {
      return el.children[0] ?? null;
    },
    attributes: {},
    children: [],
    eventListeners: {},
    get classList() {
      const getTokens = () => (el.className ? el.className.split(/\s+/).filter(Boolean) : []);
      return {
        add: (...cls: string[]) => {
          const tokens = new Set(getTokens());
          for (const c of cls) tokens.add(c);
          el.className = Array.from(tokens).join(' ');
        },
        remove: (...cls: string[]) => {
          const tokens = new Set(getTokens());
          for (const c of cls) tokens.delete(c);
          el.className = Array.from(tokens).join(' ');
        },
        contains: (c: string) => getTokens().includes(c),
      };
    },
    setAttribute(k: string, v: string) {
      el.attributes[k] = v;
      if (k === 'class') el.className = v;
      if (k === 'value') _value = v;
      if (k === 'label') _label = v;
      if (k === 'selected') _selected = true;
    },
    getAttribute(k: string) {
      return el.attributes[k] ?? null;
    },
    append(...nodes: (MockElement | string)[]) {
      for (const node of nodes) {
        if (typeof node === 'string') {
          const textNode = createMockElement('span');
          textNode.textContent = node;
          textNode.parentElement = el;
          el.children.push(textNode);
        } else if (node) {
          node.parentElement = el;
          el.children.push(node);
        }
      }
    },
    appendChild(node: MockElement) {
      node.parentElement = el;
      el.children.push(node);
      return node;
    },
    removeChild(node: MockElement) {
      const idx = el.children.indexOf(node);
      if (idx !== -1) {
        node.parentElement = null;
        el.children.splice(idx, 1);
      }
      return node;
    },
    before(...nodes: (MockElement | string)[]) {
      if (!el.parentElement) return;
      const idx = el.parentElement.children.indexOf(el);
      if (idx !== -1) {
        const addedNodes: MockElement[] = [];
        for (const n of nodes) {
          if (typeof n === 'string') {
            const span = createMockElement('span');
            span.textContent = n;
            span.parentElement = el.parentElement;
            addedNodes.push(span);
          } else if (n) {
            n.parentElement = el.parentElement;
            addedNodes.push(n);
          }
        }
        el.parentElement.children.splice(idx, 0, ...addedNodes);
      }
    },
    replaceChildren(...nodes: (MockElement | string)[]) {
      el.children = [];
      _text = '';
      el.append(...nodes);
    },
    addEventListener(evt: string, fn: (ev: any) => void) {
      el.eventListeners[evt] = el.eventListeners[evt] || [];
      el.eventListeners[evt].push(fn);
    },
    dispatchEvent(evt: { type: string; [key: string]: any }) {
      const list = el.eventListeners[evt.type] || [];
      for (const fn of list) fn(evt);
      return true;
    },
    querySelector(sel: string) {
      const selectors = sel.split(',').map((s) => s.trim());
      const match = (item: MockElement): boolean => {
        for (const s of selectors) {
          if (s.startsWith('.')) {
            const cls = s.slice(1);
            if (item.className.split(/\s+/).includes(cls)) return true;
          } else if (item.tagName.toLowerCase() === s.toLowerCase()) {
            return true;
          }
        }
        return false;
      };
      const search = (parent: MockElement): MockElement | null => {
        for (const child of parent.children) {
          if (match(child)) return child;
          const found = search(child);
          if (found) return found;
        }
        return null;
      };
      return search(el);
    },
    querySelectorAll(sel: string) {
      const selectors = sel.split(',').map((s) => s.trim());
      const match = (item: MockElement): boolean => {
        for (const s of selectors) {
          if (s.startsWith('.')) {
            const cls = s.slice(1);
            if (item.className.split(/\s+/).includes(cls)) return true;
          } else if (item.tagName.toLowerCase() === s.toLowerCase()) {
            return true;
          }
        }
        return false;
      };
      const results: MockElement[] = [];
      const search = (parent: MockElement) => {
        for (const child of parent.children) {
          if (match(child)) results.push(child);
          search(child);
        }
      };
      search(el);
      return results;
    },
    contains(node: any) {
      if (node === el) return true;
      const search = (parent: MockElement): boolean => {
        for (const child of parent.children) {
          if (child === node || search(child)) return true;
        }
        return false;
      };
      return search(el);
    },
  };
  el.ownerDocument = {
    createElement: (tag: string) => {
      const child = createMockElement(tag);
      child.ownerDocument = el.ownerDocument;
      return child;
    },
  };
  return el;
}

function createMockPane() {
  const bindings: Array<{
    target: any;
    prop: any;
    options: any;
    listeners: Record<string, ((ev: { value: any }) => void)[]>;
    fire: (event: string, value: any) => void;
    refresh: () => void;
    hidden: boolean;
    element: MockElement;
  }> = [];

  const folders: Array<{
    options: any;
    folder: ReturnType<typeof createMockPane>;
  }> = [];

  const blades: any[] = [];
  const buttons: any[] = [];

  const addBinding = (target: any, prop: any, options: any) => {
    const listeners: Record<string, ((ev: { value: any }) => void)[]> = {};
    const element = createMockElement('div');
    element.className = 'tp-lblv';
    const labelEl = createMockElement('div');
    labelEl.className = 'tp-lblv_l';
    labelEl.textContent = options?.label ?? prop;
    element.appendChild(labelEl);

    let selectEl: MockElement | null = null;
    if (options?.options) {
      selectEl = createMockElement('select');
      selectEl.className = 'tp-lstv_s';
      if (typeof options.options === 'object') {
        const doc = selectEl.ownerDocument;
        for (const [text, val] of Object.entries(options.options)) {
          const opt = doc ? doc.createElement('option') : createMockElement('option');
          opt.value = String(val);
          opt.textContent = text;
          selectEl.appendChild(opt);
        }
      }
      element.appendChild(selectEl);
    } else {
      const inputEl = createMockElement('input');
      inputEl.value = String(target[prop] ?? '');
      if (options?.readonly) {
        inputEl.setAttribute('readonly', 'readonly');
      }
      element.appendChild(inputEl);
    }

    const item = {
      target,
      prop,
      options,
      listeners,
      hidden: false,
      element,
      refresh: () => {},
      on: (event: string, fn: (ev: { value: any }) => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
        return item;
      },
      fire: (event: string, value: any) => {
        target[prop] = value;
        if (selectEl) {
          selectEl.value = String(value);
        }
        listeners[event]?.forEach((fn) => fn({ value }));
      },
    };
    bindings.push(item);
    return item;
  };

  const addFolder = (options: any) => {
    const folder = createMockPane();
    (folder as any).expanded = options?.expanded ?? true;
    (folder as any).title = options?.title ?? '';
    folders.push({ options, folder });
    return folder;
  };

  const addBlade = (options: any) => {
    const blade = { options, hidden: false, element: createMockElement('div') };
    blades.push(blade);
    return blade;
  };

  const addButton = (options: any) => {
    const element = createMockElement('button');
    element.className = 'tp-btnv';
    const buttonChild = createMockElement('button');
    buttonChild.className = 'tp-btnv_b';
    buttonChild.textContent = options?.title ?? '';
    element.appendChild(buttonChild);
    const listeners: Record<string, ((ev: any) => void)[]> = {};
    const btn = {
      title: options?.title ?? '',
      disabled: false,
      element,
      on: (event: string, fn: (ev: any) => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
        return btn;
      },
      fire: (event: string) => {
        listeners[event]?.forEach((fn) => fn({}));
      },
    };
    element.addEventListener('click', () => btn.fire('click'));
    buttonChild.addEventListener('click', () => btn.fire('click'));
    buttons.push(btn);
    return btn;
  };

  return { addBinding, bindings, addFolder, folders, addBlade, blades, addButton, buttons, dispose: () => {}, refresh: () => {} };
}

describe('buildLayerControls (live Opacity, Blend, Trails)', () => {
  function setupTest() {
    const pane = createMockPane();
    const layer: LayerEntry = {
      type: 'bars',
      enabled: true,
      opacity: 1.0,
      blend: 'max',
      trails: true,
      params: {},
    };
    const preset: Preset = {
      version: 1,
      name: 'Test',
      tags: [],
      transition: { style: 'crossfade', seconds: 1 },
      feedback: {},
      layers: [layer],
      post: {},
    };
    const scene = new Scene('test-scene', [], [{ opacity: 1.0, blend: 'max', trails: true }]);
    const commit = vi.fn();
    const session = { commit };

    const controls = buildLayerControls(pane, layer, preset, scene, session);
    return { pane, layer, preset, scene, session, commit, controls };
  }

  it('creates Opacity, Blend, and Trails bindings with clean labels (no "not drawn yet")', () => {
    const { pane } = setupTest();
    expect(pane.bindings).toHaveLength(3);
    const opacityB = pane.bindings[0]!;
    const blendB = pane.bindings[1]!;
    const trailsB = pane.bindings[2]!;

    expect(opacityB.options.label).toBe('Opacity');
    expect(opacityB.options.label).not.toContain('not drawn yet');
    expect(opacityB.options.min).toBe(0);
    expect(opacityB.options.max).toBe(1);

    expect(blendB.options.label).toBe('Blend');
    expect(blendB.options.label).not.toContain('not drawn yet');
    expect(blendB.options.options).toBeDefined();

    expect(trailsB.options.label).toBe('Trails');
  });

  it('live Opacity edit immediately updates scene layer config and commits session', () => {
    const { pane, scene, commit } = setupTest();
    const opacityB = pane.bindings[0]!;

    opacityB.fire('change', 0.45);

    expect(scene.getLayerConfigs()[0]!.opacity).toBe(0.45);
    expect(commit).toHaveBeenCalled();
  });

  it('live Blend edit immediately updates scene layer config and commits session', () => {
    const { pane, scene, commit } = setupTest();
    const blendB = pane.bindings[1]!;

    blendB.fire('change', 'alpha');

    expect(scene.getLayerConfigs()[0]!.blend).toBe('alpha');
    expect(commit).toHaveBeenCalled();
  });

  it('live Trails toggle immediately updates scene layer config and commits session', () => {
    const { pane, scene, commit } = setupTest();
    const trailsB = pane.bindings[2]!;

    trailsB.fire('change', false);

    expect(scene.getLayerConfigs()[0]!.trails).toBe(false);
    expect(commit).toHaveBeenCalled();
  });
});

describe('reset to default and changed marker (Slice 15.5)', () => {
  const spec: any = { type: 'float', name: 'gain', label: 'Gain', group: 'G', default: 0.5, min: 0, max: 1, step: 0.01 };
  const resetBtn = (b: any) => b.element.querySelector('.studio-reset');

  it('marker appears only when the value differs from the default', () => {
    const pane = createMockPane();
    const bag: Record<string, any> = { gain: 0.5 };
    bindSpec(pane, spec, bag, vi.fn() as unknown as () => void);
    const b = pane.bindings[0]!;
    expect(b.element.classList.contains('studio-changed')).toBe(false);
    b.fire('change', 0.8);
    expect(b.element.classList.contains('studio-changed')).toBe(true);
    b.fire('change', 0.5);
    expect(b.element.classList.contains('studio-changed')).toBe(false);
  });

  it('every bound control gets a reset button', () => {
    const pane = createMockPane();
    bindSpec(pane, spec, { gain: 0.5 }, vi.fn() as unknown as () => void);
    expect(resetBtn(pane.bindings[0]!)).not.toBeNull();
  });

  it('reset restores the spec default and goes through the normal edit callback', () => {
    const pane = createMockPane();
    const bag: Record<string, any> = { gain: 0.9 };
    const onEdit = vi.fn();
    bindSpec(pane, spec, bag, onEdit as unknown as () => void);
    const b = pane.bindings[0]!;
    expect(b.element.classList.contains('studio-changed')).toBe(true);
    resetBtn(b).dispatchEvent({ type: 'click' });
    expect(bag.gain).toBe(0.5);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(b.element.classList.contains('studio-changed')).toBe(false);
  });

  it('reset is a no-op on an unchanged control', () => {
    const pane = createMockPane();
    const bag: Record<string, any> = { gain: 0.5 };
    const onEdit = vi.fn();
    bindSpec(pane, spec, bag, onEdit as unknown as () => void);
    const b = pane.bindings[0]!;
    resetBtn(b).dispatchEvent({ type: 'click' });
    expect(bag.gain).toBe(0.5);
    expect(onEdit).not.toHaveBeenCalled();
    expect(b.element.classList.contains('studio-changed')).toBe(false);
  });

  it('default comes from the spec, not from the value the control started with', () => {
    const pane = createMockPane();
    const bag: Record<string, any> = { gain: 0.2 };
    bindSpec(pane, spec, bag, (vi.fn() as unknown as () => void));
    resetBtn(pane.bindings[0]!).dispatchEvent({ type: 'click' });
    expect(bag.gain).toBe(0.5);
  });

  it('vec3 reset restores all three channels', () => {
    const pane = createMockPane();
    const v: Vec3Spec = { type: 'vec3', name: 'rgb', label: 'RGB', group: 'G', default: [1, 1, 1], min: 0, max: 2, step: 0.01 };
    const bag: Record<string, any> = { rgb: [0.2, 0.3, 0.4] };
    bindSpec(pane, v, bag, vi.fn() as unknown as () => void);
    resetBtn(pane.bindings[0]!).dispatchEvent({ type: 'click' });
    expect(bag.rgb).toEqual([1, 1, 1]);
  });

  it('layer Opacity reset updates the layer entry and commits the session', () => {
    const pane = createMockPane();
    const layer: LayerEntry = { type: 'bars', enabled: true, opacity: 0.3, blend: 'max', trails: true, params: {} };
    const preset: Preset = { version: 1, name: 'T', tags: [], transition: { style: 'crossfade', seconds: 1 }, feedback: {}, layers: [layer], post: {} };
    const scene = new Scene('s', [], [{ opacity: 0.3, blend: 'max', trails: true }]);
    const commit = vi.fn();
    buildLayerControls(pane, layer, preset, scene, { commit });
    resetBtn(pane.bindings[0]!).dispatchEvent({ type: 'click' });
    expect(layer.opacity).toBe(1);
    expect(scene.getLayerConfigs()[0]!.opacity).toBe(1);
    expect(commit).toHaveBeenCalled();
  });

  it('reset and marker work in the Basic and Advanced views of a section', () => {
    const specs: any[] = [
      { ...spec, tier: 'basic' },
      { type: 'float', name: 'other', label: 'Other', group: 'G', default: 0.1, min: 0, max: 1, step: 0.01, tier: 'advanced' },
    ];
    const pane = createMockPane();
    const settings: Record<string, any> = { gain: 0.9, other: 0.7 };
    const apply = vi.fn();
    bindSection(pane, 'test', specs, settings, apply);
    const all = [...pane.folders.flatMap((f) => f.folder.folders.flatMap((g) => g.folder.bindings)), ...pane.folders.flatMap((f) => f.folder.bindings)];
    const gain = all.find((b) => b.prop === 'gain')!;
    const other = all.find((b) => b.prop === 'other')!;
    expect(gain.element.classList.contains('studio-changed')).toBe(true);
    expect(other.element.classList.contains('studio-changed')).toBe(true);
    resetBtn(gain).dispatchEvent({ type: 'click' });
    resetBtn(other).dispatchEvent({ type: 'click' });
    expect(settings.gain).toBe(0.5);
    expect(settings.other).toBe(0.1);
    expect(apply).toHaveBeenCalledTimes(2);
  });
});

describe('bindSpec (vec3 / decayRgb bindings)', () => {
  const decayRgbSpec: Vec3Spec = {
    type: 'vec3',
    name: 'decayRgb',
    label: 'Decay RGB',
    group: 'Trail',
    default: [1.0, 1.0, 1.0],
    min: 0.0,
    max: 2.0,
    step: 0.01,
  };

  it('creates three numeric slider bindings (R, G, B) with correct min, max, step', () => {
    const pane = createMockPane();
    const bag: Record<string, any> = { decayRgb: [1.0, 0.9, 0.8] };
    const onEdit = vi.fn();

    bindSpec(pane, decayRgbSpec, bag, onEdit);

    expect(pane.bindings).toHaveLength(3);
    const rB = pane.bindings[0]!;
    const gB = pane.bindings[1]!;
    const bB = pane.bindings[2]!;

    expect(rB.options.label).toBe('Decay RGB R');
    expect(rB.options.min).toBe(0.0);
    expect(rB.options.max).toBe(2.0);
    expect(rB.options.step).toBe(0.01);

    expect(gB.options.label).toBe('Decay RGB G');
    expect(gB.options.min).toBe(0.0);
    expect(gB.options.max).toBe(2.0);

    expect(bB.options.label).toBe('Decay RGB B');
    expect(bB.options.min).toBe(0.0);
    expect(bB.options.max).toBe(2.0);
  });

  it('reading and writing bag[spec.key][0..2] updates values and fires onEdit', () => {
    const pane = createMockPane();
    const bag: Record<string, any> = { decayRgb: [1.0, 1.0, 1.0] };
    const onEdit = vi.fn();

    bindSpec(pane, decayRgbSpec, bag, onEdit);
    const rB = pane.bindings[0]!;
    const gB = pane.bindings[1]!;
    const bB = pane.bindings[2]!;

    rB.fire('change', 0.5);
    expect(bag.decayRgb[0]).toBe(0.5);
    expect(onEdit).toHaveBeenCalledTimes(1);

    gB.fire('change', 0.25);
    expect(bag.decayRgb[1]).toBe(0.25);
    expect(onEdit).toHaveBeenCalledTimes(2);

    bB.fire('change', 0.75);
    expect(bag.decayRgb[2]).toBe(0.75);
    expect(onEdit).toHaveBeenCalledTimes(3);
  });

  it('supports spec with key property and initializes default when bag entry missing', () => {
    const pane = createMockPane();
    const specWithKey = {
      type: 'vec3' as const,
      key: 'decayRgb',
      label: 'Decay RGB',
      group: 'Trail',
      default: [1.0, 0.5, 0.25] as [number, number, number],
    };
    const bag: Record<string, any> = {};
    const onEdit = vi.fn();

    bindSpec(pane, specWithKey as any, bag, onEdit);
    expect(bag.decayRgb).toEqual([1.0, 0.5, 0.25]);

    pane.bindings[0]!.fire('change', 0.99);
    expect(bag.decayRgb[0]).toBe(0.99);
    expect(onEdit).toHaveBeenCalled();
  });
});

describe('buildGlobalDirectorControls (slice 7.32)', () => {
  beforeEach(() => {
    resetGlobalDirector();
  });

  it('creates 6 bindings on the folder with correct labels and configuration including experience mode', () => {
    const folder = createMockPane();
    const director = getGlobalDirector();
    director.reset();

    buildGlobalDirectorControls(folder, director);

    expect(folder.bindings).toHaveLength(6);

    const [expModeB, camModeB, camIntensityB, colMoodB, colIntensityB, trigB] = folder.bindings;

    expect(expModeB!.options.label).toBe('Experience mode');
    expect(expModeB!.options.options).toEqual({
      'Cinematic': 'cinematic',
      'Calm': 'calm',
      'Minimal': 'minimal',
      'Color Walk': 'colorWalk',
      'Custom': 'custom',
    });

    expect(camModeB!.options.label).toBe('Camera motion');
    expect(camModeB!.options.options).toEqual({
      'Auto (Complementary)': 'auto',
      'Crane sway': 'craneSway',
      'Dutch roll': 'dutchRoll',
      'Breathing push': 'breathingPush',
      'Horizon 2.5D tilt': 'horizonTilt',
      'Still anchor': 'stillAnchor',
      'Off': 'off',
    });

    expect(camIntensityB!.options.label).toBe('Camera intensity');
    expect(camIntensityB!.options.min).toBe(0);
    expect(camIntensityB!.options.max).toBe(1);
    expect(camIntensityB!.options.step).toBe(0.05);

    expect(colMoodB!.options.label).toBe('Color mood');
    expect(colMoodB!.options.options).toEqual({
      'Auto-cycle palettes': 'auto',
      'Native (preset original)': 'native',
      'Cyberpunk (Cyan/Magenta)': 'cyberpunk',
      'Ember (Indigo/Gold)': 'ember',
      'Bioluminescent (Teal/Aqua)': 'biolum',
      'Vapor (Violet/Rose)': 'vapor',
      'Prismatic (Cobalt/Coral)': 'prismatic',
    });

    expect(colIntensityB!.options.label).toBe('Color intensity');
    expect(colIntensityB!.options.min).toBe(0);
    expect(colIntensityB!.options.max).toBe(1);
    expect(colIntensityB!.options.step).toBe(0.05);

    expect(trigB!.options.label).toBe('Transition trigger');
    expect(trigB!.options.options).toEqual({
      'Song section (35s+)': 'section',
      'Every 32 beats': 'beats32',
      'Every 64 beats': 'beats64',
      'Every 128 beats': 'beats128',
      'Timer (45s)': 'timer45',
    });
  });

  it('updates director settings and experience mode when bindings change', () => {
    const folder = createMockPane();
    const director = getGlobalDirector();
    director.reset();

    buildGlobalDirectorControls(folder, director);

    const [expModeB, camModeB, camIntensityB, colMoodB, colIntensityB, trigB] = folder.bindings;

    expModeB!.fire('change', 'calm');
    expect(director.getExperienceMode()).toBe('calm');
    expect(director.isCalm()).toBe(true);

    camModeB!.fire('change', 'dutchRoll');
    expect(director.getSettings().cameraMode).toBe('dutchRoll');

    camIntensityB!.fire('change', 0.85);
    expect(director.getSettings().cameraIntensity).toBe(0.85);

    colMoodB!.fire('change', 'biolum');
    expect(director.getSettings().colorMood).toBe('biolum');

    colIntensityB!.fire('change', 0.2);
    expect(director.getSettings().colorIntensity).toBe(0.2);

    trigB!.fire('change', 'beats64');
    expect(director.getSettings().triggerCadence).toBe('beats64');
  });

  it('renders Global Director folder with title and collapsed state', () => {
    const pane = createMockPane();
    const dirFolder = pane.addFolder({ title: 'Global Director', expanded: false });
    buildGlobalDirectorControls(dirFolder);

    expect(pane.folders).toHaveLength(1);
    expect(pane.folders[0]!.options.title).toBe('Global Director');
    expect(pane.folders[0]!.options.expanded).toBe(false);
    expect(pane.folders[0]!.folder.bindings).toHaveLength(6);
  });
});

describe('Default Add-Layer Type (Slice 9.4)', () => {
  it('DEFAULT_ADD_LAYER_TYPE is "shape"', () => {
    expect(DEFAULT_ADD_LAYER_TYPE).toBe('shape');
  });

  it('defaultLayer("shape") creates an enabled shape layer with SHAPE_DEFAULTS', () => {
    const layer = defaultLayer(DEFAULT_ADD_LAYER_TYPE);
    expect(layer.type).toBe('shape');
    expect(layer.enabled).toBe(true);
    expect(layer.opacity).toBe(1);
    expect(layer.blend).toBe('add');
    expect(layer.params.baseShape?.value).toBe('circle');
    expect(layer.params.effectType?.value).toBe('bars');
    expect(layer.params.propMode?.value).toBe('single');
    expect(layer.params.colorMode?.value).toBe('palette');
  });
});

describe('formatLayerTitle & formatLayerLabel (Slice 9.4)', () => {
  it('formats shape layer with dynamic shape and effect summary', () => {
    const layer: LayerEntry = {
      type: 'shape',
      enabled: true,
      opacity: 1,
      blend: 'add',
      params: {
        baseShape: { value: 'circle' },
        effectType: { value: 'bars' },
      },
    };
    expect(formatLayerTitle(layer, 0)).toBe('1. Shape (circle · bars)');
    expect(formatLayerLabel(layer, 0)).toBe('1. Shape (circle · bars)');
  });

  it('reflects updated shape parameters (e.g. polygon and segmentedBars)', () => {
    const layer: LayerEntry = {
      type: 'shape',
      enabled: true,
      opacity: 1,
      blend: 'add',
      params: {
        baseShape: { value: 'polygon' },
        effectType: { value: 'segmentedBars' },
      },
    };
    expect(formatLayerTitle(layer, 2)).toBe('3. Shape (polygon · segmentedBars)');
    expect(formatLayerLabel(layer, 2)).toBe('3. Shape (polygon · segmentedBars)');
  });

  it('appends "(off)" in formatLayerLabel when disabled', () => {
    const layer: LayerEntry = {
      type: 'shape',
      enabled: false,
      opacity: 1,
      blend: 'add',
      params: {
        baseShape: { value: 'star' },
        effectType: { value: 'dots' },
      },
    };
    expect(formatLayerLabel(layer, 1)).toBe('2. Shape (star · dots) (off)');
  });

  it('formats non-shape layers with standard layer type', () => {
    const tunnelLayer: LayerEntry = {
      type: 'tunnel',
      enabled: true,
      opacity: 1,
      blend: 'add',
      params: {},
    };
    expect(formatLayerTitle(tunnelLayer, 0)).toBe('1. tunnel');
    expect(formatLayerLabel(tunnelLayer, 0)).toBe('1. tunnel');
    expect(formatLayerLabel({ ...tunnelLayer, enabled: false }, 1)).toBe('2. tunnel (off)');
  });
});

describe('Conditional visibility with showWhen (Slice 9.4)', () => {
  it('bindSpec sets initial hidden based on isSpecVisible', () => {
    const pane = createMockPane();
    const sidesSpec = LAYER_SPECS['shape']!.find((s) => s.name === 'sides')!;
    expect(sidesSpec).toBeDefined();

    // With baseShape: 'circle', sides should be hidden
    const bagCircle = { sides: 6, baseShape: 'circle' };
    const bCircle = bindSpec(pane, sidesSpec, bagCircle, () => {});
    expect(bCircle.hidden).toBe(true);

    // With baseShape: 'polygon', sides should be visible
    const bagPolygon = { sides: 6, baseShape: 'polygon' };
    const bPolygon = bindSpec(pane, sidesSpec, bagPolygon, () => {});
    expect(bPolygon.hidden).toBe(false);
  });

  it('bindSection dynamically reveals/hides dependent parameters when triggering changes', () => {
    const pane = createMockPane();
    const specs = LAYER_SPECS['shape']!;
    const layer = defaultLayer('shape');
    const onApply = vi.fn();
    const onCommit = vi.fn();

    saveStudioView('advanced'); // sides and starInner are advanced controls
    const { specBindings } = bindSection(pane, '1. Shape (circle · bars)', specs, layer.params, onApply, onCommit);

    const findBlade = (name: string) => {
      const entry = specBindings.find((b) => b.spec.name === name);
      return entry?.blades[0];
    };

    const baseShapeBlade = findBlade('baseShape');
    const sidesBlade = findBlade('sides');
    const starInnerBlade = findBlade('starInner');
    const propModeBlade = findBlade('propMode');
    const propCountBlade = findBlade('propCount');
    const colorModeBlade = findBlade('colorMode');
    const solidColorBlade = findBlade('solidColor');
    const effectTypeBlade = findBlade('effectType');
    const ledSegmentsBlade = findBlade('ledSegments');

    expect(baseShapeBlade).toBeDefined();
    expect(sidesBlade).toBeDefined();
    expect(propModeBlade).toBeDefined();
    expect(propCountBlade).toBeDefined();

    // Default shape is 'circle' -> sides, starInner should be hidden
    expect(sidesBlade.hidden).toBe(true);
    expect(starInnerBlade.hidden).toBe(true);

    // Default propMode is 'single' -> propCount should be hidden
    expect(propCountBlade.hidden).toBe(true);

    // Default colorMode is 'palette' -> solidColor should be hidden
    expect(solidColorBlade.hidden).toBe(true);

    // Default effectType is 'bars' -> ledSegments should be hidden
    expect(ledSegmentsBlade.hidden).toBe(true);

    // Change baseShape to 'polygon'
    baseShapeBlade.fire('change', 'polygon');
    expect(onApply).toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalled();
    expect(layer.params.baseShape?.value).toBe('polygon');
    // 'sides' is for ['polygon', 'star'] -> now visible
    expect(sidesBlade.hidden).toBe(false);
    // 'starInner' is only for 'star' -> still hidden
    expect(starInnerBlade.hidden).toBe(true);

    // Change baseShape to 'star'
    baseShapeBlade.fire('change', 'star');
    expect(sidesBlade.hidden).toBe(false);
    expect(starInnerBlade.hidden).toBe(false);

    // Change baseShape back to 'circle'
    baseShapeBlade.fire('change', 'circle');
    expect(sidesBlade.hidden).toBe(true);
    expect(starInnerBlade.hidden).toBe(true);

    // Change propMode to 'concentric'
    propModeBlade.fire('change', 'concentric');
    expect(layer.params.propMode?.value).toBe('concentric');
    expect(propCountBlade.hidden).toBe(false);

    // Change propMode back to 'single'
    propModeBlade.fire('change', 'single');
    expect(propCountBlade.hidden).toBe(true);

    // Change colorMode to 'solid'
    colorModeBlade.fire('change', 'solid');
    expect(solidColorBlade.hidden).toBe(false);

    // Change colorMode back to 'palette'
    colorModeBlade.fire('change', 'palette');
    expect(solidColorBlade.hidden).toBe(true);

    // Change effectType to 'segmentedBars'
    effectTypeBlade.fire('change', 'segmentedBars');
    expect(ledSegmentsBlade.hidden).toBe(false);

    // Change effectType back to 'bars'
    effectTypeBlade.fire('change', 'bars');
    expect(ledSegmentsBlade.hidden).toBe(true);
  });
});

describe('linkTargets with conditional visibility (Slice 9.4)', () => {
  it('filters out parameters that are hidden by showWhen and uses descriptive shape titles', () => {
    const shapeLayer = defaultLayer('shape');
    // By default, baseShape is 'circle'
    const preset: Preset = {
      version: 1,
      name: 'Test Preset',
      tags: [],
      transition: { style: 'crossfade', seconds: 1 },
      feedback: {},
      layers: [shapeLayer],
      post: {},
    };

    const targetsCircle = linkTargets(preset);
    // 'sides' should NOT be present in targets when circle
    expect(targetsCircle.some((t) => t.spec.name === 'sides')).toBe(false);
    // 'propCount' should NOT be present in targets when propMode is 'single'
    expect(targetsCircle.some((t) => t.spec.name === 'propCount')).toBe(false);

    // Visible parameters should have descriptive title
    const sizeTarget = targetsCircle.find((t) => t.spec.name === 'size');
    expect(sizeTarget).toBeDefined();
    expect(sizeTarget!.label).toBe('1. Shape (circle · bars) · Size');

    // Switch to polygon and concentric
    shapeLayer.params.baseShape = { value: 'polygon' };
    shapeLayer.params.propMode = { value: 'concentric' };
    shapeLayer.params.effectType = { value: 'harmonicWave' };

    const targetsPolygon = linkTargets(preset);
    expect(targetsPolygon.some((t) => t.spec.name === 'sides')).toBe(true);
    expect(targetsPolygon.some((t) => t.spec.name === 'propCount')).toBe(true);
    const sidesTarget = targetsPolygon.find((t) => t.spec.name === 'sides');
    expect(sidesTarget!.label).toBe('1. Shape (polygon · harmonicWave) · Sides');
  });
});

describe('Helper Bar & Warning Badge System (Slice 9.8)', () => {
  it('helper bar element exists and displays initial idle text in Studio', () => {
    const container = createMockElement('div');
    const body = createMockElement('div');
    body.className = 'studio-body';
    container.appendChild(body);

    const session = {
      list: () => [],
      get: () => undefined,
      isDirty: () => false,
      commit: vi.fn(),
      save: vi.fn(),
      saveAs: vi.fn(),
      remove: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: () => false,
      canRedo: () => false,
      exportJson: () => '{}',
      importAsset: () => ({ kind: 'preset', warnings: [] }),
      sceneOf: () => ({ layers: [], setFeedback: vi.fn() }),
      refreshPost: vi.fn(),
      rebuild: vi.fn(),
    } as any;

    const studio = new Studio(container as any, {
      session,
      switchTo: vi.fn(),
    });

    expect(studio.helperBar).toBeDefined();
    expect(studio.helperBar.className).toBe('studio-helper-bar');
    expect(studio.helperBar.getAttribute('role')).toBe('status');
    expect(studio.helperBar.getAttribute('aria-live')).toBe('polite');
    expect(studio.helperBar.textContent).toBe(STUDIO_HELPER_IDLE_TEXT);
    expect(container.querySelector('.studio-helper-bar')).toBe(studio.helperBar);
  });

  it('renders .intense-badge in UI elements for intense parameters, but not standard ones', () => {
    const pane = createMockPane();
    const helperBar = createMockElement('div');
    renderHelperContent(helperBar as any, null);

    const layer = defaultLayer('shape');
    const shapeSpecs = LAYER_SPECS.shape ?? [];
    const standardSpec = shapeSpecs.find((s) => s.name === 'size')!;
    const intenseSpec = POST_SPECS.find((s) => s.name === 'chroma' || s.name === 'mirror')!;

    expect(standardSpec).toBeDefined();
    expect(standardSpec.intense).toBeFalsy();
    expect(intenseSpec).toBeDefined();
    expect(intenseSpec.intense).toBe(true);

    const onHelperUpdate = (spec: any) => renderHelperContent(helperBar as any, spec);

    const { specBindings } = bindSection(
      pane,
      'Shape',
      [standardSpec, intenseSpec],
      layer.params,
      undefined,
      undefined,
      onHelperUpdate,
    );

    const standardBlade = specBindings.find((b) => b.spec.name === standardSpec.name)?.blades[0];
    const intenseBlade = specBindings.find((b) => b.spec.name === intenseSpec.name)?.blades[0];

    expect(standardBlade).toBeDefined();
    expect(intenseBlade).toBeDefined();

    // Standard parameter should NOT have intense-badge
    expect(standardBlade.element.querySelector('.intense-badge')).toBeNull();

    // Intense parameter MUST have intense-badge
    const badge = intenseBlade.element.querySelector('.intense-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('(!)');
    expect(badge?.title).toBe(intenseSpec.warning);
  });

  it('hovering and focusing a standard parameter updates helper bar with label + description (no warning)', () => {
    const pane = createMockPane();
    const helperBar = createMockElement('div');
    renderHelperContent(helperBar as any, null);
    expect(helperBar.textContent).toBe(STUDIO_HELPER_IDLE_TEXT);

    const layer = defaultLayer('shape');
    const shapeSpecs = LAYER_SPECS.shape ?? [];
    const standardSpec = shapeSpecs.find((s) => s.name === 'size')!;

    const onHelperUpdate = (spec: any) => renderHelperContent(helperBar as any, spec);

    const { specBindings } = bindSection(
      pane,
      'Shape',
      [standardSpec],
      layer.params,
      undefined,
      undefined,
      onHelperUpdate,
    );

    const blade = specBindings[0]?.blades[0];
    expect(blade).toBeDefined();

    // Hover (mouseenter)
    blade.element.dispatchEvent({ type: 'mouseenter' });
    expect(helperBar.textContent).toContain(standardSpec.label);
    expect(helperBar.textContent).toContain(standardSpec.description!);
    expect(helperBar.querySelector('.helper-param-name')?.textContent).toBe(standardSpec.label);
    expect(helperBar.querySelector('.helper-param-desc')?.textContent).toBe(standardSpec.description!);
    expect(helperBar.querySelector('.helper-warning')).toBeNull();

    // Mouseleave restores idle text
    blade.element.dispatchEvent({ type: 'mouseleave' });
    expect(helperBar.textContent).toBe(STUDIO_HELPER_IDLE_TEXT);
    expect(helperBar.querySelector('.helper-param-name')).toBeNull();

    // Focusin updates helper bar
    blade.element.dispatchEvent({ type: 'focusin' });
    expect(helperBar.textContent).toContain(standardSpec.label);
    expect(helperBar.textContent).toContain(standardSpec.description!);
    expect(helperBar.querySelector('.helper-param-name')?.textContent).toBe(standardSpec.label);
    expect(helperBar.querySelector('.helper-param-desc')?.textContent).toBe(standardSpec.description!);

    // Focusout restores idle text
    blade.element.dispatchEvent({ type: 'focusout' });
    expect(helperBar.textContent).toBe(STUDIO_HELPER_IDLE_TEXT);
  });

  it('hovering and focusing an intense parameter updates helper bar with label + description + warning', () => {
    const pane = createMockPane();
    const helperBar = createMockElement('div');
    renderHelperContent(helperBar as any, null);

    const layer = defaultLayer('shape');
    const intenseSpec = POST_SPECS.find((s) => s.name === 'chroma')!;
    expect(intenseSpec).toBeDefined();
    expect(intenseSpec.warning).toBeDefined();

    const onHelperUpdate = (spec: any) => renderHelperContent(helperBar as any, spec);

    const { specBindings } = bindSection(
      pane,
      'Shape',
      [intenseSpec],
      layer.params,
      undefined,
      undefined,
      onHelperUpdate,
    );

    const blade = specBindings[0]?.blades[0];
    expect(blade).toBeDefined();

    // Hover (mouseenter)
    blade.element.dispatchEvent({ type: 'mouseenter' });
    expect(blade.element.classList.contains('studio-control-highlight')).toBe(true);
    expect(blade.element.classList.contains('studio-control-highlight-intense')).toBe(true);
    expect(helperBar.textContent).toContain(intenseSpec.label);
    expect(helperBar.textContent).toContain(intenseSpec.description!);
    expect(helperBar.querySelector('.helper-param-name')?.textContent).toBe(intenseSpec.label);
    expect(helperBar.querySelector('.helper-param-desc')?.textContent).toBe(intenseSpec.description!);
    const warnEl = helperBar.querySelector('.helper-warning');
    expect(warnEl).not.toBeNull();
    expect(warnEl?.textContent).toContain('⚠️');
    expect(warnEl?.textContent).toContain(intenseSpec.warning!);

    // Mouseleave restores idle text & clears highlights
    blade.element.dispatchEvent({ type: 'mouseleave' });
    expect(blade.element.classList.contains('studio-control-highlight')).toBe(false);
    expect(blade.element.classList.contains('studio-control-highlight-intense')).toBe(false);
    expect(helperBar.textContent).toBe(STUDIO_HELPER_IDLE_TEXT);
    expect(helperBar.querySelector('.helper-warning')).toBeNull();

    // Focusin updates helper bar with label + description + warning & highlights
    blade.element.dispatchEvent({ type: 'focusin' });
    expect(blade.element.classList.contains('studio-control-highlight')).toBe(true);
    expect(helperBar.querySelector('.helper-param-name')?.textContent).toBe(intenseSpec.label);
    expect(helperBar.querySelector('.helper-warning')?.textContent).toContain(intenseSpec.warning!);

    // Focusout restores idle text & clears highlights
    blade.element.dispatchEvent({ type: 'focusout' });
    expect(blade.element.classList.contains('studio-control-highlight')).toBe(false);
    expect(helperBar.textContent).toBe(STUDIO_HELPER_IDLE_TEXT);
  });

  it('attachSpecHelper prevents duplicate badges when called multiple times on the same blade', () => {
    const el = createMockElement('div');
    const blade = { element: el };
    const intenseSpec = POST_SPECS.find((s) => s.name === 'chroma')!;

    attachSpecHelper(blade, intenseSpec);
    expect(el.querySelectorAll('.intense-badge').length).toBe(1);

    // Call again on same blade
    attachSpecHelper(blade, intenseSpec);
    expect(el.querySelectorAll('.intense-badge').length).toBe(1);
  });
});

describe('Studio Hierarchical Optgroup Preset Selector (Slice 10.3)', () => {
  const createMockPreset = (id: string, name: string): any => ({
    id,
    builtin: true,
    preset: {
      version: 1,
      name,
      tags: [],
      transition: { style: 'crossfade', seconds: 1 },
      feedback: {},
      layers: [],
      post: {},
    },
  });

  const createSampleCategorized = () => ({
    system: {
      showcase: [
        createMockPreset('13-solar-crown-eclipse', '13 · Solar Crown Eclipse'),
        createMockPreset('14-sacred-orbit-mandala', '14 · Sacred Orbit Mandala'),
      ],
      flagship: [
        createMockPreset('01-curl-fluid-warp', '01 · Curl Fluid Warp'),
        createMockPreset('02-kaleidoscopic-mandala', '02 · Kaleidoscopic Mandala'),
      ],
      classics: [
        createMockPreset('crown', 'Crown'),
        createMockPreset('flight', 'Flight'),
      ],
    },
    user: {
      folders: [
        {
          folder: { id: 'folder-1', name: 'Chill Ambient', createdAt: 1000 },
          entries: [createMockPreset('user-1', 'Midnight Flight')],
        },
      ],
      unfiled: [createMockPreset('user-2', 'Quick Test')],
    },
  });

  it('renders all hierarchical optgroups with expected labels and matching options', () => {
    const selectEl = createMockElement('select');
    const categorized = createSampleCategorized();
    const session = {
      listCategorized: () => categorized,
    } as any;

    renderPresetSelectHierarchy(selectEl as any, session, '01-curl-fluid-warp');

    const optgroups = selectEl.querySelectorAll('optgroup');
    expect(optgroups).toHaveLength(5);

    // Verify optgroup labels
    expect(optgroups[0]?.label).toBe('System: Stage 9 Showcase (13–20)');
    expect(optgroups[1]?.label).toBe('System: Flagship Generative (01–12)');
    expect(optgroups[2]?.label).toBe('System: Classics & Textures');
    expect(optgroups[3]?.label).toBe('User: Chill Ambient');
    expect(optgroups[4]?.label).toBe('User: Unfiled');

    // Verify constants match
    expect(optgroups[0]?.label).toBe(SYSTEM_OPTGROUP_LABELS.showcase);
    expect(optgroups[1]?.label).toBe(SYSTEM_OPTGROUP_LABELS.flagship);
    expect(optgroups[2]?.label).toBe(SYSTEM_OPTGROUP_LABELS.classics);

    // Verify options in Showcase
    const showcaseOpts = optgroups[0]!.querySelectorAll('option');
    expect(showcaseOpts).toHaveLength(2);
    expect(showcaseOpts[0]?.value).toBe('13-solar-crown-eclipse');
    expect(showcaseOpts[0]?.textContent).toBe('13 · Solar Crown Eclipse');
    expect(showcaseOpts[1]?.value).toBe('14-sacred-orbit-mandala');
    expect(showcaseOpts[1]?.textContent).toBe('14 · Sacred Orbit Mandala');

    // Verify options in Flagship
    const flagshipOpts = optgroups[1]!.querySelectorAll('option');
    expect(flagshipOpts).toHaveLength(2);
    expect(flagshipOpts[0]?.value).toBe('01-curl-fluid-warp');
    expect(flagshipOpts[0]?.textContent).toBe('01 · Curl Fluid Warp');

    // Verify options in Classics
    const classicsOpts = optgroups[2]!.querySelectorAll('option');
    expect(classicsOpts).toHaveLength(2);
    expect(classicsOpts[0]?.value).toBe('crown');
    expect(classicsOpts[0]?.textContent).toBe('Crown');

    // Verify options in User Folder
    const userFolderOpts = optgroups[3]!.querySelectorAll('option');
    expect(userFolderOpts).toHaveLength(1);
    expect(userFolderOpts[0]?.value).toBe('user-1');
    expect(userFolderOpts[0]?.textContent).toBe('Midnight Flight');

    // Verify options in User Unfiled
    const unfiledOpts = optgroups[4]!.querySelectorAll('option');
    expect(unfiledOpts).toHaveLength(1);
    expect(unfiledOpts[0]?.value).toBe('user-2');
    expect(unfiledOpts[0]?.textContent).toBe('Quick Test');

    // Verify current selection is set
    expect(selectEl.value).toBe('01-curl-fluid-warp');
    expect(flagshipOpts[0]?.selected).toBe(true);
    expect(flagshipOpts[1]?.selected).toBe(false);
  });

  it('clears previous children before re-rendering', () => {
    const selectEl = createMockElement('select');
    const oldOption = createMockElement('option');
    oldOption.value = 'stale';
    oldOption.textContent = 'Stale Option';
    selectEl.appendChild(oldOption);
    expect(selectEl.querySelectorAll('option')).toHaveLength(1);

    const categorized = createSampleCategorized();
    const session = {
      listCategorized: () => categorized,
    } as any;

    renderPresetSelectHierarchy(selectEl as any, session, 'crown');

    // Stale option must be gone
    const allOptions = selectEl.querySelectorAll('option');
    expect(allOptions.some((o) => o.value === 'stale')).toBe(false);
    expect(selectEl.value).toBe('crown');
  });

  it('omits empty categories when groups have 0 presets', () => {
    const selectEl = createMockElement('select');
    const emptyCategorized = {
      system: {
        showcase: [],
        flagship: [createMockPreset('01-curl-fluid-warp', '01 · Curl Fluid Warp')],
        classics: [],
      },
      user: {
        folders: [
          {
            folder: { id: 'empty-folder', name: 'Empty Folder', createdAt: 1000 },
            entries: [],
          },
        ],
        unfiled: [],
      },
    };

    const session = {
      listCategorized: () => emptyCategorized,
    } as any;

    renderPresetSelectHierarchy(selectEl as any, session, '01-curl-fluid-warp');

    const optgroups = selectEl.querySelectorAll('optgroup');
    // Only Flagship has presets; showcase, classics, empty folder and unfiled should be omitted
    expect(optgroups).toHaveLength(1);
    expect(optgroups[0]?.label).toBe('System: Flagship Generative (01–12)');
  });

  it('integrates with Studio.bind() and renders hierarchy on dropdown element', () => {
    const container = createMockElement('div');
    const body = createMockElement('div');
    body.className = 'studio-body';
    container.appendChild(body);

    const categorized = createSampleCategorized();
    const allPresets = [
      ...categorized.system.showcase,
      ...categorized.system.flagship,
      ...categorized.system.classics,
      ...categorized.user.folders.flatMap((f) => f.entries),
      ...categorized.user.unfiled,
    ];

    const presetMap = new Map(allPresets.map((e) => [e.id, e]));

    const session = {
      list: () => allPresets,
      listCategorized: () => categorized,
      get: (id: string) => presetMap.get(id),
      isDirty: () => false,
      commit: vi.fn(),
      save: vi.fn(),
      saveAs: vi.fn(),
      remove: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: () => false,
      canRedo: () => false,
      exportJson: () => '{}',
      importAsset: () => ({ kind: 'preset', warnings: [] }),
      sceneOf: () => ({ layers: [], setFeedback: vi.fn() }),
      refreshPost: vi.fn(),
      rebuild: vi.fn(),
    } as any;

    let mockPaneInstance: any = null;
    const mockPaneFactory = () => {
      mockPaneInstance = createMockPane();
      return mockPaneInstance;
    };

    const switchTo = vi.fn();
    const studio = new Studio(container as any, {
      session,
      switchTo,
      paneFactory: mockPaneFactory,
    });

    studio.bind('crown');

    expect(mockPaneInstance).not.toBeNull();
    const presetBinding = mockPaneInstance.bindings.find((b: any) => b.prop === 'id');
    expect(presetBinding).toBeDefined();

    // Verify select element exists in preset binding
    const selectEl = presetBinding.element.querySelector('select');
    expect(selectEl).not.toBeNull();

    // Verify hierarchy was rendered into selectEl
    const optgroups = selectEl!.querySelectorAll('optgroup');
    expect(optgroups).toHaveLength(5);
    expect(selectEl!.value).toBe('crown');

    // Simulate user selecting another preset from select element
    selectEl!.value = '13-solar-crown-eclipse';
    selectEl!.dispatchEvent({ type: 'change' });
    expect(switchTo).toHaveBeenCalledWith('13-solar-crown-eclipse');

    // Verify refreshPresetDropdown re-renders dropdown
    studio.refreshPresetDropdown();
    expect(selectEl!.querySelectorAll('optgroup')).toHaveLength(5);
  });

  it('safely handles environments where select element is missing without throwing', () => {
    const container = createMockElement('div');
    const body = createMockElement('div');
    body.className = 'studio-body';
    container.appendChild(body);

    const session = {
      list: () => [],
      listCategorized: () => ({
        system: { showcase: [], flagship: [], classics: [] },
        user: { folders: [], unfiled: [] },
      }),
      get: () => ({
        id: 'mock',
        preset: { name: 'Mock', tags: [], transition: { style: 'crossfade', seconds: 1 }, feedback: {}, layers: [], post: {} },
      }),
      isDirty: () => false,
      commit: vi.fn(),
      canUndo: () => false,
      canRedo: () => false,
      undo: vi.fn(),
      redo: vi.fn(),
      save: vi.fn(),
      saveAs: vi.fn(),
      sceneOf: () => ({ layers: [], setFeedback: vi.fn() }),
      refreshPost: vi.fn(),
    } as any;

    const mockPaneFactory = () => {
      const pane = createMockPane();
      const originalAddBinding = pane.addBinding;
      pane.addBinding = (target: any, prop: any, options: any) => {
        const item = originalAddBinding(target, prop, { ...options, options: undefined });
        return item;
      };
      return pane;
    };

    const studio = new Studio(container as any, {
      session,
      switchTo: vi.fn(),
      paneFactory: mockPaneFactory,
    });

    // Should not throw even if no select element is in the binding or body
    expect(() => studio.bind('mock')).not.toThrow();
  });
});

  function setupTest(testOptions: { admin?: boolean } = {}) {
    const container = createMockElement('div');
    const body = createMockElement('div');
    body.className = 'studio-body';
    container.appendChild(body);

    const folders = [
      { id: 'folder-chill', name: 'Chill Beats', createdAt: 1000 },
      { id: 'folder-energy', name: 'High Energy', createdAt: 2000 },
    ];

    const presets: Record<string, any> = {
      crown: {
        id: 'crown',
        builtin: true,
        preset: {
          name: 'Crown',
          tags: ['built-in'],
          transition: { style: 'crossfade', seconds: 0.32 },
          feedback: {},
          layers: [],
          post: {},
        },
        savedJson: '{}',
      },
      '13-solar-crown-eclipse': {
        id: '13-solar-crown-eclipse',
        builtin: true,
        preset: {
          name: '13 · Solar Crown Eclipse',
          tags: ['built-in'],
          transition: { style: 'crossfade', seconds: 0.32 },
          feedback: {},
          layers: [],
          post: {},
        },
        savedJson: '{}',
      },
      'user-1': {
        id: 'user-1',
        builtin: false,
        folderId: undefined,
        preset: {
          name: 'Custom Ambient',
          tags: [],
          transition: { style: 'crossfade', seconds: 1 },
          feedback: {},
          layers: [],
          post: {},
        },
        savedJson: '{}',
      },
      'user-in-folder': {
        id: 'user-in-folder',
        builtin: false,
        folderId: 'folder-chill',
        preset: {
          name: 'Chill Vibes',
          tags: ['favourite'],
          transition: { style: 'crossfade', seconds: 1 },
          feedback: {},
          layers: [],
          post: {},
        },
        savedJson: '{}',
      },
    };

    const session = {
      get: vi.fn((id: string) => presets[id]),
      list: vi.fn(() => Object.values(presets)),
      listCategorized: vi.fn(() => ({
        system: {
          showcase: [presets['13-solar-crown-eclipse']].filter(Boolean),
          flagship: [],
          classics: [presets['crown']].filter(Boolean),
        },
        user: {
          folders: [
            { folder: folders[0]!, entries: [presets['user-in-folder']].filter(Boolean) },
            { folder: folders[1]!, entries: [] },
          ],
          unfiled: [presets['user-1']].filter(Boolean),
        },
      })),
      getFolders: vi.fn(() => [...folders]),
      createFolder: vi.fn((name: string) => {
        const created = { id: `folder-${Date.now()}`, name, createdAt: Date.now() };
        folders.push(created);
        return created;
      }),
      renameFolder: vi.fn((folderId: string, newName: string) => {
        const found = folders.find((f) => f.id === folderId);
        if (found) found.name = newName;
      }),
      deleteFolder: vi.fn((folderId: string) => {
        const idx = folders.findIndex((f) => f.id === folderId);
        if (idx !== -1) folders.splice(idx, 1);
        for (const p of Object.values(presets)) {
          if (p.folderId === folderId) {
            p.folderId = undefined;
          }
        }
      }),
      getPresetFolder: vi.fn((presetId: string) => presets[presetId]?.folderId),
      setPresetFolder: vi.fn((presetId: string, folderId: string | undefined) => {
        if (presets[presetId]) presets[presetId].folderId = folderId;
      }),
      setPresetTags: vi.fn((presetId: string, tags: string[]) => {
        if (presets[presetId]) presets[presetId].preset.tags = [...tags];
      }),
      getSystemPresetSubfolder: vi.fn((id: string) => presets[id]?.subfolder ?? (id.startsWith('13') ? 'showcase' : 'classics')),
      setSystemPresetSubfolder: vi.fn((id: string, subfolder: string) => {
        if (presets[id]) presets[id].subfolder = subfolder as any;
      }),
      saveSystemPreset: vi.fn((id: string) => {
        if (!presets[id]?.builtin) throw new Error('Built-in presets are read-only. Use "Save as" to keep a copy.');
        presets[id].savedJson = JSON.stringify(presets[id].preset);
      }),
      removeSystemPreset: vi.fn((id: string) => {
        if (!presets[id]?.builtin) throw new Error('Not a system preset');
        delete presets[id];
      }),
      promoteToSystemPreset: vi.fn((userId: string, subfolder: string) => {
        const p = presets[userId];
        if (!p) throw new Error('Not found');
        const newId = `sys-${userId}`;
        presets[newId] = {
          ...p,
          id: newId,
          builtin: true,
          subfolder: subfolder as any,
          folderId: undefined,
          savedJson: JSON.stringify(p.preset),
        };
        delete presets[userId];
        return newId;
      }),
      isDirty: vi.fn(() => false),
      commit: vi.fn(),
      save: vi.fn((id: string) => {
        if (presets[id]?.builtin) throw new Error('Built-in presets are read-only. Use "Save as" to keep a copy.');
      }),
      saveAs: vi.fn((_fromId: string, _name: string) => `user-new-${Date.now()}`),
      duplicate: vi.fn((_fromId: string) => `user-dup-${Date.now()}`),
      remove: vi.fn(),
      canUndo: () => false,
      canRedo: () => false,
      undo: vi.fn(),
      redo: vi.fn(),
      sceneOf: () => ({ layers: [], setFeedback: vi.fn() }),
      refreshPost: vi.fn(),
      rebuild: vi.fn(),
      exportJson: () => '{}',
    } as any;

    let mockPaneInstance: any = null;
    const mockPaneFactory = () => {
      mockPaneInstance = createMockPane();
      return mockPaneInstance;
    };

    const switchTo = vi.fn((id: string) => {
      studio.bind(id);
    });

    const adminGateway = new AdminGateway({ mock: true, defaultAdmin: Boolean(testOptions?.admin) });

    const studio = new Studio(container as any, {
      session,
      switchTo,
      paneFactory: mockPaneFactory,
      adminGateway,
    });

    return { container, session, studio, getPane: () => mockPaneInstance, switchTo, folders, presets, adminGateway };
  }

describe('Slice 10.4: Studio User Folder Management UI & Read-Only Invariants', () => {

  it('renders read-only system preset affordances (category indicator, read-only name, disabled folder dropdown, hidden delete)', () => {
    const { studio, getPane, session } = setupTest();
    const showToastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => {});

    studio.bind('crown');
    const pane = getPane();

    // 1. Category indicator should be present with subfolder label
    const categoryBinding = pane.bindings.find((b: any) => b.prop === 'category');
    expect(categoryBinding).toBeDefined();
    expect(categoryBinding.options.readonly).toBe(true);
    expect(categoryBinding.target.category).toBe('System Preset (Read-Only) · Classics & Textures');

    // 2. Name field should be read-only
    const nameBinding = pane.bindings.find((b: any) => b.prop === 'name');
    expect(nameBinding).toBeDefined();
    expect(nameBinding.options.readonly).toBe(true);

    // 3. Folder assignment dropdown must NOT exist for built-ins
    const folderBinding = pane.bindings.find((b: any) => b.prop === 'folder');
    expect(folderBinding).toBeUndefined();

    // 4. Folder action buttons must NOT exist
    const renameFolderBtn = pane.buttons.find((b: any) => b.title === 'Rename folder');
    const deleteFolderBtn = pane.buttons.find((b: any) => b.title === 'Delete folder');
    const addFolderBtn = pane.buttons.find((b: any) => b.title === 'Add folder');
    expect(renameFolderBtn).toBeUndefined();
    expect(deleteFolderBtn).toBeUndefined();
    expect(addFolderBtn).toBeUndefined();

    // 5. Delete button must NOT exist for built-ins
    const deleteBtn = pane.buttons.find((b: any) => b.title === 'Delete');
    expect(deleteBtn).toBeUndefined();

    // 6. Save button should be read-only indicator and clicking shows toast
    const saveBtn = pane.buttons.find((b: any) => b.title.startsWith('Save (Read-only)'));
    expect(saveBtn).toBeDefined();
    saveBtn.fire('click');
    expect(showToastSpy).toHaveBeenCalledWith(expect.stringContaining('Built-in presets are read-only'));

    // 7. Save as and Duplicate buttons are active
    const saveAsBtn = pane.buttons.find((b: any) => b.title === 'Save as…');
    const duplicateBtn = pane.buttons.find((b: any) => b.title === 'Duplicate');
    expect(saveAsBtn).toBeDefined();
    expect(duplicateBtn).toBeDefined();

    // 8. Favourite toggle calls session.setPresetTags
    const favBinding = pane.bindings.find((b: any) => b.prop === 'favourite');
    expect(favBinding).toBeDefined();
    favBinding.fire('change', true);
    expect(session.setPresetTags).toHaveBeenCalledWith('crown', expect.arrayContaining(['favourite']));

    showToastSpy.mockRestore();
  });

  it('renders Showcase category indicator for Stage 9 showcase presets', () => {
    const { studio, getPane } = setupTest();
    studio.bind('13-solar-crown-eclipse');
    const pane = getPane();

    const categoryBinding = pane.bindings.find((b: any) => b.prop === 'category');
    expect(categoryBinding).toBeDefined();
    expect(categoryBinding.target.category).toBe('System Preset (Read-Only) · Stage 9 Showcase (13–20)');
  });

  it('renders user preset controls with folder assignment dropdown, editable name, and active Delete', () => {
    const { studio, getPane, session } = setupTest();
    studio.bind('user-1');
    const pane = getPane();

    // 1. Category indicator should NOT be present for user presets
    const categoryBinding = pane.bindings.find((b: any) => b.prop === 'category');
    expect(categoryBinding).toBeUndefined();

    // 2. Name should be editable (not read-only)
    const nameBinding = pane.bindings.find((b: any) => b.prop === 'name');
    expect(nameBinding).toBeDefined();
    expect(nameBinding.options.readonly).toBeFalsy();
    nameBinding.fire('change', 'New Name');
    expect(session.commit).toHaveBeenCalledWith('user-1');

    // 3. Folder assignment dropdown should be present
    const folderBinding = pane.bindings.find((b: any) => b.prop === 'folder');
    expect(folderBinding).toBeDefined();
    expect(folderBinding.options.label).toBe('Folder');
    expect(folderBinding.target.folder).toBe(''); // unfiled
    expect(folderBinding.options.options).toEqual(
      expect.objectContaining({
        '(Unfiled)': '',
        'Chill Beats': 'folder-chill',
        'High Energy': 'folder-energy',
        '+ New Folder…': '__new_folder__',
      }),
    );

    // 4. When unfiled, only "Add folder" button is shown (no Rename or Delete folder)
    expect(pane.buttons.find((b: any) => b.title === 'Rename folder')).toBeUndefined();
    expect(pane.buttons.find((b: any) => b.title === 'Delete folder')).toBeUndefined();
    expect(pane.buttons.find((b: any) => b.title === 'Add folder')).toBeDefined();

    // 5. Delete preset button is active
    expect(pane.buttons.find((b: any) => b.title === 'Delete')).toBeDefined();
  });

  it('moves preset to an existing user folder via folder dropdown', () => {
    const { studio, getPane, session } = setupTest();
    const showToastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => {});

    studio.bind('user-1');
    const pane = getPane();
    const folderBinding = pane.bindings.find((b: any) => b.prop === 'folder');

    // Move to "Chill Beats"
    folderBinding.fire('change', 'folder-chill');
    expect(session.setPresetFolder).toHaveBeenCalledWith('user-1', 'folder-chill');
    expect(showToastSpy).toHaveBeenCalledWith('Moved to Chill Beats');

    // After moving, studio rebinds: new pane instance should have 'folder-chill' selected and folder action buttons
    const updatedPane = getPane();
    const updatedFolderBinding = updatedPane.bindings.find((b: any) => b.prop === 'folder');
    expect(updatedFolderBinding.target.folder).toBe('folder-chill');
    expect(updatedPane.buttons.find((b: any) => b.title === 'Rename folder')).toBeDefined();
    expect(updatedPane.buttons.find((b: any) => b.title === 'Delete folder')).toBeDefined();

    showToastSpy.mockRestore();
  });

  it('unfiles preset when selecting (Unfiled) from folder dropdown', () => {
    const { studio, getPane, session } = setupTest();
    const showToastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => {});

    studio.bind('user-in-folder');
    const pane = getPane();
    const folderBinding = pane.bindings.find((b: any) => b.prop === 'folder');
    expect(folderBinding.target.folder).toBe('folder-chill');

    // Select "(Unfiled)" (empty string)
    folderBinding.fire('change', '');
    expect(session.setPresetFolder).toHaveBeenCalledWith('user-in-folder', undefined);
    expect(showToastSpy).toHaveBeenCalledWith('Preset unfiled');

    showToastSpy.mockRestore();
  });

  it('prompts and creates new folder when selecting "+ New Folder…" from dropdown', () => {
    const { studio, getPane, session } = setupTest();
    const showToastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => {});
    const promptSpy = vi.spyOn(studio, 'promptForFolderName').mockReturnValue('Synthetics');

    studio.bind('user-1');
    const pane = getPane();
    const folderBinding = pane.bindings.find((b: any) => b.prop === 'folder');

    folderBinding.fire('change', '__new_folder__');
    expect(promptSpy).toHaveBeenCalled();
    expect(session.createFolder).toHaveBeenCalledWith('Synthetics');
    expect(session.setPresetFolder).toHaveBeenCalledWith('user-1', expect.stringContaining('folder-'));
    expect(showToastSpy).toHaveBeenCalledWith(expect.stringContaining('Created folder "Synthetics"'));

    promptSpy.mockRestore();
    showToastSpy.mockRestore();
  });

  it('prompts and creates new folder when clicking "Add folder" button', () => {
    const { studio, getPane, session } = setupTest();
    const showToastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => {});
    const promptSpy = vi.spyOn(studio, 'promptForFolderName').mockReturnValue('Deep Focus');

    studio.bind('user-1');
    const pane = getPane();
    const addFolderBtn = pane.buttons.find((b: any) => b.title === 'Add folder');
    expect(addFolderBtn).toBeDefined();

    addFolderBtn.fire('click');
    expect(promptSpy).toHaveBeenCalled();
    expect(session.createFolder).toHaveBeenCalledWith('Deep Focus');
    expect(session.setPresetFolder).toHaveBeenCalledWith('user-1', expect.stringContaining('folder-'));
    expect(showToastSpy).toHaveBeenCalledWith(expect.stringContaining('Created folder "Deep Focus"'));

    promptSpy.mockRestore();
    showToastSpy.mockRestore();
  });

  it('renames folder when clicking "Rename folder" button', () => {
    const { studio, getPane, session } = setupTest();
    const showToastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => {});
    const promptSpy = vi.spyOn(studio, 'promptForFolderName').mockReturnValue('Lofi Beats');

    studio.bind('user-in-folder');
    const pane = getPane();
    const renameBtn = pane.buttons.find((b: any) => b.title === 'Rename folder');
    expect(renameBtn).toBeDefined();

    renameBtn.fire('click');
    expect(promptSpy).toHaveBeenCalledWith(expect.stringContaining('Rename folder "Chill Beats"'), 'Chill Beats');
    expect(session.renameFolder).toHaveBeenCalledWith('folder-chill', 'Lofi Beats');
    expect(showToastSpy).toHaveBeenCalledWith('Folder renamed to "Lofi Beats"');

    promptSpy.mockRestore();
    showToastSpy.mockRestore();
  });

  it('deletes folder with confirmation when clicking "Delete folder" button and unfiles presets', () => {
    const { studio, getPane, session } = setupTest();
    const showToastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => {});
    const confirmSpy = vi.spyOn(studio, 'confirmAction').mockReturnValue(true);

    studio.bind('user-in-folder');
    const pane = getPane();
    const deleteFolderBtn = pane.buttons.find((b: any) => b.title === 'Delete folder');
    expect(deleteFolderBtn).toBeDefined();

    deleteFolderBtn.fire('click');
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Delete folder "Chill Beats"? Presets inside will be moved to Unfiled.'));
    expect(session.deleteFolder).toHaveBeenCalledWith('folder-chill');
    expect(showToastSpy).toHaveBeenCalledWith('Folder "Chill Beats" deleted');

    // After folder deletion, the preset is unfiled
    const updatedPane = getPane();
    const updatedFolderBinding = updatedPane.bindings.find((b: any) => b.prop === 'folder');
    expect(updatedFolderBinding.target.folder).toBe('');
    expect(updatedPane.buttons.find((b: any) => b.title === 'Rename folder')).toBeUndefined();
    expect(updatedPane.buttons.find((b: any) => b.title === 'Delete folder')).toBeUndefined();

    confirmSpy.mockRestore();
    showToastSpy.mockRestore();
  });

  it('cancelling prompt or confirm does not create, rename, or delete folders', () => {
    const { studio, session } = setupTest();
    const promptSpy = vi.spyOn(studio, 'promptForFolderName').mockReturnValue(null);
    const confirmSpy = vi.spyOn(studio, 'confirmAction').mockReturnValue(false);

    // Cancel create
    studio.bind('user-1');
    studio.handleNewFolder('user-1');
    expect(session.createFolder).not.toHaveBeenCalled();

    // Cancel rename
    studio.bind('user-in-folder');
    studio.handleRenameFolder('user-in-folder', 'folder-chill');
    expect(session.renameFolder).not.toHaveBeenCalled();

    // Cancel delete
    studio.handleDeleteFolder('user-in-folder', 'folder-chill');
    expect(session.deleteFolder).not.toHaveBeenCalled();

    promptSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  it('studio.refresh() rebinds and synchronizes state', () => {
    const { studio, getPane } = setupTest();
    studio.bind('user-1');
    const paneBefore = getPane();

    studio.refresh();
    const paneAfter = getPane();
    expect(paneAfter).not.toBeNull();
    expect(paneAfter).not.toBe(paneBefore);
  });
});

describe('Slice 11.4: Studio Admin UI Controls & System Preset Management', () => {
  it('renders read-only system preset affordances when not in admin mode', () => {
    const { studio, getPane } = setupTest({ admin: false });
    const showToastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => {});

    studio.bind('crown');
    const pane = getPane();

    expect(studio.isAdmin()).toBe(false);

    // 1. Category indicator should be read-only
    const categoryBinding = pane.bindings.find((b: any) => b.prop === 'category');
    expect(categoryBinding).toBeDefined();
    expect(categoryBinding.options.readonly).toBe(true);
    expect(categoryBinding.target.category).toBe('System Preset (Read-Only) · Classics & Textures');

    // 2. Name is read-only
    const nameBinding = pane.bindings.find((b: any) => b.prop === 'name');
    expect(nameBinding.options.readonly).toBe(true);

    // 3. Save button is read-only with warning toast
    const saveBtn = pane.buttons.find((b: any) => b.title === 'Save (Read-only)');
    expect(saveBtn).toBeDefined();
    saveBtn.fire('click');
    expect(showToastSpy).toHaveBeenCalledWith('Built-in presets are read-only. Use "Save as…" to keep a copy.');

    // 4. Delete button is hidden
    const deleteBtn = pane.buttons.find((b: any) => b.title === 'Delete');
    expect(deleteBtn).toBeUndefined();

    // 5. Admin mode is inactive: no badge, and Admin Access button shown
    expect(studio.adminBadge).toBeNull();
    const adminBtn = pane.buttons.find((b: any) => b.title === 'Admin Access');
    expect(adminBtn).toBeDefined();

    showToastSpy.mockRestore();
  });

  it('unlocks system preset controls in admin mode (editable name, subfolder selector, Save System Preset, 2-tap delete)', () => {
    const { studio, getPane, session } = setupTest({ admin: true });
    const showToastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => {});

    studio.bind('crown');
    const pane = getPane();

    expect(studio.isAdmin()).toBe(true);

    // 1. Admin badge should be displayed
    expect(studio.adminBadge).not.toBeNull();
    expect(studio.adminBadge?.textContent).toBe(ADMIN_BADGE_LABEL);

    // 2. Read-only category indicator replaced with editable subfolder dropdown
    const categoryBinding = pane.bindings.find((b: any) => b.prop === 'category');
    expect(categoryBinding).toBeUndefined();

    const subfolderBinding = pane.bindings.find((b: any) => b.prop === 'subfolder');
    expect(subfolderBinding).toBeDefined();
    expect(subfolderBinding.options.label).toBe('Subfolder');
    expect(subfolderBinding.target.subfolder).toBe('classics');
    expect(subfolderBinding.options.options).toEqual(
      expect.objectContaining({
        'Stage 9 Showcase (13–20)': 'showcase',
        'Flagship Generative (01–12)': 'flagship',
        'Classics & Textures': 'classics',
      }),
    );

    // Move to flagship subfolder
    subfolderBinding.fire('change', 'flagship');
    expect(session.setSystemPresetSubfolder).toHaveBeenCalledWith('crown', 'flagship');
    expect(showToastSpy).toHaveBeenCalledWith('Moved to Flagship Generative (01–12)');

    // 3. Name is editable
    const nameBinding = pane.bindings.find((b: any) => b.prop === 'name');
    expect(nameBinding.options.readonly).toBe(false);
    nameBinding.fire('change', 'Crown Remastered');
    expect(session.commit).toHaveBeenCalledWith('crown');

    // 4. Save System Preset button is active
    const saveBtn = pane.buttons.find((b: any) => b.title.includes('Save System Preset 👑'));
    expect(saveBtn).toBeDefined();
    saveBtn.fire('click');
    expect(session.saveSystemPreset).toHaveBeenCalledWith('crown');
    expect(showToastSpy).toHaveBeenCalledWith('System preset saved');

    // 5. Delete button is present with 2-tap confirmation protocol
    const deleteBtn = pane.buttons.find((b: any) => b.title === 'Delete');
    expect(deleteBtn).toBeDefined();

    // First tap arms delete
    deleteBtn.fire('click');
    expect(deleteBtn.title).toBe('Tap again to delete');
    expect(session.removeSystemPreset).not.toHaveBeenCalled();

    // Second tap confirms delete
    deleteBtn.fire('click');
    expect(session.removeSystemPreset).toHaveBeenCalledWith('crown');
    expect(showToastSpy).toHaveBeenCalledWith('System preset deleted');

    showToastSpy.mockRestore();
  });

  it('renders "Promote to System Preset 👑" button for user presets in admin mode', () => {
    const { studio, getPane, session, switchTo } = setupTest({ admin: true });
    const showToastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => {});
    const promptSpy = vi.spyOn(studio, 'promptForAdminInput').mockReturnValue('flagship');

    studio.bind('user-1');
    const pane = getPane();

    // Promote button should be available
    const promoteBtn = pane.buttons.find((b: any) => b.title === 'Promote to System Preset 👑');
    expect(promoteBtn).toBeDefined();

    promoteBtn.fire('click');
    expect(promptSpy).toHaveBeenCalled();
    expect(session.promoteToSystemPreset).toHaveBeenCalledWith('user-1', 'flagship');
    expect(showToastSpy).toHaveBeenCalledWith('Promoted to system preset 👑');
    expect(switchTo).toHaveBeenCalledWith('sys-user-1');

    promptSpy.mockRestore();
    showToastSpy.mockRestore();
  });

  it('cancelling promote prompt aborts promotion', () => {
    const { studio, getPane, session } = setupTest({ admin: true });
    const promptSpy = vi.spyOn(studio, 'promptForAdminInput').mockReturnValue(null);

    studio.bind('user-1');
    const pane = getPane();
    const promoteBtn = pane.buttons.find((b: any) => b.title === 'Promote to System Preset 👑');
    promoteBtn.fire('click');

    expect(promptSpy).toHaveBeenCalled();
    expect(session.promoteToSystemPreset).not.toHaveBeenCalled();

    promptSpy.mockRestore();
  });

  it('supports admin login and logout lifecycle with dynamic UI refresh', async () => {
    const { studio, getPane, adminGateway } = setupTest({ admin: false });
    const showToastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => {});

    studio.bind('crown');
    expect(studio.isAdmin()).toBe(false);
    expect(studio.adminBadge).toBeNull();
    let pane = getPane();
    expect(pane.buttons.find((b: any) => b.title === 'Delete')).toBeUndefined();

    // Simulate a verified Cloudflare Access identity from the Worker
    vi.spyOn(adminGateway, 'checkCloudflareAccess').mockImplementation(async () => {
      (adminGateway as any).state = { isAdmin: true, adminEmail: 'admin@music-visualizer.com', role: 'admin' };
      (adminGateway as any).notifyListeners();
      return true;
    });
    const res = await studio.handleAdminLogin();
    expect(res.success).toBe(true);
    expect(studio.isAdmin()).toBe(true);

    // UI should have refreshed into admin mode
    pane = getPane();
    expect(studio.adminBadge).not.toBeNull();
    expect(studio.adminBadge?.textContent).toBe(ADMIN_BADGE_LABEL);
    expect(pane.buttons.find((b: any) => b.title.includes('Save System Preset 👑'))).toBeDefined();
    expect(pane.buttons.find((b: any) => b.title === 'Delete')).toBeDefined();

    // Logout
    adminLogout(adminGateway);
    expect(studio.isAdmin()).toBe(false);
    expect(showToastSpy).toHaveBeenCalledWith('Exited Admin Mode');

    // UI should have refreshed back to user mode
    pane = getPane();
    expect(studio.adminBadge).toBeNull();
    expect(pane.buttons.find((b: any) => b.title === 'Save (Read-only)')).toBeDefined();
    expect(pane.buttons.find((b: any) => b.title === 'Delete')).toBeUndefined();

    showToastSpy.mockRestore();
  });

  it('syncActivePresetInUI updates both preset dropdown and panel binding', () => {
    const { studio, getPane } = setupTest();
    studio.bind('crown');
    const paneBefore = getPane();

    studio.syncActivePresetInUI('user-1');
    const paneAfter = getPane();

    expect(paneAfter).not.toBe(paneBefore);
    const nameBinding = paneAfter.bindings.find((b: any) => b.prop === 'name');
    expect(nameBinding.target.name).toBe('Custom Ambient');
  });

  it('adminControls helper functions work as expected', async () => {
    const container = createMockElement('div');
    const head = createMockElement('div');
    head.className = 'studio-head';
    container.appendChild(head);

    // 1. renderAdminBadge
    const badge = renderAdminBadge(container as any, true);
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe(ADMIN_BADGE_LABEL);

    // Call again returns existing badge
    const badge2 = renderAdminBadge(container as any, true);
    expect(badge2).toBe(badge);

    // Remove badge
    const removed = renderAdminBadge(container as any, false);
    expect(removed).toBeNull();

    // 2. promptAdminLogin
    const mockGateway = new AdminGateway({ mock: true });
    const showToastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => {});

    // No Cloudflare Access identity locally: there is no passkey fallback
    const deniedRes = await promptAdminLogin(mockGateway, () => 'secret-key');
    expect(deniedRes.success).toBe(false);
    expect(mockGateway.isAdmin()).toBe(false);

    // 3. saveSystemPresetAction & deleteSystemPresetAction
    const mockSession = {
      saveSystemPreset: vi.fn(),
      removeSystemPreset: vi.fn(),
      promoteToSystemPreset: vi.fn(() => 'sys-promoted'),
    } as any;

    saveSystemPresetAction(mockSession, 'sys-1');
    expect(mockSession.saveSystemPreset).toHaveBeenCalledWith('sys-1');
    expect(showToastSpy).toHaveBeenCalledWith('System preset saved');

    deleteSystemPresetAction(mockSession, 'sys-1');
    expect(mockSession.removeSystemPreset).toHaveBeenCalledWith('sys-1');
    expect(showToastSpy).toHaveBeenCalledWith('System preset deleted');

    // 4. promoteUserPresetAction
    const promotedId = promoteUserPresetAction(mockSession, 'u-1', () => 'SHOWCASE');
    expect(mockSession.promoteToSystemPreset).toHaveBeenCalledWith('u-1', 'showcase');
    expect(promotedId).toBe('sys-promoted');

    // Default to classics when unknown
    promoteUserPresetAction(mockSession, 'u-2', () => 'unknown-folder');
    expect(mockSession.promoteToSystemPreset).toHaveBeenCalledWith('u-2', 'classics');

    // Null cancels
    const cancelledId = promoteUserPresetAction(mockSession, 'u-3', () => null);
    expect(cancelledId).toBeNull();

    showToastSpy.mockRestore();
  });
});

describe('Studio Expand All and Collapse All buttons', () => {
  it('bindSection returns created section and group folders', () => {
    const pane = createMockPane();
    const specs = LAYER_SPECS.tunnel!;
    const layer = defaultLayer('tunnel');
    const { folders } = bindSection(pane, 'Tunnel', specs, layer.params);

    expect(folders.length).toBeGreaterThan(0);
    // Initially all created folders should start collapsed
    for (const f of folders) {
      expect(f.expanded).toBe(false);
    }
  });

  it('renders Expand All and Collapse All buttons that toggle folder expansion', () => {
    const container = createMockElement('div');
    const body = createMockElement('div');
    body.className = 'studio-body';
    container.appendChild(body);

    let activePane: any = null;
    const mockPaneFactory = () => {
      activePane = createMockPane();
      return activePane;
    };

    const session: any = {
      get: vi.fn().mockReturnValue({
        id: 'test',
        preset: {
          name: 'Test',
          tags: [],
          transition: { style: 'crossfade', seconds: 0.5 },
          feedback: {},
          layers: [{ type: 'tunnel', enabled: true, opacity: 1, blend: 'add', params: {} }],
          post: {},
        },
      }),
      list: vi.fn().mockReturnValue([]),
      listCategorized: vi.fn().mockReturnValue({
        system: { showcase: [], flagship: [], classics: [] },
        user: { folders: [], unfiled: [] },
      }),
      isDirty: vi.fn().mockReturnValue(false),
      canUndo: () => false,
      canRedo: () => false,
      undo: vi.fn(),
      redo: vi.fn(),
      sceneOf: vi.fn().mockReturnValue({ layers: [{}], setFeedback: vi.fn() }),
      commit: vi.fn(),
      refreshPost: vi.fn(),
      isSolo: () => false,
      isMuted: () => false,
      monitorOf: () => undefined,
    };

    const studio = new Studio(container as any, {
      session,
      switchTo: vi.fn(),
      paneFactory: mockPaneFactory,
    });

    studio.bind('test');

    const expandBtn = activePane.buttons.find((b: any) => b.title === 'Expand All');
    const collapseBtn = activePane.buttons.find((b: any) => b.title === 'Collapse All');

    expect(expandBtn).toBeDefined();
    expect(collapseBtn).toBeDefined();

    // Trigger Expand All
    expandBtn.fire('click');
    expect(activePane.folders.length).toBeGreaterThan(0);
    for (const entry of activePane.folders) {
      expect(entry.folder.expanded).toBe(true);
    }

    // Trigger Collapse All
    collapseBtn.fire('click');
    for (const entry of activePane.folders) {
      expect(entry.folder.expanded).toBe(false);
    }
  });
});

describe('Slice 23.3: Studio Display time control', () => {
  it('shows a Display time binding that defaults to 0 when the preset has no displaySec', () => {
    const { studio, getPane } = setupTest();
    studio.bind('user-1');
    const pane = getPane();
    const displayBinding = pane.bindings.find((b: any) => b.options?.label === 'Display time (s, 0 = auto-cycle timer)');
    expect(displayBinding).toBeDefined();
    expect(displayBinding.target.displaySec).toBe(0);
    expect(displayBinding.options).toEqual(expect.objectContaining({ min: 0, max: 300, step: 1 }));
  });

  it('stores displaySec on the preset and commits when set to 45', () => {
    const { studio, getPane, session } = setupTest();
    studio.bind('user-1');
    const displayBinding = getPane().bindings.find((b: any) => b.options?.label === 'Display time (s, 0 = auto-cycle timer)');
    displayBinding.fire('change', 45);
    expect(session.get('user-1').preset.displaySec).toBe(45);
    expect(session.commit).toHaveBeenCalledWith('user-1');
  });

  it('removes displaySec when set to 0', () => {
    const { studio, getPane, session } = setupTest();
    studio.bind('user-1');
    session.get('user-1').preset.displaySec = 45;
    const displayBinding = getPane().bindings.find((b: any) => b.options?.label === 'Display time (s, 0 = auto-cycle timer)');
    displayBinding.fire('change', 0);
    expect('displaySec' in session.get('user-1').preset).toBe(false);
    expect(session.commit).toHaveBeenCalledWith('user-1');
  });

  it('removes displaySec when set below the 5 second minimum', () => {
    const { studio, getPane, session } = setupTest();
    studio.bind('user-1');
    session.get('user-1').preset.displaySec = 45;
    const displayBinding = getPane().bindings.find((b: any) => b.options?.label === 'Display time (s, 0 = auto-cycle timer)');
    displayBinding.fire('change', 3);
    expect('displaySec' in session.get('user-1').preset).toBe(false);
  });
});

describe('Slice 11.7: Non-Disruptive Studio Admin Login Popup & Background Session Detection', () => {
  it('Studio.setVisible(true) triggers adminGateway.checkCloudflareAccess() when not yet admin', async () => {
    const { container, studio, adminGateway } = setupTest({ admin: false });
    container.hidden = true;

    const checkSpy = vi
      .spyOn(adminGateway, 'checkCloudflareAccess')
      .mockResolvedValue(true);

    studio.setVisible(true);

    expect(container.hidden).toBe(false);
    expect(checkSpy).toHaveBeenCalledTimes(1);

    checkSpy.mockRestore();
  });

  it('promptAdminLogin in production mode opens /admin popup and completes authentication via mv-admin-authenticated message event without reload', async () => {
    const showToastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => {});
    const prevWindow = (globalThis as any).window;
    const messageListeners: ((ev: any) => void)[] = [];
    const mockPopup = {
      closed: false,
      close: vi.fn(() => {
        mockPopup.closed = true;
      }),
    };

    const mockWindow = {
      location: {
        hostname: 'music-visualizer.charliechonguyen.com',
        origin: 'https://music-visualizer.charliechonguyen.com',
        href: 'https://music-visualizer.charliechonguyen.com/',
      },
      screenX: 0,
      screenY: 0,
      outerWidth: 1280,
      outerHeight: 800,
      open: vi.fn(() => mockPopup),
      addEventListener: vi.fn((type: string, cb: (ev: any) => void) => {
        if (type === 'message') messageListeners.push(cb);
      }),
      removeEventListener: vi.fn((type: string, cb: (ev: any) => void) => {
        if (type === 'message') {
          const idx = messageListeners.indexOf(cb);
          if (idx >= 0) messageListeners.splice(idx, 1);
        }
      }),
    };
    (globalThis as any).window = mockWindow;

    try {
      let verifiedState = false;
      const mockGateway = {
        isAdmin: () => verifiedState,
        getState: () => ({
          isAdmin: verifiedState,
          adminEmail: 'charliechonguyen@gmail.com',
        }),
        login: vi.fn(),
        logout: vi.fn(),
        getHeaders: () => ({}),
        subscribe: () => () => {},
        checkCloudflareAccess: vi.fn(async () => verifiedState),
      };

      const loginPromise = promptAdminLogin(mockGateway as any);
      // The cookie pre-check runs before the popup opens.
      await new Promise((r) => setTimeout(r, 0));

      expect(mockWindow.open).toHaveBeenCalledWith(
        '/admin?popup=1',
        'mv-cf-access',
        expect.stringContaining('popup,width=520,height=680'),
      );

      // Simulate popup completing Cloudflare Access OTP and posting mv-admin-authenticated
      verifiedState = true;
      for (const listener of [...messageListeners]) {
        listener({
          origin: 'https://music-visualizer.charliechonguyen.com',
          data: { type: 'mv-admin-authenticated', verified: true },
        });
      }

      const result = await loginPromise;
      expect(result).toEqual({ success: true });
      expect(mockPopup.close).toHaveBeenCalled();
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    } finally {
      (globalThis as any).window = prevWindow;
      showToastSpy.mockRestore();
    }
  });

  it('promptAdminLogin in production mode falls back to /admin navigation and sets sessionStorage mv.returnToStudio when popup is blocked or navigateFn is provided', async () => {
    const showToastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => {});
    const prevWindow = (globalThis as any).window;
    const prevSessionStorage = (globalThis as any).sessionStorage;

    const storageMap = new Map<string, string>();
    const mockSessionStorage = {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => void storageMap.set(k, v),
      removeItem: (k: string) => void storageMap.delete(k),
    };
    (globalThis as any).sessionStorage = mockSessionStorage;

    const mockWindow = {
      location: {
        hostname: 'music-visualizer.charliechonguyen.com',
        origin: 'https://music-visualizer.charliechonguyen.com',
        href: 'https://music-visualizer.charliechonguyen.com/',
      },
      open: vi.fn(() => null), // Simulate popup blocker returning null
    };
    (globalThis as any).window = mockWindow;

    try {
      const mockGateway = {
        isAdmin: () => false,
        getState: () => ({ isAdmin: false }),
        login: vi.fn(),
        logout: vi.fn(),
        getHeaders: () => ({}),
        subscribe: () => () => {},
        checkCloudflareAccess: vi.fn(async () => false),
      };

      // 1. With custom navigateFn
      const navFn = vi.fn();
      const res1 = await promptAdminLogin(mockGateway as any, undefined, navFn);
      expect(res1.success).toBe(false);
      expect(navFn).toHaveBeenCalledWith('/admin');
      expect(mockSessionStorage.getItem('mv.returnToStudio')).toBe('true');

      storageMap.clear();

      // 2. With blocked popup (window.open returns null)
      const res2 = await promptAdminLogin(mockGateway as any);
      expect(res2.success).toBe(false);
      expect(mockWindow.open).toHaveBeenCalled();
      expect(mockSessionStorage.getItem('mv.returnToStudio')).toBe('true');
      expect(mockWindow.location.href).toBe('/admin');
    } finally {
      (globalThis as any).window = prevWindow;
      (globalThis as any).sessionStorage = prevSessionStorage;
      showToastSpy.mockRestore();
    }
  });
});

describe('Slice 11.10: Admin login popup survives the Cloudflare login redirect', () => {
  const ORIGIN = 'https://music-visualizer.charliechonguyen.com';
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  const COOKIE_SIGNAL = { type: 'mv-admin-authenticated', verified: true, ts: 1 };

  class FakeBroadcastChannel {
    static instances: FakeBroadcastChannel[] = [];
    name: string;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    close = vi.fn();
    constructor(name: string) {
      this.name = name;
      FakeBroadcastChannel.instances.push(this);
    }
    postMessage() {}
  }

  function setupPopupEnv(options: { popupBlocked?: boolean } = {}) {
    const showToastSpy = vi.spyOn(toastModule, 'showToast').mockImplementation(() => {});
    const prevWindow = (globalThis as any).window;
    const prevBroadcastChannel = (globalThis as any).BroadcastChannel;
    const listeners: Record<string, Array<(ev: any) => void>> = {};
    const popup = {
      closed: false,
      close: vi.fn(() => {
        popup.closed = true;
      }),
    };
    const mockWindow: any = {
      location: {
        hostname: 'music-visualizer.charliechonguyen.com',
        origin: ORIGIN,
        href: `${ORIGIN}/`,
      },
      screenX: 0,
      screenY: 0,
      outerWidth: 1280,
      outerHeight: 800,
      open: vi.fn(() => (options.popupBlocked ? null : popup)),
      addEventListener: vi.fn((type: string, cb: (ev: any) => void) => {
        (listeners[type] ??= []).push(cb);
      }),
      removeEventListener: vi.fn((type: string, cb: (ev: any) => void) => {
        const arr = listeners[type] ?? [];
        const idx = arr.indexOf(cb);
        if (idx >= 0) arr.splice(idx, 1);
      }),
    };
    (globalThis as any).window = mockWindow;
    (globalThis as any).BroadcastChannel = FakeBroadcastChannel;
    FakeBroadcastChannel.instances = [];

    // Models the real gateway: a valid Access session makes checkCloudflareAccess succeed and grant admin.
    let sessionValid = false;
    let adminState = false;
    const gateway = {
      isAdmin: () => adminState,
      getState: () => ({ isAdmin: adminState, adminEmail: 'charliechonguyen@gmail.com' }),
      login: vi.fn(),
      logout: vi.fn(),
      getHeaders: () => ({}),
      subscribe: () => () => {},
      checkCloudflareAccess: vi.fn(async () => {
        if (sessionValid) adminState = true;
        return sessionValid;
      }),
    };

    const fire = (type: string, ev: any) => {
      for (const cb of [...(listeners[type] ?? [])]) cb(ev);
    };
    const fireBroadcast = (data: unknown) => {
      for (const ch of [...FakeBroadcastChannel.instances]) ch.onmessage?.({ data });
    };

    const restore = () => {
      (globalThis as any).window = prevWindow;
      if (prevBroadcastChannel === undefined) {
        delete (globalThis as any).BroadcastChannel;
      } else {
        (globalThis as any).BroadcastChannel = prevBroadcastChannel;
      }
      showToastSpy.mockRestore();
      vi.useRealTimers();
    };

    return {
      gateway,
      mockWindow,
      popup,
      listeners,
      fire,
      fireBroadcast,
      restore,
      setSessionValid: (v: boolean) => {
        sessionValid = v;
      },
    };
  }

  it('cookie already valid: succeeds without opening a popup', async () => {
    const env = setupPopupEnv();
    try {
      env.setSessionValid(true);
      const res = await promptAdminLogin(env.gateway as any);
      expect(res).toEqual({ success: true });
      expect(env.mockWindow.open).not.toHaveBeenCalled();
    } finally {
      env.restore();
    }
  });

  it('opens the popup at /admin?popup=1 with the centred window features', async () => {
    const env = setupPopupEnv();
    try {
      const loginPromise = promptAdminLogin(env.gateway as any);
      await flush();
      expect(env.mockWindow.open).toHaveBeenCalledWith(
        '/admin?popup=1',
        'mv-cf-access',
        expect.stringMatching(/^popup,width=520,height=680,left=\d+,top=\d+$/),
      );
      env.setSessionValid(true);
      env.fireBroadcast(COOKIE_SIGNAL);
      await expect(loginPromise).resolves.toEqual({ success: true });
    } finally {
      env.restore();
    }
  });

  it('a BroadcastChannel signal completes the login via a check (not via the signal alone)', async () => {
    const env = setupPopupEnv();
    try {
      const loginPromise = promptAdminLogin(env.gateway as any);
      await flush();
      const checksBefore = env.gateway.checkCloudflareAccess.mock.calls.length;

      env.setSessionValid(true);
      env.fireBroadcast(COOKIE_SIGNAL);

      await expect(loginPromise).resolves.toEqual({ success: true });
      expect(env.gateway.checkCloudflareAccess.mock.calls.length).toBeGreaterThan(checksBefore);
      expect(env.popup.close).toHaveBeenCalled();
      expect(FakeBroadcastChannel.instances[0]?.close).toHaveBeenCalled();
      expect(env.listeners.storage ?? []).toHaveLength(0);
      expect(env.listeners.focus ?? []).toHaveLength(0);
    } finally {
      env.restore();
    }
  });

  it('a storage signal (mv.adminAuthSignal) completes the login', async () => {
    const env = setupPopupEnv();
    try {
      const loginPromise = promptAdminLogin(env.gateway as any);
      await flush();

      env.setSessionValid(true);
      env.fire('storage', {
        key: 'mv.adminAuthSignal',
        newValue: JSON.stringify(COOKIE_SIGNAL),
      });

      await expect(loginPromise).resolves.toEqual({ success: true });
      expect(env.popup.close).toHaveBeenCalled();
    } finally {
      env.restore();
    }
  });

  it('a same-origin message with the verified signal completes the login; a foreign origin does not', async () => {
    const env = setupPopupEnv();
    try {
      const loginPromise = promptAdminLogin(env.gateway as any);
      await flush();

      env.setSessionValid(true);
      env.fire('message', { origin: 'https://evil.example', data: COOKIE_SIGNAL });
      await flush();
      expect(env.popup.close).not.toHaveBeenCalled();

      env.fire('message', { origin: ORIGIN, data: COOKIE_SIGNAL });
      await expect(loginPromise).resolves.toEqual({ success: true });
    } finally {
      env.restore();
    }
  });

  it('popup.closed true right after open does not cancel; a later signal still succeeds', async () => {
    const env = setupPopupEnv();
    try {
      const loginPromise = promptAdminLogin(env.gateway as any);
      let settled = false;
      void loginPromise.then(() => {
        settled = true;
      });
      await flush();

      // COOP makes popup.closed read true while the Cloudflare login page is still open.
      env.popup.closed = true;
      await flush();
      expect(settled).toBe(false);

      env.setSessionValid(true);
      env.fireBroadcast(COOKIE_SIGNAL);
      await expect(loginPromise).resolves.toEqual({ success: true });
    } finally {
      env.restore();
    }
  });

  it('focus with a closed popup and a failed check cancels the login', async () => {
    const env = setupPopupEnv();
    try {
      const loginPromise = promptAdminLogin(env.gateway as any);
      await flush();

      env.popup.closed = true;
      env.fire('focus', {});

      await expect(loginPromise).resolves.toEqual({
        success: false,
        error: 'Authentication cancelled or not completed.',
      });
      expect(env.listeners.message ?? []).toHaveLength(0);
    } finally {
      env.restore();
    }
  });

  it('focus with the popup still open and a failed check does not cancel', async () => {
    const env = setupPopupEnv();
    try {
      const loginPromise = promptAdminLogin(env.gateway as any);
      let settled = false;
      void loginPromise.then(() => {
        settled = true;
      });
      await flush();

      env.fire('focus', {});
      await flush();
      expect(settled).toBe(false);

      env.setSessionValid(true);
      env.fireBroadcast(COOKIE_SIGNAL);
      await expect(loginPromise).resolves.toEqual({ success: true });
    } finally {
      env.restore();
    }
  });

  it('a signal with verified:false does nothing', async () => {
    const env = setupPopupEnv();
    try {
      const loginPromise = promptAdminLogin(env.gateway as any);
      let settled = false;
      void loginPromise.then(() => {
        settled = true;
      });
      await flush();
      const checksBefore = env.gateway.checkCloudflareAccess.mock.calls.length;

      env.fireBroadcast({ type: 'mv-admin-authenticated', verified: false, ts: 2 });
      env.fire('storage', {
        key: 'mv.adminAuthSignal',
        newValue: JSON.stringify({ type: 'mv-admin-authenticated', verified: false }),
      });
      env.fire('message', {
        origin: ORIGIN,
        data: { type: 'mv-admin-authenticated', verified: false },
      });
      await flush();

      expect(env.gateway.checkCloudflareAccess.mock.calls.length).toBe(checksBefore);
      expect(settled).toBe(false);
      expect(env.popup.close).not.toHaveBeenCalled();

      env.setSessionValid(true);
      env.fireBroadcast(COOKIE_SIGNAL);
      await expect(loginPromise).resolves.toEqual({ success: true });
    } finally {
      env.restore();
    }
  });

  it('no verified login within 120 s resolves with "Login timed out"', async () => {
    const env = setupPopupEnv();
    try {
      vi.useFakeTimers();
      const loginPromise = promptAdminLogin(env.gateway as any);
      await vi.advanceTimersByTimeAsync(1);
      expect(env.mockWindow.open).toHaveBeenCalled();

      // Polls every 2 s run without cancelling; the overall timeout settles the flow.
      await vi.advanceTimersByTimeAsync(ADMIN_POPUP_TIMEOUT_MS);
      await expect(loginPromise).resolves.toEqual({
        success: false,
        error: 'Login timed out',
      });
      expect(env.listeners.message ?? []).toHaveLength(0);
      expect(env.listeners.focus ?? []).toHaveLength(0);
    } finally {
      env.restore();
    }
  });

  it('the cookie pre-check is capped at its timeout when the check hangs', async () => {
    const env = setupPopupEnv();
    try {
      vi.useFakeTimers();
      (env.gateway.checkCloudflareAccess as any).mockImplementationOnce(() => new Promise(() => {}));
      const loginPromise = promptAdminLogin(env.gateway as any);
      await vi.advanceTimersByTimeAsync(ADMIN_PRECHECK_TIMEOUT_MS);
      expect(env.mockWindow.open).toHaveBeenCalledWith(
        '/admin?popup=1',
        'mv-cf-access',
        expect.any(String),
      );
      env.setSessionValid(true);
      env.fireBroadcast(COOKIE_SIGNAL);
      await expect(loginPromise).resolves.toEqual({ success: true });
    } finally {
      env.restore();
    }
  });

  it('popup blocked: falls back to top-level /admin navigation', async () => {
    const env = setupPopupEnv({ popupBlocked: true });
    try {
      const res = await promptAdminLogin(env.gateway as any);
      expect(res.success).toBe(false);
      expect(env.mockWindow.open).toHaveBeenCalledWith(
        '/admin?popup=1',
        'mv-cf-access',
        expect.any(String),
      );
      expect(env.mockWindow.location.href).toBe('/admin');
    } finally {
      env.restore();
    }
  });
});

describe('Feedback and Post regrouped into Motion, Warp, Trails, Colour (Slice 15.2)', () => {
  const GROUPS = ['Motion', 'Warp', 'Trails', 'Colour'];
  const feedbackNames = SCHEMAS.feedback.map((s) => s.name);
  const postNames = SCHEMAS.post.map((s) => s.name);

  it('every old Feedback and Post key has exactly one new home in the four groups', () => {
    for (const name of [...feedbackNames, ...postNames]) {
      const group = feedbackPostGroupOf(name);
      expect(group, `key "${name}" has no new group`).toBeDefined();
      expect(GROUPS).toContain(group);
    }
    const listed = Object.values(FEEDBACK_POST_LAYOUT).flat();
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('maps the old keys the stage notes name to the expected groups', () => {
    expect(feedbackPostGroupOf('mirror')).toBe('Warp');
    expect(feedbackPostGroupOf('kaleidoN')).toBe('Warp');
    for (const k of ['hueDrift', 'hueShift', 'saturation', 'solarize']) expect(feedbackPostGroupOf(k)).toBe('Colour');
    for (const k of ['decay', 'fade', 'blur']) expect(feedbackPostGroupOf(k)).toBe('Trails');
    for (const k of ['zoom', 'rotate', 'driftX']) expect(feedbackPostGroupOf(k)).toBe('Motion');
  });

  it('both kaleidoscopes and both hue controls share one group each, with distinct clear labels', () => {
    const laid = layoutFeedbackPost(SCHEMAS.feedback, SCHEMAS.post);
    const find = (n: string) => laid.find((s) => s.name === n)!;
    expect(find('mirror').uiGroup).toBe(find('kaleidoN').uiGroup);
    expect(find('hueDrift').uiGroup).toBe(find('hueShift').uiGroup);
    expect(find('mirror').label).not.toBe(find('kaleidoN').label);
    expect(find('hueDrift').label).not.toBe(find('hueShift').label);
  });

  it('layout keeps every spec once, keeps names, defaults and showWhen rules', () => {
    const laid = layoutFeedbackPost(SCHEMAS.feedback, SCHEMAS.post);
    const all = [...SCHEMAS.feedback, ...SCHEMAS.post];
    expect(laid.map((s) => s.name).sort()).toEqual(all.map((s) => s.name).sort());
    for (const s of laid) {
      const orig = all.find((o) => o.name === s.name)!;
      expect(s.default).toEqual(orig.default);
      expect(s.showWhen).toEqual(orig.showWhen);
      expect(s.group).toBe(orig.group);
    }
    expect(laid.find((s) => s.name === 'kaleidoN')!.showWhen).toEqual({ warpMode: 'polarFold' });
  });

  it('old presets with the old keys load with no warning and the same values', () => {
    const raw = {
      version: 1,
      name: 'Old',
      feedback: { zoom: { value: 1.02 }, hueDrift: { value: 0.01 }, kaleidoN: { value: 8 }, warpMode: { value: 'polarFold' } },
      post: { hueShift: { value: 0.5 }, mirror: { value: 4 }, bloom: { value: 0.3 } },
      layers: [],
    };
    const { preset, warnings } = parsePreset(raw, SCHEMAS);
    expect(warnings).toEqual([]);
    expect(preset.feedback.zoom?.value).toBe(1.02);
    expect(preset.feedback.hueDrift?.value).toBe(0.01);
    expect(preset.feedback.kaleidoN?.value).toBe(8);
    expect(preset.post.hueShift?.value).toBe(0.5);
    expect(preset.post.mirror?.value).toBe(4);
    expect(preset.post.bloom?.value).toBe(0.3);
  });

  it('bindSection shows four groups and writes each value back to its original Feedback or Post bag', () => {
    const pane = createMockPane();
    const feedback: any = { zoom: { value: 1 }, hueDrift: { value: 0 } };
    const post: any = { hueShift: { value: 0 }, mirror: { value: 0 } };
    const names = new Set(SCHEMAS.post.map((s) => s.name));
    const settings = mergeSettings(feedback, post, names);
    const { folders } = bindSection(pane, 'Feedback and post', layoutFeedbackPost(SCHEMAS.feedback, SCHEMAS.post), settings);
    const titles = pane.folders.flatMap((f: any) => f.folder.folders.map((g: any) => g.options.title));
    expect(titles).toEqual(GROUPS);
    expect(folders.length).toBe(1 + GROUPS.length);
    expect(settings.zoom).toBe(feedback.zoom);
    expect(settings.hueShift).toBe(post.hueShift);
    (settings as any).bloom = 0.4;
    expect(post.bloom).toBe(0.4);
    expect(feedback.bloom).toBeUndefined();
  });
});

describe('Basic and Advanced views (Slice 15.4)', () => {
  const stubStorage = (impl: Partial<Storage>) => vi.stubGlobal('localStorage', impl as Storage);
  afterEach(() => {
    vi.unstubAllGlobals();
    saveStudioView('basic');
  });

  const sections = (): Array<[string, readonly ParamSpec[]]> => [
    ...['shape', 'tunnel', 'particles', 'crown', 'rings', 'shockwave', 'bars', 'bassPulse', 'waveform'].map((k) => [k, LAYER_SPECS[k]!] as [string, readonly ParamSpec[]]),
    ['feedback and post', layoutFeedbackPost(SCHEMAS.feedback, SCHEMAS.post)],
  ];

  it('treats a spec with no tier as advanced and a basic one as basic', () => {
    expect(tierOf({ type: 'bool', name: 'x', label: 'X', group: 'G', default: false })).toBe('advanced');
    expect(tierOf({ type: 'bool', name: 'x', label: 'X', group: 'G', default: false, tier: 'basic' } as ParamSpec)).toBe('basic');
  });

  it('keeps basic count between 6 and 8 in every section that has that many controls', () => {
    for (const [name, specs] of sections()) {
      const basic = specs.filter((s) => tierOf(s) === 'basic').length;
      if (specs.length >= 6) {
        expect(basic, name).toBeGreaterThanOrEqual(6);
        expect(basic, name).toBeLessThanOrEqual(8);
      } else {
        expect(basic, name).toBe(specs.length);
      }
    }
  });

  it('hides advanced controls in Basic and shows them in Advanced; showWhen still hides in both', () => {
    const specs = LAYER_SPECS['shape']!;
    const layer = defaultLayer('shape');
    const pane = createMockPane();
    saveStudioView('basic');
    const { specBindings } = bindSection(pane, 'Shape', specs, layer.params);
    const blade = (n: string) => specBindings.find((b) => b.spec.name === n)!.blades[0];
    expect(blade('size').hidden).toBe(false);
    expect(blade('attackMs').hidden).toBe(true); // advanced
    const viewBinding = pane.folders[0]!.folder.bindings.find((b: any) => b.prop === 'view')!;
    viewBinding.fire('change', 'advanced');
    expect(blade('attackMs').hidden).toBe(false);
    // starInner needs baseShape star: hidden even in Advanced
    expect(blade('starInner').hidden).toBe(true);
    expect(isSpecShown(specs.find((s) => s.name === 'starInner')!, { baseShape: 'circle' }, 'advanced')).toBe(false);
  });

  it('shows every control, with no View toggle, in a section that has no tiered controls', () => {
    const specs: ParamSpec[] = [
      { type: 'bool', name: 'a', label: 'A', group: 'G', default: false },
      { type: 'bool', name: 'b', label: 'B', group: 'G', default: false },
    ];
    const pane = createMockPane();
    saveStudioView('basic');
    const { specBindings } = bindSection(pane, 'Untiered', specs, {});
    expect(specBindings.every((b) => b.blades[0].hidden === false)).toBe(true);
    expect(pane.folders[0]!.folder.bindings.some((b: any) => b.prop === 'view')).toBe(false);
  });

  it('persists the choice in localStorage and reads it back', () => {
    const store = new Map<string, string>();
    stubStorage({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) });
    saveStudioView('advanced');
    expect(store.get(STUDIO_VIEW_KEY)).toBe('advanced');
    expect(loadStudioView()).toBe('advanced');
    store.set(STUDIO_VIEW_KEY, 'junk');
    saveStudioView('basic');
    expect(loadStudioView()).toBe('basic');
  });

  it('falls back to this-session memory when storage throws on read and write', () => {
    const boom = () => { throw new Error('denied'); };
    stubStorage({ getItem: boom, setItem: boom });
    expect(() => saveStudioView('advanced')).not.toThrow();
    expect(loadStudioView()).toBe('advanced');
    const pane = createMockPane();
    expect(() => bindSection(pane, 'Tunnel', LAYER_SPECS['tunnel']!, defaultLayer('tunnel').params)).not.toThrow();
  });

  it('defaults to basic with no storage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadStudioView()).toBe('basic');
  });
});

describe('Studio duplicate, solo and mute controls (Slice 15.6)', () => {
  async function setup() {
    const { PresetSession } = await import('../presets/session');
    const { BUILTIN_PRESETS } = await import('../presets/builtin');
    const host = {
      setScene: vi.fn(), removeScene: vi.fn(), setFadeSeconds: vi.fn(),
      setWeights: vi.fn(), setPost: vi.fn(), setTransition: vi.fn(),
    };
    const session = new PresetSession(host as any, SCHEMAS, undefined as any);
    for (const b of BUILTIN_PRESETS) session.addBuiltin(b.id, b.preset);
    session.show('flight');
    const container = createMockElement('div');
    const body = createMockElement('div');
    body.className = 'studio-body';
    container.appendChild(body);
    let pane: any = null;
    const studio = new Studio(container as any, {
      session,
      switchTo: vi.fn(),
      paneFactory: () => (pane = createMockPane()),
    });
    studio.bind('flight');
    const current = () => pane;
    return { session, studio, current };
  }

  it('Duplicate layer button copies the selected layer directly after it', async () => {
    const { session, current } = await setup();
    const layers = session.get('flight')!.preset.layers;
    const before = layers.length;
    const first = JSON.stringify(layers[0]);
    current().buttons.find((b: any) => b.title === 'Duplicate layer').fire('click');
    expect(layers).toHaveLength(before + 1);
    expect(JSON.stringify(layers[1])).toBe(first);
    expect(layers[1]).not.toBe(layers[0]);
  });

  it('Solo and Mute controls change what the preview renders without touching the preset', async () => {
    const { session, current } = await setup();
    const saved = JSON.stringify(session.get('flight')!.preset);
    const total = session.sceneOf('flight').layers.length;
    current().bindings.find((b: any) => b.options?.label === 'Mute (preview only)').fire('change', true);
    expect(session.sceneOf('flight').layers).toHaveLength(total - 1);
    current().bindings.find((b: any) => b.options?.label === 'Mute (preview only)').fire('change', false);
    current().bindings.find((b: any) => b.options?.label === 'Solo (preview only)').fire('change', true);
    expect(session.sceneOf('flight').layers).toHaveLength(1);
    expect(JSON.stringify(session.get('flight')!.preset)).toBe(saved);
    expect(session.exportJson('flight')).not.toMatch(/solo|mute/i);
  });
});

describe('Studio reaction editor (Slice 17.6)', () => {
  async function setup() {
    const { PresetSession } = await import('../presets/session');
    const { BUILTIN_PRESETS } = await import('../presets/builtin');
    const host = {
      setScene: vi.fn(), removeScene: vi.fn(), setFadeSeconds: vi.fn(),
      setWeights: vi.fn(), setPost: vi.fn(), setTransition: vi.fn(),
    };
    const session = new PresetSession(host as any, SCHEMAS, undefined as any);
    for (const b of BUILTIN_PRESETS) session.addBuiltin(b.id, b.preset);
    session.show('flight');
    const container = createMockElement('div');
    const body = createMockElement('div');
    body.className = 'studio-body';
    container.appendChild(body);
    let pane: any = null;
    const studio = new Studio(container as any, { session, switchTo: vi.fn(), paneFactory: () => (pane = createMockPane()) });
    studio.bind('flight');
    const preset = () => session.get('flight')!.preset;
    const binding = (label: string) => pane.bindings.find((b: any) => b.options?.label === label);
    return { session, preset, binding, button: (title: string) => pane.buttons.find((b: any) => b.title === title) };
  }

  it('built-in presets start with no reactions and no style of their own, and the editor shows only the style and Add', async () => {
    const { preset, binding, button } = await setup();
    expect(preset().reactions).toBeUndefined();
    expect(preset().reactionStyle).toBeUndefined();
    expect(binding('Reaction style').target.style).toBe('global');
    expect(button('Add reaction')).toBeDefined();
    expect(binding('When')).toBeUndefined();
    expect(button('Remove reaction')).toBeUndefined();
  });

  it('Add reaction creates a beat kick on zoom and shows its controls', async () => {
    const { preset, binding, button } = await setup();
    button('Add reaction').fire('click');
    expect(preset().reactions).toEqual([{ trigger: { type: 'beat' }, response: 'kick', target: { group: 'feedback', name: 'zoom' }, amount: 0.1, ease: 0.35 }]);
    for (const label of ['Reaction', 'When', 'What happens', 'Which control', 'Amount (share of range)', 'Ease time (s)']) {
      expect(binding(label), label).toBeDefined();
    }
    expect(binding('Which control').options.options['Feedback · Zoom']).toBe('feedback.zoom');
  });

  it('the trigger, response and control choices write to the preset and mark it changed', async () => {
    const { session, preset, binding, button } = await setup();
    button('Add reaction').fire('click');
    session.commit('flight');
    binding('When').fire('change', 'everyNBeats');
    expect(preset().reactions![0]!.trigger).toEqual({ type: 'everyNBeats', n: 4 });
    expect(binding('Every how many beats')).toBeDefined();
    binding('What happens').target.response = 'flip';
    binding('What happens').fire('change', 'flip');
    expect(preset().reactions![0]!.response).toBe('flip');
    binding('Which control').fire('change', 'post.hueShift');
    expect(preset().reactions![0]!.target).toEqual({ group: 'post', name: 'hueShift' });
    expect(session.isDirty('flight')).toBe(true);
  });

  it('a style choice is stored on the preset, and Use the global setting removes it', async () => {
    const { preset, binding } = await setup();
    binding('Reaction style').fire('change', 'punchy');
    expect(preset().reactionStyle).toBe('punchy');
    binding('Reaction style').fire('change', 'global');
    expect(preset().reactionStyle).toBeUndefined();
    expect('reactionStyle' in preset()).toBe(false);
  });

  it('Remove reaction deletes it, and the reactions field disappears when the list is empty', async () => {
    const { preset, button } = await setup();
    button('Add reaction').fire('click');
    expect(preset().reactions).toHaveLength(1);
    button('Remove reaction').fire('click');
    expect(preset().reactions).toBeUndefined();
  });

  it('reactions and style survive saving as JSON and loading again', async () => {
    const { session, button, binding } = await setup();
    button('Add reaction').fire('click');
    binding('Reaction style').fire('change', 'wild');
    const parsed = parsePreset(JSON.parse(session.exportJson('flight')), SCHEMAS).preset;
    expect(parsed.reactionStyle).toBe('wild');
    expect(parsed.reactions).toHaveLength(1);
  });
});

describe('reaction editor helpers (Slice 17.6)', () => {
  it('lists Feedback and Post number controls, and skips the ones the current mode hides', async () => {
    const { BUILTIN_PRESETS } = await import('../presets/builtin');
    const { reactionTargets, parseReactionTargetKey, reactionTargetKey } = await import('./studio');
    const preset = JSON.parse(JSON.stringify(BUILTIN_PRESETS[0]!.preset)) as Preset;
    const keys = reactionTargets(preset).map((t) => t.key);
    expect(keys).toContain('feedback.zoom');
    expect(keys).toContain('feedback.rotate');
    expect(keys).toContain('post.hueShift');
    expect(keys).not.toContain('feedback.wrap'); // not a number
    expect(parseReactionTargetKey('post.hueShift')).toEqual({ group: 'post', name: 'hueShift' });
    expect(parseReactionTargetKey('layer.x')).toBeNull();
    expect(parseReactionTargetKey('nodot')).toBeNull();
    expect(reactionTargetKey({ group: 'feedback', name: 'zoom' })).toBe('feedback.zoom');
  });

  it('describes a reaction in one line, and sets N only for the triggers that need it', async () => {
    const { describeReaction, newReaction, triggerOf } = await import('./studio');
    const r = { ...newReaction({ group: 'feedback', name: 'rotate' }), trigger: { type: 'everyNBeats' as const, n: 8 }, response: 'flip' as const };
    expect(describeReaction(r)).toBe('Every 8 beats: Flip, Feedback · Spin per frame (rad)');
    expect(triggerOf('beat', 9)).toEqual({ type: 'beat' });
    expect(triggerOf('everyNSeconds', 2)).toEqual({ type: 'everyNSeconds', n: 2 });
    expect(triggerOf('everyNBeats', 500)).toEqual({ type: 'everyNBeats', n: 64 });
  });
});

describe('Studio warp operator editor (Slice 18.4)', () => {
  async function setup() {
    const { PresetSession } = await import('../presets/session');
    const { BUILTIN_PRESETS } = await import('../presets/builtin');
    const host = {
      setScene: vi.fn(), removeScene: vi.fn(), setFadeSeconds: vi.fn(),
      setWeights: vi.fn(), setPost: vi.fn(), setTransition: vi.fn(),
    };
    const session = new PresetSession(host as any, SCHEMAS, undefined as any);
    for (const b of BUILTIN_PRESETS) session.addBuiltin(b.id, b.preset);
    session.show('flight');
    const container = createMockElement('div');
    const body = createMockElement('div');
    body.className = 'studio-body';
    container.appendChild(body);
    let pane: any = null;
    const studio = new Studio(container as any, { session, switchTo: vi.fn(), paneFactory: () => (pane = createMockPane()) });
    studio.bind('flight');
    const preset = () => session.get('flight')!.preset;
    const binding = (label: string) => pane.bindings.find((b: any) => b.options?.label === label);
    return { session, preset, binding, pane: () => pane, button: (title: string) => pane.buttons.find((b: any) => b.title === title) };
  }

  it('built-in presets have no operators, and the editor shows only the type picker and Add', async () => {
    const { preset, binding, button } = await setup();
    expect(preset().warp).toBeUndefined();
    expect(button('Add warp operator')).toBeDefined();
    expect(binding('New warp operator')).toBeDefined();
    expect(binding('Operator type')).toBeUndefined();
    expect(button('Remove warp operator')).toBeUndefined();
  });

  it('Add warp operator adds the chosen type with default settings and shows its controls', async () => {
    const { session, preset, binding, button, pane } = await setup();
    binding('New warp operator').fire('change', 'swirl');
    button('Add warp operator').fire('click');
    expect(preset().warp).toHaveLength(1);
    expect(preset().warp![0]!.type).toBe('swirl');
    expect(preset().warp![0]!.enabled).toBe(true);
    expect(session.sceneOf('flight').getWarpOps()).toHaveLength(1);
    for (const label of ['Warp operator', 'Operator type', 'Operator on']) expect(binding(label), label).toBeDefined();
    const section = pane().folders.find((f: any) => String(f.options?.title).startsWith('Warp operator 1: Swirl'));
    expect(section).toBeDefined();
    const labels = JSON.stringify(section.folder.folders.map((f: any) => f.folder.bindings.map((b: any) => b.options?.label)));
    for (const label of ['Amount', 'Scale', 'Speed', 'Centre X', 'Centre Y']) expect(labels).toContain(label);
  });

  it('the type, on switch and settings write to the preset and reach the scene', async () => {
    const { session, preset, binding, button } = await setup();
    button('Add warp operator').fire('click');
    binding('Operator type').fire('change', 'ripple');
    expect(preset().warp![0]!.type).toBe('ripple');
    expect(session.sceneOf('flight').getWarpOps()[0]!.type).toBe('ripple');
    binding('Operator on').target.enabled = false;
    binding('Operator on').fire('change', false);
    expect(session.sceneOf('flight').getWarpOps()[0]!.enabled).toBe(false);
    expect(session.isDirty('flight')).toBe(true);
  });

  it('stops offering Add at four operators', async () => {
    const { preset, button } = await setup();
    for (let i = 0; i < 4; i++) button('Add warp operator').fire('click');
    expect(preset().warp).toHaveLength(4);
    expect(button('Add warp operator')).toBeUndefined();
  });

  it('Remove warp operator deletes it, and the warp field disappears when the list is empty', async () => {
    const { session, preset, button } = await setup();
    button('Add warp operator').fire('click');
    button('Remove warp operator').fire('click');
    expect(preset().warp).toBeUndefined();
    expect('warp' in preset()).toBe(false);
    expect(session.sceneOf('flight').getWarpOps()).toEqual([]);
  });

  it('operators survive saving as JSON and loading again', async () => {
    const { session, binding, button } = await setup();
    binding('New warp operator').fire('change', 'tunnel');
    button('Add warp operator').fire('click');
    const parsed = parsePreset(JSON.parse(session.exportJson('flight')), SCHEMAS).preset;
    expect(parsed.warp).toHaveLength(1);
    expect(parsed.warp![0]!.type).toBe('tunnel');
  });

  it('operator settings can be picked in the audio link editor', async () => {
    const { BUILTIN_PRESETS } = await import('../presets/builtin');
    const { newWarpOperator } = await import('./studio');
    const preset = JSON.parse(JSON.stringify(BUILTIN_PRESETS[0]!.preset)) as Preset;
    expect(linkTargets(preset).some((t) => t.key.startsWith('W'))).toBe(false);
    preset.warp = [newWarpOperator('radial')];
    const keys = linkTargets(preset).map((t) => t.key);
    expect(keys).toContain('W0.amount');
    expect(keys).toContain('W0.speed');
  });
});

describe('warp editor helpers (Slice 18.4)', () => {
  it('changing an operator to Curl noise fills in its own settings, and keeps the shared ones', async () => {
    const { newWarpOperator, fillWarpParams } = await import('./studio');
    const op = newWarpOperator('radial');
    op.params.amount!.value = 0.8;
    op.type = 'curl';
    fillWarpParams(op);
    expect(op.params.amount!.value).toBe(0.8);
    expect(op.params.octaves!.value).toBe(2);
    expect(op.params.flow!.value).toBe('plumes');
    op.type = 'swirl';
    fillWarpParams(op);
    expect(op.params.amount!.value).toBe(0.8);
  });

  it('lists every operator type with a readable label', async () => {
    const { warpTypeOptions } = await import('./studio');
    const options = warpTypeOptions();
    expect(Object.keys(options)).toHaveLength(11);
    expect(options['Radial']).toBe('radial');
    expect(options['Tile and mirror']).toBe('tile');
  });

  it('a new operator has default settings and is on; the list line shows when it is off', async () => {
    const { newWarpOperator, describeWarpOperator } = await import('./studio');
    const op = newWarpOperator('tile');
    expect(op.enabled).toBe(true);
    expect(op.params.scale!.value).toBe(2);
    expect(op.params.amount!.value).toBe(0.3);
    expect(describeWarpOperator(op, 1)).toBe('2. Tile and mirror');
    expect(describeWarpOperator({ ...op, enabled: false }, 0)).toBe('1. Tile and mirror (off)');
  });
});

// Slice 22.6: edit hook for the pop-out window, and the pure helpers of popoutMain.ts.
describe('Studio onEdit hook (Slice 22.6)', () => {
  function bindingsOf(pane: any): any[] {
    const out: any[] = [...pane.bindings];
    for (const f of pane.folders) out.push(...bindingsOf(f.folder));
    return out;
  }

  function editSession() {
    const preset = {
      name: 'Crown',
      tags: [],
      transition: { style: 'crossfade', seconds: 0.3 },
      feedback: {},
      post: {},
      layers: [],
    };
    const entry = { id: 'crown', builtin: true, preset, savedJson: '{}' };
    return {
      get: vi.fn((id: string) => (id === 'crown' ? entry : undefined)),
      list: vi.fn(() => [entry]),
      listCategorized: vi.fn(() => ({
        system: { showcase: [], flagship: [], classics: [entry] },
        user: { folders: [], unfiled: [] },
      })),
      getFolders: vi.fn(() => []),
      isDirty: () => false,
      commit: vi.fn(),
      save: vi.fn(),
      saveAs: vi.fn(),
      remove: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: () => false,
      canRedo: () => false,
      exportJson: () => '{}',
      importAsset: () => ({ kind: 'preset', warnings: [] }),
      sceneOf: () => ({ layers: [], setFeedback: vi.fn() }),
      refreshPost: vi.fn(),
      rebuild: vi.fn(),
      monitorOf: () => undefined,
    } as any;
  }

  it('calls onEdit with preset id, section, layer index, name and value when a control changes', () => {
    const container = createMockElement('div');
    const body = createMockElement('div');
    body.className = 'studio-body';
    container.appendChild(body);
    const session = editSession();
    let pane: any = null;
    const onEdit = vi.fn();
    const studio = new Studio(container as any, {
      session,
      switchTo: vi.fn(),
      onEdit,
      paneFactory: () => (pane = createMockPane()),
    });
    studio.bind('crown');

    const spec = SCHEMAS.feedback.find((s) => s.type === 'float')!;
    const binding = bindingsOf(pane).find((b) => b.prop === spec.name)!;
    expect(binding).toBeDefined();
    binding.target[spec.name] = 0.25;
    binding.fire('change', 0.25);

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith({
      presetId: 'crown',
      section: 'feedbackPost',
      layerIndex: null,
      name: spec.name,
      value: 0.25,
    });
    expect(session.commit).toHaveBeenCalledWith('crown');
  });

  it('without onEdit a control change only commits, as before', () => {
    const container = createMockElement('div');
    const body = createMockElement('div');
    body.className = 'studio-body';
    container.appendChild(body);
    const session = editSession();
    let pane: any = null;
    const studio = new Studio(container as any, {
      session,
      switchTo: vi.fn(),
      paneFactory: () => (pane = createMockPane()),
    });
    studio.bind('crown');

    const spec = SCHEMAS.feedback.find((s) => s.type === 'float')!;
    const binding = bindingsOf(pane).find((b) => b.prop === spec.name)!;
    binding.target[spec.name] = 0.25;
    expect(() => binding.fire('change', 0.25)).not.toThrow();
    expect(session.commit).toHaveBeenCalledWith('crown');
  });

  it('bindSection reports only primitive values to onEdit', () => {
    const pane = createMockPane();
    const spec = SCHEMAS.feedback.find((s) => s.type === 'float')!;
    const settings: Record<string, any> = { [spec.name]: 0.5 };
    const onEdit = vi.fn();
    bindSection(pane, 'test', [spec], settings, undefined, undefined, undefined, onEdit);
    const binding = bindingsOf(pane).find((b) => b.prop === spec.name)!;
    binding.target[spec.name] = 0.75;
    binding.fire('change', 0.75);
    expect(onEdit).toHaveBeenCalledWith(spec, 0.75);
  });
});

describe('popoutMain helpers (Slice 22.6)', () => {
  it('treats the main window as silent when it has never spoken or is past the timeout', () => {
    expect(isMainSilent(null, 1000)).toBe(true);
    expect(isMainSilent(1000, 1000 + 5999)).toBe(false);
    expect(isMainSilent(1000, 1000 + 6001)).toBe(true);
    expect(POPOUT_WAITING_TEXT).toBe('Waiting for the visual window');
  });

  it('reads a valid shown-preset JSON and rejects anything else', () => {
    const json = JSON.stringify(ALL_PRESETS[0]!.preset);
    expect(readShownPreset(json, SCHEMAS)).not.toBeNull();
    expect(readShownPreset('not json', SCHEMAS)).toBeNull();
    expect(readShownPreset('{"name":"x"}', SCHEMAS)).toBeNull();
  });

  it('no-op scene host accepts every call and draws nothing', () => {
    expect(() => {
      NOOP_SCENE_HOST.setFadeSeconds(0.1);
      NOOP_SCENE_HOST.setWeights({ a: 1 });
      NOOP_SCENE_HOST.setPost({});
      NOOP_SCENE_HOST.setTransition('crossfade');
    }).not.toThrow();
  });
});
