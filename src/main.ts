// App entry: start screen → AudioEngine (inside the click) → GlHost with the two
// Stage 1 tracer layers → debug panel and controls.
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
import { SlowFollower } from './render/dynamics';
import { getVisualGain } from './render/gainStore';
import { ParticleLayer } from './render/layers/particles';
import { BarsLayer } from './render/layers/bars';
import { RingsLayer } from './render/layers/rings';
import { advanceSway } from './render/swayStore';
import { setupControls, sourceName, type ControlsState } from './ui/controls';
import { DebugPanel } from './ui/debugPanel';
import { browserSupportProblems, showNotice } from './ui/notices';

/** Calm mode scales the bass pulse down (motion reduction for sensitive viewers). */
const CALM_SCALE = 0.35;
/** Keep the latest beat times for the latency estimate (about 30 s of kicks). */
const MAX_BEATS = 60;

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

  // Default (live site): the Stage 2 scenes. Keys 1 and 2 switch scenes.
  //   1 = flight: forward-flight tunnel + treble sparkles
  //   2 = bars:   frequency bars + rings
  // URL options for single checks: ?tracer (Stage 1), ?trail, ?tunnel, ?particles, ?bars, ?scenes.
  const params = new URLSearchParams(location.search);
  let compositor: Compositor | null = null;
  let tunnel: TunnelLayer | null = null;
  let blendCompositor: Compositor | null = null;
  let autoBlend = true;
  const energySlow = new SlowFollower(6);
  if (params.has('trail')) {
    host.addLayer(new TrailTestLayer());
  } else if (params.has('tunnel')) {
    tunnel = new TunnelLayer();
    host.addLayer(tunnel);
  } else if (params.has('particles')) {
    host.addLayer(new ParticleLayer());
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
    tunnel = new TunnelLayer();
    compositor = new Compositor([
      new Scene('flight', [tunnel, new ParticleLayer()]),
      new Scene('bars', [new BarsLayer(), new RingsLayer()]),
    ]);
    compositor.setWeights({ flight: 1 });
    host.addLayer(compositor);
    blendCompositor = compositor;
    // Auto blend: the bars scene drifts into the flight scene as the song gets louder
    // (slow, so sections change the look rather than flicker). Keys: 1 flight, 2 bars, 0 auto.
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '1') { autoBlend = false; compositor!.setWeights({ flight: 1 }); }
      if (e.key === '2') { autoBlend = false; compositor!.setWeights({ bars: 1 }); }
      if (e.key === '0') autoBlend = true;
    });
  }

  const state: ControlsState = {
    calm: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    fileName: '',
  };
  const controls = setupControls(engine, state);
  const syncCalm = () => { if (tunnel) tunnel.calm = state.calm; };
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
    if (blendCompositor && autoBlend) {
      const slow = energySlow.step(frame.energy, displayFrameMs / 1000);
      const bars = state.calm ? 0 : Math.min(0.6, Math.max(0, (slow - 0.55) * 1.5));
      blendCompositor.setWeights({ flight: 1 - bars, bars });
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
