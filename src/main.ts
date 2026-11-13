// App entry: start screen → AudioEngine (inside the click) → GlHost with the scenes
// and layers → debug panel and controls.
import '../.harness/design-system/tokens.css';
import '../.harness/design-system/bundle.css';
import './style.css';
import './app.css';
import { AudioEngine } from './audio/engine';
import { estimateLatencyMs } from './audio/latency';
import type { AudioFrame } from './audio/types';
import type { RenderLayer } from './render/layer';
import type { Preset } from './presets/format';
import { GlHost } from './gl/context';
import { BassPulseLayer } from './render/layers/bassPulse';
import { TrailTestLayer } from './render/layers/trailTest';
import { Compositor } from './render/compositor';
import { Scene } from './render/scene';
import { TunnelLayer } from './render/layers/tunnel';
import { getVisualGain, shapeReaction } from './render/gainStore';
import { ParticleLayer } from './render/layers/particles';
import { BarsLayer } from './render/layers/bars';
import { RingsLayer } from './render/layers/rings';
import { ALL_PRESETS, SCHEMAS } from './presets/builtin';
import { PresetSession } from './presets/session';
import { applyLinkedPreset, hasCrownLayer, hasLinks, LAYER_FACTORIES, presetHasRetiredLayer, restoreBasePreset, valuesOf } from './presets/loader';
import { migrateLegacyLayerToShape } from './presets/legacyShapeMigration';
import { effectiveReactionStyle, getReactionStyle, reactionsForStyle } from './presets/reactionStyles';
import { LinkRunner, ReactionBank } from './presets/links';
import { AutoCycler, DEFAULT_CYCLE, eligible, effectiveCycleOptions, loadCycleSettings, phraseBarsOf, saveCycleSettings, type CycleOptions } from './presets/autoCycle';
import { presetDisplaySec } from './presets/format';
import { advanceSway } from './render/swayStore';
import { advanceCrown } from './render/crownStore';
import { cycleIndex, indexForDigit, readStoredPresetId, safeStorage, storePresetId, stepForKey } from './presets/library';
import { showToast } from './ui/toast';
import { TouchGestureRecognizer } from './ui/gestures';
// Studio is type-only here. Its code (and Tweakpane) loads with import() on first open.
import type { Studio } from './studio/studio';
import { createPopoutHost, type PopoutHost } from './studio/popoutHost';
import { ShockwaveLayer } from './render/layers/shockwave';
import { makeSlowLoudness, sectionContrast } from './render/sectionContrast';
import { ColourSwap } from './render/colourSwap';
import { isEditableTarget, setupControls, sourceName, type ControlsState } from './ui/controls';
import { BenchmarkPanel, DebugPanel } from './ui/debugPanel';
import { BenchmarkRunner, GpuTimedLayer, benchmarkSeconds, describeRenderer } from './render/benchmark';
import { QualityGovernor, TIER_SETTINGS, detectTier } from './render/qualityGovernor';
import { setAutoScale } from './gl/size';
import { setFloatBuffersEnabled } from './gl/fbo';
import { maxCostForTier, presetCost } from './presets/cost';
import { mountPresetBrowser, toBrowserPreset, withFavourite, type BrowserPreset, type PresetBrowserHandle } from './ui/presetBrowser';
import { FrameBudget } from './render/frameBudget';
import { browserSupportProblems, showNotice, supportNoticeText } from './ui/notices';
import { getGlobalDirector, type CameraUniforms, type ColorUniforms } from './render/globalDirector';
import { clampDt } from './render/clock';
import { adminGateway, AdminGateway } from './presets/adminGateway';
// Admin signal names are mirrored from studio/adminControls.ts so the page-wide listeners do not
// pull admin code into the startup bundle. Keep these values in sync with that file.
const ADMIN_AUTH_CHANNEL = 'mv-admin-auth';
const ADMIN_AUTH_STORAGE_KEY = 'mv.adminAuthSignal';
/** The old default Waveform line, built as the Shape layer that replaced it (Slice 19.15). Used by the demo scenes. */
function defaultWaveLayer(): RenderLayer {
  const shape = migrateLegacyLayerToShape({ type: 'waveform', enabled: true, opacity: 1, blend: 'add', params: {} });
  return LAYER_FACTORIES.shape!(valuesOf(shape.params));
}

function isVerifiedAdminSignal(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.type === 'mv-admin-authenticated' && v.verified === true;
}
import {
  loadCachedPresets,
  saveCachedPresets,
  normalizeSubfolder,
  upsertRemotePreset,
  softDeleteRemotePreset,
  type RemotePresetRecord,
} from './presets/remotePresets';
import { getRemoteConfig, type RemoteConfig } from './config/remoteConfig';

export interface SyncSystemPresetsOptions {
  storage?: Storage;
  fetchFn?: typeof fetch;
  studio?: { refreshPresetDropdown: () => void } | null;
}

/**
 * Asynchronously fetch system presets from remote endpoint,
 * apply them to the preset session, persist active presets to local cache,
 * and refresh the Studio dropdown if available.
 *
 * In offline mode or upon network failure, catches gracefully and logs
 * informational message without interrupting visualizer playback.
 */
