// Player controls: source buttons, playback, volume, calm mode, fullscreen and
// keyboard shortcuts. Talks to the engine only through its public methods.
import type { AudioEngine, SourceKind } from '../audio/engine';
import type { TestSignal } from '../audio/testSignals';
import { showNotice } from './notices';
import { showToast } from './toast';
import { cyclePalette } from '../render/paletteStore';
import { getVisualGain, setVisualGain } from '../render/gainStore';
import { getBeatSensitivity, setBeatSensitivity } from '../audio/onset';
import { getReactionStyle, REACTION_STYLES, REACTION_STYLE_LABELS, setReactionStyle } from '../presets/reactionStyles';
import { getRenderScale, RENDER_SCALES, setRenderScale } from '../gl/size';
import { getAspectCorrect, setAspectCorrect } from '../render/compositor';
import {
  getGlobalDirector,
  DIRECTOR_PALETTES,
  type ExperienceMode,
  type CameraMode,
  type ColorMood,
} from '../render/globalDirector';

export const EXPERIENCE_LABELS: Record<string, string> = {
  cinematic: 'Cinematic',
  calm: 'Calm',
  minimal: 'Minimal',
  colorWalk: 'Color Walk',
  custom: 'Custom',
};

export interface ExperienceToastInfo {
  title: string;
  detail: string;
  swatch: [[number, number, number], [number, number, number]];
}

export const EXPERIENCE_TOAST_DATA: Record<string, ExperienceToastInfo> = {
  cinematic: {
    title: 'Mode: Cinematic',
    detail: 'Auto Camera · Dynamic Color',
    swatch: [DIRECTOR_PALETTES.cyberpunk.shadowTint, DIRECTOR_PALETTES.cyberpunk.highlightTint],
  },
  calm: {
    title: 'Mode: Calm',
    detail: 'Still Anchor · Bioluminescent',
    swatch: [DIRECTOR_PALETTES.biolum.shadowTint, DIRECTOR_PALETTES.biolum.highlightTint],
  },
  minimal: {
    title: 'Mode: Minimal',
    detail: 'Camera Off · Native Color',
    swatch: [[0.2, 0.2, 0.2], [0.8, 0.8, 0.8]],
  },
  colorWalk: {
    title: 'Mode: Color Walk',
    detail: 'Still Anchor · Prismatic Color',
    swatch: [DIRECTOR_PALETTES.prismatic.shadowTint, DIRECTOR_PALETTES.prismatic.highlightTint],
  },
};

