import { describe, it, expect, vi } from 'vitest';
import { Scene, FEEDBACK_WARP_DEFAULTS } from '../scene';
import feedbackSrc from '../shaders/feedback.frag.glsl?raw';
import { FULLSCREEN_VERT, compileProgram } from '../../gl/shader';
import { assertValidSpec, coerceValue, defaultsFor, FEEDBACK_WARP_SPECS } from '../../presets/schema';
import { FEEDBACK_SPECS } from '../../presets/layerSchemas';
import { valuesOf, buildScene, readFeedbackSettings } from '../../presets/loader';
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
    sampleRate: 48000,
    ...overrides,
  };
}

const mockClock: RenderClock = {
  frameIndex: 1,
  timeSec: 2.5,
  dtSec: 0.016,
};

describe('Feedback Warp Overhaul (Slice 7.22)', () => {
  describe('Schema & Defaults', () => {
    it('all feedback warp specs are valid according to assertValidSpec', () => {
      for (const spec of FEEDBACK_WARP_SPECS) {
        expect(() => assertValidSpec(spec)).not.toThrow();
      }
    });

    it('defaults match the Slice 7.22 specification', () => {
      const defaults = defaultsFor(FEEDBACK_WARP_SPECS);
      expect(defaults.warpMode).toBe('classic');
      expect(defaults.kaleidoN).toBe(6);
      expect(defaults.portalRadius).toBe(0.0);
      expect(defaults.rgbSplit).toBe(0.0);
      expect(defaults.decayRgb).toEqual([1.0, 1.0, 1.0]);
      expect(defaults.sobel).toBe(0.0);
      expect(defaults.solarize).toBe(0.0);
      expect(defaults.mobiusPoleOffset).toBe(0.48);

      // Slice 7.22 additions:
      expect(defaults.curlOctaves).toBe(2);
      expect(defaults.curlTurbulence).toBe(0.45);
      expect(defaults.curlFlowPattern).toBe('plumes');
      expect(defaults.radialFold).toBe(0.0);
      expect(defaults.mandalaTile).toBe(0.0);
      expect(defaults.mandalaCounterSpin).toBe(0.25);
      expect(defaults.mandalaKickFlare).toBe(0.35);
      expect(defaults.mandalaPattern).toBe('auto');
      expect(defaults.contourFreq).toBe(7.85);
      expect(defaults.contourWidth).toBe(0.45);
      expect(defaults.colorSpread).toBe(0.65);
      expect(defaults.mobiusFlow).toBe(0.85);
      expect(defaults.mobiusSwirl).toBe(0.65);
      expect(defaults.mobiusWander).toBe(0.55);
      expect(defaults.mobiusMode).toBe('auto');
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
        mobiusPoleOffset: 0.48,
        curlOctaves: 2,
        curlTurbulence: 0.45,
        curlFlowPattern: 'plumes',
        radialFold: 0.0,
        mandalaTile: 0.0,
        mandalaCounterSpin: 0.25,
        mandalaKickFlare: 0.35,
        mandalaPattern: 'auto',
        contourFreq: 7.85,
        contourWidth: 0.45,
        colorSpread: 0.65,
        mobiusFlow: 0.85,
        mobiusSwirl: 0.65,
        mobiusWander: 0.55,
        mobiusMode: 'auto',
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

      const curlFlowSpec = FEEDBACK_WARP_SPECS.find((s) => s.name === 'curlFlowPattern')!;
      expect(coerceValue(curlFlowSpec, 'eddies').value).toBe('eddies');
      expect(coerceValue(curlFlowSpec, 'invalid').value).toBe('plumes');

      const mobiusModeSpec = FEEDBACK_WARP_SPECS.find((s) => s.name === 'mobiusMode')!;
      expect(coerceValue(mobiusModeSpec, 'figureEight').value).toBe('figureEight');
      expect(coerceValue(mobiusModeSpec, 'invalid').value).toBe('auto');

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
        curlOctaves: { value: 3 },
        curlTurbulence: { value: 0.6 },
        curlFlowPattern: { value: 'eddies' },
        radialFold: { value: 0.5 },
        mandalaTile: { value: 0.3 },
        contourFreq: { value: 8.5 },
        mobiusFlow: { value: 1.2 },
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
      expect(values.curlOctaves).toBe(3);
      expect(values.curlTurbulence).toBe(0.6);
      expect(values.curlFlowPattern).toBe('eddies');
      expect(values.radialFold).toBe(0.5);
      expect(values.mandalaTile).toBe(0.3);
      expect(values.contourFreq).toBe(8.5);
      expect(values.mobiusFlow).toBe(1.2);
    });

    it('readFeedbackSettings normalises and defaults all feedback fields', () => {
      const partialPreset: Preset = {
        version: 1,
        name: 'test-loader-fb',
        tags: [],
        transition: { style: 'crossfade', seconds: 0.5 },
        feedback: {
          warpMode: { value: 'curl' },
          curlOctaves: { value: 3 },
        },
        layers: [],
        post: {},
      };
      const fb = readFeedbackSettings(partialPreset);
      expect(fb.warpMode).toBe('curl');
      expect(fb.curlOctaves).toBe(3);
      expect(fb.curlTurbulence).toBe(0.45);
      expect(fb.mobiusPoleOffset).toBe(0.48);
      expect(fb.contourFreq).toBe(7.85);
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
      expect(feedbackSrc).toContain('snoise');
      expect(feedbackSrc).toContain('curlNoise');
      expect(feedbackSrc).toContain('uCurlFlowPattern');
      expect(feedbackSrc).toContain('uMandalaTile');
      expect(feedbackSrc).toContain('uRadialFold');
      expect(feedbackSrc).toContain('abs(mod(theta, TWO_PI / uKaleidoN) - PI / uKaleidoN)');
      expect(feedbackSrc).toContain('smoothstep(0.0, uPortalRadius, r)');
      expect(feedbackSrc).toContain('uMobiusPoleA');
      expect(feedbackSrc).toContain('uMobiusPoleB');
      expect(feedbackSrc).toContain('cDiv');
      expect(feedbackSrc).toContain('cLog');
      expect(feedbackSrc).toContain('cExp');

      // Luminance-gated solarize
      expect(feedbackSrc).toContain('uSobel');
      expect(feedbackSrc).toContain('uSolarize');
      expect(feedbackSrc).toContain('smoothstep(0.035, 0.14, lum)');
      expect(feedbackSrc).toContain('dot(c, vec3(0.299, 0.587, 0.114))');
      expect(feedbackSrc).toContain('uContourFreq');
      expect(feedbackSrc).toContain('uContourWidth');
      expect(feedbackSrc).toContain('uColorSpread');
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

    it('binds all Curl, Mandala, Solarize, and Möbius uniforms correctly', () => {
      const gl = createMockGl();
      const scene = new Scene('test', []);
      scene.init(gl);
      scene.setFeedback({
        curlOctaves: 3,
        curlTurbulence: 0.75,
        curlFlowPattern: 'outflow',
        radialFold: 0.65,
        mandalaTile: 0.45,
        mandalaCounterSpin: 0.35,
        mandalaKickFlare: 0.55,
        contourFreq: 10.5,
        contourWidth: 0.6,
        colorSpread: 0.8,
        mobiusFlow: 1.1,
        mobiusSwirl: -0.4,
        mobiusPoleOffset: 0.52,
        mobiusWander: 0.65,
      });
      scene.draw(makeMockFrame(), mockClock);

      const uniform1iMock = gl.uniform1i as unknown as { mock: { calls: [unknown, number][] } };
      const uniform1fMock = gl.uniform1f as unknown as { mock: { calls: [unknown, number][] } };
      const uniform2fMock = gl.uniform2f as unknown as { mock: { calls: [unknown, number, number][] } };

      const findInt = (name: string) => uniform1iMock.mock.calls.find(([loc]) => (loc as { name: string })?.name === name)?.[1];
      const findFloat = (name: string) => uniform1fMock.mock.calls.find(([loc]) => (loc as { name: string })?.name === name)?.[1];
      const findVec2 = (name: string) => {
        const c = uniform2fMock.mock.calls.find(([loc]) => (loc as { name: string })?.name === name);
        return c ? [c[1], c[2]] : undefined;
      };

      expect(findInt('uCurlOctaves')).toBe(3);
      expect(findFloat('uCurlTurbulence')).toBe(0.75);
      expect(findInt('uCurlFlowPattern')).toBe(2); // outflow = 2

      expect(findFloat('uRadialFold')).toBe(0.65);
      expect(findFloat('uMandalaTile')).toBe(0.45);
      expect(findFloat('uMandalaCounterSpin')).toBe(0.35);
      expect(findFloat('uMandalaKickFlare')).toBe(0.55);

      expect(findFloat('uContourFreq')).toBe(10.5);
      expect(findFloat('uContourWidth')).toBe(0.6);
      expect(findFloat('uColorSpread')).toBe(0.8);

      expect(findFloat('uMobiusFlow')).toBe(1.1);
      expect(findFloat('uMobiusSwirl')).toBe(-0.4);

      const poleA = findVec2('uMobiusPoleA');
      const poleB = findVec2('uMobiusPoleB');
      expect(poleA).toBeDefined();
      expect(poleB).toBeDefined();
      // Poles must be separated symmetrically around center
      expect(poleA![0]).not.toBe(poleB![0]);
    });

    it('ensures smooth Möbius dipole continuity (no sign-flip on kick, dynamic pole drift)', () => {
      const gl = createMockGl();
      const scene = new Scene('test', []);
      scene.init(gl);

      const uniform2fMock = gl.uniform2f as unknown as { mock: { calls: [unknown, number, number][] } };
      const getPoles = () => {
        const calls = uniform2fMock.mock.calls;
        const poleA = calls.filter(([loc]) => (loc as { name: string })?.name === 'uMobiusPoleA').pop();
        const poleB = calls.filter(([loc]) => (loc as { name: string })?.name === 'uMobiusPoleB').pop();
        return { poleA: [poleA?.[1], poleA?.[2]], poleB: [poleB?.[1], poleB?.[2]] };
      };

      // Frame 1
      scene.draw(makeMockFrame({ dtSec: 0.016, kickPulse: false }), mockClock);
      const f1 = getPoles();

      // Frame 2: kickPulse fires!
      scene.draw(makeMockFrame({ dtSec: 0.016, kickPulse: true }), mockClock);
      const f2 = getPoles();

      // Poles should move smoothly (small delta across 1 frame, NOT a sign flip!)
      const deltaAx = Math.abs(Number(f2.poleA[0]) - Number(f1.poleA[0]));
      const deltaAy = Math.abs(Number(f2.poleA[1]) - Number(f1.poleA[1]));
      expect(deltaAx).toBeLessThan(0.05); // Smooth motion, not jump
      expect(deltaAy).toBeLessThan(0.05);

      // Frame 3: additional drift over time
      scene.draw(makeMockFrame({ dtSec: 0.5, kickPulse: false }), mockClock);
      const f3 = getPoles();
      // Poles should have moved noticeably with dt = 0.5s
      expect(f3.poleA[0]).not.toBe(f2.poleA[0]);
    });
  });
});
