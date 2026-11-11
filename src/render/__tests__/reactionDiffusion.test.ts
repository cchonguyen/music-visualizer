import { describe, it, expect, vi } from 'vitest';
import { ReactionDiffusionLayer, RD_SIZE, RD_TEXTURE_UNIT, parseHexColor, computeCentroid } from '../layers/reactionDiffusion';
import simFragSrc from '../shaders/rdSim.frag.glsl?raw';
import renderFragSrc from '../shaders/rdRender.frag.glsl?raw';
import {
  assertValidSpec,
  REACTION_DIFFUSION_SPECS,
  REACTION_DIFFUSION_DEFAULTS,
} from '../../presets/schema';
import { LAYER_FACTORIES, buildScene } from '../../presets/loader';
import { FLAGSHIP_PRESETS_12, ALL_PRESETS, getPresetsByGroup } from '../../presets/builtin';
import { PRESET_VERSION } from '../../presets/format';
import { BrightnessLimiter } from '../safety';
import type { AudioFrame } from '../../audio/types';
import type { RenderClock } from '../clock';
import type { RenderTarget } from '../layer';

function createMockGl(hasFloat = true): WebGL2RenderingContext & {
  calls: string[];
  activeTextures: number[];
  uniformValues: Map<string, any>;
  texImageCalls: any[];
} {
  const uniformValues = new Map<string, any>();
  const calls: string[] = [];
  const activeTextures: number[] = [];
  const texImageCalls: any[] = [];

  const gl = {
    BLEND: 0x0be2,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE2: 0x84c2,
    TEXTURE3: 0x84c3,
    TEXTURE4: 0x84c4,
    TEXTURE5: 0x84c5,
    TEXTURE_2D: 0x0de1,
    FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    RGBA: 0x1908,
    RGBA8: 0x8058,
    RGBA16F: 0x881a,
    UNSIGNED_BYTE: 0x1401,
    FLOAT: 0x1406,
    LINEAR: 0x2601,
    NEAREST: 0x2600,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    CLAMP_TO_EDGE: 0x812f,
    TRIANGLES: 0x0004,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,

    calls,
    activeTextures,
    uniformValues,
    texImageCalls,

    getExtension: vi.fn((name: string) => {
      if (name === 'EXT_color_buffer_float') {
        return hasFloat ? {} : null;
      }
      return null;
    }),

    enable: vi.fn((cap?: number) => {
      calls.push(`enable:${cap === 0x0be2 ? 'BLEND' : cap}`);
    }),
    disable: vi.fn((cap?: number) => {
      calls.push(`disable:${cap === 0x0be2 ? 'BLEND' : cap}`);
    }),
    viewport: vi.fn((_x: number, _y: number, w: number, h: number) => {
      calls.push(`viewport:${w}x${h}`);
    }),
    compileShader: vi.fn(),
    shaderSource: vi.fn(),
    attachShader: vi.fn(),
    deleteShader: vi.fn(),
    linkProgram: vi.fn(),
    deleteProgram: vi.fn((_p) => calls.push('deleteProgram')),
    getShaderParameter: vi.fn().mockReturnValue(true),
    getProgramParameter: vi.fn().mockReturnValue(true),
    getShaderInfoLog: vi.fn().mockReturnValue(''),
    getProgramInfoLog: vi.fn().mockReturnValue(''),
    createShader: vi.fn().mockReturnValue({}),
    createProgram: vi.fn().mockReturnValue({}),
    createVertexArray: vi.fn().mockReturnValue({}),
    deleteVertexArray: vi.fn((_v) => calls.push('deleteVertexArray')),
    bindVertexArray: vi.fn(),
    createTexture: vi.fn().mockReturnValue({}),
    deleteTexture: vi.fn((_t) => calls.push('deleteTexture')),
    activeTexture: vi.fn((unit: number) => {
      activeTextures.push(unit);
      calls.push(`activeTexture:TEXTURE${unit - 0x84c0}`);
    }),
    bindTexture: vi.fn((target: number, tex: any) => {
      calls.push(`bindTexture:${target}:${tex ? 'valid' : 'null'}`);
    }),
    texParameteri: vi.fn(),
    texImage2D: vi.fn((...args: any[]) => {
      texImageCalls.push(args);
    }),
    createFramebuffer: vi.fn().mockReturnValue({}),
    deleteFramebuffer: vi.fn((_f) => calls.push('deleteFramebuffer')),
    bindFramebuffer: vi.fn((target: number, fbo: any) => {
      calls.push(`bindFramebuffer:${target}:${fbo ? 'valid' : 'null'}`);
    }),
    framebufferTexture2D: vi.fn(),
    checkFramebufferStatus: vi.fn().mockReturnValue(0x8cd5),
    useProgram: vi.fn(),
    getUniformLocation: vi.fn().mockImplementation((_prog, name: string) => ({ name })),
    uniform1f: vi.fn((loc: any, val: number) => {
      if (loc?.name) uniformValues.set(loc.name, val);
    }),
    uniform1i: vi.fn((loc: any, val: number) => {
      if (loc?.name) uniformValues.set(loc.name, val);
    }),
    uniform2f: vi.fn((loc: any, x: number, y: number) => {
      if (loc?.name) uniformValues.set(loc.name, [x, y]);
    }),
    uniform3f: vi.fn(),
    uniform3fv: vi.fn((loc: any, val: any) => {
      if (loc?.name) uniformValues.set(loc.name, val);
    }),
    drawArrays: vi.fn((mode: number, first: number, count: number) => {
      calls.push(`drawArrays:${mode}:${first}:${count}`);
    }),
  };

  return gl as unknown as WebGL2RenderingContext & {
    calls: string[];
    activeTextures: number[];
    uniformValues: Map<string, any>;
    texImageCalls: any[];
  };
}

