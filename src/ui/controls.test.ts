import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import indexHtml from '../../index.html?raw';
import {
  canStartSwipe,
  isControlsBarFocusable,
  isPhoneSheetWidth,
  isSwipeDismiss,
  SWIPE_DISMISS_PX,
  setupControls,
  isEditableTarget,
  EXPERIENCE_LABELS,
  EXPERIENCE_TOAST_DATA,
  triggerExperienceToast,
} from './controls';
import { showToast, toRgbStr } from './toast';
import { getGlobalDirector } from '../render/globalDirector';
import type { AudioEngine } from '../audio/engine';

// The shortcuts list is static markup, so the test reads it from index.html (no jsdom in this repo).
const dialog = indexHtml.slice(indexHtml.indexOf('<dialog id="shortcuts"'), indexHtml.indexOf('</dialog>'));

describe('controls bar focus when idle (slice 11.4)', () => {
  it('is focusable while awake', () => {
    expect(isControlsBarFocusable(false)).toBe(true);
  });

  it('is not focusable while faded for idleness, and returns when awake again', () => {
    expect(isControlsBarFocusable(true)).toBe(false);
    expect(isControlsBarFocusable(false)).toBe(true);
  });
});

describe('phone sheet swipe down (slice 11.6, handle only follow-up)', () => {
  it('counts widths under 600 px as phone, and 600 px and up as desktop', () => {
    expect(isPhoneSheetWidth(360)).toBe(true);
    expect(isPhoneSheetWidth(390)).toBe(true);
    expect(isPhoneSheetWidth(599)).toBe(true);
    expect(isPhoneSheetWidth(600)).toBe(false);
    expect(isPhoneSheetWidth(1280)).toBe(false);
  });

  it('starts only from the handle, never from the header or body', () => {
    expect(canStartSwipe(true)).toBe(true);
    expect(canStartSwipe(false)).toBe(false);
  });

  it('gives every settings surface a handle at its top', () => {
    const studio = indexHtml.slice(indexHtml.indexOf('<div id="studio"'), indexHtml.indexOf('<div class="studio-head'));
    const controls = indexHtml.slice(indexHtml.indexOf('<nav id="controls"'), indexHtml.indexOf('<div class="sheet-head controls-head">'));
    const shortcuts = indexHtml.slice(indexHtml.indexOf('<dialog id="shortcuts"'), indexHtml.indexOf('<div class="dialog-head sheet-head">'));
    for (const block of [studio, controls, shortcuts]) expect(block).toContain('class="sheet-handle"');
  });

  it('dismisses when the downward drag reaches about 80 px, and not before', () => {
    expect(SWIPE_DISMISS_PX).toBe(80);
    expect(isSwipeDismiss(100, 100)).toBe(false);
    expect(isSwipeDismiss(100, 179)).toBe(false);
    expect(isSwipeDismiss(100, 180)).toBe(true);
    expect(isSwipeDismiss(100, 400)).toBe(true);
  });

  it('never dismisses on an upward or sideways drag', () => {
    expect(isSwipeDismiss(300, 100)).toBe(false);
    expect(isSwipeDismiss(300, 300)).toBe(false);
  });
});