export async function syncSystemPresets(
  session: PresetSession,
  config: RemoteConfig = getRemoteConfig(),
  options: SyncSystemPresetsOptions = {},
): Promise<RemotePresetRecord[]> {
  try {
    const fetchFn = options.fetchFn ?? (typeof fetch !== 'undefined' ? fetch : undefined);
    if (!fetchFn) return [];
    if (!config.supabaseUrl || !config.anonKey) {
      console.info('Using local/cached system presets (remote not configured).');
      return [];
    }

    const baseUrl = config.supabaseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/rest/v1/system_presets?select=id,name,subfolder,preset_data,sort_order,tags,updated_at,is_deleted&order=sort_order.asc,updated_at.desc`;

    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`Remote presets fetch failed: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    const records: RemotePresetRecord[] = data
      .filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => ({
        id: String(item['id'] ?? ''),
        name: String(item['name'] || item['id'] || ''),
        subfolder: normalizeSubfolder(item['subfolder']),
        preset_data: item['preset_data'] as Preset,
        sort_order: typeof item['sort_order'] === 'number' ? item['sort_order'] : 0,
        tags: Array.isArray(item['tags']) ? (item['tags'] as unknown[]).map(String) : [],
        updated_at: typeof item['updated_at'] === 'string' ? item['updated_at'] : new Date().toISOString(),
        ...(item['is_deleted'] !== undefined ? { is_deleted: Boolean(item['is_deleted']) } : {}),
      }));

    if (records.length > 0) {
      session.applyRemoteSystemPresets(records);
      const activeRecords = records.filter((r) => !r.is_deleted);
      saveCachedPresets(activeRecords, options.storage);
      if (options.studio && typeof options.studio.refreshPresetDropdown === 'function') {
        options.studio.refreshPresetDropdown();
      }
    }
    return records;
  } catch {
    console.info('Using local/cached system presets.');
    return [];
  }
}

/** Calm mode scales the bass pulse down (motion reduction for sensitive viewers). */
const CALM_SCALE = 0.35;
/** Keep the latest beat times for the latency estimate (about 30 s of kicks). */
const MAX_BEATS = 60;

/**
 * Capture whether the application initially loaded on the `/admin` Cloudflare Access gate
 * before URL normalization or user click on `#start-btn`.
 */
const launchedOnAdminPath =
  typeof window !== 'undefined' && Boolean(window.location?.pathname?.startsWith('/admin'));

/** Calm, section contrast and accent swap reach the tunnel, particles, shockwave and rings. */
function flagLayer(layer: RenderLayer, calm: boolean, contrast: number, swap: number): void {
  if (layer instanceof TunnelLayer || layer instanceof ParticleLayer) {
    layer.calm = calm;
    layer.sectionContrast = contrast;
    layer.accentSwap = swap;
  } else if (layer instanceof ShockwaveLayer) {
    layer.calm = calm;
    layer.accentSwap = swap;
  } else if (layer instanceof RingsLayer) {
    layer.calm = calm;
  }
}

// Touch on the stage (Slice 21.7). Touch only, so mouse clicks keep their normal behaviour.
// Tap toggles the controls, horizontal swipe changes preset ([ and ] keys), double tap toggles fullscreen.
function wireTouchGestures(canvas: HTMLCanvasElement): void {
  const recognizer = new TouchGestureRecognizer({
    onTap: () => {
      const collapsed = document.getElementById('controls')?.classList.contains('collapsed');
      document.getElementById(collapsed ? 'controls-show' : 'controls-close')?.click();
    },
    onSwipe: (direction) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: direction === 'left' ? ']' : '[' }));
    },
    onDoubleTap: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => showNotice('Fullscreen was blocked by the browser.'));
    },
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || !e.isPrimary) return;
    recognizer.pointerDown({ x: e.clientX, y: e.clientY, t: e.timeStamp });
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch' || !e.isPrimary) return;
    recognizer.pointerUp({ x: e.clientX, y: e.clientY, t: e.timeStamp });
  });
  canvas.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'touch') recognizer.cancel();
  });
}

// Keeps the screen awake while audio plays (Slice 21.7). Feature-detected. Released while the page is hidden.
function keepScreenAwake(engine: AudioEngine): void {
  type WakeLockSentinelLike = { release(): Promise<void>; addEventListener(type: 'release', cb: () => void): void };
  type WakeLockApi = { request(type: 'screen'): Promise<WakeLockSentinelLike> };
  const wakeLock = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
  if (!wakeLock || typeof wakeLock.request !== 'function') return;

  let sentinel: WakeLockSentinelLike | null = null;
  let requesting = false;
  const playing = (): boolean => {
    if (engine.kind === 'none') return false;
    const media = engine.media;
    return media ? !media.paused : true;
  };
  const release = (): void => {
    const held = sentinel;
    sentinel = null;
    if (held) void held.release().catch(() => undefined);
  };
  const sync = (): void => {
    if (document.visibilityState === 'hidden' || !playing()) {
      release();
      return;
    }
    if (sentinel || requesting) return;
    requesting = true;
    wakeLock
      .request('screen')
      .then((held) => {
        requesting = false;
        if (document.visibilityState === 'hidden' || !playing()) {
          void held.release().catch(() => undefined);
          return;
        }
        sentinel = held;
        held.addEventListener('release', () => {
          if (sentinel === held) sentinel = null;
        });
      })
      .catch(() => {
        requesting = false; // Denied or unavailable: the visualizer still works without it.
      });
  };
  engine.on('source-changed', sync);
  engine.on('source-ended', sync);
  document.addEventListener('play', sync, true);
  document.addEventListener('pause', sync, true);
  document.addEventListener('ended', sync, true);
  document.addEventListener('visibilitychange', sync);
}

