// App entry: start screen → AudioEngine (inside the click) → GlHost with the scenes
// and layers → debug panel and controls.
import './style.css';
import { AudioEngine } from './audio/engine';
import { estimateLatencyMs } from './audio/latency';
import type { AudioFrame } from './audio/types';
import type { RenderLayer } from './render/layer';
import { GlHost } from './gl/context';
import { BassPulseLayer } from './render/layers/bassPulse';
import { WaveformLayer } from './render/layers/waveform';
import { TrailTestLayer } from './render/layers/trailTest';
import { Compositor } from './render/compositor';
import { Scene } from './render/scene';
import { TunnelLayer } from './render/layers/tunnel';
import { getVisualGain, shapeReaction } from './render/gainStore';
import { ParticleLayer } from './render/layers/particles';
import { BarsLayer } from './render/layers/bars';
import { RingsLayer } from './render/layers/rings';
import { BUILTIN_PRESETS, SCHEMAS } from './presets/builtin';
import { PresetSession } from './presets/session';
import { applyLinkedPreset, hasLinks } from './presets/loader';
import { LinkRunner } from './presets/links';
import { AutoCycler, DEFAULT_CYCLE, eligible, type CycleOptions } from './presets/autoCycle';
import { advanceSway } from './render/swayStore';
import { advanceCrown } from './render/crownStore';
import { cycleIndex, indexForDigit, readStoredPresetId, safeStorage, storePresetId, stepForKey } from './presets/library';
import { showToast } from './ui/toast';
import { Studio } from './studio/studio';
import { ShockwaveLayer } from './render/layers/shockwave';
import { makeSlowLoudness, sectionContrast } from './render/sectionContrast';
import { ColourSwap } from './render/colourSwap';
import { setupControls, sourceName, type ControlsState } from './ui/controls';
import { DebugPanel } from './ui/debugPanel';
import { FrameBudget } from './render/frameBudget';
import { browserSupportProblems, showNotice } from './ui/notices';

/** Calm mode scales the bass pulse down (motion reduction for sensitive viewers). */
const CALM_SCALE = 0.35;
/** Keep the latest beat times for the latency estimate (about 30 s of kicks). */
const MAX_BEATS = 60;

