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
  getSourceIcon,
  formatSourceLabel,
  sourceName,
} from './controls';
import { showToast, toRgbStr } from './toast';
import { getGlobalDirector } from '../render/globalDirector';
import { getVisualGain } from '../render/gainStore';
import { getBeatSensitivity } from '../audio/onset';
import { getRenderScale } from '../gl/size';
import { getAspectCorrect } from '../render/compositor';
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

describe('Segmented Pill HUD layout & Hub Popups in index.html (Stage 12 / Sector 487)', () => {
  const nav = indexHtml.slice(indexHtml.indexOf('<nav id="controls"'), indexHtml.indexOf('</nav>'));
  const sourcePanel = indexHtml.slice(indexHtml.indexOf('<div id="source-panel"'), indexHtml.indexOf('<div id="experience-panel"'));
  const expPanel = indexHtml.slice(indexHtml.indexOf('<div id="experience-panel"'), indexHtml.indexOf('<div class="hud-pills-row">'));
  const pillsRow = indexHtml.slice(indexHtml.indexOf('<div class="hud-pills-row">'), indexHtml.indexOf('</nav>'));

  it('structures HUD into three sleek segmented pills (#audio-pill, #visuals-pill, #utilities-pill)', () => {
    for (const pillId of ['audio-pill', 'visuals-pill', 'utilities-pill']) {
      expect(pillsRow).toContain(`id="${pillId}"`);
    }
    expect(pillsRow).toContain('id="source-btn"');
    expect(pillsRow).toContain('id="source-icon"');
    expect(pillsRow).toContain('id="source-label"');
    expect(pillsRow).toContain('id="playback-action-btn"');
    expect(pillsRow).toContain('id="action-icon"');
    expect(pillsRow).toContain('id="action-label"');
    expect(pillsRow).toContain('id="timeline-separator"');
    expect(pillsRow).toContain('id="playback-scrubber-segment"');
    expect(pillsRow).toContain('id="time-current"');
    expect(pillsRow).toContain('id="seek"');
    expect(pillsRow).toContain('id="time-total"');
    expect(pillsRow).toContain('id="experience-btn"');
    expect(pillsRow).toContain('id="experience-label"');
    expect(pillsRow).toContain('id="studio-open"');
    expect(pillsRow).toContain('id="shortcuts-btn"');
    expect(pillsRow).toContain('id="fs-btn"');
  });

  it('consolidates 4 first-class audio sources and master volume in #source-panel', () => {
    expect(sourcePanel).toContain('data-source="display"');
    expect(sourcePanel).toContain('Tab / System Audio');
    expect(sourcePanel).toContain('data-source="mic"');
    expect(sourcePanel).toContain('Microphone');
    expect(sourcePanel).toContain('id="file-btn"');
    expect(sourcePanel).toContain('id="file-input"');
    expect(sourcePanel).toContain('id="test-select"');
    for (const opt of ['kick', 'tone', 'sweep', 'silence']) {
      expect(sourcePanel).toContain(`value="${opt}"`);
    }
    expect(sourcePanel).toContain('id="volume"');
    expect(sourcePanel).toContain('id="volume-value"');
  });

  it('has the preset auto-cycle selector, Shuffle toggle and timer length in #experience-panel (slice 21.13)', () => {
    expect(expPanel).toContain('id="exp-cycle-mode"');
    for (const v of ['off', 'timer', 'beat']) {
      expect(expPanel).toMatch(new RegExp(`<option value="${v}">`));
    }
    expect(expPanel).toContain('id="exp-cycle-shuffle"');
    expect(expPanel).toMatch(/id="exp-cycle-interval"[^>]*min="5"[^>]*max="120"/);
    expect(expPanel).toContain('id="exp-cycle-interval-value"');
  });

  it('consolidates Experience mode, Camera, Color, Gain, Beat, Quality and Aspect in #experience-panel', () => {
    for (const mode of ['cinematic', 'calm', 'minimal', 'colorWalk']) {
      expect(expPanel).toContain(`data-mode="${mode}"`);
    }
    expect(expPanel).toContain('id="exp-camera-select"');
    expect(expPanel).toContain('id="exp-color-select"');
    for (const cam of ['auto', 'craneSway', 'dutchRoll', 'breathingPush', 'horizonTilt', 'stillAnchor', 'off']) {
      expect(expPanel).toContain(`value="${cam}"`);
    }
    for (const col of ['auto', 'native', 'cyberpunk', 'ember', 'biolum', 'vapor', 'prismatic']) {
      expect(expPanel).toContain(`value="${col}"`);
    }
    expect(expPanel).toContain('id="gain"');
    expect(expPanel).toContain('id="gain-value"');
    expect(expPanel).toContain('id="beat-sensitivity"');
    expect(expPanel).toContain('id="beat-value"');
    expect(expPanel).toContain('id="render-quality"');
    expect(expPanel).toContain('id="aspect-correct"');
    expect(expPanel).toContain('id="exp-export-btn"');
    expect(expPanel).toContain('id="exp-import-input"');

    // Standalone obsolete elements are absent
    expect(nav).not.toContain('id="calm"');
    expect(nav).not.toContain('id="director-mode"');
  });

  it('starts with timeline scrubber and action button hidden until source is active', () => {
    expect(pillsRow).toContain('id="playback-scrubber-segment" class="pill-segment scrubber-segment" hidden');
    expect(pillsRow).toContain('id="playback-action-btn" class="ui-btn ui-btn--ghost pill-segment action-btn" aria-label="Playback action" hidden');
    expect(pillsRow).toContain('id="playback" hidden');
  });

  it('includes startup onboarding toast and guide re-summon button', () => {
    expect(indexHtml).toContain('id="onboarding-toast" class="onboarding-toast" role="status" aria-live="polite" hidden');
    expect(indexHtml).toContain('id="dismiss-toast-btn"');
    expect(indexHtml).toContain('Ready to visualize audio');
    expect(dialog).toContain('id="reopen-toast-btn"');
    expect(dialog).toContain('Show Getting Started Guide');
  });

  it('keeps one sticky close header on the controls panel', () => {
    expect(nav).toContain('class="sheet-head controls-head"');
    expect(nav).toContain('id="controls-close"');
  });
});

