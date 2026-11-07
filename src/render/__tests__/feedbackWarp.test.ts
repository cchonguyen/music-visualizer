import { describe, it, expect, vi } from 'vitest';
import { Scene, FEEDBACK_WARP_DEFAULTS } from '../scene';
import feedbackSrc from '../shaders/feedback.frag.glsl?raw';
import { FULLSCREEN_VERT, compileProgram } from '../../gl/shader';
import { assertValidSpec, coerceValue, defaultsFor, FEEDBACK_WARP_SPECS } from '../../presets/schema';
import { FEEDBACK_SPECS } from '../../presets/layerSchemas';
import { valuesOf, buildScene } from '../../presets/loader';
import type { AudioFrame } from '../../audio/types';
import type { RenderClock } from '../clock';
import type { Preset } from '../../presets/format';

function createMockGl(): WebGL2RenderingContext {
  const gl = {
    MAX: 0x8008,
    FUNC_ADD: 0x8006,
    ONE: 1,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    ONE_MINUS_SRC_COLOR: 0x0301,
    BLEND: 0x0be2,
    TRIANGLES: 4,
    TEXTURE0: 0x84c0,
    TEXTURE_2D: 0x0de1,
    FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    R32F: 0x822e,
    RED: 0x1903,
    FLOAT: 0x1406,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    CLAMP_TO_EDGE: 0x812f,
    getExtension: vi.fn().mockReturnValue(null),
    checkFramebufferStatus: vi.fn().mockReturnValue(0x8cd5),
    compileShader: vi.fn(),
    shaderSource: vi.fn(),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getShaderParameter: vi.fn().mockReturnValue(true),
    getProgramParameter: vi.fn().mockReturnValue(true),
    createShader: vi.fn().mockReturnValue({}),
    createProgram: vi.fn().mockReturnValue({}),
    createVertexArray: vi.fn().mockReturnValue({}),
    createTexture: vi.fn().mockReturnValue({}),
    createFramebuffer: vi.fn().mockReturnValue({}),
    bindTexture: vi.fn(),
    bindFramebuffer: vi.fn(),
    bindVertexArray: vi.fn(),
    useProgram: vi.fn(),
    activeTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    texSubImage2D: vi.fn(),
    framebufferTexture2D: vi.fn(),
    drawArrays: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    blendEquation: vi.fn(),
    blendFunc: vi.fn(),
    viewport: vi.fn(),
    getUniformLocation: vi.fn().mockImplementation((_prog, name: string) => ({ name })),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    uniform1fv: vi.fn(),
    deleteProgram: vi.fn(),
    deleteShader: vi.fn(),
    deleteTexture: vi.fn(),
    deleteFramebuffer: vi.fn(),
    deleteVertexArray: vi.fn(),
  } as unknown as WebGL2RenderingContext;
  return gl;
}

function makeMockFrame(overrides: Partial<AudioFrame> = {}): AudioFrame {
  return {
    frameIndex: 0,
    time: 1.0,
    dtSec: 0.016,
    raw: { sub: 0.5, mid: 0.5, high: 0.5 },
    env: { sub: 0.5, mid: 0.5, high: 0.5 },
    norm: { sub: 0.5, mid: 0.5, high: 0.5 },
    loudness: 0.5,
    energy: 0.5,
    flux: 0,
    fluxByBand: { sub: 0, mid: 0, high: 0 },
    beat: false,
    beatByBand: { sub: false, mid: false, high: false },
    beatStrength: 0,
    kickEnv: 0,
    kickPulse: false,
    waveform: new Float32Array(4),
    bandWaveforms: {
      sub: new Float32Array(4),
      mid: new Float32Array(4),
      high: new Float32Array(4),
    },
    spectrum: new Float32Array(4),
    smoothedSpectrum: new Float32Array(4),
    sampleRate: 44100,
    ...overrides,
  };
}

const mockClock: RenderClock = {
  frameIndex: 1,
  timeSec: 2.5,
  dtSec: 0.016,
};

