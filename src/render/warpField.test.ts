import { describe, it, expect, vi } from 'vitest';
import { WarpField, curlExtras, foldIterations, warpFieldSize, activeWarpOpCount, isActiveWarpOp, WARP_FIELD_WIDTH, WARP_FIELD_HEIGHT, type ResolvedWarpOp } from './warpField';
import warpFieldSrc from './shaders/warpField.frag.glsl?raw';
import feedbackSrc from './shaders/feedback.frag.glsl?raw';
import { WARP_OP_TYPES } from '../presets/warpOps';

const op = (type: ResolvedWarpOp['type'], amount: number, enabled = true, extra: Record<string, number> = {}): ResolvedWarpOp => ({
  type,
  enabled,
  values: { amount, scale: 1, speed: 0.2, centreX: 0, centreY: 0, ...extra },
});

function mockGl() {
  const gl = {
    TEXTURE_2D: 0x0de1, FRAMEBUFFER: 0x8d40, COLOR_ATTACHMENT0: 0x8ce0, FRAMEBUFFER_COMPLETE: 0x8cd5,
    RGBA: 0x1908, RGBA8: 0x8058, UNSIGNED_BYTE: 0x1401, LINEAR: 0x2601, BLEND: 0x0be2, TRIANGLES: 4,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, CLAMP_TO_EDGE: 0x812f,
    getExtension: vi.fn().mockReturnValue(null),
    checkFramebufferStatus: vi.fn().mockReturnValue(0x8cd5),
    compileShader: vi.fn(), shaderSource: vi.fn(), attachShader: vi.fn(), linkProgram: vi.fn(), deleteProgram: vi.fn(), deleteShader: vi.fn(),
    getShaderParameter: vi.fn().mockReturnValue(true),
    getProgramParameter: vi.fn().mockReturnValue(true),
    createShader: vi.fn().mockReturnValue({}),
    createProgram: vi.fn().mockReturnValue({}),
    createTexture: vi.fn().mockImplementation(() => ({})),
    createFramebuffer: vi.fn().mockImplementation(() => ({})),
    deleteTexture: vi.fn(), deleteFramebuffer: vi.fn(),
    bindTexture: vi.fn(), bindFramebuffer: vi.fn(), bindVertexArray: vi.fn(), useProgram: vi.fn(),
    texParameteri: vi.fn(), texImage2D: vi.fn(), framebufferTexture2D: vi.fn(),
    drawArrays: vi.fn(), disable: vi.fn(), viewport: vi.fn(),
    getUniformLocation: vi.fn().mockImplementation((_p: unknown, name: string) => ({ name })),
    uniform1i: vi.fn(), uniform1f: vi.fn(), uniform1iv: vi.fn(), uniform1fv: vi.fn(), uniform2fv: vi.fn(), uniform3fv: vi.fn(),
    isContextLost: vi.fn().mockReturnValue(false),
  };
  return gl as unknown as WebGL2RenderingContext & typeof gl;
}

describe('warpFieldSize', () => {
  it('starts at 64 by 36 and shrinks with the render scale', () => {
    expect(warpFieldSize(1)).toEqual({ width: WARP_FIELD_WIDTH, height: WARP_FIELD_HEIGHT });
    expect(warpFieldSize(0.75).width).toBeLessThan(WARP_FIELD_WIDTH);
    expect(warpFieldSize(0.5).width).toBeLessThan(warpFieldSize(0.75).width);
    expect(warpFieldSize(0.25)).toEqual({ width: 32, height: 18 });
  });
});

describe('active operators', () => {
  it('skips disabled operators and amount 0', () => {
    expect(isActiveWarpOp(op('radial', 0.5))).toBe(true);
    expect(isActiveWarpOp(op('radial', 0))).toBe(false);
    expect(isActiveWarpOp(op('radial', 0.5, false))).toBe(false);
  });

  it('counts at most four', () => {
    const ops = [op('radial', 1), op('swirl', 1), op('ripple', 0), op('stripes', 1), op('radial', 1), op('swirl', 1)];
    expect(activeWarpOpCount(ops)).toBe(4);
    expect(activeWarpOpCount([])).toBe(0);
  });
});

