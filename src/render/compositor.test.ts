import { describe, it, expect, vi } from 'vitest';
import { Compositor, RETAIN_MAX_BYTES, RETAIN_MAX_SCENES, aspectBox, retainLimit, sceneBufferBytes } from './compositor';
import { Scene } from './scene';
import type { AudioFrame } from '../audio/types';
import type { RenderLayer, RenderTarget } from './layer';
import compositeSrc from './shaders/composite.frag.glsl?raw';
import postSrc from './shaders/post.frag.glsl?raw';
import copySrc from './shaders/copy.frag.glsl?raw';
import { setAutoScale, setRenderScale } from '../gl/size';

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
    invalidateFramebuffer: vi.fn(),
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

function block(src: string, name: string): string {
  const a = src.indexOf(`// @${name}-begin`);
  const b = src.indexOf(`// @${name}-end`);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return src.slice(a, b);
}

describe('shader copies stay in step (Slice 16.4)', () => {
  it('the blend block is the same in composite.frag and post.frag', () => {
    expect(block(postSrc, 'blend')).toBe(block(compositeSrc, 'blend'));
  });
  it('the safety block is the same in composite.frag and post.frag', () => {
    expect(block(postSrc, 'safety')).toBe(block(compositeSrc, 'safety'));
  });
  it('post.frag applies the safety rules last, after bloom and vignette, and clamps first', () => {
    const main = postSrc.slice(postSrc.indexOf('void main()'));
    const safety = main.indexOf('applySafety(c)');
    expect(safety).toBeGreaterThan(main.indexOf('uBloomAmt'));
    expect(safety).toBeGreaterThan(main.indexOf('uVignette'));
    expect(main.indexOf('clamp(c, 0.0, 1.0)')).toBeLessThan(safety);
    expect(main.indexOf('outColor')).toBeGreaterThan(safety);
    expect(main.slice(safety)).not.toMatch(/c\s*[*+\-]?=/);
  });
  it('post.frag has no switch that turns the safety rules off', () => {
    expect(postSrc).not.toContain('uSafety');
  });
});

/** A gl mock whose programs are distinct, so uniform calls can be traced to the program that got them. */
function createTracingGl() {
  const gl = createMockGl() as unknown as Record<string, unknown>;
  let id = 0;
  const progOf = new Map<unknown, number>();
  gl.createProgram = vi.fn(() => {
    const p = { id: id++ };
    progOf.set(p, p.id);
    return p;
  });
  gl.getUniformLocation = vi.fn((prog: unknown, name: string) => ({ name, prog }));
  const uniforms: { name: string; value: number; prog: unknown }[] = [];
  gl.uniform1f = vi.fn((loc: { name: string; prog: unknown } | null, value: number) => {
    if (loc) uniforms.push({ name: loc.name, value, prog: loc.prog });
  });
  const used: unknown[] = [];
  gl.useProgram = vi.fn((p: unknown) => used.push(p));
  return { gl: gl as unknown as WebGL2RenderingContext, uniforms, used };
}