describe('settings layout & Experience HUD card (Slice 8.2 & slice 11.6)', () => {
  const nav = indexHtml.slice(indexHtml.indexOf('<nav id="controls"'), indexHtml.indexOf('</nav>'));
  const soundStart = nav.indexOf('aria-label="Sound and response"');
  const displayStart = nav.indexOf('aria-label="Display"');
  const viewStart = nav.indexOf('aria-label="View"');
  const displayRow = nav.slice(displayStart, viewStart);

  it('groups Volume, Visual gain and Beat sensitivity as value buttons in one section', () => {
    const sound = nav.slice(soundStart, displayStart);
    for (const id of ['volume-btn', 'gain-btn', 'beat-btn']) expect(sound).toContain(`id="${id}"`);
    expect(sound).not.toContain('id="calm"');
  });

  it('consolidates Calm and Director into the Experience popover card in the Display row', () => {
    for (const id of ['experience-btn', 'experience-panel', 'render-quality', 'aspect-correct']) {
      expect(displayRow).toContain(`id="${id}"`);
    }
    // Standalone #calm and #director-mode are replaced
    expect(displayRow).not.toContain('id="calm"');
    expect(displayRow).not.toContain('id="director-mode"');
  });

  it('includes Experience label and all 4 mode buttons in the popover', () => {
    expect(displayRow).toContain('id="experience-label"');
    expect(displayRow).toContain('Experience: Cinematic');
    for (const mode of ['cinematic', 'calm', 'minimal', 'colorWalk']) {
      expect(displayRow).toContain(`data-mode="${mode}"`);
    }
  });

  it('includes camera, color, export and import controls in the popover card', () => {
    expect(displayRow).toContain('id="exp-camera-select"');
    expect(displayRow).toContain('id="exp-color-select"');
    expect(displayRow).toContain('id="exp-export-btn"');
    expect(displayRow).toContain('id="exp-import-input"');
    for (const cam of ['auto', 'craneSway', 'dutchRoll', 'breathingPush', 'horizonTilt', 'stillAnchor', 'off']) {
      expect(displayRow).toContain(`value="${cam}"`);
    }
    for (const col of ['auto', 'native', 'cyberpunk', 'ember', 'biolum', 'vapor', 'prismatic']) {
      expect(displayRow).toContain(`value="${col}"`);
    }
  });

  it('starts with Playback hidden, so it shows only once a file is loaded (slice 11.8)', () => {
    expect(nav).toMatch(/<div class="group" role="group" aria-label="Playback" id="playback" hidden>/);
  });

  it('keeps one sticky close header on the controls panel', () => {
    expect(nav).toContain('class="sheet-head controls-head"');
    expect(nav).toContain('id="controls-close"');
  });
});