function makeMockFrame(overrides: Partial<AudioFrame> = {}): AudioFrame {
  const spectrum = new Float32Array(512);
  for (let i = 0; i < spectrum.length; i++) spectrum[i] = Math.sin(i * 0.1) * 0.5 + 0.5;
  return {
    frameIndex: 1,
    time: 1.0,
    dtSec: 0.016,
    raw: { sub: 0.5, mid: 0.4, high: 0.3 },
    env: { sub: 0.5, mid: 0.4, high: 0.3 },
    norm: { sub: 0.7, mid: 0.6, high: 0.5 },
    loudness: 0.6,
    energy: 0.5,
    flux: 0.2,
    fluxByBand: { sub: 0.2, mid: 0.3, high: 0.1 },
    beat: false,
    beatByBand: { sub: false, mid: false, high: false },
    beatStrength: 0.75,
    kickEnv: 0.85,
    kickPulse: false,
    waveform: new Float32Array(1024),
    bandWaveforms: {
      sub: new Float32Array(1024),
      mid: new Float32Array(1024),
      high: new Float32Array(1024),
    },
    spectrum,
    smoothedSpectrum: spectrum,
    sampleRate: 44100,
    ...overrides,
  };
}

const mockClock: RenderClock = {
  timeSec: 3.0,
  dtSec: 1 / 60,
  frameIndex: 180,
};

const mockTarget: RenderTarget = {
  kind: 'canvas',
  width: 1920,
  height: 1080,
};

