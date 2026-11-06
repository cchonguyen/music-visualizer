// Player controls: source buttons, playback, volume, calm mode, fullscreen and
// keyboard shortcuts. Talks to the engine only through its public methods.
import type { AudioEngine, SourceKind } from '../audio/engine';
import type { TestSignal } from '../audio/testSignals';
import { showNotice } from './notices';
import { cyclePalette } from '../render/paletteStore';
import { getVisualGain, setVisualGain } from '../render/gainStore';
import { getBeatSensitivity, setBeatSensitivity } from '../audio/onset';
import { getRenderScale, RENDER_SCALES, setRenderScale } from '../gl/size';
import { getAspectCorrect, setAspectCorrect } from '../render/compositor';

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

export function setupControls(engine: AudioEngine, state: ControlsState): { tick(): void } {
  const controls = $<HTMLElement>('controls');
  const fileInput = $<HTMLInputElement>('file-input');
  const fileBtn = $<HTMLButtonElement>('file-btn');
  const testSelect = $<HTMLSelectElement>('test-select');
  const playBtn = $<HTMLButtonElement>('play-btn');
  const seek = $<HTMLInputElement>('seek');
  const time = $<HTMLSpanElement>('time');
  const volume = $<HTMLInputElement>('volume');
  const calm = $<HTMLInputElement>('calm');
  const fsBtn = $<HTMLButtonElement>('fs-btn');
  const sourceLabel = $<HTMLSpanElement>('source-label');
  const playback = $<HTMLElement>('playback');
  const sourceButtons = [...controls.querySelectorAll<HTMLButtonElement>('button[data-source]')];

  controls.hidden = false;
  engine.setVolume(Number(volume.value));
  calm.checked = state.calm;

  const loadFile = (file: File | undefined) => {
    if (!file) return;
    state.fileName = file.name;
    void engine.useFile(file);
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
      if (s === 'display') void engine.useDisplayCapture();
      else if (s === 'mic') void engine.useMic();
      else if (s === 'stop') engine.stop();
    });
  }

  testSelect.addEventListener('change', () => {
    const v = testSelect.value as TestSignal | '';
    if (v) engine.useTestSignal(v);
    testSelect.value = '';
  });

  const togglePlay = () => {
    const media = engine.media;
    if (!media) return;
    if (media.paused) void media.play();
    else media.pause();
  };
  playBtn.addEventListener('click', togglePlay);

  seek.addEventListener('input', () => {
    const media = engine.media;
    if (media && Number.isFinite(media.duration)) {
      media.currentTime = (Number(seek.value) / 1000) * media.duration;
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
  calm.addEventListener('change', () => (state.calm = calm.checked));

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
    const open = openItem();
    if (open && !open.contains(e.target as Node)) setOpenValue(null);
  });
  controls.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpenValue(null);
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

  // Controls bar close (slice 11.2): collapses to a "Show controls" button. State is in memory only.
  const controlsShow = $<HTMLButtonElement>('controls-show');
  const setControlsCollapsed = (collapsed: boolean) => {
    controls.classList.toggle('collapsed', collapsed);
    controlsShow.hidden = !collapsed;
    if (collapsed) controlsShow.focus();
    else fileBtn.focus();
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
    const tag = (e.target as HTMLElement | null)?.tagName;
    // Let form controls keep their own keys (e.g. arrows on sliders).
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
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
        togglePlay();
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
    }
  });

  engine.on('source-changed', (kind) => {
    const k = kind as SourceKind;
    sourceLabel.textContent = sourceName(k, state.fileName);
    for (const btn of sourceButtons) {
      btn.setAttribute('aria-pressed', String(btn.dataset.source === k));
    }
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
      playback.hidden = !media;
      if (!media) return;
      const action = media.paused ? 'Play' : 'Pause';
      if (playBtn.textContent !== action) playBtn.textContent = action;
      const label = `${action} (Space)`;
      if (playBtn.getAttribute('aria-label') !== label) playBtn.setAttribute('aria-label', label);
      if (Number.isFinite(media.duration) && media.duration > 0) {
        if (document.activeElement !== seek) seek.value = String(Math.round((media.currentTime / media.duration) * 1000));
        time.textContent = `${formatTime(media.currentTime)} / ${formatTime(media.duration)}`;
      }
    },
  };
}
