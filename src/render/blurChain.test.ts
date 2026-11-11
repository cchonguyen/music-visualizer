import { describe, it, expect, vi } from 'vitest';
import { BlurChain, BLUR_IDLE_FRAMES, BLUR_LEVELS, blurLevelSize, bloomPlan } from './blurChain';

function mockGl() {
  let n = 0;
  const gl = {
    TEXTURE_2D: 0x0de1, FRAMEBUFFER: 0x8d40, COLOR_ATTACHMENT0: 0x8ce0, FRAMEBUFFER_COMPLETE: 0x8cd5,
    RGBA: 0x1908, RGBA8: 0x8058, UNSIGNED_BYTE: 0x1401, LINEAR: 0x2601,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, CLAMP_TO_EDGE: 0x812f,
    checkFramebufferStatus: vi.fn().mockReturnValue(0x8cd5),
    createTexture: vi.fn().mockImplementation(() => ({ tex: n++ })),
    createFramebuffer: vi.fn().mockImplementation(() => ({ fb: n++ })),
    deleteTexture: vi.fn(), deleteFramebuffer: vi.fn(),
    bindTexture: vi.fn(), bindFramebuffer: vi.fn(), texParameteri: vi.fn(), texImage2D: vi.fn(), framebufferTexture2D: vi.fn(),
    invalidateFramebuffer: vi.fn(),
  };
  return gl as unknown as WebGL2RenderingContext & typeof gl;
}

interface PassCall { src: WebGLTexture; stepX: number; stepY: number; width: number; height: number }
function recorder() {
  const calls: PassCall[] = [];
  const pass = (src: WebGLTexture, stepX: number, stepY: number, target: { width: number; height: number }) => {
    calls.push({ src, stepX, stepY, width: target.width, height: target.height });
  };
  return { calls, pass: pass as unknown as Parameters<BlurChain['build']>[0] };
}

describe('blurLevelSize', () => {
  it('halves each level and never goes below 1', () => {
    expect(blurLevelSize(64, 36, 0)).toEqual({ width: 64, height: 36 });
    expect(blurLevelSize(64, 36, 1)).toEqual({ width: 32, height: 18 });
    expect(blurLevelSize(64, 36, 2)).toEqual({ width: 16, height: 9 });
    expect(blurLevelSize(3, 1, 2)).toEqual({ width: 1, height: 1 });
  });
});

describe('BlurChain: built only when something asks', () => {
  it('allocates nothing and builds nothing until a level is requested', () => {
    const gl = mockGl();
    const chain = new BlurChain(gl, 64, 36);
    const { calls, pass } = recorder();
    expect(gl.createTexture).not.toHaveBeenCalled();
    expect(chain.levelsWanted).toBe(0);
    chain.build(pass);
    expect(calls).toHaveLength(0);
    expect(chain.texture(0)).toBeNull();
  });

  it('level 0 is two passes (across, then down) at its own size, and its texture is valid after build', () => {
    const gl = mockGl();
    const chain = new BlurChain(gl, 64, 36);
    const { calls, pass } = recorder();
    chain.request(0);
    chain.sourceTarget();
    chain.build(pass);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ stepX: 1 / 64, stepY: 0, width: 64, height: 36 });
    expect(calls[1]).toMatchObject({ stepX: 0, stepY: 1 / 36, width: 64, height: 36 });
    expect(chain.texture(0)).not.toBeNull();
    expect(chain.texture(1)).toBeNull();
    expect(chain.levelsAllocated).toBe(1);
  });

  it('a request for level 2 builds 0, 1 and 2, each from the one above, at half the size each time', () => {
    const gl = mockGl();
    const chain = new BlurChain(gl, 64, 36);
    const { calls, pass } = recorder();
    chain.request(2);
    chain.sourceTarget();
    chain.build(pass);
    expect(calls.map((c) => [c.width, c.height])).toEqual([[64, 36], [64, 36], [32, 18], [32, 18], [16, 9], [16, 9]]);
    // Level 1 starts from level 0's finished picture, level 2 from level 1's.
    expect(calls[2]!.src).toBe(chain.texture(0));
    expect(calls[4]!.src).toBe(chain.texture(1));
    expect(chain.levelsAllocated).toBe(BLUR_LEVELS);
  });

  it('skips levels nothing asked for this frame', () => {
    const gl = mockGl();
    const chain = new BlurChain(gl, 64, 36);
    chain.request(2);
    chain.sourceTarget();
    chain.build(recorder().pass);
    chain.endFrame();
    const { calls, pass } = recorder();
    chain.request(0);
    chain.sourceTarget();
    chain.build(pass);
    expect(calls).toHaveLength(2);
    expect(chain.texture(1)).toBeNull();
  });

  it('a texture is only valid for the frame it was built in', () => {
    const chain = new BlurChain(mockGl(), 16, 16);
    chain.request(0);
    chain.sourceTarget();
    chain.build(recorder().pass);
    chain.endFrame();
    expect(chain.texture(0)).toBeNull();
  });

  it('invalidates the across-blur buffer of every level it builds', () => {
    const gl = mockGl();
    const chain = new BlurChain(gl, 64, 36);
    chain.request(1);
    chain.sourceTarget();
    chain.build(recorder().pass);
    expect(gl.invalidateFramebuffer).toHaveBeenCalledTimes(2);
    expect(gl.invalidateFramebuffer).toHaveBeenCalledWith(gl.FRAMEBUFFER, [gl.COLOR_ATTACHMENT0]);
  });

  it('frees a level that has not been requested for a while, and keeps one that is still in use', () => {
    const gl = mockGl();
    const chain = new BlurChain(gl, 64, 36);
    chain.request(1);
    chain.endFrame();
    for (let i = 0; i < BLUR_IDLE_FRAMES + 1; i++) {
      chain.request(0);
      chain.endFrame();
    }
    expect(chain.levelsAllocated).toBe(1);
    expect(gl.deleteTexture).toHaveBeenCalled();
  });

  it('resize changes the size of levels that exist, and later levels follow the new size', () => {
    const gl = mockGl();
    const chain = new BlurChain(gl, 64, 36);
    chain.request(0);
    chain.resize(32, 18);
    const { calls, pass } = recorder();
    chain.request(1);
    chain.sourceTarget();
    chain.build(pass);
    expect(calls.map((c) => [c.width, c.height])).toEqual([[32, 18], [32, 18], [16, 9], [16, 9]]);
  });

  it('dispose releases every level', () => {
    const chain = new BlurChain(mockGl(), 64, 36);
    chain.request(2);
    chain.dispose();
    expect(chain.levelsAllocated).toBe(0);
    expect(chain.levelsWanted).toBe(0);
  });
});

