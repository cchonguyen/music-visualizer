import { describe, expect, it, vi } from 'vitest';
import {
  BenchmarkRunner,
  GpuTimedLayer,
  GpuTimer,
  benchmarkSeconds,
  formatTable,
  percentile,
  reportToJson,
  type BenchmarkEnvironment,
} from './benchmark';
import type { RenderLayer } from './layer';

const ENV: BenchmarkEnvironment = {
  userAgent: 'test',
  renderer: 'Test GPU',
  devicePixelRatio: 2,
  canvasWidth: 100,
  canvasHeight: 50,
  gpuTimer: false,
};

describe('percentile', () => {
  it('uses nearest rank and handles empty input', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });
});

describe('benchmarkSeconds', () => {
  it('is null when the flag is absent', () => {
    expect(benchmarkSeconds(new URLSearchParams(''))).toBeNull();
  });
  it('defaults to 5 seconds for a bare flag or junk', () => {
    expect(benchmarkSeconds(new URLSearchParams('benchmark'))).toBe(5);
    expect(benchmarkSeconds(new URLSearchParams('benchmark=abc'))).toBe(5);
    expect(benchmarkSeconds(new URLSearchParams('benchmark=-3'))).toBe(5);
  });
  it('clamps a given value to 2..60', () => {
    expect(benchmarkSeconds(new URLSearchParams('benchmark=8'))).toBe(8);
    expect(benchmarkSeconds(new URLSearchParams('benchmark=1'))).toBe(2);
    expect(benchmarkSeconds(new URLSearchParams('benchmark=999'))).toBe(60);
  });
});

describe('BenchmarkRunner', () => {
  const entries = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
  ];

  it('is done at once with no presets', () => {
    const r = new BenchmarkRunner([], 2, vi.fn());
    expect(r.done).toBe(true);
    expect(r.report(ENV).results).toEqual([]);
  });

  it('shows the first preset on start and each next one when a preset finishes', () => {
    const shown: string[] = [];
    const r = new BenchmarkRunner(entries, 1, (id) => shown.push(id), 100);
    r.start();
    expect(shown).toEqual(['a']);
    // 100 ms warm-up plus 1000 ms measured, in 100 ms frames.
    for (let i = 0; i < 11; i++) r.onFrame({ intervalMs: 100, cpuMs: 2 });
    expect(shown).toEqual(['a', 'b']);
    expect(r.done).toBe(false);
    for (let i = 0; i < 11; i++) r.onFrame({ intervalMs: 100, cpuMs: 4 });
    expect(r.done).toBe(true);
    expect(shown).toEqual(['a', 'b']);
  });

  it('drops warm-up frames and records p50 and p95 for the rest', () => {
    const r = new BenchmarkRunner([entries[0]!], 1, vi.fn(), 200);
    r.start();
    // Two warm-up frames with a large spike, then ten measured frames.
    r.onFrame({ intervalMs: 100, cpuMs: 500 });
    r.onFrame({ intervalMs: 100, cpuMs: 500 });
    for (let i = 0; i < 10; i++) r.onFrame({ intervalMs: 100, cpuMs: 10 + i });
    const res = r.report(ENV).results[0]!;
    expect(res.id).toBe('a');
    expect(res.frames).toBe(10);
    expect(res.cpuP50Ms).toBe(14);
    expect(res.cpuP95Ms).toBe(19);
    expect(res.intervalP50Ms).toBe(100);
    expect(res.gpuP50Ms).toBeNull();
  });

  it('records GPU time only after warm-up and reports null when none arrived', () => {
    const r = new BenchmarkRunner([entries[0]!], 1, vi.fn(), 100);
    r.start();
    r.onGpu(99);
    r.onFrame({ intervalMs: 100, cpuMs: 1 });
    r.onGpu(3);
    r.onGpu(5);
    for (let i = 0; i < 10; i++) r.onFrame({ intervalMs: 100, cpuMs: 1 });
    const res = r.report(ENV).results[0]!;
    expect(res.gpuP50Ms).toBe(3);
    expect(res.gpuP95Ms).toBe(5);
  });

  it('ignores bad samples and frames after the run is done', () => {
    const r = new BenchmarkRunner([entries[0]!], 1, vi.fn(), 0);
    r.start();
    r.onFrame({ intervalMs: Number.NaN, cpuMs: 1 });
    r.onFrame({ intervalMs: -5, cpuMs: 1 });
    for (let i = 0; i < 10; i++) r.onFrame({ intervalMs: 100, cpuMs: 1 });
    expect(r.done).toBe(true);
    r.onFrame({ intervalMs: 100, cpuMs: 1 });
    expect(r.report(ENV).results).toHaveLength(1);
    expect(r.report(ENV).results[0]!.frames).toBe(10);
  });
});