describe('Feedback Warp Modes (Slice 7.11)', () => {
  describe('Schema & Defaults', () => {
    it('all feedback warp specs are valid according to assertValidSpec', () => {
      for (const spec of FEEDBACK_WARP_SPECS) {
        expect(() => assertValidSpec(spec)).not.toThrow();
      }
    });

    it('defaults match the Slice 7.11 specification', () => {
      const defaults = defaultsFor(FEEDBACK_WARP_SPECS);
      expect(defaults.warpMode).toBe('classic');
      expect(defaults.kaleidoN).toBe(6);
      expect(defaults.portalRadius).toBe(0.0);
      expect(defaults.rgbSplit).toBe(0.0);
      expect(defaults.decayRgb).toEqual([1.0, 1.0, 1.0]);
      expect(defaults.sobel).toBe(0.0);
      expect(defaults.solarize).toBe(0.0);
      expect(defaults.mobiusPoleOffset).toBe(0.35);
    });

    it('FEEDBACK_WARP_DEFAULTS matches typed defaults', () => {
      expect(FEEDBACK_WARP_DEFAULTS).toEqual({
        warpMode: 'classic',
        kaleidoN: 6,
        portalRadius: 0.0,
        rgbSplit: 0.0,
        decayRgb: [1.0, 1.0, 1.0],
        sobel: 0.0,
        solarize: 0.0,
        mobiusPoleOffset: 0.35,
      });
    });

    it('coerces valid and invalid values safely', () => {
      const warpModeSpec = FEEDBACK_WARP_SPECS.find((s) => s.name === 'warpMode')!;
      expect(coerceValue(warpModeSpec, 'curl').value).toBe('curl');
      expect(coerceValue(warpModeSpec, 'invalid').value).toBe('classic');

      const kaleidoSpec = FEEDBACK_WARP_SPECS.find((s) => s.name === 'kaleidoN')!;
      expect(coerceValue(kaleidoSpec, 10).value).toBe(10);
      expect(coerceValue(kaleidoSpec, 2).value).toBe(4); // clamped min
      expect(coerceValue(kaleidoSpec, 20).value).toBe(16); // clamped max

      const decayRgbSpec = FEEDBACK_WARP_SPECS.find((s) => s.name === 'decayRgb')!;
      expect(coerceValue(decayRgbSpec, [0.99, 0.95, 1.0]).value).toEqual([0.99, 0.95, 1.0]);
      expect(coerceValue(decayRgbSpec, 'invalid').value).toEqual([1.0, 1.0, 1.0]);
      expect(coerceValue(decayRgbSpec, [1, 2]).value).toEqual([1.0, 1.0, 1.0]);
    });
  });

  describe('Loader Propagation', () => {
    it('FEEDBACK_SPECS includes the extended feedback warp specs', () => {
      for (const spec of FEEDBACK_WARP_SPECS) {
        expect(FEEDBACK_SPECS.some((s) => s.name === spec.name)).toBe(true);
      }
    });

    it('valuesOf extracts extended feedback fields from preset settings', () => {
      const settings = {
        warpMode: { value: 'curl' },
        kaleidoN: { value: 8 },
        portalRadius: { value: 0.1 },
        rgbSplit: { value: 0.04 },
        decayRgb: { value: [0.98, 0.97, 1.0] as [number, number, number] },
        sobel: { value: 0.5 },
        solarize: { value: 0.6 },
        mobiusPoleOffset: { value: 0.4 },
      };
      const values = valuesOf(settings);
      expect(values.warpMode).toBe('curl');
      expect(values.kaleidoN).toBe(8);
      expect(values.portalRadius).toBe(0.1);
      expect(values.rgbSplit).toBe(0.04);
      expect(values.decayRgb).toEqual([0.98, 0.97, 1.0]);
      expect(values.sobel).toBe(0.5);
      expect(values.solarize).toBe(0.6);
      expect(values.mobiusPoleOffset).toBe(0.4);
    });

    it('buildScene applies feedback settings from preset', () => {
      const preset: Preset = {
        version: 1,
        name: 'test-feedback',
        tags: [],
        transition: { style: 'crossfade', seconds: 0.5 },
        feedback: {
          warpMode: { value: 'mobius' },
          decayRgb: { value: [0.95, 0.95, 1.0] },
        },
        layers: [],
        post: {},
      };
      const scene = buildScene('test', preset);
      expect(scene).toBeInstanceOf(Scene);
    });
  });

  describe('Shader Source & Invariants', () => {
    it('contains all required warp modes and algorithms', () => {
      // Warp modes
      expect(feedbackSrc).toContain('uWarpMode');
      expect(feedbackSrc).toContain('curlField');
      expect(feedbackSrc).toContain('abs(mod(theta, TWO_PI / uKaleidoN) - PI / uKaleidoN)');
      expect(feedbackSrc).toContain('smoothstep(0.0, uPortalRadius, r)');
      expect(feedbackSrc).toContain('uMobiusPolePolarity');
      expect(feedbackSrc).toContain('max(denomMag, 1e-4)');
      expect(feedbackSrc).toContain('vec2(-p.y, p.x) / max(length(p), 0.05)');

      // Post-fetch transforms
      expect(feedbackSrc).toContain('uSobel');
      expect(feedbackSrc).toContain('uSolarize');
      expect(feedbackSrc).toContain('0.5 + 0.5 * sin');
      expect(feedbackSrc).toContain('uDecay * uDecayRgb');
    });

    it('compiles cleanly via compileProgram with mock WebGL', () => {
      const gl = createMockGl();
      const prog = compileProgram(gl, FULLSCREEN_VERT, feedbackSrc, 'feedback:test');
      expect(prog).toBeDefined();
      expect(gl.compileShader).toHaveBeenCalledTimes(2);
      expect(gl.linkProgram).toHaveBeenCalledTimes(1);
    });
  });

  describe('Uniform Binding in Scene', () => {
    it('binds classic warp mode as uniform 0 by default', () => {
      const gl = createMockGl();
      const scene = new Scene('test', []);
      scene.init(gl);
      scene.draw(makeMockFrame(), mockClock);

      const uniform1iMock = gl.uniform1i as unknown as { mock: { calls: [unknown, number][] } };
      const warpModeCall = uniform1iMock.mock.calls.find(([loc]) => (loc as { name: string })?.name === 'uWarpMode');
      expect(warpModeCall).toBeDefined();
      expect(warpModeCall![1]).toBe(0); // 0 = classic
    });

    it.each([
      ['classic', 0],
      ['curl', 1],
      ['polarFold', 2],
      ['mobius', 3],
      ['rgbSplit', 4],
    ])('maps warpMode "%s" to integer %d', (mode, expectedInt) => {
      const gl = createMockGl();
      const scene = new Scene('test', []);
      scene.init(gl);
      scene.setFeedback({ warpMode: mode });
      scene.draw(makeMockFrame(), mockClock);

      const uniform1iMock = gl.uniform1i as unknown as { mock: { calls: [unknown, number][] } };
      const warpModeCall = uniform1iMock.mock.calls.find(([loc]) => (loc as { name: string })?.name === 'uWarpMode');
      expect(warpModeCall).toBeDefined();
      expect(warpModeCall![1]).toBe(expectedInt);
    });

    it('binds decayRgb vec3 uniform correctly', () => {
      const gl = createMockGl();
      const scene = new Scene('test', []);
      scene.init(gl);
      scene.setFeedback({ decayRgb: [0.99, 0.97, 1.0] });
      scene.draw(makeMockFrame(), mockClock);

      const uniform3fMock = gl.uniform3f as unknown as { mock: { calls: [unknown, number, number, number][] } };
      const decayRgbCall = uniform3fMock.mock.calls.find(([loc]) => (loc as { name: string })?.name === 'uDecayRgb');
      expect(decayRgbCall).toBeDefined();
      expect(decayRgbCall![1]).toBeCloseTo(0.99);
      expect(decayRgbCall![2]).toBeCloseTo(0.97);
      expect(decayRgbCall![3]).toBeCloseTo(1.0);
    });

    it('binds sobel, solarize, and geometric warp uniforms', () => {
      const gl = createMockGl();
      const scene = new Scene('test', []);
      scene.init(gl);
      scene.setFeedback({
        kaleidoN: 8,
        portalRadius: 0.15,
        rgbSplit: 0.04,
        sobel: 0.75,
        solarize: 0.65,
        mobiusPoleOffset: 0.45,
      });
      scene.draw(makeMockFrame(), mockClock);

      const uniform1fMock = gl.uniform1f as unknown as { mock: { calls: [unknown, number][] } };
      const findFloat = (name: string) => uniform1fMock.mock.calls.find(([loc]) => (loc as { name: string })?.name === name)?.[1];

      expect(findFloat('uKaleidoN')).toBe(8);
      expect(findFloat('uPortalRadius')).toBe(0.15);
      expect(findFloat('uRgbSplit')).toBe(0.04);
      expect(findFloat('uSobel')).toBe(0.75);
      expect(findFloat('uSolarize')).toBe(0.65);
      expect(findFloat('uMobiusPoleOffset')).toBe(0.45);
    });

    it('flips mobius pole polarity when kickPulse triggers', () => {
      const gl = createMockGl();
      const scene = new Scene('test', []);
      scene.init(gl);

      const uniform1fMock = gl.uniform1f as unknown as { mock: { calls: [unknown, number][] } };
      const getPolarity = () => uniform1fMock.mock.calls.filter(([loc]) => (loc as { name: string })?.name === 'uMobiusPolePolarity').pop()?.[1];

      // Draw 1: normal frame without kickPulse -> initial polarity +1
      scene.draw(makeMockFrame({ kickPulse: false }), mockClock);
      expect(getPolarity()).toBe(1.0);

      // Draw 2: kickPulse triggers -> flips polarity to -1
      scene.draw(makeMockFrame({ kickPulse: true }), mockClock);
      expect(getPolarity()).toBe(-1.0);

      // Draw 3: normal frame -> stays -1
      scene.draw(makeMockFrame({ kickPulse: false }), mockClock);
      expect(getPolarity()).toBe(-1.0);

      // Draw 4: kickPulse triggers again -> flips back to +1
      scene.draw(makeMockFrame({ kickPulse: true }), mockClock);
      expect(getPolarity()).toBe(1.0);
    });
  });
});