export function triggerExperienceToast(mode: ExperienceMode): void {
  const info = EXPERIENCE_TOAST_DATA[mode];
  if (info) {
    showToast(info.title, { detail: info.detail, swatch: info.swatch });
  } else {
    showToast(`Mode: ${EXPERIENCE_LABELS[mode] ?? mode}`);
  }
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const SOURCE_NAMES: Record<string, string> = {
  none: 'No source',
  file: 'File',
  display: 'Tab / system audio',
  mic: 'Microphone',
};

export function getSourceIcon(kind: SourceKind): string {
  if (kind === 'mic') return '🎙️';
  if (kind === 'display') return '🖥️';
  if (kind === 'file') return '🎵';
  if (kind.startsWith('test:')) return '⚡';
  return '🔊';
}

export function formatSourceLabel(kind: SourceKind, fileName = ''): string {
  if (kind === 'none') return 'Source: None';
  if (kind === 'mic') return 'Source: Mic';
  if (kind === 'display') return 'Source: Tab / system audio';
  if (kind === 'file') return fileName ? `Source: ${fileName}` : 'Source: File';
  if (kind.startsWith('test:')) return `Source: Test (${kind.slice(5)})`;
  return `Source: ${kind}`;
}

export function sourceName(kind: SourceKind, fileName = ''): string {
  if (kind.startsWith('test:')) return `Test signal: ${kind.slice(5)}`;
  if (kind === 'file' && fileName) return `File: ${fileName}`;
  return SOURCE_NAMES[kind] ?? kind;
}

/** The controls bar is removed from the focus order while it is faded for idleness (slice 11.4). */
export function isControlsBarFocusable(idle: boolean): boolean {
  return !idle;
}

/** Swipe-down dismiss on phone settings sheets (slice 11.6). A downward drag of this many px closes the sheet. */
export const SWIPE_DISMISS_PX = 80;

/** Phone layout: under 600 px wide. */
export function isPhoneSheetWidth(width: number): boolean {
  return width < 600;
}

/** A swipe may start only from the sheet's handle (.sheet-handle). Header and body starts are ignored. */
export function canStartSwipe(fromHandle: boolean): boolean {
  return fromHandle;
}

/** True when a drag that began at startY (client px) has moved down far enough to dismiss the sheet. */
export function isSwipeDismiss(startY: number, currentY: number): boolean {
  return currentY - startY >= SWIPE_DISMISS_PX;
}

/**
 * Swipe down to dismiss a settings sheet on phones (slice 11.6). Pointer events, touch and pen only.
 * The sheet is its own scroller. The swipe calls close(), the same path as the close button, so focus returns.
 */
export function attachSwipeDismiss(sheet: HTMLElement, close: () => void): void {
  let pointerId: number | null = null;
  let startY = 0;
  const reset = () => { pointerId = null; };
  sheet.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !isPhoneSheetWidth(window.innerWidth)) return;
    const target = e.target as HTMLElement;
    // Sliders, selects and text fields keep their own drags.
    if (target.closest('input, select, textarea, .tp-sldv')) return;
    if (!canStartSwipe(!!target.closest('.sheet-handle'))) return;
    pointerId = e.pointerId;
    startY = e.clientY;
  });
  sheet.addEventListener('pointermove', (e) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    if (isSwipeDismiss(startY, e.clientY)) {
      reset();
      close();
    }
  });
  sheet.addEventListener('pointerup', (e) => {
    if (e.pointerId === pointerId) reset();
  });
  sheet.addEventListener('pointercancel', reset);
}

export interface ControlsState {
  calm: boolean;
  fileName: string;
}