describe('WarpField.update', () => {
  const make = () => {
    const gl = mockGl();
    return { gl, field: new WarpField(gl, {} as WebGLVertexArrayObject, 1) };
  };

  it('draws nothing and touches no GPU state when no operator is active', () => {
    const { gl, field } = make();
    gl.bindFramebuffer.mockClear();
    expect(field.update([], 0, 1 / 60, 16 / 9)).toBe(false);
    expect(field.update([op('radial', 0), op('swirl', 1, false)], 0, 1 / 60, 16 / 9)).toBe(false);
    expect(gl.drawArrays).not.toHaveBeenCalled();
    expect(gl.bindFramebuffer).not.toHaveBeenCalled();
    expect(field.ready).toBe(false);
  });

  it('draws one pass with the packed operators', () => {
    const { gl, field } = make();
    const ok = field.update([op('radial', 0.5), op('ripple', 0), op('stripes', -0.25, true, { scale: 3, centreX: 0.1, centreY: -0.2 })], 2, 1 / 60, 2);
    expect(ok).toBe(true);
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);
    expect(gl.uniform1i).toHaveBeenCalledWith({ name: 'uOpCount' }, 2);
    const types = gl.uniform1iv.mock.calls[0]![1] as Int32Array;
    expect([types[0], types[1]]).toEqual([WARP_OP_TYPES.indexOf('radial'), WARP_OP_TYPES.indexOf('stripes')]);
    const amounts = gl.uniform1fv.mock.calls[0]![1] as Float32Array;
    expect([amounts[0], amounts[1]]).toEqual([0.5, -0.25]);
    const centres = gl.uniform2fv.mock.calls[0]![1] as Float32Array;
    expect(centres[2]).toBeCloseTo(0.1, 5);
    expect(centres[3]).toBeCloseTo(-0.2, 5);
    expect(field.ready).toBe(true);
  });

  it('size follows the render scale', () => {
    const { gl, field } = make();
    gl.texImage2D.mockClear();
    field.setRenderScale(0.5);
    expect(gl.texImage2D).toHaveBeenCalled();
    expect(gl.texImage2D.mock.calls[0]![3]).toBe(32);
  });
});

describe('curl noise operator (Slice 18.5)', () => {
  it('reads octaves, turbulence and flow style into the numbers the shader uses', () => {
    expect(curlExtras({})).toEqual([2, 0.45, 0]);
    expect(curlExtras({ octaves: 3, turbulence: 0.9, flow: 'inflow' })).toEqual([3, 0.9, 3]);
    expect(curlExtras({ octaves: 9, turbulence: 4, flow: 'eddies' })).toEqual([3, 1, 1]);
    expect(curlExtras({ octaves: 0, turbulence: -1, flow: 'nope' })).toEqual([1, 0, 0]);
  });

  it('packs the curl settings and the treble level into the field pass', () => {
    const gl = mockGl();
    const field = new WarpField(gl, {} as WebGLVertexArrayObject, 1);
    const curl = op('curl', 0.6, true, { octaves: 3, turbulence: 0.5 });
    curl.values.flow = 'outflow';
    expect(field.update([op('radial', 0.5), curl], 1, 1 / 60, 2, 0.8)).toBe(true);
    const extras = gl.uniform3fv.mock.calls[0]![1] as Float32Array;
    expect(Array.from(extras.slice(0, 6))).toEqual([0, 0, 0, 3, 0.5, 2]);
    expect(gl.uniform1f).toHaveBeenCalledWith({ name: 'uHigh' }, 0.8);
  });
});

describe('fractal fold operator (Slice 20.2)', () => {
  it('reads iterations from the setting and caps them by render scale', () => {
    expect(foldIterations({}, 1)).toBe(4);
    expect(foldIterations({ iterations: 6 }, 1)).toBe(6);
    expect(foldIterations({ iterations: 6 }, 0.7)).toBe(4);
    expect(foldIterations({ iterations: 6 }, 0.4)).toBe(3);
    expect(foldIterations({ iterations: 99 }, 1)).toBe(6);
    expect(foldIterations({ iterations: 0 }, 1)).toBe(3);
  });

  it('sends the capped iteration count to the field pass', () => {
    const gl = mockGl();
    const field = new WarpField(gl, {} as WebGLVertexArrayObject, 0.7);
    expect(field.update([op('fold', 0.5, true, { iterations: 6 })], 1, 1 / 60, 1)).toBe(true);
    const extras = gl.uniform3fv.mock.calls[0]![1] as Float32Array;
    expect(extras[0]).toBe(4);
  });
});

describe('shaders', () => {
  it('the field shader handles every operator type', () => {
    for (let i = 0; i < WARP_OP_TYPES.length; i++) expect(warpFieldSrc).toContain(`type == ${i}`);
  });

  it('the feedback shader skips the lookup when the field is off', () => {
    expect(feedbackSrc).toMatch(/if \(uWarpFieldOn > 0\.5\) \{\s*p \+= texture\(uField, vUv\)\.rg - 0\.5;/);
  });
});
