import { describe, it, expect, vi } from 'vitest';
import { Compositor, RETAIN_MAX_BYTES, RETAIN_MAX_SCENES, aspectBox, retainLimit, sceneBufferBytes } from './compositor';
import { Scene } from './scene';
import type { AudioFrame } from '../audio/types';
import type { RenderLayer, RenderTarget } from './layer';

const mk = (name: string) => new Scene(name, []);

describe('aspectBox (slice 8.2 fit rule)', () => {
  it('letterboxes landscape 2560x1440 with correction on', () => {
    const b = aspectBox(2560, 1440, true);
    expect(b).toEqual({ width: 2560, height: 1440, offX: 0, offY: 0 });
  });
  it('pillarboxes ultrawide 3440x1440 with correction on', () => {
    const b = aspectBox(3440, 1440, true);
    expect(b.width).toBe(2560);
    expect(b.height).toBe(1440);
    expect(b.offX).toBe(440);
    expect(b.offY).toBe(0);
  });
  it('fills the full canvas for portrait 780x1688 with correction on', () => {
    expect(aspectBox(780, 1688, true)).toEqual({ width: 780, height: 1688, offX: 0, offY: 0 });
  });
  it('fills the full canvas for portrait with correction off', () => {
    expect(aspectBox(780, 1688, false)).toEqual({ width: 780, height: 1688, offX: 0, offY: 0 });
  });
  it('fills the full canvas for square 1000x1000 with correction on', () => {
    expect(aspectBox(1000, 1000, true)).toEqual({ width: 1000, height: 1000, offX: 0, offY: 0 });
  });
  it('letterboxes 4:3 1024x768 with correction on (landscape rule)', () => {
    expect(aspectBox(1024, 768, true)).toEqual({ width: 1024, height: 576, offX: 0, offY: 96 });
  });
  it('never exceeds the canvas and keeps offsets as integers', () => {
    const sizes: [number, number][] = [
      [2560, 1440], [3440, 1440], [780, 1688], [1000, 1000], [1024, 768], [1921, 1080], [391, 845], [280, 900],
    ];
    for (const [w, h] of sizes) {
      for (const correct of [true, false]) {
        const b = aspectBox(w, h, correct);
        expect(b.width).toBeLessThanOrEqual(w);
        expect(b.height).toBeLessThanOrEqual(h);
        expect(b.offX + b.width).toBeLessThanOrEqual(w);
        expect(b.offY + b.height).toBeLessThanOrEqual(h);
        expect(Number.isInteger(b.offX)).toBe(true);
        expect(Number.isInteger(b.offY)).toBe(true);
      }
    }
  });
});

describe('Compositor input checks', () => {
  it('refuses a third active scene (the shader has two inputs)', () => {
    const c = new Compositor([mk('a'), mk('b'), mk('c')]);
    expect(() => c.setWeights({ a: 0.5, b: 0.3, c: 0.2 })).toThrow(/at most two/);
  });
  it('allows two active scenes, and zero-weight scenes do not count', () => {
    const c = new Compositor([mk('a'), mk('b'), mk('c')]);
    expect(() => c.setWeights({ a: 0.5, b: 0.5, c: 0 })).not.toThrow();
  });
  it('rejects an unknown scene name', () => {
    const c = new Compositor([mk('a')]);
    expect(() => c.setWeights({ nope: 1 })).toThrow(/unknown scene/);
  });
  it('clamps weights to 0..1', () => {
    const c = new Compositor([mk('a'), mk('b')]);
    expect(() => c.setWeights({ a: 2, b: -1 })).not.toThrow();
  });
});

