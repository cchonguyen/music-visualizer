import { describe, it, expect, vi } from 'vitest';
import { ShaderError, compileProgram, finishProgram, isProgramComplete, numberLines, startProgram } from './shader';

describe('numberLines', () => {
  it('numbers each line from 1 so driver errors like 0:2 are easy to find', () => {
    expect(numberLines('a\nb')).toBe('  1| a\n  2| b');
  });
});

interface FakeOpts {
  compileOk?: boolean;
  linkOk?: boolean;
  parallel?: boolean;
  complete?: boolean;
}

function fakeGl(o: FakeOpts = {}) {
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => o.compileOk !== false),
    getShaderInfoLog: vi.fn(() => 'syntax error'),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn((_p: unknown, name: number) =>
      name === 0x91b1 ? o.complete !== false : o.linkOk !== false,
    ),
    getProgramInfoLog: vi.fn(() => 'link failed'),
    deleteProgram: vi.fn(),
    getExtension: vi.fn((n: string) => (n === 'KHR_parallel_shader_compile' && o.parallel ? { COMPLETION_STATUS_KHR: 0x91b1 } : null)),
  };
  return gl as unknown as WebGL2RenderingContext & typeof gl;
}

describe('startProgram and finishProgram', () => {
  it('starts a compile and link without reading any status', () => {
    const gl = fakeGl();
    startProgram(gl, 'v', 'f', 'p');
    expect(gl.compileShader).toHaveBeenCalledTimes(2);
    expect(gl.linkProgram).toHaveBeenCalledTimes(1);
    expect(gl.getShaderParameter).not.toHaveBeenCalled();
    expect(gl.getProgramParameter).not.toHaveBeenCalled();
  });

  it('reads only the link status when linking works, and frees the shaders', () => {
    const gl = fakeGl();
    const pending = startProgram(gl, 'v', 'f', 'p');
    expect(finishProgram(gl, pending)).toBe(pending.program);
    expect(gl.getShaderParameter).not.toHaveBeenCalled();
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).not.toHaveBeenCalled();
  });

  it('reports a compile failure with the driver log and numbered source', () => {
    const gl = fakeGl({ linkOk: false, compileOk: false });
    expect(() => compileProgram(gl, 'void main(){}', 'bad', 'p')).toThrow(ShaderError);
    try {
      compileProgram(gl, 'void main(){}', 'bad', 'p');
    } catch (e) {
      expect((e as Error).message).toContain('p vertex shader failed to compile');
      expect((e as Error).message).toContain('syntax error');
      expect((e as Error).message).toContain('  1| void main(){}');
    }
    expect(gl.deleteProgram).toHaveBeenCalled();
  });

  it('reports a link failure when both shaders compiled', () => {
    const gl = fakeGl({ linkOk: false });
    expect(() => compileProgram(gl, 'v', 'f', 'p')).toThrow('p failed to link:\nlink failed');
  });

  it('compileProgram returns the linked program', () => {
    const gl = fakeGl();
    expect(compileProgram(gl, 'v', 'f')).toBeTruthy();
  });
});

describe('isProgramComplete', () => {
  it('is always true without KHR_parallel_shader_compile', () => {
    const gl = fakeGl();
    expect(isProgramComplete(gl, startProgram(gl, 'v', 'f'))).toBe(true);
  });

  it('follows the completion status when the extension exists', () => {
    const busy = fakeGl({ parallel: true, complete: false });
    expect(isProgramComplete(busy, startProgram(busy, 'v', 'f'))).toBe(false);
    const done = fakeGl({ parallel: true, complete: true });
    expect(isProgramComplete(done, startProgram(done, 'v', 'f'))).toBe(true);
  });
});