/** Returns true if the target is an editable form control or contenteditable element. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as Partial<HTMLElement>;
  const tag = el.tagName?.toUpperCase();
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
  if (el.isContentEditable) return true;
  if (typeof (target as Element).closest === 'function') {
    return Boolean((target as Element).closest('input, select, textarea, [contenteditable="true"], [contenteditable=""]'));
  }
  return false;
}

export function setupControls(engine: AudioEngine, state: ControlsState): { tick(): void } {
  const controls = $<HTMLElement>('controls');
  const fileInput = $<HTMLInputElement>('file-input');
  const fileBtn = $<HTMLButtonElement>('file-btn');
  const testSelect = $<HTMLSelectElement>('test-select');
  const playBtn = $<HTMLButtonElement>('play-btn');
  const seek = $<HTMLInputElement>('seek');
  const time = $<HTMLSpanElement>('time');
  const volume = $<HTMLInputElement>('volume');
  const calm = document.getElementById('calm') as HTMLInputElement | null;
  const fsBtn = $<HTMLButtonElement>('fs-btn');
  const sourceLabel = $<HTMLSpanElement>('source-label');
  const playback = $<HTMLElement>('playback');
  const sourceButtons = [...controls.querySelectorAll<HTMLButtonElement>('button[data-source]')];

  // Segmented Pill & Hub Popups Elements (Slice 12.3)
  const sourceBtn = document.getElementById('source-btn') as HTMLButtonElement | null;
  const sourcePanel = document.getElementById('source-panel') as HTMLElement | null;
  const sourceIcon = document.getElementById('source-icon') as HTMLElement | null;
  const playbackActionBtn = document.getElementById('playback-action-btn') as HTMLButtonElement | null;
  const actionIcon = document.getElementById('action-icon') as HTMLElement | null;
  const actionLabel = document.getElementById('action-label') as HTMLElement | null;
  const timelineSeparator = document.getElementById('timeline-separator') as HTMLElement | null;
  const scrubberSegment = document.getElementById('playback-scrubber-segment') as HTMLElement | null;
  const timeCurrent = document.getElementById('time-current') as HTMLSpanElement | null;
  const timeTotal = document.getElementById('time-total') as HTMLSpanElement | null;
  const experienceBtn = document.getElementById('experience-btn') as HTMLButtonElement | null;
  const experiencePanel = document.getElementById('experience-panel') as HTMLElement | null;

  // Startup Onboarding Toast
  const onboardingToast = document.getElementById('onboarding-toast') as HTMLElement | null;
  const dismissToastBtn = document.getElementById('dismiss-toast-btn') as HTMLButtonElement | null;
  const reopenToastBtn = document.getElementById('reopen-toast-btn') as HTMLButtonElement | null;

  const dismissToast = () => {
    if (!onboardingToast) return;
    onboardingToast.classList.add('dismissed');
    onboardingToast.hidden = true;
  };

  const showToastGuide = () => {
    if (!onboardingToast) return;
    onboardingToast.hidden = false;
    onboardingToast.classList.remove('dismissed');
  };

  dismissToastBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissToast();
  });

  // Auto-dismiss toast on any HUD controls interaction
  controls.addEventListener('click', () => {
    dismissToast();
  });

  const setSourceOpen = (open: boolean) => {
    if (!sourcePanel) return;
    sourcePanel.hidden = !open;
    sourceBtn?.setAttribute('aria-expanded', String(open));
    if (open && experiencePanel) {
      setExperienceOpen(false);
    }
  };

  const setExperienceOpen = (open: boolean) => {
    if (!experiencePanel) return;
    experiencePanel.hidden = !open;
    experienceBtn?.setAttribute('aria-expanded', String(open));
    if (open && sourcePanel) {
      setSourceOpen(false);
    }
  };

  sourceBtn?.addEventListener('click', () => {
    const isCurrentlyOpen = sourceBtn.getAttribute('aria-expanded') === 'true';
    setSourceOpen(!isCurrentlyOpen);
  });

  experienceBtn?.addEventListener('click', () => {
    const isCurrentlyOpen = experienceBtn.getAttribute('aria-expanded') === 'true';
    setExperienceOpen(!isCurrentlyOpen);
  });

  if (sourcePanel) attachSwipeDismiss(sourcePanel, () => setSourceOpen(false));
  if (experiencePanel) attachSwipeDismiss(experiencePanel, () => setExperienceOpen(false));

  controls.hidden = false;
  if (onboardingToast) onboardingToast.hidden = false;
  engine.setVolume(Number(volume.value));
  if (calm) calm.checked = state.calm;

  const loadFile = (file: File | undefined) => {
    if (!file) return;
    state.fileName = file.name;
    void engine.useFile(file);
    setSourceOpen(false);
    dismissToast();
  };

  fileInput.addEventListener('change', () => {
    loadFile(fileInput.files?.[0]);
    fileInput.value = ''; // allow picking the same file again
  });
  fileBtn.addEventListener('click', () => fileInput.click());

  // Drag and drop (desktop extra; the file button is the main path).
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('drag-over');
  });
  window.addEventListener('dragleave', () => document.body.classList.remove('drag-over'));
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file && !file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|wav|flac|ogg|opus|webm)$/i.test(file.name)) {
      showNotice(`"${file.name}" doesn't look like an audio file.`);
      return;
    }
    loadFile(file);
  });

  for (const btn of sourceButtons) {
    btn.addEventListener('click', () => {
      const s = btn.dataset.source;
      if (s === 'display') {
        void engine.useDisplayCapture();
        setSourceOpen(false);
      } else if (s === 'mic') {
        void engine.useMic();
        setSourceOpen(false);
      } else if (s === 'stop') {
        engine.stop();
      }
    });
  }

  testSelect.addEventListener('change', () => {
    const v = testSelect.value as TestSignal | '';
    if (v) {
      engine.useTestSignal(v);
      setSourceOpen(false);
    }
    testSelect.value = '';
  });

  const togglePlay = () => {
    const media = engine.media;
    if (!media) return;
    if (media.paused) void media.play();
    else media.pause();
  };
  playBtn.addEventListener('click', togglePlay);

  playbackActionBtn?.addEventListener('click', () => {
    if (engine.kind === 'file') {
      togglePlay();
    } else if (engine.kind !== 'none') {
      engine.stop();
    }
  });

  seek.addEventListener('input', () => {
    const media = engine.media;
    if (media && Number.isFinite(media.duration)) {
      media.currentTime = (Number(seek.value) / 1000) * media.duration;
      if (timeCurrent) timeCurrent.textContent = formatTime(media.currentTime);
    }
  });

  // Volume value text on its button (slice 11.6). Kept in step with the slider and the arrow keys.
  const volumeValue = $<HTMLSpanElement>('volume-value');
  const syncVolumeText = () => { volumeValue.textContent = `${Math.round(Number(volume.value) * 100)}%`; };
  syncVolumeText();
  volume.addEventListener('input', () => {
    engine.setVolume(Number(volume.value));
    syncVolumeText();
  });
  if (calm) {
    calm.addEventListener('change', () => {
      state.calm = calm.checked;
      getGlobalDirector().setCalm(calm.checked);
    });
  }

  // Experience Mode & Global Director HUD (Slice 8.2)
  const experienceLabel = document.getElementById('experience-label') as HTMLSpanElement | null;
  const modeButtons = controls ? [...controls.querySelectorAll<HTMLButtonElement>('.exp-mode-btn')] : [];
  const expCameraSelect = document.getElementById('exp-camera-select') as HTMLSelectElement | null;
  const expColorSelect = document.getElementById('exp-color-select') as HTMLSelectElement | null;
  const expExportBtn = document.getElementById('exp-export-btn') as HTMLButtonElement | null;
  const expImportInput = document.getElementById('exp-import-input') as HTMLInputElement | null;

  const syncExperienceUI = (mode?: ExperienceMode) => {
    const director = getGlobalDirector();
    const currentMode = mode ?? director.getExperienceMode();
    state.calm = director.isCalm();
    if (calm) calm.checked = state.calm;
    if (experienceLabel) {
      const prefix = experienceLabel.textContent?.startsWith('Visuals') ? 'Visuals' : 'Experience';
      experienceLabel.textContent = `${prefix}: ${EXPERIENCE_LABELS[currentMode] ?? currentMode}`;
    }
    for (const btn of modeButtons) {
      const isActive = btn.dataset.mode === currentMode;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    }
    const settings = director.getSettings();
    if (expCameraSelect) expCameraSelect.value = settings.cameraMode;
    if (expColorSelect) expColorSelect.value = settings.colorMood;
  };

  syncExperienceUI();

  for (const btn of modeButtons) {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode as ExperienceMode | undefined;
      if (!mode) return;
      getGlobalDirector().setExperienceMode(mode);
      syncExperienceUI(mode);
      triggerExperienceToast(mode);
    });
  }

  expCameraSelect?.addEventListener('change', () => {
    getGlobalDirector().updateSettings({ cameraMode: expCameraSelect.value as CameraMode });
    syncExperienceUI();
  });

  expColorSelect?.addEventListener('change', () => {
    getGlobalDirector().updateSettings({ colorMood: expColorSelect.value as ColorMood });
    syncExperienceUI();
  });

  expExportBtn?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('export-experience-look', { bubbles: true }));
  });

  expImportInput?.addEventListener('change', () => {
    const file = expImportInput.files?.[0];
    if (file) {
      window.dispatchEvent(new CustomEvent('import-experience-look', { detail: { file }, bubbles: true }));
      expImportInput.value = '';
    }
  });

  getGlobalDirector().subscribeExperienceChange((mode) => {
    syncExperienceUI(mode);
  });

  // Global Director HUD mode (slice 7.32). Optional in test mock DOM.
  const directorSelect = document.getElementById('director-mode') as HTMLSelectElement | null;
  if (directorSelect) {
    const s = getGlobalDirector().getSettings();
    if (s.cameraMode === 'off' && s.colorMood === 'native') {
      directorSelect.value = 'off';
    } else if (s.cameraMode === 'off') {
      directorSelect.value = 'colorOnly';
    } else if (s.colorMood === 'native') {
      directorSelect.value = 'cameraOnly';
    } else if (s.cameraIntensity <= 0.35 && s.colorIntensity <= 0.3) {
      directorSelect.value = 'subtle';
    } else {
      directorSelect.value = 'auto';
    }

    directorSelect.addEventListener('change', () => {
      const mode = directorSelect.value;
      if (mode === 'auto') {
        getGlobalDirector().updateSettings({
          cameraMode: 'auto',
          cameraIntensity: 0.65,
          colorMood: 'auto',
          colorIntensity: 0.45,
        });
      } else if (mode === 'subtle') {
        getGlobalDirector().updateSettings({
          cameraMode: 'auto',
          cameraIntensity: 0.3,
          colorMood: 'auto',
          colorIntensity: 0.25,
        });
      } else if (mode === 'cameraOnly') {
        const cur = getGlobalDirector().getSettings();
        getGlobalDirector().updateSettings({
          cameraMode: 'auto',
          cameraIntensity: cur.cameraIntensity > 0 ? cur.cameraIntensity : 0.65,
          colorMood: 'native',
        });
      } else if (mode === 'colorOnly') {
        const cur = getGlobalDirector().getSettings();
        getGlobalDirector().updateSettings({
          cameraMode: 'off',
          colorMood: 'auto',
          colorIntensity: cur.colorIntensity > 0 ? cur.colorIntensity : 0.45,
        });
      } else if (mode === 'off') {
        getGlobalDirector().updateSettings({
          cameraMode: 'off',
          colorMood: 'native',
        });
      }
    });
  }

  // Beat sensitivity: higher means more onsets are reported as beats (slice 5.1). Markup is in index.html.
  const beatInput = $<HTMLInputElement>('beat-sensitivity');
  const beatValue = $<HTMLSpanElement>('beat-value');
  beatInput.value = String(Math.round(getBeatSensitivity() * 100));
  beatValue.textContent = `${beatInput.value}%`;
  beatInput.addEventListener('input', () => {
    setBeatSensitivity(Number(beatInput.value) / 100);
    beatValue.textContent = `${beatInput.value}%`;
  });

  // Render quality (slice 5.2): feedback buffer at 100, 75 or 50 percent. Saved locally. Options are built here.
  const qualitySelect = $<HTMLSelectElement>('render-quality');
  for (const s of RENDER_SCALES) {
    const opt = document.createElement('option');
    opt.value = String(s);
    opt.textContent = `${Math.round(s * 100)}%`;
    qualitySelect.append(opt);
  }
  qualitySelect.value = String(getRenderScale());
  qualitySelect.addEventListener('change', () => setRenderScale(Number(qualitySelect.value)));

  // Reaction style (Slice 17.5): Off, Gentle, Punchy or Wild. Off by default; saved locally. A preset's own style wins.
  const reactionSelect = document.getElementById('reaction-style') as HTMLSelectElement | null;
  if (reactionSelect) {
    for (const style of REACTION_STYLES) {
      const opt = document.createElement('option');
      opt.value = style;
      opt.textContent = REACTION_STYLE_LABELS[style];
      reactionSelect.append(opt);
    }
    reactionSelect.value = getReactionStyle();
    reactionSelect.addEventListener('change', () => {
      reactionSelect.value = setReactionStyle(reactionSelect.value);
    });
  }

  // Aspect correction (slice 5.3): keeps shapes round in non-16:9 windows. On by default; saved locally.
  const aspectBox = $<HTMLInputElement>('aspect-correct');
  aspectBox.checked = getAspectCorrect();
  aspectBox.addEventListener('change', () => setAspectCorrect(aspectBox.checked));

  // Visual gain: how strongly visuals respond to the music (not the volume).
  const gain = $<HTMLInputElement>('gain');
  const gainValue = $<HTMLSpanElement>('gain-value');
  gain.value = String(getVisualGain());
  gainValue.textContent = `${getVisualGain().toFixed(2)}×`;
  gain.addEventListener('input', () => {
    const v = setVisualGain(Number(gain.value));
    gainValue.textContent = `${v.toFixed(2)}×`;
  });

  // Value buttons (slice 11.6): Volume, Visual gain and Beat sensitivity open their slider inline.
  // One is open at a time. A second tap or a tap outside closes it. Escape closes it too.
  const valueItems = [...controls.querySelectorAll<HTMLElement>('.value-item')];
  const valueBtnOf = (item: HTMLElement) => item.querySelector<HTMLButtonElement>('.value-btn');
  const openItem = () => valueItems.find((it) => valueBtnOf(it)?.getAttribute('aria-expanded') === 'true') ?? null;
  const setOpenValue = (item: HTMLElement | null) => {
    for (const it of valueItems) {
      const open = it === item;
      valueBtnOf(it)?.setAttribute('aria-expanded', String(open));
      const panel = it.querySelector<HTMLElement>('.value-panel');
      if (panel) panel.hidden = !open;
    }
  };
  for (const item of valueItems) {
    valueBtnOf(item)?.addEventListener('click', () => setOpenValue(openItem() === item ? null : item));
  }
  document.addEventListener('pointerdown', (e) => {
    const target = e.target as Node | null;
    if (!target) return;
    if (sourcePanel && !sourcePanel.hidden) {
      if (!sourcePanel.contains(target) && !sourceBtn?.contains(target)) {
        setSourceOpen(false);
      }
    }
    if (experiencePanel && !experiencePanel.hidden) {
      if (!experiencePanel.contains(target) && !experienceBtn?.contains(target)) {
        setExperienceOpen(false);
      }
    }
    const open = openItem();
    if (open && !open.contains(target)) setOpenValue(null);
  });
  controls.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setSourceOpen(false);
      setExperienceOpen(false);
      setOpenValue(null);
    }
  });
  setOpenValue(null);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => showNotice('Fullscreen was blocked by the browser.'));
  };
  fsBtn.addEventListener('click', toggleFullscreen);
  if (!document.fullscreenEnabled) fsBtn.hidden = true; // never ship a dead button

  // Keyboard shortcuts list (slice 6.1). A native <dialog>: Esc closes it, and a click on the backdrop closes it too.
  const shortcutsDialog = $<HTMLDialogElement>('shortcuts');
  // Focus returns to the opener on close (slice 11.2), the same as Studio.
  let shortcutsOpener: HTMLElement | null = null;
  const openShortcuts = () => {
    if (shortcutsDialog.open) return;
    shortcutsOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    shortcutsDialog.showModal();
  };
  shortcutsDialog.addEventListener('close', () => {
    const back = shortcutsOpener;
    shortcutsOpener = null;
    if (back?.isConnected) back.focus();
  });
  $<HTMLButtonElement>('shortcuts-btn').addEventListener('click', openShortcuts);
  $<HTMLButtonElement>('shortcuts-close').addEventListener('click', () => shortcutsDialog.close());

  reopenToastBtn?.addEventListener('click', () => {
    showToastGuide();
    shortcutsDialog.close();
  });

  // Controls bar close (slice 11.2): collapses to a "Show controls" button. State is in memory only.
  const controlsShow = $<HTMLButtonElement>('controls-show');
  const setControlsCollapsed = (collapsed: boolean) => {
    controls.classList.toggle('collapsed', collapsed);
    controlsShow.hidden = !collapsed;
    if (collapsed) {
      setSourceOpen(false);
      setExperienceOpen(false);
      controlsShow.focus();
    } else {
      (sourceBtn ?? fileBtn).focus();
    }
  };
  $<HTMLButtonElement>('controls-close').addEventListener('click', () => setControlsCollapsed(true));
  controlsShow.addEventListener('click', () => setControlsCollapsed(false));
  // Swipe down on a phone sheet closes the controls (slice 11.6). Same path as the Close button.
  attachSwipeDismiss(controls, () => setControlsCollapsed(true));
  shortcutsDialog.addEventListener('click', (e) => {
    if (e.target === shortcutsDialog) shortcutsDialog.close();
  });
  // Swipe down on a phone sheet closes it (slice 11.6). Same paths as the close buttons.
  attachSwipeDismiss(shortcutsDialog, () => shortcutsDialog.close());

  // Tap a letter in the list to fire it (slice 8.1). The list closes, then the same events the key sends go to window.
  const fireKey = (key: string, type: 'keydown' | 'keyup') => {
    window.dispatchEvent(new KeyboardEvent(type, { key, repeat: false }));
  };
  // The list closes on the pointer event, so the click that follows the tap would land on the page underneath. Swallow that one click.
  let swallowClick = false;
  let swallowTimer = 0;
  const armSwallow = () => {
    swallowClick = true;
    window.clearTimeout(swallowTimer);
    swallowTimer = window.setTimeout(() => { swallowClick = false; }, 600);
  };
  window.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  for (const btn of shortcutsDialog.querySelectorAll<HTMLButtonElement>('button.key')) {
    const key = btn.dataset.key ?? '';
    if (key === '?') {
      // Help key in the list: a tap closes the list (same as ? on the keyboard). It must not reopen it, so it fires no key.
      btn.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        armSwallow();
        shortcutsDialog.close();
      });
      btn.addEventListener('click', (e) => {
        if (e.detail !== 0) return; // pointer taps were handled on pointerup
        shortcutsDialog.close();
      });
      continue;
    }
    if (key !== 'A') {
      // Pointer taps fire on pointerup, which does not depend on the click event reaching the button (iOS Safari did not run the click handler). Keyboard activation (click with detail 0) still fires on click.
      btn.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        armSwallow();
        shortcutsDialog.close();
        fireKey(key, 'keydown');
      });
      btn.addEventListener('click', (e) => {
        if (e.detail !== 0) return; // pointer taps were handled on pointerup
        shortcutsDialog.close();
        fireKey(key, 'keydown');
      });
      continue;
    }
    // A is hold-to-compare: press sends keydown, release sends keyup. Keyboard activation (click with detail 0) sends both.
    let held = false;
    const release = () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      if (!held) return;
      held = false;
      armSwallow();
      fireKey(key, 'keyup');
    };
    btn.addEventListener('pointerdown', () => {
      if (held) return;
      shortcutsDialog.close();
      held = true;
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
      fireKey(key, 'keydown');
    });
    btn.addEventListener('click', (e) => {
      if (e.detail !== 0) return; // pointer clicks were handled on pointerdown
      shortcutsDialog.close();
      fireKey(key, 'keydown');
      fireKey(key, 'keyup');
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Let form controls and text inputs keep their own keys.
    if (isEditableTarget(e.target)) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    // While the list is open, only ? (close) and Esc (native) act; no other key should play or switch.
    if (shortcutsDialog.open) {
      if (e.key === '?') shortcutsDialog.close();
      return;
    }
    const media = engine.media;
    switch (e.key) {
      case ' ':
        if (tag === 'BUTTON') return; // Space already clicks the focused button
        e.preventDefault();
        if (engine.kind === 'file') {
          togglePlay();
        }
        break;
      case 'Escape':
        setSourceOpen(false);
        setExperienceOpen(false);
        setOpenValue(null);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (media) media.currentTime = Math.max(0, media.currentTime + (e.key === 'ArrowLeft' ? -5 : 5));
        break;
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        const v = Math.max(0, Math.min(1, Number(volume.value) + (e.key === 'ArrowUp' ? 0.05 : -0.05)));
        volume.value = String(v);
        engine.setVolume(v);
        syncVolumeText();
        break;
      }
      case '?':
        openShortcuts();
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      case 'p':
      case 'P':
        showNotice(`Palette: ${cyclePalette()}`, 'info', 2000);
        break;
      case 'm':
      case 'M': {
        const nextMode = getGlobalDirector().cycleExperienceMode();
        syncExperienceUI(nextMode);
        triggerExperienceToast(nextMode);
        break;
      }
    }
  });

  const syncSourceUI = (kind: SourceKind) => {
    if (sourceLabel) {
      sourceLabel.textContent = formatSourceLabel(kind, state.fileName);
    }
    if (sourceIcon) {
      sourceIcon.textContent = getSourceIcon(kind);
    }
    for (const btn of sourceButtons) {
      btn.setAttribute('aria-pressed', String(btn.dataset.source === kind));
    }

    if (kind === 'file') {
      if (playbackActionBtn) {
        playbackActionBtn.hidden = false;
        playbackActionBtn.classList.remove('is-stop');
        playbackActionBtn.dataset.action = 'play';
        const isPaused = !engine.media || engine.media.paused;
        if (actionIcon) actionIcon.textContent = isPaused ? '▶' : '⏸';
        if (actionLabel) actionLabel.textContent = isPaused ? 'Play' : 'Pause';
        playbackActionBtn.setAttribute('aria-label', isPaused ? 'Play (Space)' : 'Pause (Space)');
      }
      if (scrubberSegment) scrubberSegment.hidden = false;
      if (timelineSeparator) timelineSeparator.hidden = false;
      if (playback) playback.hidden = false;
    } else if (kind === 'display' || kind === 'mic' || kind.startsWith('test:')) {
      if (playbackActionBtn) {
        playbackActionBtn.hidden = false;
        playbackActionBtn.classList.add('is-stop');
        playbackActionBtn.dataset.action = 'stop';
        if (actionIcon) actionIcon.textContent = '⏹';
        if (actionLabel) actionLabel.textContent = 'Stop';
        playbackActionBtn.setAttribute('aria-label', 'Stop stream');
      }
      if (scrubberSegment) scrubberSegment.hidden = true;
      if (timelineSeparator) timelineSeparator.hidden = true;
      if (playback) playback.hidden = true;
    } else {
      // none / idle
      if (playbackActionBtn) {
        playbackActionBtn.hidden = true;
        playbackActionBtn.classList.remove('is-stop');
      }
      if (scrubberSegment) scrubberSegment.hidden = true;
      if (timelineSeparator) timelineSeparator.hidden = true;
      if (playback) playback.hidden = true;
    }
  };

  syncSourceUI(engine.kind ?? 'none');

  engine.on('source-changed', (kind) => {
    const k = kind as SourceKind;
    if (k !== 'none') dismissToast();
    syncSourceUI(k);
  });
  engine.on('source-ended', (kind) => {
    if (kind === 'display') showNotice('Sharing ended. Choose Tab / system audio to start again.', 'info');
    if (kind === 'mic') showNotice('The microphone stopped.', 'info');
  });
  engine.on('error', (msg) => showNotice(String(msg)));

  // Hide controls after 3 s without mouse movement (fullscreen viewing).
  let idleTimer = 0;
  // A faded bar is also inert, so its controls cannot take focus until the bar wakes (slice 11.4).
  const setBarIdle = (idle: boolean) => {
    controls.classList.toggle('idle', idle);
    controls.toggleAttribute('inert', !isControlsBarFocusable(idle));
    document.body.style.cursor = idle ? 'none' : '';
  };
  const wake = () => {
    setBarIdle(false);
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => setBarIdle(true), 3000);
  };
  window.addEventListener('mousemove', wake);
  window.addEventListener('keydown', wake);
  wake();

  return {
    // Called once per frame to keep the playback row in sync.
    tick() {
      const media = engine.media;
      if (playback) playback.hidden = !media;
      if (!media) return;
      const isPaused = media.paused;
      const action = isPaused ? 'Play' : 'Pause';
      if (playBtn.textContent !== action) playBtn.textContent = action;
      const label = `${action} (Space)`;
      if (playBtn.getAttribute('aria-label') !== label) playBtn.setAttribute('aria-label', label);

      if (playbackActionBtn && engine.kind === 'file') {
        const icon = isPaused ? '▶' : '⏸';
        if (actionIcon && actionIcon.textContent !== icon) {
          actionIcon.textContent = icon;
        }
        if (actionLabel && actionLabel.textContent !== action) {
          actionLabel.textContent = action;
        }
        if (playbackActionBtn.getAttribute('aria-label') !== label) {
          playbackActionBtn.setAttribute('aria-label', label);
        }
      }

      if (Number.isFinite(media.duration) && media.duration > 0) {
        if (document.activeElement !== seek) seek.value = String(Math.round((media.currentTime / media.duration) * 1000));
        const cur = formatTime(media.currentTime);
        const tot = formatTime(media.duration);
        if (timeCurrent) timeCurrent.textContent = cur;
        if (timeTotal) timeTotal.textContent = tot;
        if (time) time.textContent = `${cur} / ${tot}`;
      }
    },
  };
}

export type PresetGroup = 'flagship' | 'textures' | 'classic' | 'archive';
export const PRESET_GROUPS: readonly PresetGroup[] = ['flagship', 'textures', 'classic', 'archive'] as const;

export function filterPresetsByGroup<T extends { group?: PresetGroup }>(presets: readonly T[], group: PresetGroup): T[] {
  return presets.filter((p) => p.group === group);
}

export function presetGroupLabel(group: PresetGroup): string {
  switch (group) {
    case 'flagship': return 'Flagship';
    case 'textures': return 'Textures';
    case 'classic': return 'Classics';
    case 'archive': return 'Archive';
  }
}