describe('shortcuts list keys (slices 8.1 and 8.7)', () => {
  it('makes every key in the list tappable: letters, digits, brackets, arrows, Space and .', () => {
    const keys = [...dialog.matchAll(/<button type="button" class="key" data-key="([^"]+)"/g)].map((m) => m[1]);
    const expected = ['A', 'B', 'C', 'D', 'E', 'F', 'K', 'P', 'X', ' ', '.', '[', ']', '?', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    expect(keys.sort()).toEqual(expected.sort());
  });

  it('makes the Help (?) row a tappable key (slice 11.8), not plain kbd', () => {
    const kbds = [...dialog.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map((m) => m[1]);
    expect(kbds).not.toContain('?');
    expect(dialog).toContain('data-key="?"');
  });
});

describe('toRgbStr & Rich Swatch Toast (Slice 8.2)', () => {
  it('formats normalized 0..1 RGB colors to 0..255 css rgb() strings', () => {
    expect(toRgbStr([0, 0, 0])).toBe('rgb(0, 0, 0)');
    expect(toRgbStr([1, 1, 1])).toBe('rgb(255, 255, 255)');
    expect(toRgbStr([0, 0.17, 0.21])).toBe('rgb(0, 43, 54)');
    expect(toRgbStr([0, 1, 0.67])).toBe('rgb(0, 255, 171)');
  });

  it('formats already 0..255 RGB numbers cleanly', () => {
    expect(toRgbStr([255, 128, 64])).toBe('rgb(255, 128, 64)');
  });

  it('renders simple text toast with backward compatibility', () => {
    const toastEl = createMockElement('div');
    toastEl.id = 'toast';
    const originalDoc = globalThis.document;
    (globalThis as any).document = {
      getElementById: (id: string) => (id === 'toast' ? toastEl : null),
      createElement: (tag: string) => createMockElement(tag),
    };

    try {
      showToast('Crown');
      expect(toastEl.textContent).toBe('Crown');
      expect(toastEl.classList.contains('shown')).toBe(true);
      expect(toastEl.getAttribute('aria-label')).toBeNull();
    } finally {
      (globalThis as any).document = originalDoc;
    }
  });

  it('renders rich toast with title, detail, and dual-tone gradient swatch', () => {
    const toastEl = createMockElement('div');
    toastEl.id = 'toast';
    const originalDoc = globalThis.document;
    (globalThis as any).document = {
      getElementById: (id: string) => (id === 'toast' ? toastEl : null),
      createElement: (tag: string) => createMockElement(tag),
    };

    try {
      showToast('Mode: Calm', {
        detail: 'Still Anchor · Bioluminescent',
        swatch: [[0, 0.17, 0.21], [0, 1, 0.67]],
      });

      expect(toastEl.getAttribute('aria-label')).toBe('Mode: Calm · Still Anchor · Bioluminescent');
      const content = toastEl.children[0] as MockDomElement;
      expect(content.className).toBe('toast-content');

      const swatch = content.children[0] as MockDomElement;
      expect(swatch.className).toBe('toast-swatch');
      expect(swatch.style.background).toBe('linear-gradient(135deg, rgb(0, 43, 54), rgb(0, 255, 171))');

      const title = content.children[1] as MockDomElement;
      expect(title.className).toBe('toast-title');
      expect(title.textContent).toBe('Mode: Calm');

      const detail = content.children[2] as MockDomElement;
      expect(detail.className).toBe('toast-detail');
      expect(detail.textContent).toBe('Still Anchor · Bioluminescent');
    } finally {
      (globalThis as any).document = originalDoc;
    }
  });

  it('renders rich toast with single-color swatch', () => {
    const toastEl = createMockElement('div');
    toastEl.id = 'toast';
    const originalDoc = globalThis.document;
    (globalThis as any).document = {
      getElementById: (id: string) => (id === 'toast' ? toastEl : null),
      createElement: (tag: string) => createMockElement(tag),
    };

    try {
      showToast('Simple Swatch', {
        detail: 'Solid preview',
        swatch: [1, 0, 0],
      });

      const content = toastEl.children[0] as MockDomElement;
      const swatch = content.children[0] as MockDomElement;
      expect(swatch.style.background).toBe('rgb(255, 0, 0)');
    } finally {
      (globalThis as any).document = originalDoc;
    }
  });
});

describe('Experience mode definitions & triggerExperienceToast (Slice 8.2)', () => {
  it('provides friendly labels for all experience modes', () => {
    expect(EXPERIENCE_LABELS.cinematic).toBe('Cinematic');
    expect(EXPERIENCE_LABELS.calm).toBe('Calm');
    expect(EXPERIENCE_LABELS.minimal).toBe('Minimal');
    expect(EXPERIENCE_LABELS.colorWalk).toBe('Color Walk');
    expect(EXPERIENCE_LABELS.custom).toBe('Custom');
  });

  it('provides toast metadata with dual-tone swatches for all primary modes', () => {
    for (const mode of ['cinematic', 'calm', 'minimal', 'colorWalk'] as const) {
      const data = EXPERIENCE_TOAST_DATA[mode];
      expect(data).toBeDefined();
      expect(data!.title.startsWith('Mode:')).toBe(true);
      expect(data!.detail.length).toBeGreaterThan(0);
      expect(data!.swatch).toHaveLength(2);
      expect(data!.swatch[0]).toHaveLength(3);
      expect(data!.swatch[1]).toHaveLength(3);
    }
  });

  it('emits rich toast when triggerExperienceToast is called', () => {
    const toastEl = createMockElement('div');
    toastEl.id = 'toast';
    const originalDoc = globalThis.document;
    (globalThis as any).document = {
      getElementById: (id: string) => (id === 'toast' ? toastEl : null),
      createElement: (tag: string) => createMockElement(tag),
    };

    try {
      triggerExperienceToast('calm');
      expect(toastEl.getAttribute('aria-label')).toBe('Mode: Calm · Still Anchor · Bioluminescent');
    } finally {
      (globalThis as any).document = originalDoc;
    }
  });
});

describe('Experience HUD wiring in setupControls (Slice 8.2)', () => {
  let originalDoc: any;
  let originalWindow: any;
  let mockEngine: AudioEngine;
  let domElements: Record<string, MockDomElement>;
  let windowListeners: Record<string, ((e: any) => void)[]>;

  beforeEach(() => {
    originalDoc = globalThis.document;
    originalWindow = globalThis.window;
    windowListeners = {};

    domElements = {};
    const register = (id: string, tag: string = 'div') => {
      const el = createMockElement(tag);
      el.id = id;
      domElements[id] = el;
      return el;
    };

    const controls = register('controls', 'nav');
    register('file-input', 'input');
    register('file-btn', 'button');
    register('test-select', 'select');
    register('play-btn', 'button');
    register('seek', 'input');
    register('time', 'span');
    register('volume', 'input');
    domElements['volume']!.value = '0.8';
    register('volume-value', 'span');
    register('gain', 'input');
    domElements['gain']!.value = '1.0';
    register('gain-value', 'span');
    register('beat-sensitivity', 'input');
    domElements['beat-sensitivity']!.value = '50';
    register('beat-value', 'span');
    register('fs-btn', 'button');
    register('source-label', 'span');
    register('playback', 'div');
    register('shortcuts', 'dialog');
    register('shortcuts-btn', 'button');
    register('shortcuts-close', 'button');
    register('controls-show', 'button');
    register('controls-close', 'button');
    register('render-quality', 'select');
    register('aspect-correct', 'input');

    // Toast
    register('toast', 'div');

    // Experience items
    const expBtn = register('experience-btn', 'button');
    expBtn.className = 'value-btn';
    const expLabel = register('experience-label', 'span');
    expLabel.textContent = 'Experience: Cinematic';
    expBtn.appendChild(expLabel);

    const expPanel = register('experience-panel', 'div');
    expPanel.className = 'value-panel experience-panel';
    expPanel.hidden = true;

    const expItem = createMockElement('div');
    expItem.className = 'value-item experience-item';
    expItem.appendChild(expBtn);
    expItem.appendChild(expPanel);
    controls.appendChild(expItem);

    // Mode buttons
    for (const mode of ['cinematic', 'calm', 'minimal', 'colorWalk']) {
      const btn = createMockElement('button');
      btn.className = 'exp-mode-btn';
      btn.dataset.mode = mode;
      expPanel.appendChild(btn);
    }

    const camSelect = register('exp-camera-select', 'select');
    expPanel.appendChild(camSelect);

    const colSelect = register('exp-color-select', 'select');
    expPanel.appendChild(colSelect);

    const exportBtn = register('exp-export-btn', 'button');
    expPanel.appendChild(exportBtn);

    const importInput = register('exp-import-input', 'input');
    importInput.type = 'file';
    expPanel.appendChild(importInput);

    (globalThis as any).document = {
      body: createMockElement('body'),
      getElementById: (id: string) => domElements[id] ?? null,
      createElement: (tag: string) => createMockElement(tag),
      addEventListener: vi.fn(),
      fullscreenEnabled: true,
      fullscreenElement: null,
    };

    (globalThis as any).window = {
      addEventListener: (evt: string, fn: (e: any) => void) => {
        windowListeners[evt] = windowListeners[evt] || [];
        windowListeners[evt].push(fn);
      },
      removeEventListener: (evt: string, fn: (e: any) => void) => {
        if (windowListeners[evt]) {
          windowListeners[evt] = windowListeners[evt].filter((f) => f !== fn);
        }
      },
      dispatchEvent: (evt: any) => {
        for (const fn of windowListeners[evt.type] || []) fn(evt);
        return true;
      },
      innerWidth: 1024,
      clearTimeout: vi.fn(),
      setTimeout: vi.fn((fn: () => void) => {
        fn();
        return 123;
      }),
    };

    mockEngine = {
      setVolume: vi.fn(),
      useFile: vi.fn(),
      useDisplayCapture: vi.fn(),
      useMic: vi.fn(),
      useTestSignal: vi.fn(),
      stop: vi.fn(),
      media: null,
      on: vi.fn(),
    } as unknown as AudioEngine;
  });

  afterEach(() => {
    (globalThis as any).document = originalDoc;
    (globalThis as any).window = originalWindow;
  });

  it('initializes Experience UI matching GlobalDirector current state', () => {
    const director = getGlobalDirector();
    director.setExperienceMode('cinematic');

    setupControls(mockEngine, { calm: false, fileName: '' });

    expect(domElements['experience-label']?.textContent).toBe('Experience: Cinematic');
    const modeBtns = domElements['experience-panel']?.querySelectorAll('.exp-mode-btn') ?? [];
    const cinematicBtn = modeBtns.find((b) => b.dataset.mode === 'cinematic');
    expect(cinematicBtn?.classList.contains('active')).toBe(true);
    expect(cinematicBtn?.getAttribute('aria-pressed')).toBe('true');
  });

  it('sets Experience mode and updates button states on click', () => {
    setupControls(mockEngine, { calm: false, fileName: '' });
    const director = getGlobalDirector();

    const modeBtns = domElements['experience-panel']?.querySelectorAll('.exp-mode-btn') ?? [];
    const calmBtn = modeBtns.find((b) => b.dataset.mode === 'calm');
    calmBtn?.dispatchEvent({ type: 'click' });

    expect(director.getExperienceMode()).toBe('calm');
    expect(domElements['experience-label']?.textContent).toBe('Experience: Calm');
    expect(calmBtn?.classList.contains('active')).toBe(true);
    expect(domElements['toast']?.getAttribute('aria-label')).toBe('Mode: Calm · Still Anchor · Bioluminescent');
  });

  it('cycles Experience mode on M keydown', () => {
    setupControls(mockEngine, { calm: false, fileName: '' });
    const director = getGlobalDirector();
    director.setExperienceMode('cinematic');

    // Fire M keydown on window
    const keyEvent = { key: 'm', ctrlKey: false, metaKey: false, altKey: false, target: null };
    for (const fn of windowListeners['keydown'] || []) fn(keyEvent);

    expect(director.getExperienceMode()).toBe('calm');
    expect(domElements['experience-label']?.textContent).toBe('Experience: Calm');
    expect(domElements['toast']?.getAttribute('aria-label')).toBe('Mode: Calm · Still Anchor · Bioluminescent');
  });

  it('ignores shortcuts when typing in a text field or form input', () => {
    setupControls(mockEngine, { calm: false, fileName: '' });
    const director = getGlobalDirector();
    director.setExperienceMode('cinematic');

    // Simulate typing 'm' inside an input element (e.g. Studio search or name field)
    const inputEl = { tagName: 'INPUT' } as unknown as EventTarget;
    const keyEvent = { key: 'm', ctrlKey: false, metaKey: false, altKey: false, target: inputEl };
    for (const fn of windowListeners['keydown'] || []) fn(keyEvent);

    // Mode should NOT change
    expect(director.getExperienceMode()).toBe('cinematic');
  });

  it('identifies editable targets correctly with isEditableTarget', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({ tagName: 'DIV' } as any)).toBe(false);
    expect(isEditableTarget({ tagName: 'BUTTON' } as any)).toBe(false);
    expect(isEditableTarget({ tagName: 'INPUT' } as any)).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' } as any)).toBe(true);
    expect(isEditableTarget({ tagName: 'TEXTAREA' } as any)).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true } as any)).toBe(true);
    expect(isEditableTarget({
      tagName: 'SPAN',
      closest: (sel: string) => sel.includes('input') ? {} : null,
    } as any)).toBe(true);
  });

  it('updates director settings when camera and color selects change', () => {
    setupControls(mockEngine, { calm: false, fileName: '' });
    const director = getGlobalDirector();

    const camSelect = domElements['exp-camera-select'];
    if (camSelect) {
      camSelect.value = 'dutchRoll';
      camSelect.dispatchEvent({ type: 'change' });
    }
    expect(director.getSettings().cameraMode).toBe('dutchRoll');

    const colSelect = domElements['exp-color-select'];
    if (colSelect) {
      colSelect.value = 'ember';
      colSelect.dispatchEvent({ type: 'change' });
    }
    expect(director.getSettings().colorMood).toBe('ember');
  });

  it('dispatches custom event on export button click', () => {
    setupControls(mockEngine, { calm: false, fileName: '' });
    let exportFired = false;
    windowListeners['export-experience-look'] = [() => { exportFired = true; }];

    domElements['exp-export-btn']?.dispatchEvent({ type: 'click' });
    expect(exportFired).toBe(true);
  });

  it('dispatches custom event on import input file selection', () => {
    setupControls(mockEngine, { calm: false, fileName: '' });
    let importFile: any = null;
    windowListeners['import-experience-look'] = [(e: any) => { importFile = e.detail?.file; }];

    const fakeFile = { name: 'look.json' };
    const input = domElements['exp-import-input'];
    if (input) {
      input.files = [fakeFile];
      input.dispatchEvent({ type: 'change' });
    }
    expect(importFile).toBe(fakeFile);
  });
});