describe('bloomPlan (Slice 18.7)', () => {
  it('0 is the original glow: level 0, usual spread, all weight on the half-size blur', () => {
    expect(bloomPlan(0)).toEqual({ level: 0, spread: 1, weights: [1, 0, 0] });
  });

  it('negative sizes tighten the half-size blur and never ask for deeper levels', () => {
    expect(bloomPlan(-1)).toEqual({ level: 0, spread: 0.5, weights: [1, 0, 0] });
    expect(bloomPlan(-0.5).spread).toBeCloseTo(0.75, 6);
  });

  it('0 to 1 fades from half to quarter size, 1 to 2 from quarter to eighth, and the weights always add to 1', () => {
    expect(bloomPlan(0.25)).toEqual({ level: 1, spread: 1, weights: [0.75, 0.25, 0] });
    expect(bloomPlan(1)).toEqual({ level: 1, spread: 1, weights: [0, 1, 0] });
    expect(bloomPlan(1.5)).toEqual({ level: 2, spread: 1, weights: [0, 0.5, 0.5] });
    expect(bloomPlan(2)).toEqual({ level: 2, spread: 1, weights: [0, 0, 1] });
    for (let s = -1; s <= 2; s += 0.1) expect(bloomPlan(s).weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it('clamps out-of-range and bad values', () => {
    expect(bloomPlan(9).level).toBe(2);
    expect(bloomPlan(-9).spread).toBe(0.5);
    expect(bloomPlan(NaN)).toEqual({ level: 0, spread: 1, weights: [1, 0, 0] });
  });

  it('fills the object it is given', () => {
    const out = { level: 0, spread: 1, weights: [1, 0, 0] as [number, number, number] };
    expect(bloomPlan(1.5, out)).toBe(out);
    expect(out.level).toBe(2);
  });
});

describe('BlurChain spread (Slice 18.7)', () => {
  it('spread tightens level 0 only', () => {
    const chain = new BlurChain(mockGl(), 64, 36);
    const { calls, pass } = recorder();
    chain.request(1);
    chain.sourceTarget();
    chain.build(pass, 0.5);
    expect(calls[0]!.stepX).toBeCloseTo(0.5 / 64, 9);
    expect(calls[1]!.stepY).toBeCloseTo(0.5 / 36, 9);
    expect(calls[2]!.stepX).toBeCloseTo(1 / 32, 9);
    expect(calls[3]!.stepY).toBeCloseTo(1 / 18, 9);
  });
});
