// Benchmark mode (Stage 16, Slice 16.1). Reached with the URL flag `?benchmark` (optionally
// `?benchmark=8` for 8 seconds per preset). Runs every preset in turn on the built-in kick test
// signal and records frame times, so a performance change can be judged against numbers.
//
// Three things are recorded per preset:
// - cpu: how long the draw calls took to submit (GlHost.onFrameTime)
// - interval: time between animation frames (what a viewer feels as smoothness)
// - gpu: GPU time, only where EXT_disjoint_timer_query_webgl2 exists (null elsewhere)
import type { AudioFrame } from '../audio/types';
import type { RenderClock } from './clock';
import type { RenderLayer, RenderTarget } from './layer';

export const DEFAULT_SECONDS_PER_PRESET = 5;
/** Frames in the first second after a switch are dropped: shader compiles and warm-up spikes. */
export const WARMUP_MS = 1000;

/** Nearest-rank percentile on an already-sorted array (p in 0..100). */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] ?? 0;
}

function stats(values: readonly number[]): { p50: number; p95: number } {
  const sorted = values.slice().sort((a, b) => a - b);
  return { p50: percentile(sorted, 50), p95: percentile(sorted, 95) };
}

/** Parses the `benchmark` URL flag. Returns null when off, else seconds per preset (2 to 60). */
export function benchmarkSeconds(params: URLSearchParams): number | null {
  if (!params.has('benchmark')) return null;
  const n = Number(params.get('benchmark'));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SECONDS_PER_PRESET;
  return Math.min(60, Math.max(2, n));
}

export interface BenchmarkEntry {
  id: string;
  name: string;
}

export interface PresetBenchResult {
  id: string;
  name: string;
  frames: number;
  cpuP50Ms: number;
  cpuP95Ms: number;
  intervalP50Ms: number;
  intervalP95Ms: number;
  /** Null when the GPU timer extension is missing or returned nothing. */
  gpuP50Ms: number | null;
  gpuP95Ms: number | null;
}

export interface BenchmarkEnvironment {
  userAgent: string;
  renderer: string;
  devicePixelRatio: number;
  canvasWidth: number;
  canvasHeight: number;
  gpuTimer: boolean;
}

export interface BenchmarkReport {
  startedAt: string;
  secondsPerPreset: number;
  environment: BenchmarkEnvironment;
  results: PresetBenchResult[];
}

export interface FrameSample {
  /** Time between animation frames, in ms. */
  intervalMs: number;
  /** Draw-call submit time, in ms. */
  cpuMs: number;
}

/**
 * Steps through the presets. Driven by frames, not a wall clock: the elapsed time of a preset is the
 * sum of the frame intervals it was fed, so the run behaves the same under any frame rate.
 */
export class BenchmarkRunner {
  private index = -1;
  private elapsedMs = 0;
  private cpu: number[] = [];
  private interval: number[] = [];
  private gpu: number[] = [];
  private readonly results: PresetBenchResult[] = [];
  private finished = false;

  constructor(
    private readonly entries: readonly BenchmarkEntry[],
    private readonly secondsPerPreset: number,
    private readonly switchTo: (id: string) => void,
    private readonly warmupMs = WARMUP_MS,
  ) {
    if (entries.length === 0) this.finished = true;
  }

  get done(): boolean {
    return this.finished;
  }

  /** 1-based number of the preset being measured, and the total. */
  get position(): { current: number; total: number } {
    return { current: Math.min(this.entries.length, this.index + 1), total: this.entries.length };
  }

  get currentName(): string {
    return this.entries[this.index]?.name ?? '';
  }

  /** Begin the run: shows the first preset. */
  start(): void {
    if (this.finished || this.index >= 0) return;
    this.begin(0);
  }

  /** One finished GPU timer result in ms. Kept only while measuring (past the warm-up). */
  onGpu(ms: number): void {
    if (this.finished || this.index < 0 || this.elapsedMs < this.warmupMs) return;
    if (Number.isFinite(ms) && ms >= 0) this.gpu.push(ms);
  }

  onFrame(sample: FrameSample): void {
    if (this.finished || this.index < 0) return;
    if (!Number.isFinite(sample.intervalMs) || sample.intervalMs < 0) return;
    const measuring = this.elapsedMs >= this.warmupMs;
    this.elapsedMs += sample.intervalMs;
    if (measuring) {
      if (Number.isFinite(sample.cpuMs) && sample.cpuMs >= 0) this.cpu.push(sample.cpuMs);
      this.interval.push(sample.intervalMs);
    }
    if (this.elapsedMs >= this.warmupMs + this.secondsPerPreset * 1000) this.finishCurrent();
  }

  report(environment: BenchmarkEnvironment, startedAt = new Date().toISOString()): BenchmarkReport {
    return { startedAt, secondsPerPreset: this.secondsPerPreset, environment, results: this.results.slice() };
  }

