// App entry: start screen → AudioEngine (inside the click) → GlHost with the scenes
// and layers → debug panel and controls.
import './style.css';
import { AudioEngine } from './audio/engine';
import { estimateLatencyMs } from './audio/latency';
import type { AudioFrame } from './audio/types';
import { GlHost } from './gl/context';
import { BassPulseLayer } from './render/layers/bassPulse';
import { WaveformLayer } from './render/layers/waveform';
import { TrailTestLayer } from './render/layers/trailTest';
import { Compositor } from './render/compositor';
import { Scene } from './render/scene';
import { TunnelLayer } from './render/layers/tunnel';
import { getVisualGain } from './render/gainStore';
import { ParticleLayer } from './render/layers/particles';
import { BarsLayer } from './render/layers/bars';
import { RingsLayer } from './render/layers/rings';
import { CrownLayer } from './render/layers/crown';
import { advanceSway } from './render/swayStore';
import { advanceCrown } from './render/crownStore';
import { sceneForKey } from './render/sceneKeys';
import { ShockwaveLayer } from './render/layers/shockwave';
import { makeSlowLoudness, sectionContrast } from './render/sectionContrast';
import { ColourSwap } from './render/colourSwap';
import { setupControls, sourceName, type ControlsState } from './ui/controls';
import { DebugPanel } from './ui/debugPanel';
import { browserSupportProblems, showNotice } from './ui/notices';

/** Calm mode scales the bass pulse down (motion reduction for sensitive viewers). */
const CALM_SCALE = 0.35;
/** Keep the latest beat times for the latency estimate (about 30 s of kicks). */
const MAX_BEATS = 60;

/** One set of flight layers. Each scene owns its own layers, so each scene gets its own set. */
interface FlightKit {
  tunnel: TunnelLayer;
  particles: ParticleLayer;
  shockwave: ShockwaveLayer;
}

function flightKit(): FlightKit {
  return { tunnel: new TunnelLayer(), particles: new ParticleLayer(), shockwave: new ShockwaveLayer() };
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

  // Default (live site): the crown scene. Keys switch scenes (see sceneKeys.ts):
  //   0 = crown:  flight tunnel + radial crown + particles + shockwave
  //   1 = flight: flight tunnel + particles + shockwave, no crown
  //   2 = bars:   frequency bars + rings
  // URL options for single checks: ?tracer (Stage 1), ?trail, ?tunnel, ?particles, ?bars, ?scenes.
  const params = new URLSearchParams(location.search);
  let compositor: Compositor | null = null;
  // Single-layer debug options (?tunnel, ?particles) and the scene kits. Arrays, so TypeScript
  // does not narrow them to null inside the per-frame closures.
  const tunnels: TunnelLayer[] = [];
  const particleLayers: ParticleLayer[] = [];
  const kits: FlightKit[] = [];
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
    const crownKit = flightKit();
    const flyKit = flightKit();
    kits.push(crownKit, flyKit);
    const crown = new CrownLayer();
    const comp = new Compositor([
      new Scene('crown', [crownKit.tunnel, crown, crownKit.particles, crownKit.shockwave]),
      new Scene('flight', [flyKit.tunnel, flyKit.particles, flyKit.shockwave]),
      new Scene('bars', [new BarsLayer(), new RingsLayer()]),
    ]);
    comp.setWeights({ crown: 1 });
    compositor = comp;
    host.addLayer(comp);
    // No automatic blend: the view changes only when a key is pressed.
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const name = sceneForKey(e.key);
      if (!name) return;
      comp.setWeights({ [name]: 1 });
      crownOn = name === 'crown';
    });
  }

  const state: ControlsState = {
    calm: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    fileName: '',
  };
  const controls = setupControls(engine, state);
  const syncCalm = () => {
    for (const t of tunnels) t.calm = state.calm;
    for (const p of particleLayers) p.calm = state.calm;
    for (const k of kits) {
      k.tunnel.calm = state.calm;
      k.particles.calm = state.calm;
      k.shockwave.calm = state.calm;
    }
  };
  const panel = new DebugPanel();

  // Dev-only handle for automated checks; stripped from production builds.
  if (import.meta.env.DEV) (window as unknown as { __mv: unknown }).__mv = { engine, host, compositor };

  const beatTimes: number[] = [];
  engine.on('source-changed', () => (beatTimes.length = 0));

  let frameMs = 16;
  host.onFrameTime = (ms) => (frameMs = ms);
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
      trackSettings: engine.trackSettings,
      latency:
        engine.kind === 'test:kick'
          ? estimateLatencyMs(engine.kickTimes, beatTimes, engine.ctx.outputLatency || 0, engine.ctx.baseLatency || 0, displayFrameMs)
          : null,
    });
    controls.tick();
    syncCalm();
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
    for (const layer of [...tunnels, ...particleLayers]) {
      layer.sectionContrast = contrast;
      layer.accentSwap = swapMix;
    }
    for (const k of kits) {
      k.tunnel.sectionContrast = contrast;
      k.tunnel.accentSwap = swapMix;
      k.particles.sectionContrast = contrast;
      k.particles.accentSwap = swapMix;
      k.shockwave.accentSwap = swapMix;
    }

    // Visual gain: scales the response (ring crests, sparkles, ring count), not the
    // full-screen background level, so turning it up can't wash the screen out.
    const g = getVisualGain();
    if (g !== 1) {
      const up = (x: number) => Math.min(1, x * g);
      frame.norm.sub = up(frame.norm.sub); frame.norm.mid = up(frame.norm.mid); frame.norm.high = up(frame.norm.high);
      frame.energy = up(frame.energy);
    }

    // Calm mode: the frame object is rebuilt every tick, so scaling it here
    // affects only this frame's drawing, never the analysis state.
    if (state.calm) frame.env.sub *= CALM_SCALE;
    return frame;
  });
}

const problems = browserSupportProblems();
if (problems.length) showNotice(problems.join(' '), 'error', 0);
document.getElementById('start-btn')!.addEventListener('click', start, { once: true });