describe('scene textures are read clamped (Slice 16.7)', () => {
  it('both blend copies read scene textures only through the clamping helper', () => {
    for (const src of [compositeSrc, postSrc]) {
      const withoutHelper = src.replace(/vec3 sceneAt\(sampler2D s, vec2 uv\) \{[\s\S]*?\n\}/, '');
      expect(withoutHelper).not.toMatch(/texture\(u[AB],/);
      expect(src).toContain('min(texture(s, uv).rgb, vec3(1.0))');
    }
  });

  it('a half-float scene counts for more memory than an 8-bit one, so fewer are kept on a big canvas', () => {
    expect(sceneBufferBytes(1000, 500, 1, 'rgba16f')).toBe(1000 * 500 * 20);
    expect(sceneBufferBytes(1000, 500, 1, 'rgba8')).toBe(1000 * 500 * 12);
    expect(retainLimit(3840, 2160, 1, 'rgba16f')).toBeLessThanOrEqual(retainLimit(3840, 2160, 1, 'rgba8'));
  });
});

describe('final pass count (Slice 16.4)', () => {
  function setup(post: Record<string, number>) {
    const t = createTracingGl();
    const layer = spyLayer();
    const comp = new Compositor([new Scene('a', [layer])]);
    comp.init(t.gl);
    comp.resize(64, 36, 1);
    comp.setPost(post);
    comp.setWeights({ a: 1 });
    for (let i = 0; i < 3; i++) comp.draw(FRAME, clock(0.1), TARGET);
    // Look at one frame only.
    t.uniforms.length = 0;
    comp.draw(FRAME, clock(0.1), TARGET);
    return { ...t, comp };
  }
  const capPasses = (u: { name: string }[]) => u.filter((x) => x.name === 'uCap').length;

  it('a preset with no post effect runs one blend-and-safety pass', () => {
    const { uniforms, comp } = setup({});
    expect(comp.hasPost()).toBe(false);
    expect(capPasses(uniforms)).toBe(1);
  });

  it('a preset with post effects runs one pass, not three', () => {
    const { uniforms, comp } = setup({ saturation: 1.4, vignette: 0.3 });
    expect(comp.hasPost()).toBe(true);
    expect(capPasses(uniforms)).toBe(1);
    expect(uniforms.some((x) => x.name === 'uSat')).toBe(true);
  });

  it('the post pass is the last program used in the frame, so safety is last', () => {
    const { used, uniforms } = setup({ saturation: 1.4 });
    const hue = uniforms.find((x) => x.name === 'uHue')!;
    expect(used[used.length - 1]).toBe(hue.prog);
  });

  it('bloom adds one half-size blend ahead of the single full-size pass', () => {
    const { uniforms } = setup({ bloom: 0.5 });
    const caps = uniforms.filter((x) => x.name === 'uCap');
    expect(caps).toHaveLength(2);
    // The half-size blend (composite program) has safety off; the final pass (post program) is the one with uHue.
    const safetyOff = uniforms.filter((x) => x.name === 'uSafety' && x.value === 0);
    expect(safetyOff).toHaveLength(1);
    const hue = uniforms.find((x) => x.name === 'uHue')!;
    expect(uniforms.filter((x) => x.name === 'uCap' && x.prog === hue.prog)).toHaveLength(1);
  });
});

describe('render scale covers the whole chain (Slice 16.5)', () => {
  /** Draws one frame and returns, in order, the fragment source of each program used. */
  function frameWith(post: Record<string, number>, opts: { scale?: number; auto?: number }) {
    setRenderScale(opts.scale ?? 1);
    setAutoScale(opts.auto ?? 1);
    try {
      const gl = createMockGl() as unknown as Record<string, unknown>;
      const fragOf = new Map<unknown, string>();
      const shaderSrc = new Map<unknown, string>();
      gl.createShader = vi.fn(() => ({}));
      gl.shaderSource = vi.fn((sh: unknown, src: string) => shaderSrc.set(sh, src));
      gl.createProgram = vi.fn(() => ({}));
      gl.attachShader = vi.fn((p: unknown, sh: unknown) => {
        const src = shaderSrc.get(sh) ?? '';
        if (!src.includes('gl_VertexID')) fragOf.set(p, src);
      });
      const used: string[] = [];
      gl.useProgram = vi.fn((p: unknown) => used.push(fragOf.get(p) ?? ''));
      const viewports: number[][] = [];
      gl.viewport = vi.fn((...a: number[]) => viewports.push(a));
      const comp = new Compositor([new Scene('a', [spyLayer()])]);
      comp.init(gl as unknown as WebGL2RenderingContext);
      comp.resize(64, 36, 1);
      comp.setPost(post);
      comp.setWeights({ a: 1 });
      for (let i = 0; i < 3; i++) comp.draw(FRAME, clock(0.1), TARGET);
      used.length = 0;
      viewports.length = 0;
      comp.draw(FRAME, clock(0.1), TARGET);
      return { used, viewports, comp };
    } finally {
      setRenderScale(1);
      setAutoScale(1);
    }
  }

  it('at 100% there is no copy pass: the final pass draws straight to the canvas', () => {
    const { used, viewports } = frameWith({ saturation: 1.3 }, {});
    expect(used.some((u) => u === copySrc)).toBe(false);
    expect(viewports[viewports.length - 1]).toEqual([0, 0, 64, 36]);
  });

  it('at 50% the final pass runs at half size and one copy pass upscales it', () => {
    const { used, viewports } = frameWith({ saturation: 1.3 }, { scale: 0.5 });
    expect(used[used.length - 1]).toBe(copySrc);
    expect(used.filter((u) => u === copySrc)).toHaveLength(1);
    expect(used[used.length - 2]).toBe(postSrc);
    expect(viewports[viewports.length - 2]).toEqual([0, 0, 32, 18]);
    expect(viewports[viewports.length - 1]).toEqual([0, 0, 64, 36]);
  });

  it('the no-post path is scaled the same way', () => {
    const { used, viewports } = frameWith({}, { scale: 0.75 });
    expect(used[used.length - 1]).toBe(copySrc);
    expect(used[used.length - 2]).toBe(compositeSrc);
    expect(viewports[viewports.length - 2]).toEqual([0, 0, 48, 27]);
  });

  it('automatic scaling below the owner ceiling scales the chain, at a size the three steps do not offer', () => {
    const { used, viewports } = frameWith({ saturation: 1.3 }, { scale: 1, auto: 0.6 });
    expect(used[used.length - 1]).toBe(copySrc);
    expect(viewports[viewports.length - 2]).toEqual([0, 0, 38, 22]);
  });

  it('the safety pass is still the last blend-or-post program before the copy', () => {
    const { used } = frameWith({ bloom: 0.5 }, { scale: 0.5 });
    expect(used[used.length - 1]).toBe(copySrc);
    expect(used[used.length - 2]).toBe(postSrc);
  });
});

describe('no per-frame lookups or rebuilds (Slice 16.8)', () => {
  it('looks up the calm checkbox once, not on every frame', () => {
    const getElementById = vi.fn(() => ({ checked: false }));
    vi.stubGlobal('document', { getElementById });
    try {
      const { comp } = rig(['a']);
      comp.setWeights({ a: 1 });
      for (let i = 0; i < 6; i++) comp.draw(FRAME, clock(0.1), TARGET);
      expect(getElementById).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('follows the calm checkbox state when it is ticked', () => {
    const box = { checked: false };
    vi.stubGlobal('document', { getElementById: () => box });
    try {
      const { comp } = rig(['a']);
      comp.setWeights({ a: 1 });
      comp.draw(FRAME, clock(0.1), TARGET);
      expect(comp.brightnessLimiter.calm).toBe(false);
      box.checked = true;
      comp.draw(FRAME, clock(0.1), TARGET);
      expect(comp.brightnessLimiter.calm).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('setPost keeps values given and returns the rest to identity, in place', () => {
    const c = new Compositor([]);
    c.setPost({ saturation: 1.5, bloom: 0.4 });
    expect(c.hasPost()).toBe(true);
    c.setPost({ saturation: 1.5 });
    expect(c.hasPost()).toBe(true);
    c.setPost({});
    expect(c.hasPost()).toBe(false);
    c.setPost({ vignette: 0.2, junk: 5, saturation: 'x' as unknown as number });
    expect(c.hasPost()).toBe(true);
  });

  it('setDirectorState copies its input: changing the source afterwards changes nothing', () => {
    const c = new Compositor([]);
    const cam = { panX: 0.1, panY: 0, zoom: 1.2, roll: 0, tiltX: 0, tiltY: 0 };
    const col = { shadowTint: [1, 1, 1] as [number, number, number], highlightTint: [1, 1, 1] as [number, number, number], spatialSpread: 0, gradAngle: 0, intensity: 0.5, cycleAngle: 0 };
    c.setDirectorState(cam, col);
    expect(c.hasDirectorEffect()).toBe(true);
    cam.zoom = 1;
    cam.panX = 0;
    col.intensity = 0;
    expect(c.hasDirectorEffect()).toBe(true);
    c.setDirectorState({ panX: 0, panY: 0, zoom: 1, roll: 0, tiltX: 0, tiltY: 0 }, { ...col, intensity: 0 });
    expect(c.hasDirectorEffect()).toBe(false);
  });

  it('a normal frame builds no scene list or weight set: the active list is reused', () => {
    const { comp, frame } = rig(['a', 'b']);
    comp.setWeights({ a: 1 });
    frame();
    const before = (comp as unknown as { activeNames: string[] }).activeNames;
    for (let i = 0; i < 5; i++) frame();
    expect((comp as unknown as { activeNames: string[] }).activeNames).toBe(before);
  });
});

describe('lighter crossfade (Slice 16.11)', () => {
  function crossfade(light: boolean) {
    const r = rig(['a', 'b']);
    r.comp.setLightFade(light);
    r.comp.setFadeSeconds(4);
    r.comp.setWeights({ a: 1 });
    for (let i = 0; i < 80; i++) r.frame(0.1);
    r.comp.setWeights({ b: 1 });
    r.frame(0.1); // gate frame: b is set up
    return r;
  }

  it('is off by default', () => {
    expect(new Compositor([]).isLightFade()).toBe(false);
  });

  it('keeps redrawing the outgoing scene while two scenes blend when it is off', () => {
    const { layers, frame } = crossfade(false);
    const before = layers.get('a')!.draw.mock.calls.length;
    frame(0.1);
    frame(0.1);
    expect(layers.get('a')!.draw.mock.calls.length).toBe(before + 2);
  });

  it('does not redraw the outgoing scene during the blend when it is on, but still draws the incoming one', () => {
    const { layers, frame } = crossfade(true);
    const aBefore = layers.get('a')!.draw.mock.calls.length;
    const bBefore = layers.get('b')!.draw.mock.calls.length;
    frame(0.1);
    frame(0.1);
    expect(layers.get('a')!.draw.mock.calls.length).toBe(aBefore);
    expect(layers.get('b')!.draw.mock.calls.length).toBe(bBefore + 2);
  });

  it('caps the fade length, so the outgoing scene is gone within about a second', () => {
    const light = crossfade(true);
    for (let i = 0; i < 12; i++) light.frame(0.1);
    expect(light.comp.getWeight('a')).toBeLessThan(0.2);
    const full = crossfade(false);
    for (let i = 0; i < 12; i++) full.frame(0.1);
    expect(full.comp.getWeight('a')).toBeGreaterThan(0.5);
  });

  it('a lone scene is always drawn', () => {
    const r = rig(['a']);
    r.comp.setLightFade(true);
    r.comp.setWeights({ a: 1 });
    r.frame(0.1);
    const first = r.layers.get('a')!.draw.mock.calls.length;
    for (let i = 0; i < 4; i++) r.frame(0.1);
    expect(r.layers.get('a')!.draw.mock.calls.length).toBe(first + 4);
  });
});