function start(): void {
  const startScreen = document.getElementById('start')!;
  const canvas = document.getElementById('stage') as HTMLCanvasElement;

  // Created synchronously inside the click: browsers block audio otherwise.
  const engine = AudioEngine.create();

  let host: GlHost;
  try {
    host = new GlHost(canvas);
  } catch (err) {
    showNotice((err as Error).message, 'error', 0);
    return;
  }
  startScreen.hidden = true;
  wireTouchGestures(canvas);
  keepScreenAwake(engine);

  // Freeze (k) holds the picture; while frozen, . draws exactly one frame (frameStep.ts).
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditableTarget(e.target)) return;
    if (e.key === 'k' || e.key === 'K') {
      showToast(host.stepper.toggle() ? 'Frozen. Press . to step a frame.' : 'Running again.');
      return;
    }
    if (e.key === '.' && host.stepper.isFrozen) host.stepper.requestStep();
  });

  // Default: the last preset used (remembered), else Crown. Keys switch presets (library.ts):
  //   0 = Crown, 1 = Flight, 2 = Bars (the old keys), 3-9 = later presets, [ and ] = previous / next.
  // URL options for single checks: ?tracer (Stage 1), ?trail, ?tunnel, ?particles, ?bars, ?scenes.
  const params = new URLSearchParams(location.search);
  // ?float=0 turns half-float trail buffers off (8-bit), to compare looks or rule them out (Slice 16.7).
  if (params.get('float') === '0') setFloatBuffersEnabled(false);
  let compositor: Compositor | null = null;
  let session: PresetSession | null = null;
  const benchSeconds = benchmarkSeconds(params);
  let benchLayer: GpuTimedLayer | null = null;
  const linkRunner = new LinkRunner();
  const reactionBank = new ReactionBank();
  // Presets whose scene currently holds reacted values, so they can be put back when reactions stop.
  const reactedIds = new Set<string>();
  const director = getGlobalDirector();
  // Auto-cycle (T2): timer mode by default. Keys: C timer (C again turns it off), B beat, X shuffle.
  const cycle: CycleOptions = { ...DEFAULT_CYCLE };
  // The Visuals menu saves the choice (slice 21.13); a saved choice wins over the default.
  loadCycleSettings(cycle, safeStorage());
  const cycler = new AutoCycler();
  let switchShown: ((id: string) => void) | null = null;
  // Single-layer debug options (?tunnel, ?particles) and the preset scenes. Arrays, so TypeScript
  // does not narrow them to null inside the per-frame closures.
  const tunnels: TunnelLayer[] = [];
  const particleLayers: ParticleLayer[] = [];
  // Whether the crown is on screen: its heights drive particle launches, so they are zero otherwise.
  let crownOn = true;
  // P4: section contrast (fast loudness minus 8 s slow loudness) and the drop colour swap.
  const loudSlow = makeSlowLoudness();
  const colourSwap = new ColourSwap();
  if (params.has('trail')) {
    host.addLayer(new TrailTestLayer());
  } else if (params.has('tunnel')) {
    const t = new TunnelLayer();
    tunnels.push(t);
    host.addLayer(t);
  } else if (params.has('particles')) {
    const p = new ParticleLayer();
    particleLayers.push(p);
    host.addLayer(p);
  } else if (params.has('bars')) {
    host.addLayer(new BarsLayer());
    host.addLayer(new RingsLayer());
  } else if (params.has('scenes')) {
    compositor = new Compositor([
      new Scene('pulse', [new BassPulseLayer()]),
      new Scene('wave', [defaultWaveLayer()]),
    ]);
    compositor.setWeights({ pulse: 1 });
    host.addLayer(compositor);
  } else if (params.has('tracer')) {
    host.addLayer(new BassPulseLayer());
    host.addLayer(defaultWaveLayer());
  } else {
    // Presets: the session owns every preset's working copy and scene. Built-ins come first, so
    // keys 0 / 1 / 2 keep their old meaning (Crown / Flight / Bars).
    const comp = new Compositor([]);
    compositor = comp;
    // Benchmark mode (?benchmark): the compositor is drawn through a GPU-timing wrapper.
    if (benchSeconds !== null) {
      benchLayer = new GpuTimedLayer(comp);
      host.addLayer(benchLayer);
    } else {
      host.addLayer(comp);
    }
    session = new PresetSession(comp, SCHEMAS, safeStorage(), {
      adminGateway,
      remoteWriter: {
        upsert: (record) => upsertRemotePreset(record),
        softDelete: (id) => softDeleteRemotePreset(id),
        onResult: (r) => {
          if (!r.success) {
            showToast(`Not saved to the server: ${r.error}`);
          } else {
            showToast(r.op === 'delete' ? 'Deleted from the server' : 'Saved to the server. Reload to confirm everyone sees it');
          }
        },
      },
    });
    for (const b of ALL_PRESETS) session.addBuiltin(b.id, b.preset);
    const cached = loadCachedPresets(safeStorage());
    if (cached?.presets && cached.presets.length > 0) {
      session.applyRemoteSystemPresets(cached.presets);
    }
    for (const problem of session.loadUserPresets()) console.warn('Saved preset skipped:', problem);
    const liveSession = session;
    const order = () => liveSession.list().map((e) => e.id);
    // Preset browser on the main screen (Slice 21.5). Built from the session, so it shows the same favourites the auto-cycle reads.
    const browserEntries = (): BrowserPreset[] => liveSession.list().map((e) => toBrowserPreset(e.id, e.preset));
    let presetBrowser: PresetBrowserHandle | null = null;
    const remembered = readStoredPresetId();
    let currentId = remembered && liveSession.get(remembered) ? remembered : 'crown';
    let retiredNoticeShown = false;
    // Pop-out (slice 22.7): the host is created below, after switchTo. While a pop-out is connected the in-page Studio hides.
    let popoutHost: PopoutHost | null = null;
    let popoutConnected = false;
    let popoutWindow: Window | null = null;
    const switchTo = (id: string, announce = false) => {
      currentId = id;
      cycler.reset();
      liveSession.show(id);
      presetBrowser?.setEntries(browserEntries());
      // Old presets may still hold a retired ReactionDiffusion layer. It is skipped; say so once per session.
      if (!retiredNoticeShown && presetHasRetiredLayer(liveSession.get(id)?.preset)) {
        retiredNoticeShown = true;
        showNotice('ReactionDiffusion has been retired. Its layer is skipped in this preset.', 'info', 6000);
      }
      crownOn = hasCrownLayer(liveSession.get(id)?.preset);
      director.notifyPresetChanged(liveSession.get(id)?.preset);
      storePresetId(id);
      if (announce) showToast(liveSession.get(id)!.preset.name);
      if (isStudioOpen()) studioPanel?.bind(id);
      popoutHost?.notifyShownChanged();
    };
    // Preset Studio loads on first open (Slice 21.8). Until then there is no panel and nothing is drawn.
    let studioPanel: Studio | null = null;
    let studioWanted = false;
    let studioLoading: Promise<Studio> | null = null;
    const ensureStudio = (): Promise<Studio> => {
      studioLoading ??= import('./studio/studio').then(({ Studio: StudioClass }) => {
        const panel = new StudioClass(document.getElementById('studio')!, {
          session: liveSession,
          switchTo: (id) => switchTo(id, true),
          frameMs: () => frameMs,
          linkMeter: (key) => linkRunner.meterByKey(key),
          adminGateway,
        });
        studioPanel = panel;
        return panel;
      });
      return studioLoading;
    };
    const isStudioOpen = (): boolean => (studioPanel ? studioPanel.visible : studioWanted);
    const setStudioOpen = (open: boolean): void => {
      studioWanted = open;
      if (!open) {
        studioPanel?.setVisible(false);
        return;
      }
      void ensureStudio().then((panel) => {
        if (!studioWanted) return;
        panel.setVisible(true);
        panel.bind(currentId);
      });
    };
    switchTo(currentId);
    switchShown = (id) => switchTo(id, true);
    popoutHost = createPopoutHost({
      session: liveSession,
      switchTo: (id) => switchTo(id, true),
      getShownId: () => currentId,
      onConnectionChange: (connected) => {
        popoutConnected = connected;
        if (connected) setStudioOpen(false);
      },
    });

    // Show the browser on the main screen. Benchmark mode keeps it hidden, since it drives the presets itself.
    const browserRoot = document.getElementById('preset-browser');
    if (browserRoot && benchSeconds === null) {
      browserRoot.hidden = false;
      presetBrowser = mountPresetBrowser(browserRoot, {
        onSelect: (id) => switchTo(id, true),
        onFavouriteChange: (id, on) => {
          const entry = liveSession.get(id);
          if (!entry) return;
          liveSession.setPresetTags(id, withFavourite(entry.preset.tags, on));
          showToast(on ? `Favourited ${entry.preset.name}` : `Removed ${entry.preset.name} from favourites`);
        },
      });
      presetBrowser.setEntries(browserEntries());
    }

    // Check Cloudflare Access identity on startup (e.g. returning from /admin gate)
    if (typeof adminGateway.checkCloudflareAccess === 'function') {
      adminGateway.checkCloudflareAccess().then((verified) => {
        if (verified) {
          const email = adminGateway.getState().adminEmail;
          showToast(`👑 Admin Mode Active${email ? ` (${email})` : ''}`);
        }
        if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
          window.history.replaceState({}, '', '/');
        }
      });
    }

    // Automatically reopen Preset Studio if user launched via /admin or returned from Cloudflare Access redirect
    let shouldReturnToStudio = launchedOnAdminPath;
    try {
      if (
        typeof sessionStorage !== 'undefined' &&
        sessionStorage.getItem('mv.returnToStudio') === 'true'
      ) {
        shouldReturnToStudio = true;
        sessionStorage.removeItem('mv.returnToStudio');
      }
    } catch {
      // ignore storage errors
    }
    if (shouldReturnToStudio) {
      setStudioOpen(true);
    }

    // Background asynchronous sync of system presets with local cache persistence.
    // The bridge refreshes the Studio dropdown only if the Studio has been loaded.
    const studioBridge = { refreshPresetDropdown: () => studioPanel?.refreshPresetDropdown() };
    syncSystemPresets(liveSession, getRemoteConfig(), { storage: safeStorage(), studio: studioBridge })
      .then((records) => {
        if (records && records.length > 0) {
          liveSession.applyRemoteSystemPresets(records);
          saveCachedPresets(records, safeStorage());
          studioPanel?.refreshPresetDropdown();
        }
      })
      .catch(() => {
        console.info('Using local/cached system presets.');
      });
    // Studio button and E key share one toggle. Escape closes Studio unless the shortcuts dialog is open.
    const toggleStudio = () => {
      setStudioOpen(!isStudioOpen());
    };
    // Pop-out window (slice 22.7). Opened from a click or key, so the browser allows it. While connected, the Studio button and E focus it.
    const openPopout = (): void => {
      if (popoutConnected && popoutWindow && !popoutWindow.closed) {
        popoutWindow.focus();
        return;
      }
      const win = window.open('/popout.html', 'mv-studio-popout', 'popup,width=520,height=900');
      if (!win) {
        showToast('Pop-out blocked. Allow pop-ups for this site, then press Shift+E again.');
        return;
      }
      popoutWindow = win;
      win.focus();
    };
    const studioOrPopout = (): void => {
      if (popoutConnected) openPopout();
      else toggleStudio();
    };
    document.getElementById('studio-open')!.addEventListener('click', studioOrPopout);
    document.getElementById('popout-open')!.addEventListener('click', openPopout);
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !isStudioOpen()) return;
      const shortcuts = document.getElementById('shortcuts');
      if (shortcuts instanceof HTMLDialogElement && shortcuts.open) return;
      setStudioOpen(false);
    });
    // No automatic blend: the view changes only when a key is pressed.
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (e.key === 'c' || e.key === 'C' || e.key === 'b' || e.key === 'B' || e.key === 'x' || e.key === 'X') {
        const k = e.key.toLowerCase();
        if (k === 'c') cycle.mode = cycle.mode === 'timer' ? 'off' : 'timer';
        if (k === 'b') cycle.mode = cycle.mode === 'beat' ? 'off' : 'beat';
        if (k === 'x') cycle.shuffle = !cycle.shuffle;
        saveCycleSettings(cycle, safeStorage());
        const modeText = cycle.mode === 'timer' ? `every ${cycle.intervalSec} s` : cycle.mode === 'phrase' ? `Phrase, every ${phraseBarsOf(cycle)} bars` : 'on strong beats';
        const label = cycle.mode === 'off' ? 'Auto-cycle off' : `Auto-cycle: ${modeText}${cycle.shuffle ? ', shuffled' : ''}`;
        if (k !== 'x' || cycle.mode !== 'off') showToast(label);
        else showToast(`Shuffle ${cycle.shuffle ? 'on' : 'off'}`);
        return;
      }
      if (e.key === 'E' && e.shiftKey) {
        openPopout();
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        studioOrPopout();
        return;
      }
      const step = stepForKey(e.key);
      if (step !== null) {
        const ids = order();
        const at = Math.max(0, ids.indexOf(currentId));
        return switchTo(ids[cycleIndex(at, ids.length, step)]!, true);
      }
      const digit = indexForDigit(e.key, order().length);
      if (digit !== null) switchTo(order()[digit]!, true);
    });
    // A/B compare (slice S4): hold A to see the saved copy of the preset on screen; release to return.
    window.addEventListener('keydown', (e) => {
      if (isEditableTarget(e.target)) return;
      if ((e.key === 'a' || e.key === 'A') && !e.repeat && !e.ctrlKey && !e.metaKey) liveSession.compare(currentId, true);
    });
    window.addEventListener('keyup', (e) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === 'a' || e.key === 'A') liveSession.compare(currentId, false);
    });
  }

  // The Studio button only works with the preset session (not the single-layer debug URLs).
  if (!session) {
    document.getElementById('studio-open')!.hidden = true;
    document.getElementById('popout-open')!.hidden = true;
  }

  // Reduced motion (slice 21.3): read at start and followed live. While it is on, Calm and
  // Reduced intensity apply. Turning it off undoes only what it turned on, so a viewer's own
  // Calm or intensity choice is kept.
  const reduceQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const state: ControlsState = { calm: director.isCalm(), fileName: '', intensity: 'full', cycle };
  let reduceSetCalm = false;
  let reduceSetIntensity = false;
  const applyReducedMotion = (reduce: boolean): void => {
    if (reduce) {
      if (!state.calm) { state.calm = true; reduceSetCalm = true; }
      if (state.intensity === 'full') { state.intensity = 'reduced'; reduceSetIntensity = true; }
    } else {
      if (reduceSetCalm) { state.calm = false; reduceSetCalm = false; }
      if (reduceSetIntensity) {
        if (state.intensity === 'reduced') state.intensity = 'full';
        reduceSetIntensity = false;
      }
    }
  };
  applyReducedMotion(reduceQuery?.matches === true);
  reduceQuery?.addEventListener('change', (e) => applyReducedMotion(e.matches));
  const controls = setupControls(engine, state);
  const panel = new DebugPanel();

  // Benchmark mode (Slice 16.1): runs every preset on the kick test signal, with auto-cycle off.
  let bench: BenchmarkRunner | null = null;
  let benchPanel: BenchmarkPanel | null = null;
  let benchReported = false;
  if (benchSeconds !== null && session && switchShown) {
    const liveSession = session;
    const show = switchShown;
    engine.useTestSignal('kick');
    bench = new BenchmarkRunner(
      liveSession.list().map((e) => ({ id: e.id, name: e.preset.name })),
      benchSeconds,
      show,
    );
    benchPanel = new BenchmarkPanel();
    if (benchLayer) benchLayer.onGpu = (ms) => bench?.onGpu(ms);
    bench.start();
  }

  const isCalmFriendlyPreset = (preset?: Preset | null): boolean => {
    if (!preset) return false;
    if (!preset.tags.includes('calm')) return false;
    const intenseTags = ['strobe', 'shockwave', 'moire', 'intense'];
    return !preset.tags.some((t) => intenseTags.includes(t));
  };

  const switchToCalmPresetIfNeeded = () => {
    if (!session || !switchShown) return;
    const currentEntry = session.get(session.shownId ?? '');
    if (!currentEntry || !isCalmFriendlyPreset(currentEntry.preset)) {
      const all = session.list();
      const curl = all.find((e) => e.id === '01-curl-fluid-warp');
      const calmPreset = curl ?? all.find((e) => e.preset.tags.includes('calm'));
      if (calmPreset && calmPreset.id !== session.shownId) {
        switchShown(calmPreset.id);
        showToast(`Calm: switched to ${calmPreset.preset.name}`);
      }
    }
  };

  director.subscribeExperienceChange((mode) => {
    state.calm = director.isCalm();
    if (compositor) compositor.calm = state.calm;
    if (mode === 'calm') {
      switchToCalmPresetIfNeeded();
    }
  });

  const handleExportLook = () => {
    if (!session) return;
    const shownId = session.shownId ?? 'crown';
    const entry = session.get(shownId);
    const text = session.exportJson(shownId, true);
    const name = (entry?.preset.name ?? 'experience-look').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}-look.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported Look · ${entry?.preset.name ?? 'Look'}`);
  };

  const handleImportAssetFile = async (file: File) => {
    if (!session) return;
    try {
      const text = await file.text();
      const res = session.importAsset(text);
      if (res.kind === 'preset') {
        if (res.id && switchShown) {
          switchShown(res.id);
        }
        showToast(`Imported Preset · ${res.name}`);
      } else if (res.kind === 'palette') {
        const expColorSelect = document.getElementById('exp-color-select') as HTMLSelectElement | null;
        if (expColorSelect && res.id && !expColorSelect.querySelector(`option[value="${res.id}"]`)) {
          const opt = document.createElement('option');
          opt.value = res.id;
          opt.textContent = res.name;
          expColorSelect.appendChild(opt);
          expColorSelect.value = res.id;
        }
        director.updateSettings({ colorMood: res.id as any });
        showToast(`Imported Palette · ${res.name}`);
      } else if (res.kind === 'bundle') {
        showToast(`Imported Bundle · ${res.name}`);
      }
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  window.addEventListener('export-experience-look', () => {
    handleExportLook();
  });

  window.addEventListener('import-experience-look', (e: Event) => {
    const customEvent = e as CustomEvent<{ file: File }>;
    if (customEvent.detail?.file) {
      void handleImportAssetFile(customEvent.detail.file);
    }
  });

  document.getElementById('exp-export-btn')?.addEventListener('click', handleExportLook);

  const expImportInput = document.getElementById('exp-import-input') as HTMLInputElement | null;
  expImportInput?.addEventListener('change', () => {
    const file = expImportInput.files?.[0];
    if (file) {
      void handleImportAssetFile(file);
      expImportInput.value = '';
    }
  });

  window.addEventListener(
    'drop',
    (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file && (file.type === 'application/json' || file.name.endsWith('.json'))) {
        e.stopImmediatePropagation();
        e.preventDefault();
        document.body.classList.remove('drag-over');
        void handleImportAssetFile(file);
      }
    },
    true,
  );

  // Dev-only handle for automated checks; stripped from production builds.
  if (import.meta.env.DEV) (window as unknown as { __mv: unknown }).__mv = { engine, host, compositor, session, director };

  const beatTimes: number[] = [];
  engine.on('source-changed', () => (beatTimes.length = 0));

  let frameMs = 16;
  const budget = new FrameBudget();
  host.onFrameTime = (ms) => {
    frameMs = ms;
    budget.push(ms);
  };
  host.onContextChange = (s) =>
    showNotice(s === 'lost' ? 'Graphics reset… restarting visuals.' : 'Visuals restarted.', 'info', 3000);

  let preparedId: string | null = null;
  // Filled by the director every frame instead of building new objects (Slice 16.8).
  const camScratch: CameraUniforms = { panX: 0, panY: 0, zoom: 1, roll: 0, tiltX: 0, tiltY: 0 };
  const colourScratch: ColorUniforms = { shadowTint: [1, 1, 1], highlightTint: [1, 1, 1], spatialSpread: 0, gradAngle: 0, intensity: 0, cycleAngle: 0 };
  // Automatic resolution scaling (Slice 16.6). Off in benchmark mode, so results are comparable, and with ?autoscale=0.
  const autoScaleOn = benchSeconds === null && params.get('autoscale') !== '0';
  const governor = new QualityGovernor(
    TIER_SETTINGS[
      detectTier({
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints ?? 0,
        screenShortSide: Math.min(screen.width, screen.height),
        renderer: (() => {
          const gl = host.canvas.getContext('webgl2');
          return gl ? describeRenderer(gl) : '';
        })(),
      })
    ],
  );
  if (autoScaleOn) setAutoScale(governor.scale);
  // The phone tier also gets the lighter crossfade (shorter fade, outgoing scene not redrawn).
  if (governor.tier === 'phone' && compositor) compositor.setLightFade(true);
  let lastRaf = performance.now();
  host.start((): AudioFrame => {
    const now = performance.now();
    const displayFrameMs = clampDt((now - lastRaf) / 1000) * 1000;
    // The governor reads the true gap between frames (the clamped value would hide long frames).
    const rawFrameMs = now - lastRaf;
    lastRaf = now;
    if (autoScaleOn && !host.stepper.isFrozen) {
      const next = governor.push(rawFrameMs);
      if (next !== null) setAutoScale(next);
    }

    const frame = engine.readFrame();
    if (frame.beat && engine.kind === 'test:kick') {
      beatTimes.push(frame.time);
      if (beatTimes.length > MAX_BEATS) beatTimes.shift();
    }

    // Debug stats are worked out only while the panel is open (budget sort, latency estimate).
    if (panel.isVisible) {
      panel.update({
        sourceName: sourceName(engine.kind, state.fileName),
        frame,
        frameMs,
        budget: budget.summary(),
        trackSettings: engine.trackSettings,
        latency:
          engine.kind === 'test:kick'
            ? estimateLatencyMs(engine.kickTimes, beatTimes, engine.ctx.outputLatency || 0, engine.ctx.baseLatency || 0, displayFrameMs)
            : null,
      });
    }
    controls.tick();
    if (bench && benchPanel && !benchReported) {
      if (bench.done) {
        benchReported = true;
        benchPanel.showResults(
          bench.report({
            userAgent: navigator.userAgent,
            renderer: benchLayer?.renderer ?? 'unknown',
            devicePixelRatio: window.devicePixelRatio || 1,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            gpuTimer: Boolean(benchLayer?.timer),
          }),
        );
      } else {
        bench.onFrame({ intervalMs: displayFrameMs, cpuMs: frameMs });
        const pos = bench.position;
        benchPanel.showProgress(pos.current, pos.total, bench.currentName);
      }
    }
    // One shared sway per frame (tunnel, particles, crown read it). Calm turns it off.
    advanceSway(displayFrameMs / 1000, frame.norm.mid, state.calm);
    // P5: crown heights once per frame (particles launch from them). Visual gain is applied inside.
    advanceCrown(frame.smoothedSpectrum, frame.sampleRate, frame.spectrum.length * 2, displayFrameMs / 1000, state.calm, crownOn);
    // P4 (before the visual gain, so energy is the track-relative value): contrast and colour swap.
    const dtSec = displayFrameMs / 1000;
    const contrast = sectionContrast(frame.loudness, loudSlow.step(frame.loudness, dtSec));
    const swapMix = colourSwap.update({
      dtSec,
      contrast,
      energy: frame.energy,
      kick: frame.beatByBand.sub,
      calm: state.calm,
    });
    for (const layer of [...tunnels, ...particleLayers, ...(session ? session.list().flatMap((e) => session!.sceneOf(e.id).layers) : [])]) {
      flagLayer(layer, state.calm, contrast, swapMix);
    }

    if (director.isCalm() !== state.calm) {
      director.setCalm(state.calm);
    }
    director.advance(dtSec, frame, contrast);
    if (compositor) {
      compositor.calm = state.calm;
      // Intensity only tightens the brightness limiter (slice 21.3).
      compositor.brightnessLimiter.setIntensity(state.intensity ?? 'full');
      // Kick zoom follows the same viewer Intensity (slice 22.2): Full 1, Reduced 0.5, Calm 0.
      director.setKickZoomScale(state.intensity === 'calm' ? 0 : state.intensity === 'reduced' ? 0.5 : 1);
      compositor.setDirectorState(director.getCameraUniforms(camScratch), director.getColorUniforms(colourScratch));
    }

    // Visual gain bends the reaction curve (gainStore.shapeReaction): low = calmer, high =
    // more contrast. Applied to the reaction values only, not the full-screen level.
    const g = getVisualGain();
    if (g !== 1) {
      const bend = (x: number) => shapeReaction(x, g);
      frame.norm.sub = bend(frame.norm.sub); frame.norm.mid = bend(frame.norm.mid); frame.norm.high = bend(frame.norm.high);
      frame.energy = bend(frame.energy);
    }

    // Calm mode: the frame object is rebuilt every tick, so scaling it here
    // affects only this frame's drawing, never the analysis state.
    if (state.calm) frame.env.sub *= CALM_SCALE;
    // Auto-cycle (T2): pick the next preset when the timer or a strong beat says so.
    if (session && switchShown && cycle.mode !== 'off' && !bench) {
      const shownId = session.shownId ?? 'crown';
      // Slow devices (phone, integrated graphics) skip Heavy presets in the cycle (Slice 16.11).
      const cycleOpts: CycleOptions = { ...cycle, calmOnly: state.calm, maxCost: maxCostForTier(governor.tier) };
      const pool = eligible(session.list().map((e) => ({ id: e.id, tags: e.preset.tags, cost: presetCost(e.preset).level })), cycleOpts);
      const strongBeat = frame.beat && frame.beatStrength >= 0.8;
      // A few seconds before a switch, compile the next preset while it is still hidden (Slice 16.3).
      // Slice 23.2: a preset's own display time replaces the timer length (Timer mode only).
      const shownCycleOpts = effectiveCycleOptions(cycleOpts, presetDisplaySec(session.get(shownId)?.preset));
      const upcoming = cycler.upcoming(shownId, pool, shownCycleOpts, undefined, frame);
      if (upcoming && upcoming !== preparedId && compositor) {
        preparedId = upcoming;
        session.sceneOf(upcoming);
        compositor.prepare(upcoming);
      } else if (!upcoming) {
        preparedId = null;
      }
      const pick = cycler.next(dtSec, strongBeat, shownId, pool, shownCycleOpts, frame);
      if (pick) switchShown(pick);
    }
    // Audio links (E2): the shown preset's linked settings follow the music, once per frame.
    const shown = session?.shownId;
    if (session && shown) {
      const entry = session.get(shown);
      if (entry) crownOn = hasCrownLayer(entry.preset);
      // A preset's own reaction style wins over the global one (Off by default, so old presets look the same).
      const styleReactions = entry ? reactionsForStyle(effectiveReactionStyle(entry.preset.reactionStyle, getReactionStyle())) : undefined;
      const reactions = entry ? reactionBank.engineFor(shown, entry.preset.reactions, styleReactions) : null;
      if (reactions) reactedIds.add(shown);
      if (entry && !reactions && !hasLinks(entry.preset) && reactedIds.delete(shown)) {
        compositor?.setPost(restoreBasePreset(session.previewOf(shown), session.sceneOf(shown)));
      }
      if (entry && (hasLinks(entry.preset) || reactions)) {
        const post = applyLinkedPreset(session.previewOf(shown), session.sceneOf(shown), linkRunner, shown, { frame, timeSec: performance.now() / 1000, sectionContrast: contrast }, dtSec, reactions);
        compositor?.setPost(post);
      }
    }
    return frame;
  });
}

export {
  hasCrownLayer,
  adminGateway,
  AdminGateway,
  loadCachedPresets,
  start,
};

/**
 * Announce a verified admin login on all three channels the studio listens to:
 * BroadcastChannel, localStorage (storage event) and the opener (postMessage).
 */
function publishAdminSignal(): void {
  const signal = { type: 'mv-admin-authenticated', verified: true, ts: Date.now() };
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(ADMIN_AUTH_CHANNEL);
      channel.postMessage(signal);
      channel.close();
    } catch {
      // ignore channel errors
    }
  }
  try {
    localStorage.setItem(ADMIN_AUTH_STORAGE_KEY, JSON.stringify(signal));
  } catch {
    // ignore storage errors
  }
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(signal, window.location.origin);
    } catch {
      // ignore postMessage errors
    }
  }
}

/**
 * Page-wide listeners: a login that finishes after the studio stopped waiting still unlocks admin.
 */
function installAdminAuthListeners(): void {
  const onSignal = (value: unknown) => {
    if (!isVerifiedAdminSignal(value)) return;
    if (adminGateway.isAdmin()) return;
    if (typeof adminGateway.checkCloudflareAccess === 'function') {
      void adminGateway.checkCloudflareAccess().catch(() => false);
    }
  };
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(ADMIN_AUTH_CHANNEL);
      channel.onmessage = (event: MessageEvent) => onSignal(event.data);
    } catch {
      // ignore channel errors
    }
  }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (event: StorageEvent) => {
      if (event.key !== ADMIN_AUTH_STORAGE_KEY || !event.newValue) return;
      try {
        onSignal(JSON.parse(event.newValue));
      } catch {
        // ignore malformed signal
      }
    });
  }
}

/**
 * Register the offline cache worker (Slice 21.10). Production only, over https or localhost.
 * Any failure is swallowed so it never breaks the app.
 */
function registerServiceWorker(): void {
  try {
    if (!import.meta.env.PROD) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const { protocol, hostname } = window.location;
    if (protocol !== 'https:' && hostname !== 'localhost') return;
    window.addEventListener(
      'load',
      () => {
        try {
          navigator.serviceWorker.register('/sw.js').catch(() => undefined);
        } catch {
          // ignore registration errors
        }
      },
      { once: true },
    );
  } catch {
    // ignore support errors
  }
}

if (typeof window !== 'undefined') {
  const isAuthPopup = Boolean(
    launchedOnAdminPath &&
      (new URLSearchParams(window.location.search).get('popup') === '1' ||
        (window.opener && !window.opener.closed)),
  );
  if (launchedOnAdminPath) {
    if (!isAuthPopup) {
      try {
        sessionStorage.setItem('mv.returnToStudio', 'true');
      } catch {
        // ignore storage errors
      }
    }
  }
  installAdminAuthListeners();
  if (typeof adminGateway.checkCloudflareAccess === 'function') {
    void adminGateway.checkCloudflareAccess().then((verified) => {
      if (isAuthPopup) {
        // Never close the popup unless the login is verified.
        if (verified) {
          publishAdminSignal();
          try {
            window.close();
          } catch {
            // ignore window.close errors
          }
        }
      } else if (launchedOnAdminPath) {
        try {
          window.history.replaceState({}, '', '/');
        } catch {
          // ignore history errors
        }
      }
    });
  }
  const supportText = supportNoticeText(browserSupportProblems());
  if (supportText) showNotice(supportText, 'error', 0, { dismissible: true });
  document.getElementById('start-btn')?.addEventListener('click', start, { once: true });
  registerServiceWorker();
}