describe('report output', () => {
  const report = {
    startedAt: '2026-01-01T00:00:00.000Z',
    secondsPerPreset: 5,
    environment: ENV,
    results: [
      { id: 'a', name: 'Alpha', frames: 300, cpuP50Ms: 1.25, cpuP95Ms: 2, intervalP50Ms: 16.7, intervalP95Ms: 20, gpuP50Ms: null, gpuP95Ms: null },
      { id: 'b', name: 'Beta preset', frames: 290, cpuP50Ms: 3, cpuP95Ms: 4, intervalP50Ms: 16.7, intervalP95Ms: 33.4, gpuP50Ms: 2.5, gpuP95Ms: 3.5 },
    ],
  };

  it('formats one row per preset plus a header, with n/a for missing GPU time', () => {
    const lines = formatTable(report).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('gpu p95');
    expect(lines[1]).toContain('Alpha');
    expect(lines[1]).toContain('n/a');
    expect(lines[2]).toContain('2.5');
  });

  it('round-trips through JSON', () => {
    expect(JSON.parse(reportToJson(report))).toEqual(report);
  });
});

function fakeGl(opts: { ext: boolean; disjoint?: boolean; ready?: boolean }) {
  const ext = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
  let next = 0;
  const gl = {
    QUERY_RESULT_AVAILABLE: 1,
    QUERY_RESULT: 2,
    getExtension: vi.fn((name: string) => (name === 'EXT_disjoint_timer_query_webgl2' && opts.ext ? ext : null)),
    createQuery: vi.fn(() => ({ id: next++ })),
    beginQuery: vi.fn(),
    endQuery: vi.fn(),
    deleteQuery: vi.fn(),
    getParameter: vi.fn((p: number) => (p === ext.GPU_DISJOINT_EXT ? Boolean(opts.disjoint) : 'GPU')),
    getQueryParameter: vi.fn((_q: unknown, p: number) => (p === 1 ? opts.ready !== false : 2_000_000)),
  };
  return gl as unknown as WebGL2RenderingContext & typeof gl;
}

describe('GpuTimer', () => {
  it('is null without the extension', () => {
    expect(GpuTimer.create(fakeGl({ ext: false }))).toBeNull();
  });

  it('returns finished spans in ms and frees the queries', () => {
    const gl = fakeGl({ ext: true });
    const t = GpuTimer.create(gl)!;
    t.begin();
    t.end();
    expect(t.drain()).toEqual([2]);
    expect(gl.deleteQuery).toHaveBeenCalledTimes(1);
  });

  it('keeps a span pending until the GPU finishes it', () => {
    const gl = fakeGl({ ext: true, ready: false });
    const t = GpuTimer.create(gl)!;
    t.begin();
    t.end();
    expect(t.drain()).toEqual([]);
    expect(gl.deleteQuery).not.toHaveBeenCalled();
  });

  it('drops results spoiled by a disjoint event', () => {
    const gl = fakeGl({ ext: true, disjoint: true });
    const t = GpuTimer.create(gl)!;
    t.begin();
    t.end();
    expect(t.drain()).toEqual([]);
    expect(gl.deleteQuery).toHaveBeenCalledTimes(1);
  });

  it('caps the number of spans in flight', () => {
    const gl = fakeGl({ ext: true, ready: false });
    const t = GpuTimer.create(gl)!;
    for (let i = 0; i < 20; i++) {
      t.begin();
      t.end();
    }
    expect(gl.createQuery).toHaveBeenCalledTimes(8);
  });
});

describe('GpuTimedLayer', () => {
  it('draws the inner layer inside a timed span and reports GPU results', () => {
    const calls: string[] = [];
    const inner: RenderLayer = {
      init: () => calls.push('init'),
      resize: () => calls.push('resize'),
      draw: () => calls.push('draw'),
      dispose: () => calls.push('dispose'),
    };
    const gl = fakeGl({ ext: true });
    const layer = new GpuTimedLayer(inner);
    const got: number[] = [];
    layer.onGpu = (ms) => got.push(ms);
    layer.init(gl);
    layer.resize(10, 10, 1);
    const frame = {} as never;
    const clock = { timeSec: 0, dtSec: 0, frameIndex: 0 };
    const target = { kind: 'canvas', width: 10, height: 10 } as const;
    layer.draw(frame, clock, target);
    layer.draw(frame, clock, target);
    expect(got).toEqual([2]);
    expect(layer.renderer).toBe('GPU');
    layer.dispose();
    expect(calls).toEqual(['init', 'resize', 'draw', 'draw', 'dispose']);
  });

  it('still draws when the extension is missing', () => {
    const draw = vi.fn();
    const layer = new GpuTimedLayer({ init: vi.fn(), resize: vi.fn(), draw, dispose: vi.fn() });
    layer.init(fakeGl({ ext: false }));
    layer.draw({} as never, { timeSec: 0, dtSec: 0, frameIndex: 0 }, { kind: 'canvas', width: 1, height: 1 });
    expect(draw).toHaveBeenCalledTimes(1);
    expect(layer.timer).toBeNull();
  });
});