function createMockGl(): WebGL2RenderingContext {
  const gl = {
    MAX: 0x8008, FUNC_ADD: 0x8006, ONE: 1, SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303, ONE_MINUS_SRC_COLOR: 0x0301,
    BLEND: 0x0be2, TRIANGLES: 4, TEXTURE0: 0x84c0, TEXTURE1: 0x84c1, TEXTURE_2D: 0x0de1, FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0, FRAMEBUFFER_COMPLETE: 0x8cd5, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, NEAREST: 0x2600,
    LINEAR: 0x2601, TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
    CLAMP_TO_EDGE: 0x812f, COLOR_BUFFER_BIT: 0x4000,
    getExtension: vi.fn().mockReturnValue(null),
    checkFramebufferStatus: vi.fn().mockReturnValue(0x8cd5),
    compileShader: vi.fn(), shaderSource: vi.fn(), attachShader: vi.fn(), linkProgram: vi.fn(),
    getShaderParameter: vi.fn().mockReturnValue(true),
    getProgramParameter: vi.fn().mockReturnValue(true),
    createShader: vi.fn().mockReturnValue({}),
    createProgram: vi.fn().mockReturnValue({}),
    createVertexArray: vi.fn().mockReturnValue({}),
    createTexture: vi.fn().mockReturnValue({}),
    createFramebuffer: vi.fn().mockReturnValue({}),
    bindTexture: vi.fn(), bindFramebuffer: vi.fn(), bindVertexArray: vi.fn(), useProgram: vi.fn(), activeTexture: vi.fn(),
    texParameteri: vi.fn(), texImage2D: vi.fn(), framebufferTexture2D: vi.fn(), drawArrays: vi.fn(),
    enable: vi.fn(), disable: vi.fn(), blendEquation: vi.fn(), blendFunc: vi.fn(), viewport: vi.fn(),
    clearColor: vi.fn(), clear: vi.fn(),
    getUniformLocation: vi.fn().mockImplementation((_p, name) => ({ name })),
    uniform1i: vi.fn(), uniform1f: vi.fn(), uniform2f: vi.fn(), uniform3f: vi.fn(), uniform3fv: vi.fn(),
    deleteProgram: vi.fn(), isProgram: vi.fn().mockReturnValue(true), isContextLost: vi.fn().mockReturnValue(false),
    deleteShader: vi.fn(), deleteTexture: vi.fn(), deleteFramebuffer: vi.fn(), deleteVertexArray: vi.fn(),
  } as unknown as WebGL2RenderingContext;
  return gl;
}

const FRAME = { loudness: 0.5, energy: 0.5, norm: { sub: 0, mid: 0, high: 0 }, env: { sub: 0, mid: 0, high: 0 } } as unknown as AudioFrame;
const TARGET: RenderTarget = { kind: 'canvas', width: 64, height: 36 };
const clock = (dtSec: number) => ({ timeSec: 0, dtSec, frameIndex: 1 });

function spyLayer() {
  return { init: vi.fn(), resize: vi.fn(), draw: vi.fn(), dispose: vi.fn() } satisfies RenderLayer;
}

function rig(names: string[]) {
  const layers = new Map(names.map((n) => [n, spyLayer()]));
  const scenes = names.map((n) => new Scene(n, [layers.get(n)!]));
  const comp = new Compositor(scenes);
  const gl = createMockGl();
  comp.init(gl);
  comp.resize(64, 36, 1);
  const frame = (dt = 0.1) => comp.draw(FRAME, clock(dt), TARGET);
  return { comp, gl, layers, frame };
}