  private begin(i: number): void {
    this.index = i;
    this.elapsedMs = 0;
    this.cpu = [];
    this.interval = [];
    this.gpu = [];
    this.switchTo(this.entries[i]!.id);
  }

  private finishCurrent(): void {
    const entry = this.entries[this.index]!;
    const c = stats(this.cpu);
    const iv = stats(this.interval);
    const g = this.gpu.length > 0 ? stats(this.gpu) : null;
    this.results.push({
      id: entry.id,
      name: entry.name,
      frames: this.interval.length,
      cpuP50Ms: c.p50,
      cpuP95Ms: c.p95,
      intervalP50Ms: iv.p50,
      intervalP95Ms: iv.p95,
      gpuP50Ms: g ? g.p50 : null,
      gpuP95Ms: g ? g.p95 : null,
    });
    if (this.index + 1 >= this.entries.length) {
      this.finished = true;
      return;
    }
    this.begin(this.index + 1);
  }
}

const f1 = (n: number | null): string => (n === null ? 'n/a' : n.toFixed(1));

/** Plain-text table, one row per preset, for the on-screen results. */
export function formatTable(report: BenchmarkReport): string {
  const head = ['preset', 'frames', 'cpu p50', 'cpu p95', 'frame p50', 'frame p95', 'gpu p50', 'gpu p95'];
  const rows = report.results.map((r) => [
    r.name,
    String(r.frames),
    f1(r.cpuP50Ms),
    f1(r.cpuP95Ms),
    f1(r.intervalP50Ms),
    f1(r.intervalP95Ms),
    f1(r.gpuP50Ms),
    f1(r.gpuP95Ms),
  ]);
  const all = [head, ...rows];
  const widths = head.map((_, i) => Math.max(...all.map((row) => row[i]!.length)));
  const line = (row: string[]) => row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!))).join('  ');
  return all.map(line).join('\n');
}

/** The JSON the Copy button puts on the clipboard. */
export function reportToJson(report: BenchmarkReport): string {
  return JSON.stringify(report, null, 2);
}

/** Reads the GPU name where the browser exposes it. */
export function describeRenderer(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const value = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return typeof value === 'string' ? value : 'unknown';
}

/** Minimal shape of EXT_disjoint_timer_query_webgl2 that the timer uses. */
interface DisjointTimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/**
 * GPU time per drawn span, via EXT_disjoint_timer_query_webgl2. Results arrive a frame or two late,
 * so queries wait in a small pool and `drain()` returns the ones that have finished.
 */
export class GpuTimer {
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  private static readonly MAX_PENDING = 8;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly ext: DisjointTimerExt,
  ) {}

  /** Null when the extension is missing. */
  static create(gl: WebGL2RenderingContext): GpuTimer | null {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as DisjointTimerExt | null;
    return ext ? new GpuTimer(gl, ext) : null;
  }

  begin(): void {
    if (this.active || this.pending.length >= GpuTimer.MAX_PENDING) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Finished results in ms, oldest first. Results spoiled by a GPU disjoint event are dropped. */
  drain(): number[] {
    const out: number[] = [];
    const gl = this.gl;
    const disjoint = Boolean(gl.getParameter(this.ext.GPU_DISJOINT_EXT));
    while (this.pending.length > 0) {
      const q = this.pending[0]!;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) out.push(Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6);
      gl.deleteQuery(q);
    }
    if (disjoint) {
      for (const q of this.pending) gl.deleteQuery(q);
      this.pending.length = 0;
    }
    return out;
  }

  dispose(): void {
    for (const q of this.pending) this.gl.deleteQuery(q);
    this.pending.length = 0;
    if (this.active) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.gl.deleteQuery(this.active);
      this.active = null;
    }
  }
}

/**
 * Wraps a layer (the compositor) so its draw is timed on the GPU. Added to the host in place of the
 * layer only when benchmark mode is on, so the normal path has no wrapper.
 */
export class GpuTimedLayer implements RenderLayer {
  timer: GpuTimer | null = null;
  renderer = 'unknown';
  /** Called with each finished GPU result in ms. */
  onGpu: ((ms: number) => void) | null = null;

  constructor(private readonly inner: RenderLayer) {}

  init(gl: WebGL2RenderingContext): void {
    this.timer?.dispose();
    this.timer = GpuTimer.create(gl);
    this.renderer = describeRenderer(gl);
    this.inner.init(gl);
  }

  resize(width: number, height: number, dpr: number): void {
    this.inner.resize(width, height, dpr);
  }

  draw(frame: AudioFrame, clock: RenderClock, target: RenderTarget): void {
    const timer = this.timer;
    if (timer) {
      for (const ms of timer.drain()) this.onGpu?.(ms);
      timer.begin();
    }
    this.inner.draw(frame, clock, target);
    timer?.end();
  }

  dispose(): void {
    this.timer?.dispose();
    this.timer = null;
    this.inner.dispose();
  }
}