describe('source formatting helpers (Slice 12.3)', () => {
  it('returns appropriate icon for each source kind', () => {
    expect(getSourceIcon('mic')).toContain('data-icon="mic"');
    expect(getSourceIcon('display')).toContain('data-icon="monitor"');
    expect(getSourceIcon('file')).toContain('data-icon="music"');
    expect(getSourceIcon('test:kick')).toContain('data-icon="zap"');
    expect(getSourceIcon('none')).toContain('data-icon="volume"');
  });

  it('formats source labels appropriately', () => {
    expect(formatSourceLabel('none')).toBe('Source: None');
    expect(formatSourceLabel('mic')).toBe('Source: Mic');
    expect(formatSourceLabel('display')).toBe('Source: Tab / system audio');
    expect(formatSourceLabel('file')).toBe('Source: File');
    expect(formatSourceLabel('file', 'synth.mp3')).toBe('Source: synth.mp3');
    expect(formatSourceLabel('test:kick')).toBe('Source: Test (kick)');
  });

  it('returns friendly source names', () => {
    expect(sourceName('none')).toBe('No source');
    expect(sourceName('mic')).toBe('Microphone');
    expect(sourceName('display')).toBe('Tab / system audio');
    expect(sourceName('file', 'beat.wav')).toBe('File: beat.wav');
    expect(sourceName('test:tone')).toBe('Test signal: tone');
  });
});