// Minimal mock DOM helper for unit testing without jsdom
interface MockDomElement {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  value: string;
  type: string;
  hidden: boolean;
  checked: boolean;
  files?: any[];
  dataset: Record<string, string>;
  attributes: Record<string, string>;
  children: MockDomElement[];
  style: Record<string, string>;
  classList: {
    add: (c: string) => void;
    remove: (c: string) => void;
    toggle: (c: string, force?: boolean) => void;
    contains: (c: string) => boolean;
  };
  eventListeners: Record<string, ((e: any) => void)[]>;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  toggleAttribute(k: string, force?: boolean): boolean;
  appendChild(c: MockDomElement): MockDomElement;
  append(...nodes: MockDomElement[]): void;
  replaceChildren(...nodes: MockDomElement[]): void;
  addEventListener(evt: string, fn: (e: any) => void): void;
  dispatchEvent(evt: { type: string; [key: string]: any }): boolean;
  querySelector(sel: string): MockDomElement | null;
  querySelectorAll(sel: string): MockDomElement[];
  closest(sel: string): MockDomElement | null;
  contains(node: any): boolean;
}

function createMockElement(tagName: string): MockDomElement {
  const el: MockDomElement = {
    tagName: tagName.toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    value: '',
    type: '',
    hidden: false,
    checked: false,
    dataset: {},
    attributes: {},
    children: [],
    style: {},
    classList: {
      add: (c: string) => {
        const classes = new Set(el.className.split(/\s+/).filter(Boolean));
        classes.add(c);
        el.className = Array.from(classes).join(' ');
      },
      remove: (c: string) => {
        const classes = new Set(el.className.split(/\s+/).filter(Boolean));
        classes.delete(c);
        el.className = Array.from(classes).join(' ');
      },
      toggle: (c: string, force?: boolean) => {
        const has = el.classList.contains(c);
        const shouldHave = force !== undefined ? force : !has;
        if (shouldHave) el.classList.add(c);
        else el.classList.remove(c);
      },
      contains: (c: string) => el.className.split(/\s+/).includes(c),
    },
    eventListeners: {},
    setAttribute(k: string, v: string) {
      el.attributes[k] = v;
    },
    getAttribute(k: string) {
      return el.attributes[k] ?? null;
    },
    removeAttribute(k: string) {
      delete el.attributes[k];
    },
    toggleAttribute(k: string, force?: boolean): boolean {
      const has = k in el.attributes;
      const shouldHave = force !== undefined ? force : !has;
      if (shouldHave) el.attributes[k] = '';
      else delete el.attributes[k];
      return shouldHave;
    },
    appendChild(c: MockDomElement) {
      el.children.push(c);
      return c;
    },
    append(...nodes: MockDomElement[]) {
      el.children.push(...nodes);
    },
    replaceChildren(...nodes: MockDomElement[]) {
      el.children = [...nodes];
    },
    addEventListener(evt: string, fn: (e: any) => void) {
      el.eventListeners[evt] = el.eventListeners[evt] || [];
      el.eventListeners[evt].push(fn);
    },
    dispatchEvent(evt: { type: string; [key: string]: any }) {
      for (const fn of el.eventListeners[evt.type] || []) fn(evt);
      return true;
    },
    querySelector(sel: string): MockDomElement | null {
      const matches = el.querySelectorAll(sel);
      return matches[0] ?? null;
    },
    querySelectorAll(sel: string): MockDomElement[] {
      const results: MockDomElement[] = [];
      const match = (node: MockDomElement) => {
        if (sel.startsWith('.')) {
          const cls = sel.slice(1);
          if (node.classList.contains(cls)) results.push(node);
        } else if (sel.startsWith('#')) {
          const id = sel.slice(1);
          if (node.id === id) results.push(node);
        } else if (sel.includes('[') && sel.includes(']')) {
          const attr = sel.slice(sel.indexOf('[') + 1, sel.indexOf(']'));
          if (attr.includes('=')) {
            const [k, v] = attr.split('=').map((s) => s.replace(/['"]/g, ''));
            if (node.attributes[k!] === v || (node.dataset && node.dataset[k!.replace('data-', '')] === v)) {
              results.push(node);
            }
          }
        }
        for (const child of node.children) {
          match(child);
        }
      };
      for (const child of el.children) match(child);
      return results;
    },
    closest(sel: string): MockDomElement | null {
      if (sel.startsWith('.') && el.classList.contains(sel.slice(1))) return el;
      if (sel.startsWith('#') && el.id === sel.slice(1)) return el;
      return null;
    },
    contains(node: any): boolean {
      if (node === el) return true;
      return el.children.some((c) => c.contains(node));
    },
  };
  return el;
}