/** Calm, section contrast and accent swap reach only the tunnel, particles and shockwave (as before 4.3). */
function flagLayer(layer: RenderLayer, calm: boolean, contrast: number, swap: number): void {
  if (layer instanceof TunnelLayer || layer instanceof ParticleLayer) {
    layer.calm = calm;
    layer.sectionContrast = contrast;
    layer.accentSwap = swap;
  } else if (layer instanceof ShockwaveLayer) {
    layer.calm = calm;
    layer.accentSwap = swap;
  }
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

  // Freeze (k) holds the picture; while frozen, . draws exactly one frame (frameStep.ts).
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
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
  let compositor: Compositor | null = null;
  let session: PresetSession | null = null;
  const linkRunner = new LinkRunner();
  // Auto-cycle (T2): off by default. Keys: C timer, B beat, X shuffle.
  const cycle: CycleOptions = { ...DEFAULT_CYCLE };
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
      new Scene('wave', [new WaveformLayer()]),
    ]);
    compositor.setWeights({ pulse: 1 });
    host.addLayer(compositor);
  } else if (params.has('tracer')) {
    host.addLayer(new BassPulseLayer());
    host.addLayer(new WaveformLayer());
  } else {
    // Presets: the session owns every preset's working copy and scene. Built-ins come first, so
    // keys 0 / 1 / 2 keep their old meaning (Crown / Flight / Bars).
    const comp = new Compositor([]);
    compositor = comp;
    host.addLayer(comp);
    session = new PresetSession(comp, SCHEMAS, safeStorage());
    for (const b of BUILTIN_PRESETS) session.addBuiltin(b.id, b.preset);
    for (const problem of session.loadUserPresets()) console.warn('Saved preset skipped:', problem);
    const liveSession = session;
    const order = () => liveSession.list().map((e) => e.id);
    const remembered = readStoredPresetId();
    let currentId = remembered && liveSession.get(remembered) ? remembered : 'crown';
    const switchTo = (id: string, announce = false) => {
      currentId = id;
      cycler.reset();
      liveSession.show(id);
      crownOn = id === 'crown';
      storePresetId(id);
      if (announce) showToast(liveSession.get(id)!.preset.name);
      if (studio.visible) studio.bind(id);
    };
    const studio = new Studio(document.getElementById('studio')!, {
      session: liveSession,
      switchTo: (id) => switchTo(id, true),
      frameMs: () => frameMs,
      linkMeter: (key) => linkRunner.meterByKey(key),
    });
    switchTo(currentId);
    switchShown = (id) => switchTo(id, true);
    // No automatic blend: the view changes only when a key is pressed.
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'c' || e.key === 'C' || e.key === 'b' || e.key === 'B' || e.key === 'x' || e.key === 'X') {
        const k = e.key.toLowerCase();
        if (k === 'c') cycle.mode = cycle.mode === 'timer' ? 'off' : 'timer';
        if (k === 'b') cycle.mode = cycle.mode === 'beat' ? 'off' : 'beat';
        if (k === 'x') cycle.shuffle = !cycle.shuffle;
        const label = cycle.mode === 'off' ? 'Auto-cycle off' : `Auto-cycle: ${cycle.mode === 'timer' ? 'every 20 s' : 'on strong beats'}${cycle.shuffle ? ', shuffled' : ''}`;
        if (k !== 'x' || cycle.mode !== 'off') showToast(label);
        else showToast(`Shuffle ${cycle.shuffle ? 'on' : 'off'}`);
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        studio.setVisible(!studio.visible);
        if (studio.visible) studio.bind(currentId);
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
      if ((e.key === 'a' || e.key === 'A') && !e.repeat && !e.ctrlKey && !e.metaKey) liveSession.compare(currentId, true);
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'a' || e.key === 'A') liveSession.compare(currentId, false);
    });
  }

  const state: ControlsState = {
    calm: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    fileName: '',
  };
  const controls = setupControls(engine, state);
  const panel = new DebugPanel();

  // Dev-only handle for automated checks; stripped from production builds.
  if (import.meta.env.DEV) (window as unknown as { __mv: unknown }).__mv = { engine, host, compositor, session };

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

  let lastRaf = performance.now();
  host.start((): AudioFrame => {
    const now = performance.now();
    const displayFrameMs = now - lastRaf;
    lastRaf = now;

    const frame = engine.readFrame();
    if (frame.beat && engine.kind === 'test:kick') {
      beatTimes.push(frame.time);
      if (beatTimes.length > MAX_BEATS) beatTimes.shift();
    }

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
    controls.tick();
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
    if (session && switchShown && cycle.mode !== 'off') {
      const shownId = session.shownId ?? 'crown';
      const pool = eligible(session.list().map((e) => ({ id: e.id, tags: e.preset.tags })), cycle);
      const strongBeat = frame.beat && frame.beatStrength >= 0.8;
      const pick = cycler.next(dtSec, strongBeat, shownId, pool, cycle);
      if (pick) switchShown(pick);
    }
    // Audio links (E2): the shown preset's linked settings follow the music, once per frame.
    const shown = session?.shownId;
    if (session && shown) {
      const entry = session.get(shown);
      if (entry && hasLinks(entry.preset)) {
        const post = applyLinkedPreset(entry.preset, session.sceneOf(shown), linkRunner, shown, { frame, timeSec: performance.now() / 1000, sectionContrast: contrast }, dtSec);
        compositor?.setPost(post);
      }
    }
    return frame;
  });
}

const problems = browserSupportProblems();
if (problems.length) showNotice(problems.join(' '), 'error', 0);
document.getElementById('start-btn')!.addEventListener('click', start, { once: true });