describe('scene retention (Slice 16.3)', () => {
  it('sizes a scene as three RGBA8 buffers at the render scale', () => {
    expect(sceneBufferBytes(1000, 500, 1)).toBe(1000 * 500 * 4 * 3);
    expect(sceneBufferBytes(1000, 500, 0.5)).toBe(500 * 250 * 4 * 3);
  });

  it('keeps up to the count cap on small canvases and fewer on huge ones', () => {
    expect(retainLimit(1920, 1080, 1)).toBe(RETAIN_MAX_SCENES);
    // 8K at full scale: three buffers are about 400 MB, more than the whole cap.
    expect(retainLimit(7680, 4320, 1)).toBe(0);
    const w = 3840;
    const h = 2160;
    const n = retainLimit(w, h, 1);
    expect(n * sceneBufferBytes(w, h, 1)).toBeLessThanOrEqual(RETAIN_MAX_BYTES);
    expect(retainLimit(w, h, 0.5)).toBeGreaterThanOrEqual(n);
  });

  it('does not dispose a scene when its fade finishes', () => {
    const { comp, layers, frame } = rig(['a', 'b']);
    comp.setWeights({ a: 1 });
    for (let i = 0; i < 30; i++) frame(0.2);
    comp.setWeights({ b: 1 });
    for (let i = 0; i < 60; i++) frame(0.2);
    expect(comp.getWeight('a')).toBe(0);
    expect(layers.get('a')!.dispose).not.toHaveBeenCalled();
    expect(comp.isReady('a')).toBe(true);
  });

  it('shows a kept scene again without initialising it a second time', () => {
    const { comp, layers, frame } = rig(['a', 'b']);
    comp.setWeights({ a: 1 });
    for (let i = 0; i < 30; i++) frame(0.2);
    comp.setWeights({ b: 1 });
    for (let i = 0; i < 60; i++) frame(0.2);
    comp.setWeights({ a: 1 });
    for (let i = 0; i < 30; i++) frame(0.2);
    expect(layers.get('a')!.init).toHaveBeenCalledTimes(1);
    expect(comp.getWeight('a')).toBe(1);
  });

  it('clears the old image of a kept scene when it comes back, but not while it stays on screen', () => {
    const { comp, gl, frame } = rig(['a', 'b']);
    comp.setWeights({ a: 1 });
    for (let i = 0; i < 30; i++) frame(0.2);
    const clearsOnScreen = (gl.clear as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(clearsOnScreen).toBe(0);
    comp.setWeights({ b: 1 });
    for (let i = 0; i < 60; i++) frame(0.2);
    expect(gl.clear).not.toHaveBeenCalled();
    comp.setWeights({ a: 1 });
    frame(0.2);
    expect((gl.clear as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2); // read and write buffers
    for (let i = 0; i < 30; i++) frame(0.2);
    expect((gl.clear as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('drops the oldest kept scenes past the cap and never one that is on screen', () => {
    const names = ['s0', 's1', 's2', 's3', 's4', 's5'];
    const { comp, layers, frame } = rig(names);
    for (const n of names) {
      comp.setWeights({ [n]: 1 });
      for (let i = 0; i < 40; i++) frame(0.2);
    }
    const kept = names.filter((n) => comp.isReady(n));
    // The newest is on screen; RETAIN_MAX_SCENES older ones are kept.
    expect(kept).toEqual(['s2', 's3', 's4', 's5']);
    expect(layers.get('s0')!.dispose).toHaveBeenCalledTimes(1);
    expect(layers.get('s1')!.dispose).toHaveBeenCalledTimes(1);
    expect(layers.get('s5')!.dispose).not.toHaveBeenCalled();
  });

  it('removeScene still frees a kept scene', () => {
    const { comp, layers, frame } = rig(['a', 'b']);
    comp.setWeights({ a: 1 });
    for (let i = 0; i < 30; i++) frame(0.2);
    comp.setWeights({ b: 1 });
    for (let i = 0; i < 60; i++) frame(0.2);
    comp.removeScene('a');
    expect(layers.get('a')!.dispose).toHaveBeenCalledTimes(1);
    expect(comp.isReady('a')).toBe(false);
  });
});

describe('prepare and the fade gate (Slice 16.3)', () => {
  it('prepare initialises a hidden scene and does not draw it', () => {
    const { comp, layers, frame } = rig(['a', 'b']);
    comp.setWeights({ a: 1 });
    for (let i = 0; i < 30; i++) frame(0.2);
    expect(comp.prepare('b')).toBe(true);
    expect(layers.get('b')!.init).toHaveBeenCalledTimes(1);
    expect(comp.getWeight('b')).toBe(0);
    frame(0.2);
    expect(layers.get('b')!.draw).not.toHaveBeenCalled();
    expect(layers.get('b')!.init).toHaveBeenCalledTimes(1);
  });

  it('prepare is a no-op for unknown scenes, before init, and when already ready', () => {
    const { comp, layers } = rig(['a']);
    expect(comp.prepare('nope')).toBe(false);
    expect(comp.prepare('a')).toBe(true);
    expect(comp.prepare('a')).toBe(true);
    expect(layers.get('a')!.init).toHaveBeenCalledTimes(1);
    expect(new Compositor([mk('x')]).prepare('x')).toBe(false);
  });

  it('a prepared scene starts its fade on the first frame', () => {
    const { comp, frame } = rig(['a', 'b']);
    comp.setWeights({ a: 1 });
    for (let i = 0; i < 30; i++) frame(0.2);
    comp.prepare('b');
    comp.setWeights({ b: 1 });
    frame(0.05);
    expect(comp.getWeight('b')).toBeGreaterThan(0);
  });

  it('an unprepared scene is initialised first and the fade starts on the following frame', () => {
    const { comp, layers, frame } = rig(['a', 'b']);
    comp.setWeights({ a: 1 });
    for (let i = 0; i < 30; i++) frame(0.2);
    const wBefore = comp.getWeight('a');
    comp.setWeights({ b: 1 });
    frame(0.05);
    expect(layers.get('b')!.init).toHaveBeenCalledTimes(1);
    expect(comp.getWeight('b')).toBe(0);
    expect(comp.getWeight('a')).toBe(wBefore);
    frame(0.05);
    expect(comp.getWeight('b')).toBeGreaterThan(0);
    expect(comp.getWeight('a')).toBeLessThan(wBefore);
  });

  it('a prepared scene counts as the newest, so it is not the first one dropped', () => {
    const names = ['s0', 's1', 's2', 's3', 's4', 's5'];
    const { comp, frame } = rig(names);
    for (const n of names.slice(0, 5)) {
      comp.setWeights({ [n]: 1 });
      for (let i = 0; i < 40; i++) frame(0.2);
    }
    comp.prepare('s5');
    frame(0.2);
    expect(comp.isReady('s5')).toBe(true);
  });
});