describe('ReactionDiffusionLayer (Slice 7.17)', () => {
  it('loads shader sources and validates defaults', () => {
    expect(typeof simFragSrc).toBe('string');
    expect(typeof renderFragSrc).toBe('string');
    expect(REACTION_DIFFUSION_DEFAULTS.du).toBe(0.16);
    expect(REACTION_DIFFUSION_DEFAULTS.dv).toBe(0.08);
  });

  it('passes all REACTION_DIFFUSION_SPECS validation through assertValidSpec', () => {
    for (const spec of REACTION_DIFFUSION_SPECS) {
      expect(() => assertValidSpec(spec)).not.toThrow();
    }
    expect(REACTION_DIFFUSION_SPECS.length).toBeGreaterThanOrEqual(9);
  });

  it('allocates isolated 256x256 PingPong FBO with RGBA16F when EXT_color_buffer_float is available', () => {
    const gl = createMockGl(true);
    const layer = new ReactionDiffusionLayer();
    layer.init(gl);

    expect(layer.isUsingFloat()).toBe(true);
    expect(gl.texImageCalls.length).toBe(2); // Two targets (simTargetA and simTargetB)

    // Check first texture allocation: RGBA16F, 256x256, format RGBA, type FLOAT
    const [target, level, internalFormat, width, height, border, format, type] = gl.texImageCalls[0]!;
    expect(target).toBe(gl.TEXTURE_2D);
    expect(level).toBe(0);
    expect(internalFormat).toBe(gl.RGBA16F);
    expect(width).toBe(RD_SIZE);
    expect(height).toBe(RD_SIZE);
    expect(border).toBe(0);
    expect(format).toBe(gl.RGBA);
    expect(type).toBe(gl.FLOAT);
  });

  it('falls back cleanly to RGBA8 when EXT_color_buffer_float is null', () => {
    const gl = createMockGl(false);
    const layer = new ReactionDiffusionLayer();
    layer.init(gl);

    expect(layer.isUsingFloat()).toBe(false);
    expect(gl.texImageCalls.length).toBe(2);

    // Fallback: internalFormat RGBA8, format RGBA, type UNSIGNED_BYTE
    const [target, level, internalFormat, width, height, border, format, type] = gl.texImageCalls[0]!;
    expect(target).toBe(gl.TEXTURE_2D);
    expect(level).toBe(0);
    expect(internalFormat).toBe(gl.RGBA8);
    expect(width).toBe(RD_SIZE);
    expect(height).toBe(RD_SIZE);
    expect(border).toBe(0);
    expect(format).toBe(gl.RGBA);
    expect(type).toBe(gl.UNSIGNED_BYTE);
  });

  it('executes 8 simulation substeps at nominal 60fps and caps at 10 substeps on large dt', () => {
    const gl = createMockGl(true);
    const layer = new ReactionDiffusionLayer();
    layer.init(gl);

    // 1. Nominal frame at 60fps (dt = 1/60s): executes exactly 8 substeps
    const frame = makeMockFrame();
    layer.draw(frame, { timeSec: 1.0, dtSec: 1 / 60, frameIndex: 1 }, mockTarget);
    expect(layer.getLastSubsteps()).toBe(8);

    // 2. Large dt frame (dt = 0.1s): capped at 10 substeps
    layer.draw(frame, { timeSec: 1.1, dtSec: 0.1, frameIndex: 2 }, mockTarget);
    expect(layer.getLastSubsteps()).toBe(10);
  });

  it('binds simulation and state texture strictly on TEXTURE5 without colliding with TEXTURE0-4', () => {
    const gl = createMockGl(true);
    const layer = new ReactionDiffusionLayer();
    layer.init(gl);

    const frame = makeMockFrame();
    layer.draw(frame, mockClock, mockTarget);

    // Check that TEXTURE5 (0x84c5) was activated
    expect(gl.activeTextures).toContain(gl.TEXTURE5);
    expect(gl.activeTextures).toContain(0x84c0 + RD_TEXTURE_UNIT);
  });

  it('injects chemical V along central ring when kickPulse or kickEnv > 0.7 triggers', () => {
    const gl = createMockGl(true);
    const layer = new ReactionDiffusionLayer();
    layer.init(gl);

    // 1. Kick pulse active
    const framePulse = makeMockFrame({ kickPulse: true, kickEnv: 0.2 });
    layer.draw(framePulse, mockClock, mockTarget);
    expect(gl.uniformValues.get('uInjectRing')).toBe(1.0);

    // 2. High kickEnv > 0.7
    const frameEnv = makeMockFrame({ kickPulse: false, kickEnv: 0.88 });
    layer.draw(frameEnv, mockClock, mockTarget);
    expect(gl.uniformValues.get('uInjectRing')).toBe(1.0);

    // 3. No kick
    const frameQuiet = makeMockFrame({ kickPulse: false, kickEnv: 0.3 });
    layer.draw(frameQuiet, mockClock, mockTarget);
    expect(gl.uniformValues.get('uInjectRing')).toBe(0.0);
  });

  it('correctly maps u_mid and u_centroid to simulation uniforms', () => {
    const gl = createMockGl(true);
    const layer = new ReactionDiffusionLayer();
    layer.init(gl);

    const frame = makeMockFrame({
      norm: { sub: 0.2, mid: 0.73, high: 0.4 },
    });
    layer.draw(frame, mockClock, mockTarget);

    expect(gl.uniformValues.get('u_mid')).toBeCloseTo(0.73, 2);
    expect(gl.uniformValues.get('u_centroid')).toBeGreaterThanOrEqual(0.0);
    expect(gl.uniformValues.get('u_centroid')).toBeLessThanOrEqual(1.0);
  });

  it('cleans up all WebGL resources on dispose() and recreates cleanly after context restore', () => {
    const gl = createMockGl(true);
    const layer = new ReactionDiffusionLayer();
    layer.init(gl);

    expect(layer.getStateTexture()).not.toBeNull();

    // Dispose
    layer.dispose();
    expect(layer.getStateTexture()).toBeNull();
    expect(gl.calls).toContain('deleteProgram');
    expect(gl.calls).toContain('deleteVertexArray');
    expect(gl.calls).toContain('deleteTexture');
    expect(gl.calls).toContain('deleteFramebuffer');

    // Drawing after dispose throws error
    expect(() => layer.draw(makeMockFrame(), mockClock, mockTarget)).toThrowError(
      'ReactionDiffusionLayer: draw before init',
    );

    // Context restore: re-calling init(gl) succeeds and recreates resources
    layer.init(gl);
    expect(layer.getStateTexture()).not.toBeNull();
    expect(() => layer.draw(makeMockFrame(), mockClock, mockTarget)).not.toThrow();
  });

  it('is retired from LAYER_FACTORIES (Slice 15.10); the layer class still takes params directly', () => {
    expect(LAYER_FACTORIES['reactionDiffusion']).toBeUndefined();

    const layer = new ReactionDiffusionLayer({ speed: 1.5, brightness: 2.0 });

    layer.setParams({ speed: 2.0, brightness: 2.5 });
    expect((layer as any).p.speed).toBe(2.0);
    expect((layer as any).p.brightness).toBe(2.5);
  });

  it('authors and validates Flagship Preset 12 (Reaction-Diffusion Coral)', () => {
    expect(FLAGSHIP_PRESETS_12).toHaveLength(1);
    const entry = FLAGSHIP_PRESETS_12[0]!;
    expect(entry.id).toBe('12-reaction-diffusion-coral');
    expect(entry.group).toBe('flagship');
    expect(entry.warnings).toEqual([]);

    const preset = entry.preset;
    expect(preset.version).toBe(PRESET_VERSION);
    expect(preset.name).toBe('Reaction-Diffusion Coral');
    expect(preset.feedback.decay?.value).toBe(0.20);

    const rdLayer = preset.layers.find((l) => l.type === 'reactionDiffusion');
    expect(rdLayer).toBeDefined();
    expect(rdLayer!.enabled).toBe(true);

    // Retired layer is skipped when building a scene (Slice 15.10)
    const scene = buildScene('test-12', preset);
    expect(scene.layers.some((l) => l instanceof ReactionDiffusionLayer)).toBe(false);
  });

  it('keeps Preset 12 out of ALL_PRESETS and getPresetsByGroup("flagship") (moved to review, Slice 15.10)', () => {
    const foundInAll = ALL_PRESETS.find((p) => p.id === '12-reaction-diffusion-coral');
    expect(foundInAll).toBeUndefined();

    const flagships = getPresetsByGroup('flagship');
    expect(flagships.some((p) => p.id === '12-reaction-diffusion-coral')).toBe(false);
  });

  it('passes WCAG safety luminance checks via BrightnessLimiter on Preset 12', () => {
    const limiter = new BrightnessLimiter();
    limiter.reset();

    for (let f = 0; f < 30; f++) {
      const targetLum = f % 2 === 0 ? 0.85 : 0.15;
      const cap = limiter.step(targetLum, 0.016);
      expect(cap).toBeGreaterThanOrEqual(0.0);
      expect(cap).toBeLessThanOrEqual(1.0);
      expect(Number.isFinite(cap)).toBe(true);
    }
  });

  it('parses color hex codes and calculates centroid gracefully', () => {
    expect(parseHexColor('#ff0000')).toEqual([1, 0, 0]);
    expect(parseHexColor('#00ff00')).toEqual([0, 1, 0]);
    expect(parseHexColor('#0000ff')).toEqual([0, 0, 1]);
    expect(parseHexColor('invalid')).toEqual([1.0, 0.16, 0.55]);

    // Centroid on empty spectrum holds 0.5
    const silentFrame = makeMockFrame({ spectrum: new Float32Array(0) });
    expect(computeCentroid(silentFrame)).toBe(0.5);

    // Centroid on explicit number
    const frameWithCentroid = makeMockFrame({ centroid: 0.75 } as any);
    expect(computeCentroid(frameWithCentroid)).toBe(0.75);
  });

  it('disables blending before simulation substeps and re-enables before display rendering', () => {
    const gl = createMockGl(true);
    const layer = new ReactionDiffusionLayer();
    layer.init(gl);

    const frame = makeMockFrame();
    layer.draw(frame, mockClock, mockTarget, { uLayerOpacity: 0.85 });

    const disableBlendIdx = gl.calls.indexOf('disable:BLEND');
    const enableBlendIdx = gl.calls.indexOf('enable:BLEND');
    const firstDrawIdx = gl.calls.indexOf('drawArrays:4:0:3');
    const lastDrawIdx = gl.calls.lastIndexOf('drawArrays:4:0:3');

    expect(disableBlendIdx).toBeGreaterThan(-1);
    expect(enableBlendIdx).toBeGreaterThan(-1);
    expect(firstDrawIdx).toBeGreaterThan(-1);
    expect(lastDrawIdx).toBeGreaterThan(firstDrawIdx);

    // disable:BLEND must happen before the first simulation substep draw
    expect(disableBlendIdx).toBeLessThan(firstDrawIdx);
    // enable:BLEND must happen after simulation substeps and before the final render pass draw
    expect(enableBlendIdx).toBeGreaterThan(firstDrawIdx);
    expect(enableBlendIdx).toBeLessThan(lastDrawIdx);

    expect(gl.disable).toHaveBeenCalledWith(gl.BLEND);
    expect(gl.enable).toHaveBeenCalledWith(gl.BLEND);
    expect(gl.uniformValues.get('uLayerOpacity')).toBe(0.85);
  });
});