describe('shortcuts list keys (slices 8.1 and 8.7)', () => {
  it('makes every key in the list tappable: letters, digits, brackets, arrows, Space and .', () => {
    const keys = [...dialog.matchAll(/<button type="button" class="key" data-key="([^"]+)"/g)].map((m) => m[1]);
    const expected = ['A', 'B', 'C', 'E', 'F', 'K', 'P', 'X', ' ', '.', '[', ']', '?', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    expect(keys.sort()).toEqual(expected.sort());
  });

  it('does not advertise the debug panel key (slice 21.1)', () => {
    expect(dialog).not.toContain('Debug panel');
    expect(dialog).not.toContain('data-key="D"');
  });

  it('start-screen copy does not reference a Calm switch (slice 21.1)', () => {
    expect(indexHtml).not.toContain('Calm switch');
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

      expect(toastEl.getAttribute('role')).toBe('status');
      expect(toastEl.getAttribute('aria-live')).toBe('polite');
      expect(toastEl.getAttribute('aria-label')).toBeNull();
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
      expect(toastEl.getAttribute('role')).toBe('status');
      expect(toastEl.getAttribute('aria-live')).toBe('polite');
      expect(toastEl.getAttribute('aria-label')).toBeNull();
      const content = toastEl.children[0]!;
      expect(content.children.find((c) => c.className === 'toast-title')?.textContent).toBe('Mode: Calm');
      expect(content.children.find((c) => c.className === 'toast-detail')?.textContent).toBe('Still Anchor · Bioluminescent');
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
  let docListeners: Record<string, ((e: any) => void)[]>;

  beforeEach(() => {
    originalDoc = globalThis.document;
    originalWindow = globalThis.window;
    windowListeners = {};
    docListeners = {};
    domElements = {};

    const register = (id: string, tag: string = 'div') => {
      const el = createMockElement(tag);
      el.id = id;
      domElements[id] = el;
      return el;
    };

    const controls = register('controls', 'nav');

    // Onboarding toast
    register('toast', 'div');
    const onboardingToast = register('onboarding-toast', 'div');
    const dismissToastBtn = register('dismiss-toast-btn', 'button');
    onboardingToast.appendChild(dismissToastBtn);

    // Source panel
    const sourcePanel = register('source-panel', 'div');
    sourcePanel.hidden = true;

    const tabSourceBtn = createMockElement('button');
    tabSourceBtn.dataset.source = 'display';
    tabSourceBtn.setAttribute('data-source', 'display');
    sourcePanel.appendChild(tabSourceBtn);

    const micSourceBtn = createMockElement('button');
    micSourceBtn.dataset.source = 'mic';
    micSourceBtn.setAttribute('data-source', 'mic');
    sourcePanel.appendChild(micSourceBtn);

    const stopSourceBtn = createMockElement('button');
    stopSourceBtn.dataset.source = 'stop';
    stopSourceBtn.setAttribute('data-source', 'stop');
    sourcePanel.appendChild(stopSourceBtn);

    const fileBtn = register('file-btn', 'button');
    sourcePanel.appendChild(fileBtn);
    const fileInput = register('file-input', 'input');
    fileInput.type = 'file';
    sourcePanel.appendChild(fileInput);

    const testSelect = register('test-select', 'select');
    sourcePanel.appendChild(testSelect);

    const volume = register('volume', 'input');
    volume.value = '0.8';
    sourcePanel.appendChild(volume);
    const volumeValue = register('volume-value', 'span');
    volumeValue.textContent = '80%';
    sourcePanel.appendChild(volumeValue);

    controls.appendChild(sourcePanel);

    // Experience panel
    const experiencePanel = register('experience-panel', 'div');
    experiencePanel.className = 'value-panel experience-panel';
    experiencePanel.hidden = true;

    for (const mode of ['cinematic', 'calm', 'minimal', 'colorWalk']) {
      const btn = createMockElement('button');
      btn.className = 'exp-mode-btn';
      btn.dataset.mode = mode;
      experiencePanel.appendChild(btn);
    }

    const expCameraSelect = register('exp-camera-select', 'select');
    experiencePanel.appendChild(expCameraSelect);

    const expColorSelect = register('exp-color-select', 'select');
    experiencePanel.appendChild(expColorSelect);

    const gain = register('gain', 'input');
    gain.value = '1.0';
    experiencePanel.appendChild(gain);
    const gainValue = register('gain-value', 'span');
    experiencePanel.appendChild(gainValue);

    const beatSensitivity = register('beat-sensitivity', 'input');
    beatSensitivity.value = '50';
    experiencePanel.appendChild(beatSensitivity);
    const beatValue = register('beat-value', 'span');
    experiencePanel.appendChild(beatValue);

    const renderQuality = register('render-quality', 'select');
    experiencePanel.appendChild(renderQuality);

    const aspectCorrect = register('aspect-correct', 'input');
    aspectCorrect.type = 'checkbox';
    experiencePanel.appendChild(aspectCorrect);

    const expExportBtn = register('exp-export-btn', 'button');
    experiencePanel.appendChild(expExportBtn);

    const expImportInput = register('exp-import-input', 'input');
    expImportInput.type = 'file';
    experiencePanel.appendChild(expImportInput);

    controls.appendChild(experiencePanel);

    // Pills row
    const pillsRow = createMockElement('div');
    pillsRow.className = 'hud-pills-row';

    // Audio pill
    const audioPill = register('audio-pill', 'div');
    audioPill.className = 'pill-container';

    const sourceBtn = register('source-btn', 'button');
    sourceBtn.className = 'pill-segment';
    const sourceIcon = register('source-icon', 'span');
    sourceIcon.textContent = '🔊';
    const sourceLabel = register('source-label', 'span');
    sourceLabel.textContent = 'Source: None';
    sourceBtn.appendChild(sourceIcon);
    sourceBtn.appendChild(sourceLabel);
    audioPill.appendChild(sourceBtn);

    const playbackActionBtn = register('playback-action-btn', 'button');
    playbackActionBtn.className = 'pill-segment action-btn';
    playbackActionBtn.hidden = true;
    const actionIcon = register('action-icon', 'span');
    const actionLabel = register('action-label', 'span');
    playbackActionBtn.appendChild(actionIcon);
    playbackActionBtn.appendChild(actionLabel);
    audioPill.appendChild(playbackActionBtn);

    const playBtn = register('play-btn', 'button');
    playBtn.hidden = true;
    audioPill.appendChild(playBtn);

    const timelineSep = register('timeline-separator', 'div');
    timelineSep.hidden = true;
    audioPill.appendChild(timelineSep);

    const scrubberSeg = register('playback-scrubber-segment', 'div');
    scrubberSeg.hidden = true;
    const timeCurrent = register('time-current', 'span');
    timeCurrent.textContent = '0:00';
    const seek = register('seek', 'input');
    seek.value = '0';
    const timeTotal = register('time-total', 'span');
    timeTotal.textContent = '0:00';
    const time = register('time', 'span');
    time.textContent = '0:00';
    scrubberSeg.appendChild(timeCurrent);
    scrubberSeg.appendChild(seek);
    scrubberSeg.appendChild(timeTotal);
    scrubberSeg.appendChild(time);
    audioPill.appendChild(scrubberSeg);

    const playback = register('playback', 'div');
    playback.hidden = true;
    audioPill.appendChild(playback);

    pillsRow.appendChild(audioPill);

    // Visuals pill
    const visualsPill = register('visuals-pill', 'div');
    visualsPill.className = 'pill-container';

    const expBtn = register('experience-btn', 'button');
    expBtn.className = 'pill-segment value-btn';
    const expLabel = register('experience-label', 'span');
    expLabel.textContent = 'Experience: Cinematic';
    expBtn.appendChild(expLabel);
    visualsPill.appendChild(expBtn);

    const studioOpen = register('studio-open', 'button');
    visualsPill.appendChild(studioOpen);

    pillsRow.appendChild(visualsPill);

    // Utilities pill
    const utilitiesPill = register('utilities-pill', 'div');
    utilitiesPill.className = 'pill-container';

    const shortcutsBtn = register('shortcuts-btn', 'button');
    utilitiesPill.appendChild(shortcutsBtn);

    const fsBtn = register('fs-btn', 'button');
    utilitiesPill.appendChild(fsBtn);

    pillsRow.appendChild(utilitiesPill);
    controls.appendChild(pillsRow);

    // Controls show/close
    register('controls-show', 'button');
    register('controls-close', 'button');

    // Shortcuts dialog
    const shortcuts = register('shortcuts', 'dialog');
    shortcuts.showModal = vi.fn(() => { (shortcuts as any).open = true; });
    shortcuts.close = vi.fn(() => {
      (shortcuts as any).open = false;
      for (const fn of shortcuts.eventListeners['close'] || []) fn({ type: 'close' });
    });
    register('shortcuts-close', 'button');
    const reopenToastBtn = register('reopen-toast-btn', 'button');
    shortcuts.appendChild(reopenToastBtn);

    (globalThis as any).document = {
      body: createMockElement('body'),
      activeElement: null,
      getElementById: (id: string) => domElements[id] ?? null,
      createElement: (tag: string) => createMockElement(tag),
      addEventListener: (evt: string, fn: (e: any) => void) => {
        docListeners[evt] = docListeners[evt] || [];
        docListeners[evt].push(fn);
      },
      dispatchEvent: (evt: any) => {
        for (const fn of docListeners[evt.type] || []) fn(evt);
        return true;
      },
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

    let engineListeners: Record<string, ((...args: any[]) => void)[]> = {};
    mockEngine = {
      setVolume: vi.fn(),
      useFile: vi.fn().mockImplementation((_file: File) => {
        (mockEngine as any).kind = 'file';
        (mockEngine as any).media = {
          paused: true,
          currentTime: 0,
          duration: 180,
          play: vi.fn().mockImplementation(() => { (mockEngine as any).media.paused = false; }),
          pause: vi.fn().mockImplementation(() => { (mockEngine as any).media.paused = true; }),
        };
        for (const fn of engineListeners['source-changed'] || []) fn('file');
      }),
      useDisplayCapture: vi.fn().mockImplementation(() => {
        (mockEngine as any).kind = 'display';
        (mockEngine as any).media = null;
        for (const fn of engineListeners['source-changed'] || []) fn('display');
      }),
      useMic: vi.fn().mockImplementation(() => {
        (mockEngine as any).kind = 'mic';
        (mockEngine as any).media = null;
        for (const fn of engineListeners['source-changed'] || []) fn('mic');
      }),
      useTestSignal: vi.fn().mockImplementation((sig: string) => {
        (mockEngine as any).kind = `test:${sig}`;
        (mockEngine as any).media = null;
        for (const fn of engineListeners['source-changed'] || []) fn(`test:${sig}`);
      }),
      stop: vi.fn().mockImplementation(() => {
        (mockEngine as any).kind = 'none';
        (mockEngine as any).media = null;
        for (const fn of engineListeners['source-changed'] || []) fn('none');
      }),
      kind: 'none',
      media: null,
      on: vi.fn((evt: string, fn: (...args: any[]) => void) => {
        engineListeners[evt] = engineListeners[evt] || [];
        engineListeners[evt].push(fn);
      }),
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
    const toastEl = domElements['toast']!;
    expect(toastEl.getAttribute('role')).toBe('status');
    expect(toastEl.getAttribute('aria-live')).toBe('polite');
    expect(toastEl.getAttribute('aria-label')).toBeNull();
    const content = toastEl.children[0]!;
    expect(content.children.find((c) => c.className === 'toast-title')?.textContent).toBe('Mode: Calm');
    expect(content.children.find((c) => c.className === 'toast-detail')?.textContent).toBe('Still Anchor · Bioluminescent');
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
    const toastEl = domElements['toast']!;
    expect(toastEl.getAttribute('role')).toBe('status');
    expect(toastEl.getAttribute('aria-live')).toBe('polite');
    expect(toastEl.getAttribute('aria-label')).toBeNull();
    const content = toastEl.children[0]!;
    expect(content.children.find((c) => c.className === 'toast-title')?.textContent).toBe('Mode: Calm');
    expect(content.children.find((c) => c.className === 'toast-detail')?.textContent).toBe('Still Anchor · Bioluminescent');
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

describe('Segmented Pill Controls & Interactivity (Slice 12.4)', () => {
  let originalDoc: any;
  let originalWindow: any;
  let mockEngine: AudioEngine;
  let domElements: Record<string, MockDomElement>;
  let windowListeners: Record<string, ((e: any) => void)[]>;
  let docListeners: Record<string, ((e: any) => void)[]>;
  let engineListeners: Record<string, ((...args: any[]) => void)[]>;

  beforeEach(() => {
    originalDoc = globalThis.document;
    originalWindow = globalThis.window;
    windowListeners = {};
    docListeners = {};
    engineListeners = {};
    domElements = {};

    const register = (id: string, tag: string = 'div') => {
      const el = createMockElement(tag);
      el.id = id;
      domElements[id] = el;
      return el;
    };

    const controls = register('controls', 'nav');

    // Onboarding toast
    register('toast', 'div');
    const onboardingToast = register('onboarding-toast', 'div');
    const dismissToastBtn = register('dismiss-toast-btn', 'button');
    onboardingToast.appendChild(dismissToastBtn);

    // Source panel
    const sourcePanel = register('source-panel', 'div');
    sourcePanel.hidden = true;

    const tabSourceBtn = createMockElement('button');
    tabSourceBtn.dataset.source = 'display';
    tabSourceBtn.setAttribute('data-source', 'display');
    sourcePanel.appendChild(tabSourceBtn);

    const micSourceBtn = createMockElement('button');
    micSourceBtn.dataset.source = 'mic';
    micSourceBtn.setAttribute('data-source', 'mic');
    sourcePanel.appendChild(micSourceBtn);

    const stopSourceBtn = createMockElement('button');
    stopSourceBtn.dataset.source = 'stop';
    stopSourceBtn.setAttribute('data-source', 'stop');
    sourcePanel.appendChild(stopSourceBtn);

    const fileBtn = register('file-btn', 'button');
    sourcePanel.appendChild(fileBtn);
    const fileInput = register('file-input', 'input');
    fileInput.type = 'file';
    sourcePanel.appendChild(fileInput);

    const testSelect = register('test-select', 'select');
    sourcePanel.appendChild(testSelect);

    const volume = register('volume', 'input');
    volume.value = '0.8';
    sourcePanel.appendChild(volume);
    const volumeValue = register('volume-value', 'span');
    volumeValue.textContent = '80%';
    sourcePanel.appendChild(volumeValue);

    controls.appendChild(sourcePanel);

    // Experience panel
    const experiencePanel = register('experience-panel', 'div');
    experiencePanel.className = 'value-panel experience-panel';
    experiencePanel.hidden = true;

    for (const mode of ['cinematic', 'calm', 'minimal', 'colorWalk']) {
      const btn = createMockElement('button');
      btn.className = 'exp-mode-btn';
      btn.dataset.mode = mode;
      experiencePanel.appendChild(btn);
    }

    const expCameraSelect = register('exp-camera-select', 'select');
    experiencePanel.appendChild(expCameraSelect);

    const expColorSelect = register('exp-color-select', 'select');
    experiencePanel.appendChild(expColorSelect);

    const gain = register('gain', 'input');
    gain.value = '1.0';
    experiencePanel.appendChild(gain);
    const gainValue = register('gain-value', 'span');
    experiencePanel.appendChild(gainValue);

    const beatSensitivity = register('beat-sensitivity', 'input');
    beatSensitivity.value = '50';
    experiencePanel.appendChild(beatSensitivity);
    const beatValue = register('beat-value', 'span');
    experiencePanel.appendChild(beatValue);

    const renderQuality = register('render-quality', 'select');
    experiencePanel.appendChild(renderQuality);

    const aspectCorrect = register('aspect-correct', 'input');
    aspectCorrect.type = 'checkbox';
    experiencePanel.appendChild(aspectCorrect);

    const expExportBtn = register('exp-export-btn', 'button');
    experiencePanel.appendChild(expExportBtn);

    const expImportInput = register('exp-import-input', 'input');
    expImportInput.type = 'file';
    experiencePanel.appendChild(expImportInput);

    controls.appendChild(experiencePanel);

    // Pills row
    const pillsRow = createMockElement('div');
    pillsRow.className = 'hud-pills-row';

    // Audio pill
    const audioPill = register('audio-pill', 'div');
    audioPill.className = 'pill-container';

    const sourceBtn = register('source-btn', 'button');
    sourceBtn.className = 'pill-segment';
    const sourceIcon = register('source-icon', 'span');
    sourceIcon.textContent = '🔊';
    const sourceLabel = register('source-label', 'span');
    sourceLabel.textContent = 'Source: None';
    sourceBtn.appendChild(sourceIcon);
    sourceBtn.appendChild(sourceLabel);
    audioPill.appendChild(sourceBtn);

    const playbackActionBtn = register('playback-action-btn', 'button');
    playbackActionBtn.className = 'pill-segment action-btn';
    playbackActionBtn.hidden = true;
    const actionIcon = register('action-icon', 'span');
    const actionLabel = register('action-label', 'span');
    playbackActionBtn.appendChild(actionIcon);
    playbackActionBtn.appendChild(actionLabel);
    audioPill.appendChild(playbackActionBtn);

    const playBtn = register('play-btn', 'button');
    playBtn.hidden = true;
    audioPill.appendChild(playBtn);

    const timelineSep = register('timeline-separator', 'div');
    timelineSep.hidden = true;
    audioPill.appendChild(timelineSep);

    const scrubberSeg = register('playback-scrubber-segment', 'div');
    scrubberSeg.hidden = true;
    const timeCurrent = register('time-current', 'span');
    timeCurrent.textContent = '0:00';
    const seek = register('seek', 'input');
    seek.value = '0';
    const timeTotal = register('time-total', 'span');
    timeTotal.textContent = '0:00';
    const time = register('time', 'span');
    time.textContent = '0:00';
    scrubberSeg.appendChild(timeCurrent);
    scrubberSeg.appendChild(seek);
    scrubberSeg.appendChild(timeTotal);
    scrubberSeg.appendChild(time);
    audioPill.appendChild(scrubberSeg);

    const playback = register('playback', 'div');
    playback.hidden = true;
    audioPill.appendChild(playback);

    pillsRow.appendChild(audioPill);

    // Visuals pill
    const visualsPill = register('visuals-pill', 'div');
    visualsPill.className = 'pill-container';

    const expBtn = register('experience-btn', 'button');
    expBtn.className = 'pill-segment';
    const expLabel = register('experience-label', 'span');
    expLabel.textContent = 'Visuals: Cinematic';
    expBtn.appendChild(expLabel);
    visualsPill.appendChild(expBtn);

    const studioOpen = register('studio-open', 'button');
    visualsPill.appendChild(studioOpen);

    pillsRow.appendChild(visualsPill);

    // Utilities pill
    const utilitiesPill = register('utilities-pill', 'div');
    utilitiesPill.className = 'pill-container';

    const shortcutsBtn = register('shortcuts-btn', 'button');
    utilitiesPill.appendChild(shortcutsBtn);

    const fsBtn = register('fs-btn', 'button');
    utilitiesPill.appendChild(fsBtn);

    pillsRow.appendChild(utilitiesPill);
    controls.appendChild(pillsRow);

    // Controls show/close
    register('controls-show', 'button');
    register('controls-close', 'button');

    // Shortcuts dialog
    const shortcuts = register('shortcuts', 'dialog');
    shortcuts.showModal = vi.fn(() => { (shortcuts as any).open = true; });
    shortcuts.close = vi.fn(() => {
      (shortcuts as any).open = false;
      for (const fn of shortcuts.eventListeners['close'] || []) fn({ type: 'close' });
    });
    register('shortcuts-close', 'button');
    const reopenToastBtn = register('reopen-toast-btn', 'button');
    shortcuts.appendChild(reopenToastBtn);

    (globalThis as any).document = {
      body: createMockElement('body'),
      activeElement: null,
      getElementById: (id: string) => domElements[id] ?? null,
      createElement: (tag: string) => createMockElement(tag),
      addEventListener: (evt: string, fn: (e: any) => void) => {
        docListeners[evt] = docListeners[evt] || [];
        docListeners[evt].push(fn);
      },
      dispatchEvent: (evt: any) => {
        for (const fn of docListeners[evt.type] || []) fn(evt);
        return true;
      },
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
      useFile: vi.fn().mockImplementation((_file: File) => {
        (mockEngine as any).kind = 'file';
        (mockEngine as any).media = {
          paused: true,
          currentTime: 0,
          duration: 180,
          play: vi.fn().mockImplementation(() => { (mockEngine as any).media.paused = false; }),
          pause: vi.fn().mockImplementation(() => { (mockEngine as any).media.paused = true; }),
        };
        for (const fn of engineListeners['source-changed'] || []) fn('file');
      }),
      useDisplayCapture: vi.fn().mockImplementation(() => {
        (mockEngine as any).kind = 'display';
        (mockEngine as any).media = null;
        for (const fn of engineListeners['source-changed'] || []) fn('display');
      }),
      useMic: vi.fn().mockImplementation(() => {
        (mockEngine as any).kind = 'mic';
        (mockEngine as any).media = null;
        for (const fn of engineListeners['source-changed'] || []) fn('mic');
      }),
      useTestSignal: vi.fn().mockImplementation((sig: string) => {
        (mockEngine as any).kind = `test:${sig}`;
        (mockEngine as any).media = null;
        for (const fn of engineListeners['source-changed'] || []) fn(`test:${sig}`);
      }),
      stop: vi.fn().mockImplementation(() => {
        (mockEngine as any).kind = 'none';
        (mockEngine as any).media = null;
        for (const fn of engineListeners['source-changed'] || []) fn('none');
      }),
      kind: 'none',
      media: null,
      on: vi.fn((evt: string, fn: (...args: any[]) => void) => {
        engineListeners[evt] = engineListeners[evt] || [];
        engineListeners[evt].push(fn);
      }),
    } as unknown as AudioEngine;
  });

  afterEach(() => {
    (globalThis as any).document = originalDoc;
    (globalThis as any).window = originalWindow;
  });

  it('opens and closes #source-panel when #source-btn is clicked', () => {
    setupControls(mockEngine, { calm: false, fileName: '' });
    const sourceBtn = domElements['source-btn']!;
    const sourcePanel = domElements['source-panel']!;

    expect(sourcePanel.hidden).toBe(true);
    expect(sourceBtn.getAttribute('aria-expanded')).toBeNull();

    sourceBtn.dispatchEvent({ type: 'click' });
    expect(sourcePanel.hidden).toBe(false);
    expect(sourceBtn.getAttribute('aria-expanded')).toBe('true');

    sourceBtn.dispatchEvent({ type: 'click' });
    expect(sourcePanel.hidden).toBe(true);
    expect(sourceBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('ensures mutual exclusivity between Source and Visuals popups', () => {
    setupControls(mockEngine, { calm: false, fileName: '' });
    const sourceBtn = domElements['source-btn']!;
    const sourcePanel = domElements['source-panel']!;
    const expBtn = domElements['experience-btn']!;
    const expPanel = domElements['experience-panel']!;

    // Open source panel
    sourceBtn.dispatchEvent({ type: 'click' });
    expect(sourcePanel.hidden).toBe(false);
    expect(expPanel.hidden).toBe(true);

    // Opening visuals panel closes source panel
    expBtn.dispatchEvent({ type: 'click' });
    expect(expPanel.hidden).toBe(false);
    expect(sourcePanel.hidden).toBe(true);

    // Opening source panel closes visuals panel
    sourceBtn.dispatchEvent({ type: 'click' });
    expect(sourcePanel.hidden).toBe(false);
    expect(expPanel.hidden).toBe(true);
  });

  it('closes open popups when clicking outside or pressing Escape', () => {
    setupControls(mockEngine, { calm: false, fileName: '' });
    const sourceBtn = domElements['source-btn']!;
    const sourcePanel = domElements['source-panel']!;
    const controls = domElements['controls']!;

    // Open source panel
    sourceBtn.dispatchEvent({ type: 'click' });
    expect(sourcePanel.hidden).toBe(false);

    // Outside pointerdown closes panel
    const outsideEl = createMockElement('div');
    (globalThis.document as any).dispatchEvent({ type: 'pointerdown', target: outsideEl });
    expect(sourcePanel.hidden).toBe(true);

    // Open again, Escape key closes panel
    sourceBtn.dispatchEvent({ type: 'click' });
    expect(sourcePanel.hidden).toBe(false);
    controls.dispatchEvent({ type: 'keydown', key: 'Escape' });
    expect(sourcePanel.hidden).toBe(true);
  });

  it('switches audio source to Tab audio, Mic, Test signal, and File', () => {
    setupControls(mockEngine, { calm: false, fileName: '' });
    const sourcePanel = domElements['source-panel']!;
    const sourceBtn = domElements['source-btn']!;

    // 1. Tab Audio
    sourceBtn.dispatchEvent({ type: 'click' });
    const tabBtn = sourcePanel.querySelectorAll('button[data-source="display"]')[0];
    tabBtn?.dispatchEvent({ type: 'click' });
    expect(mockEngine.useDisplayCapture).toHaveBeenCalled();
    expect(sourcePanel.hidden).toBe(true);

    // 2. Microphone
    sourceBtn.dispatchEvent({ type: 'click' });
    const micBtn = sourcePanel.querySelectorAll('button[data-source="mic"]')[0];
    micBtn?.dispatchEvent({ type: 'click' });
    expect(mockEngine.useMic).toHaveBeenCalled();
    expect(sourcePanel.hidden).toBe(true);

    // 3. Test Signal
    sourceBtn.dispatchEvent({ type: 'click' });
    const testSelect = domElements['test-select']!;
    testSelect.value = 'kick';
    testSelect.dispatchEvent({ type: 'change' });
    expect(mockEngine.useTestSignal).toHaveBeenCalledWith('kick');
    expect(testSelect.value).toBe('');
    expect(sourcePanel.hidden).toBe(true);

    // 4. File Input
    sourceBtn.dispatchEvent({ type: 'click' });
    const fileInput = domElements['file-input']!;
    const fakeFile = { name: 'track.mp3' };
    fileInput.files = [fakeFile];
    fileInput.dispatchEvent({ type: 'change' });
    expect(mockEngine.useFile).toHaveBeenCalledWith(fakeFile);
    expect(sourcePanel.hidden).toBe(true);
  });

  it('adjusts master volume and synchronizes readout', () => {
    setupControls(mockEngine, { calm: false, fileName: '' });
    const volume = domElements['volume']!;
    const volumeValue = domElements['volume-value']!;

    volume.value = '0.45';
    volume.dispatchEvent({ type: 'input' });

    expect(mockEngine.setVolume).toHaveBeenCalledWith(0.45);
    expect(volumeValue.textContent).toBe('45%');
  });

  it('configures contextual action button and scrubber for local audio file playback', () => {
    const controlsInstance = setupControls(mockEngine, { calm: false, fileName: '' });
    const actionBtn = domElements['playback-action-btn']!;
    const actionIcon = domElements['action-icon']!;
    const actionLabel = domElements['action-label']!;
    const scrubber = domElements['playback-scrubber-segment']!;
    const separator = domElements['timeline-separator']!;
    const sourceLabel = domElements['source-label']!;
    const timeCurrent = domElements['time-current']!;

    // Trigger local file load
    const fakeFile = { name: 'groove.mp3' };
    domElements['file-input']!.files = [fakeFile];
    domElements['file-input']!.dispatchEvent({ type: 'change' });

    // File loaded: action button and scrubber visible
    expect(actionBtn.hidden).toBe(false);
    expect(actionBtn.classList.contains('is-stop')).toBe(false);
    expect(actionBtn.dataset.action).toBe('play');
    expect(scrubber.hidden).toBe(false);
    expect(separator.hidden).toBe(false);
    expect(sourceLabel.textContent).toContain('groove.mp3');

    // Paused state initial
    controlsInstance.tick();
    expect(actionIcon.textContent).toBe('▶');
    expect(actionLabel.textContent).toBe('Play');
    expect(actionBtn.getAttribute('aria-label')).toBe('Play (Space)');

    // Toggle playback via action button
    actionBtn.dispatchEvent({ type: 'click' });
    expect((mockEngine as any).media.play).toHaveBeenCalled();
    expect((mockEngine as any).media.paused).toBe(false);

    // Tick updates action icon to Pause
    controlsInstance.tick();
    expect(actionIcon.textContent).toBe('⏸');
    expect(actionLabel.textContent).toBe('Pause');
    expect(actionBtn.getAttribute('aria-label')).toBe('Pause (Space)');

    // Seeking updates media position
    const seek = domElements['seek']!;
    seek.value = '500'; // halfway through 180s = 90s
    seek.dispatchEvent({ type: 'input' });
    expect((mockEngine as any).media.currentTime).toBe(90);
    expect(timeCurrent.textContent).toBe('1:30');
  });

  it('configures contextual action button for live stream inputs (mic / tab / test) and stops stream', () => {
    setupControls(mockEngine, { calm: false, fileName: '' });
    const actionBtn = domElements['playback-action-btn']!;
    const actionIcon = domElements['action-icon']!;
    const actionLabel = domElements['action-label']!;
    const scrubber = domElements['playback-scrubber-segment']!;
    const separator = domElements['timeline-separator']!;

    // Switch to mic
    const micBtn = domElements['source-panel']!.querySelectorAll('button[data-source="mic"]')[0];
    micBtn?.dispatchEvent({ type: 'click' });

    // Live stream state: Stop button shown, scrubber hidden
    expect(actionBtn.hidden).toBe(false);
    expect(actionBtn.classList.contains('is-stop')).toBe(true);
    expect(actionBtn.dataset.action).toBe('stop');
    expect(actionIcon.textContent).toBe('⏹');
    expect(actionLabel.textContent).toBe('Stop');
    expect(actionBtn.getAttribute('aria-label')).toBe('Stop stream');
    expect(scrubber.hidden).toBe(true);
    expect(separator.hidden).toBe(true);

    // Clicking Stop stops engine and returns to idle
    actionBtn.dispatchEvent({ type: 'click' });
    expect(mockEngine.stop).toHaveBeenCalled();
    expect(actionBtn.hidden).toBe(true);
    expect(scrubber.hidden).toBe(true);
  });

  it('wires consolidated visual controls inside #experience-panel (gain, beat, quality, aspect)', () => {
    setupControls(mockEngine, { calm: false, fileName: '' });

    // Visual Gain
    const gain = domElements['gain']!;
    const gainVal = domElements['gain-value']!;
    gain.value = '2.50';
    gain.dispatchEvent({ type: 'input' });
    expect(getVisualGain()).toBe(2.50);
    expect(gainVal.textContent).toBe('2.50×');

    // Beat Sensitivity
    const beat = domElements['beat-sensitivity']!;
    const beatVal = domElements['beat-value']!;
    beat.value = '75';
    beat.dispatchEvent({ type: 'input' });
    expect(getBeatSensitivity()).toBe(0.75);
    expect(beatVal.textContent).toBe('75%');

    // Render Quality
    const quality = domElements['render-quality']!;
    quality.value = '0.5';
    quality.dispatchEvent({ type: 'change' });
    expect(getRenderScale()).toBe(0.5);

    // Aspect Correction
    const aspect = domElements['aspect-correct']!;
    aspect.checked = false;
    aspect.dispatchEvent({ type: 'change' });
    expect(getAspectCorrect()).toBe(false);
  });

  it('manages startup onboarding toast lifecycle (dismissal and re-summon)', () => {
    setupControls(mockEngine, { calm: false, fileName: '' });
    const toast = domElements['onboarding-toast']!;
    const dismissBtn = domElements['dismiss-toast-btn']!;
    const reopenBtn = domElements['reopen-toast-btn']!;
    const shortcuts = domElements['shortcuts']!;
    const controls = domElements['controls']!;

    // Initial state: visible
    expect(toast.hidden).toBe(false);
    expect(toast.classList.contains('dismissed')).toBe(false);

    // Dismiss via toast dismiss button
    dismissBtn.dispatchEvent({ type: 'click' });
    expect(toast.hidden).toBe(true);
    expect(toast.classList.contains('dismissed')).toBe(true);

    // Re-summon via shortcuts help dialog button
    reopenBtn.dispatchEvent({ type: 'click' });
    expect(toast.hidden).toBe(false);
    expect(toast.classList.contains('dismissed')).toBe(false);
    expect(shortcuts.close).toHaveBeenCalled();

    // Auto-dismiss on controls interaction
    controls.dispatchEvent({ type: 'click' });
    expect(toast.hidden).toBe(true);
    expect(toast.classList.contains('dismissed')).toBe(true);

    // Auto-dismiss on source change
    reopenBtn.dispatchEvent({ type: 'click' });
    expect(toast.hidden).toBe(false);
    for (const fn of engineListeners['source-changed'] || []) fn('mic');
    expect(toast.hidden).toBe(true);
    expect(toast.classList.contains('dismissed')).toBe(true);
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
  click?(): void;
  showModal?(): void;
  close?(): void;
  focus?(): void;
}

function matchesSelector(node: MockDomElement, sel: string): boolean {
  let s = sel.trim();
  let tag = '';
  const matchTag = s.match(/^([a-zA-Z0-9]+)/);
  if (matchTag) {
    tag = matchTag[1]!.toUpperCase();
    s = s.slice(matchTag[1]!.length);
  }
  if (tag && node.tagName !== tag) return false;
  if (!s) return true;

  if (s.startsWith('.')) {
    const cls = s.slice(1);
    return node.classList.contains(cls);
  }
  if (s.startsWith('#')) {
    const id = s.slice(1);
    return node.id === id;
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const attr = s.slice(1, -1);
    if (attr.includes('=')) {
      const [k, v] = attr.split('=').map((str) => str.replace(/['"]/g, ''));
      const val = node.attributes[k!] ?? (node.dataset ? node.dataset[k!.replace('data-', '')] : undefined);
      return val === v;
    } else {
      const dataKey = attr.startsWith('data-') ? attr.slice(5) : attr;
      return attr in node.attributes || (node.dataset && dataKey in node.dataset);
    }
  }
  return false;
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
      if (!evt.stopPropagation) evt.stopPropagation = () => {};
      if (!evt.preventDefault) evt.preventDefault = () => {};
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
        if (matchesSelector(node, sel)) {
          results.push(node);
        }
        for (const child of node.children) {
          match(child);
        }
      };
      for (const child of el.children) match(child);
      return results;
    },
    closest(sel: string): MockDomElement | null {
      if (matchesSelector(el, sel)) return el;
      return null;
    },
    contains(node: any): boolean {
      if (node === el) return true;
      return el.children.some((c) => c.contains(node));
    },
    click() {
      el.dispatchEvent({ type: 'click' });
    },
    focus() {},
  };
  return el;
}
