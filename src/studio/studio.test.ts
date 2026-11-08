import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  linkTargets,
  STUDIO_HELPER_IDLE_TEXT,
  renderHelperContent,
  attachSpecHelper,
  SYSTEM_OPTGROUP_LABELS,
  renderPresetSelectHierarchy,
  Studio,
} from './studio';
import { getGlobalDirector, resetGlobalDirector } from '../render/globalDirector';
import { Scene } from '../render/scene';
import type { Preset, LayerEntry } from '../presets/format';
import type { Vec3Spec } from '../presets/schema';
import { LAYER_SPECS, POST_SPECS } from '../presets/layerSchemas';

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
          el.children.push(textNode);
        } else if (node) {
          el.children.push(node);
        }
      }
    },
    appendChild(node: MockElement) {
      el.children.push(node);
      return node;
    },
    removeChild(node: MockElement) {
      const idx = el.children.indexOf(node);
      if (idx !== -1) el.children.splice(idx, 1);
      return node;
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
      element.appendChild(selectEl);
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
