import { describe, it, expect, vi } from 'vitest';
import { ProgramCache, getProgramCache } from './programCache';

function fakeGl(o: { parallel?: boolean; complete?: () => boolean; linkOk?: boolean } = {}) {
  const live = new Set<object>();
  let nextId = 0;
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => {
      const p = { id: nextId++ };
      live.add(p);
      return p;
    }),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn((_p: unknown, name: number) =>
      name === 0x91b1 ? (o.complete ? o.complete() : true) : o.linkOk !== false,
    ),
    getProgramInfoLog: vi.fn(() => 'bad'),
    deleteProgram: vi.fn((p: object) => live.delete(p)),
    isProgram: vi.fn((p: object) => live.has(p)),
    getExtension: vi.fn((n: string) => (n === 'KHR_parallel_shader_compile' && o.parallel ? { COMPLETION_STATUS_KHR: 0x91b1 } : null)),
    /** Simulates a context loss and restore: every old program becomes invalid. */
    loseAll: () => live.clear(),
  };
  return gl as unknown as WebGL2RenderingContext & typeof gl;
}

describe('ProgramCache', () => {
  it('compiles a pair of sources once and shares the program', () => {
    const gl = fakeGl();
    const c = new ProgramCache(gl);
    const a = c.acquire('v', 'f', 'a');
    const b = c.acquire('v', 'f', 'b');
    expect(b).toBe(a);
    expect(gl.createProgram).toHaveBeenCalledTimes(1);
    expect(c.stats()).toMatchObject({ entries: 1, hits: 1, misses: 1 });
  });

  it('keys by source, so different sources get different programs', () => {
    const gl = fakeGl();
    const c = new ProgramCache(gl);
    expect(c.acquire('v', 'f1')).not.toBe(c.acquire('v', 'f2'));
    expect(gl.createProgram).toHaveBeenCalledTimes(2);
  });

  it('keeps a released program so the next scene compiles nothing', () => {
    const gl = fakeGl();
    const c = new ProgramCache(gl);
    const a = c.acquire('v', 'f');
    c.release(a);
    expect(gl.deleteProgram).not.toHaveBeenCalled();
    expect(c.acquire('v', 'f')).toBe(a);
    expect(gl.createProgram).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used idle programs past the cap, never one in use', () => {
    const gl = fakeGl();
    const c = new ProgramCache(gl, 2);
    const held = c.acquire('v', 'held');
    const first = c.acquire('v', 'one');
    const second = c.acquire('v', 'two');
    const third = c.acquire('v', 'three');
    c.release(first);
    c.release(second);
    c.release(third);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.deleteProgram).toHaveBeenCalledWith(first);
    expect(gl.deleteProgram).not.toHaveBeenCalledWith(held);
    expect(c.stats().entries).toBe(3);
  });

  it('rebuilds a program that died with a lost context', () => {
    const gl = fakeGl();
    const c = new ProgramCache(gl);
    const old = c.acquire('v', 'f');
    gl.loseAll();
    const fresh = c.acquire('v', 'f');
    expect(fresh).not.toBe(old);
    expect(gl.createProgram).toHaveBeenCalledTimes(2);
  });

  it('throws on a broken program and does not keep it', () => {
    const gl = fakeGl({ linkOk: false });
    const c = new ProgramCache(gl);
    expect(() => c.acquire('v', 'f', 'broken')).toThrow('broken');
    expect(c.stats().entries).toBe(0);
  });

  it('release of an unknown program is harmless', () => {
    const c = new ProgramCache(fakeGl());
    expect(() => c.release({} as WebGLProgram)).not.toThrow();
  });

  describe('prewarm', () => {
    it('finishes at once without the parallel compile extension', () => {
      const gl = fakeGl();
      const c = new ProgramCache(gl);
      c.prewarm('v', 'f');
      expect(c.isReady('v', 'f')).toBe(true);
      const getsBefore = gl.getProgramParameter.mock.calls.length;
      c.acquire('v', 'f');
      expect(gl.getProgramParameter.mock.calls.length).toBe(getsBefore);
      expect(gl.createProgram).toHaveBeenCalledTimes(1);
    });

    it('does not read the link status while the driver is still working', () => {
      let done = false;
      const gl = fakeGl({ parallel: true, complete: () => done });
      const c = new ProgramCache(gl);
      c.prewarm('v', 'f');
      expect(c.isReady('v', 'f')).toBe(false);
      const linkReads = () => gl.getProgramParameter.mock.calls.filter((call) => call[1] === 4).length;
      expect(linkReads()).toBe(0);
      done = true;
      expect(c.isReady('v', 'f')).toBe(true);
      c.acquire('v', 'f');
      expect(linkReads()).toBe(1);
      expect(gl.createProgram).toHaveBeenCalledTimes(1);
    });

    it('is not ready for sources it has never seen', () => {
      expect(new ProgramCache(fakeGl()).isReady('v', 'f')).toBe(false);
    });

    it('swallows a failed background compile and reports it on acquire', () => {
      const gl = fakeGl({ linkOk: false });
      const c = new ProgramCache(gl);
      expect(() => c.prewarm('v', 'f', 'broken')).not.toThrow();
      expect(() => c.acquire('v', 'f', 'broken')).toThrow('broken');
    });

    it('does nothing when the program is cached already', () => {
      const gl = fakeGl();
      const c = new ProgramCache(gl);
      c.acquire('v', 'f');
      c.prewarm('v', 'f');
      expect(gl.createProgram).toHaveBeenCalledTimes(1);
    });
  });

  it('clear deletes every program', () => {
    const gl = fakeGl();
    const c = new ProgramCache(gl);
    c.acquire('v', 'a');
    c.acquire('v', 'b');
    c.clear();
    expect(gl.deleteProgram).toHaveBeenCalledTimes(2);
    expect(c.stats().entries).toBe(0);
  });
});

describe('getProgramCache', () => {
  it('returns one cache per context', () => {
    const a = fakeGl();
    const b = fakeGl();
    expect(getProgramCache(a)).toBe(getProgramCache(a));
    expect(getProgramCache(a)).not.toBe(getProgramCache(b));
  });
});
