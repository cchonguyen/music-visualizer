import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Compositor, POST_IDENTITY } from '../compositor';
import { Scene } from '../scene';
import type { AudioFrame } from '../../audio/types';
import type { RenderClock } from '../clock';
import type { RenderTarget } from '../layer';
import type { CameraUniforms, ColorUniforms } from '../globalDirector';
import postSrc from '../shaders/post.frag.glsl?raw';

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
    TEXTURE1: 0x84c1,
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
    createShader: vi.fn().mockImplementation((type: number) => ({ id: `shader-${type}-${Math.random()}` })),
    createProgram: vi.fn().mockImplementation(() => ({ id: `prog-${Math.random()}` })),
    createVertexArray: vi.fn().mockReturnValue({ id: 'mock-vao' }),
    createTexture: vi.fn().mockImplementation(() => ({ id: `tex-${Math.random()}` })),
    createFramebuffer: vi.fn().mockImplementation(() => ({ id: `fbo-${Math.random()}` })),
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
    drawArraysInstanced: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    blendEquation: vi.fn(),
    blendFunc: vi.fn(),
    viewport: vi.fn(),
    getUniformLocation: vi.fn().mockImplementation((prog: { id?: string }, name: string) => ({ progId: prog?.id, name })),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    uniform3fv: vi.fn(),
    uniform1fv: vi.fn(),
    deleteProgram: vi.fn(),
    deleteShader: vi.fn(),
    deleteTexture: vi.fn(),
    deleteFramebuffer: vi.fn(),
    deleteVertexArray: vi.fn(),
  } as unknown as WebGL2RenderingContext;
  return gl;
}

function makeMockFrame(): AudioFrame {
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
    waveform: new Float32Array([0, 0.5, -0.5, 0]),
    bandWaveforms: {
      sub: new Float32Array(16),
      mid: new Float32Array(16),
      high: new Float32Array(16),
    },
    spectrum: new Float32Array(64),
    smoothedSpectrum: new Float32Array(64),
    sampleRate: 48000,
  };
}

describe('Global Director Shader & Compositor Integration (Slice 7.31)', () => {
  describe('1. post.frag.glsl shader source integrity', () => {
    it('declares all 2.5D camera uniforms with identity defaults in comments', () => {
      expect(postSrc).toContain('uniform vec2 uCamPan;');
      expect(postSrc).toContain('uniform float uCamZoom;');
      expect(postSrc).toContain('uniform float uCamRoll;');
      expect(postSrc).toContain('uniform vec2 uCamTilt;');

      expect(postSrc).toMatch(/uniform vec2 uCamPan;\s*\/\/\s*default\s*\(0\.0,\s*0\.0\)/);
      expect(postSrc).toMatch(/uniform float uCamZoom;\s*\/\/\s*default\s*1\.0/);
      expect(postSrc).toMatch(/uniform float uCamRoll;\s*\/\/\s*default\s*0\.0/);
      expect(postSrc).toMatch(/uniform vec2 uCamTilt;\s*\/\/\s*default\s*\(0\.0,\s*0\.0\)/);
    });

    it('declares all split-tone color uniforms with identity defaults in comments', () => {
      expect(postSrc).toContain('uniform vec3 uColorShadowTint;');
      expect(postSrc).toContain('uniform vec3 uColorHighlightTint;');
      expect(postSrc).toContain('uniform float uColorSpatialSpread;');
      expect(postSrc).toContain('uniform float uColorGradAngle;');
      expect(postSrc).toContain('uniform float uColorIntensity;');

      expect(postSrc).toMatch(/uniform vec3 uColorShadowTint;\s*\/\/\s*default\s*\(1\.0,\s*1\.0,\s*1\.0\)/);
      expect(postSrc).toMatch(/uniform vec3 uColorHighlightTint;\s*\/\/\s*default\s*\(1\.0,\s*1\.0,\s*1\.0\)/);
      expect(postSrc).toMatch(/uniform float uColorSpatialSpread;\s*\/\/\s*default\s*0\.0/);
      expect(postSrc).toMatch(/uniform float uColorGradAngle;\s*\/\/\s*default\s*0\.0/);
      expect(postSrc).toMatch(/uniform float uColorIntensity;\s*\/\/\s*default\s*0\.0/);
      expect(postSrc).toMatch(/uniform float uColorCycleAngle;\s*\/\/\s*default\s*0\.0/);
    });

    it('contains the 2.5D camera transform and mirrored-repeat UV fold', () => {
      expect(postSrc).toContain('uCamZoom != 1.0 || uCamRoll != 0.0 || dot(uCamPan, uCamPan) > 0.0 || dot(uCamTilt, uCamTilt) > 0.0');
      expect(postSrc).toContain('float cr = cos(uCamRoll);');
      expect(postSrc).toContain('float sr = sin(uCamRoll);');
      expect(postSrc).toContain('vec2 p1 = vec2(p0.x * cr - p0.y * sr, p0.x * sr + p0.y * cr);');
      expect(postSrc).toContain('vec2 p2 = p1 / max(0.2, 1.0 + p1.x * uCamTilt.x + p1.y * uCamTilt.y);');
      expect(postSrc).toContain('vec2 p3 = (p2 / max(0.5, uCamZoom)) - uCamPan;');
      expect(postSrc).toContain('vec2 camUv = p3 + 0.5;');
      expect(postSrc).toContain('vec2 mUv = mod(camUv, 2.0);');
      expect(postSrc).toContain('uv = mix(mUv, 2.0 - mUv, step(1.0, mUv));');
    });

    it('contains luminance-preserving split tone re-normalized with Y / max(1e-4, Ytint)', () => {
      expect(postSrc).toContain('float Y = dot(c, vec3(0.2126, 0.7152, 0.0722));');
      expect(postSrc).toContain('if (Y > 1e-5 && uColorIntensity > 0.0)');
      expect(postSrc).toContain('vec2 gradDir = vec2(cos(uColorGradAngle), sin(uColorGradAngle));');
      expect(postSrc).toContain('float s = dot(vUv - 0.5, gradDir);');
      expect(postSrc).toContain('float tTone = clamp(Y + s * uColorSpatialSpread, 0.0, 1.0);');
      expect(postSrc).toContain('vec3 shadowT = hueRotate(uColorShadowTint, uColorCycleAngle * 0.7);');
      expect(postSrc).toContain('vec3 highlightT = hueRotate(uColorHighlightTint, uColorCycleAngle);');
      expect(postSrc).toContain('vec3 tint = mix(shadowT, highlightT, tTone);');
      expect(postSrc).toContain('vec3 tinted = mix(c, c * tint * 2.2, uColorIntensity);');
      expect(postSrc).toContain('float Ytint = dot(tinted, vec3(0.2126, 0.7152, 0.0722));');
      expect(postSrc).toContain('c = tinted * (Y / max(1e-4, Ytint));');
    });

    it('samples bloom at camera-transformed uv so bloom moves with the camera', () => {
      expect(postSrc).toContain('texture(uBloom, uv).rgb');
    });
  });

  describe('2. Compositor post pass activation & hasDirectorEffect', () => {
    let comp: Compositor;
    const defaultCam: CameraUniforms = { panX: 0, panY: 0, zoom: 1, roll: 0, tiltX: 0, tiltY: 0 };
    const defaultColor: ColorUniforms = {
      shadowTint: [1, 1, 1],
      highlightTint: [1, 1, 1],
      spatialSpread: 0,
      gradAngle: 0,
      intensity: 0,
      cycleAngle: 0,
    };

    beforeEach(() => {
      const mockScene = new Scene('s1', []);
      comp = new Compositor([mockScene]);
    });

    it('is inactive when both post and director are at identity', () => {
      expect(comp.hasDirectorEffect()).toBe(false);
      expect(comp.hasPost()).toBe(false);

      comp.setPost({});
      expect(comp.hasDirectorEffect()).toBe(false);
      expect(comp.hasPost()).toBe(false);

      comp.setPost(POST_IDENTITY);
      expect(comp.hasDirectorEffect()).toBe(false);
      expect(comp.hasPost()).toBe(false);
    });

    it('activates post pass when director camera zoom differs from 1.0', () => {
      comp.setDirectorState({ ...defaultCam, zoom: 1.06 }, defaultColor);
      expect(comp.hasDirectorEffect()).toBe(true);
      expect(comp.hasPost()).toBe(true);
    });

    it('activates post pass when director camera panX or panY differs from 0', () => {
      comp.setDirectorState({ ...defaultCam, panX: 0.04 }, defaultColor);
      expect(comp.hasDirectorEffect()).toBe(true);
      expect(comp.hasPost()).toBe(true);

      comp.setDirectorState({ ...defaultCam, panY: -0.05 }, defaultColor);
      expect(comp.hasDirectorEffect()).toBe(true);
      expect(comp.hasPost()).toBe(true);
    });

    it('activates post pass when director camera roll differs from 0', () => {
      comp.setDirectorState({ ...defaultCam, roll: 0.14 }, defaultColor);
      expect(comp.hasDirectorEffect()).toBe(true);
      expect(comp.hasPost()).toBe(true);
    });

    it('activates post pass when director camera tiltX or tiltY differs from 0', () => {
      comp.setDirectorState({ ...defaultCam, tiltX: 0.15 }, defaultColor);
      expect(comp.hasDirectorEffect()).toBe(true);
      expect(comp.hasPost()).toBe(true);

      comp.setDirectorState({ ...defaultCam, tiltY: -0.20 }, defaultColor);
      expect(comp.hasDirectorEffect()).toBe(true);
      expect(comp.hasPost()).toBe(true);
    });

    it('activates post pass when director color intensity > 0', () => {
      comp.setDirectorState(defaultCam, {
        shadowTint: [0, 0.9, 1],
        highlightTint: [1, 0, 0.5],
        spatialSpread: 0.45,
        gradAngle: 0.25,
        intensity: 0.45,
        cycleAngle: 0.1,
      });
      expect(comp.hasDirectorEffect()).toBe(true);
      expect(comp.hasPost()).toBe(true);
    });

    it('deactivates post pass when restored to identity', () => {
      comp.setDirectorState({ ...defaultCam, zoom: 1.08 }, { ...defaultColor, intensity: 0.5 });
      expect(comp.hasDirectorEffect()).toBe(true);
      expect(comp.hasPost()).toBe(true);

      comp.setDirectorState(defaultCam, defaultColor);
      expect(comp.hasDirectorEffect()).toBe(false);
      expect(comp.hasPost()).toBe(false);
    });

    it('activates post pass if preset post settings are active even if director is identity', () => {
      comp.setPost({ hueShift: 1.2 });
      expect(comp.hasDirectorEffect()).toBe(false);
      expect(comp.hasPost()).toBe(true);
    });
  });

  describe('3. Compositor WebGL post pass execution & uniform uploads', () => {
    let comp: Compositor;
    let gl: WebGL2RenderingContext;
    let mockScene: Scene;
    const target: RenderTarget = { kind: 'canvas', width: 640, height: 360 };
    const clock: RenderClock = { timeSec: 1.0, dtSec: 0.016, frameIndex: 1 };

    beforeEach(() => {
      gl = createMockGl();
      mockScene = {
        name: 'testScene',
        init: vi.fn(),
        resize: vi.fn(),
        draw: vi.fn(),
        outputTexture: vi.fn().mockReturnValue({ id: 'scene-tex' }),
        dispose: vi.fn(),
      } as unknown as Scene;

      comp = new Compositor([mockScene]);
      comp.init(gl);
      comp.resize(640, 360, 1);
      comp.setWeights({ testScene: 1.0 });
    });

    it('skips the post pass and does not upload director uniforms when at identity', () => {
      comp.draw(makeMockFrame(), clock, target);

      // Verify that no director uniforms were uploaded
      const uniform1fCalls = (gl.uniform1f as ReturnType<typeof vi.fn>).mock.calls;
      const uniform2fCalls = (gl.uniform2f as ReturnType<typeof vi.fn>).mock.calls;
      const uniform3fvCalls = (gl.uniform3fv as ReturnType<typeof vi.fn>).mock.calls;

      const camZoomCall = uniform1fCalls.find(([loc]) => loc?.name === 'uCamZoom');
      const camPanCall = uniform2fCalls.find(([loc]) => loc?.name === 'uCamPan');
      const colorShadowCall = uniform3fvCalls.find(([loc]) => loc?.name === 'uColorShadowTint');

      expect(camZoomCall).toBeUndefined();
      expect(camPanCall).toBeUndefined();
      expect(colorShadowCall).toBeUndefined();
    });

    it('executes post pass and uploads all 9 director uniforms with exact values', () => {
      const cam: CameraUniforms = {
        panX: 0.04,
        panY: -0.02,
        zoom: 1.06,
        roll: 0.14,
        tiltX: -0.05,
        tiltY: 0.08,
      };
      const color: ColorUniforms = {
        shadowTint: [0.1, 0.2, 0.3],
        highlightTint: [0.8, 0.9, 1.0],
        spatialSpread: 0.45,
        gradAngle: 1.25,
        intensity: 0.65,
        cycleAngle: 2.1,
      };

      comp.setDirectorState(cam, color);
      comp.draw(makeMockFrame(), clock, target);

      const uniform1fCalls = (gl.uniform1f as ReturnType<typeof vi.fn>).mock.calls;
      const uniform2fCalls = (gl.uniform2f as ReturnType<typeof vi.fn>).mock.calls;
      const uniform3fvCalls = (gl.uniform3fv as ReturnType<typeof vi.fn>).mock.calls;

      // 1. uCamPan (uniform2f)
      const camPanCall = uniform2fCalls.find(([loc]) => loc?.name === 'uCamPan');
      expect(camPanCall).toBeDefined();
      expect(camPanCall![1]).toBeCloseTo(0.04);
      expect(camPanCall![2]).toBeCloseTo(-0.02);

      // 2. uCamZoom (uniform1f)
      const camZoomCall = uniform1fCalls.find(([loc]) => loc?.name === 'uCamZoom');
      expect(camZoomCall).toBeDefined();
      expect(camZoomCall![1]).toBeCloseTo(1.06);

      // 3. uCamRoll (uniform1f)
      const camRollCall = uniform1fCalls.find(([loc]) => loc?.name === 'uCamRoll');
      expect(camRollCall).toBeDefined();
      expect(camRollCall![1]).toBeCloseTo(0.14);

      // 4. uCamTilt (uniform2f)
      const camTiltCall = uniform2fCalls.find(([loc]) => loc?.name === 'uCamTilt');
      expect(camTiltCall).toBeDefined();
      expect(camTiltCall![1]).toBeCloseTo(-0.05);
      expect(camTiltCall![2]).toBeCloseTo(0.08);

      // 5. uColorShadowTint (uniform3fv)
      const shadowTintCall = uniform3fvCalls.find(([loc]) => loc?.name === 'uColorShadowTint');
      expect(shadowTintCall).toBeDefined();
      expect(shadowTintCall![1]).toEqual([0.1, 0.2, 0.3]);

      // 6. uColorHighlightTint (uniform3fv)
      const highlightTintCall = uniform3fvCalls.find(([loc]) => loc?.name === 'uColorHighlightTint');
      expect(highlightTintCall).toBeDefined();
      expect(highlightTintCall![1]).toEqual([0.8, 0.9, 1.0]);

      // 7. uColorSpatialSpread (uniform1f)
      const spreadCall = uniform1fCalls.find(([loc]) => loc?.name === 'uColorSpatialSpread');
      expect(spreadCall).toBeDefined();
      expect(spreadCall![1]).toBeCloseTo(0.45);

      // 8. uColorGradAngle (uniform1f)
      const angleCall = uniform1fCalls.find(([loc]) => loc?.name === 'uColorGradAngle');
      expect(angleCall).toBeDefined();
      expect(angleCall![1]).toBeCloseTo(1.25);

      // 9. uColorIntensity (uniform1f)
      const intensityCall = uniform1fCalls.find(([loc]) => loc?.name === 'uColorIntensity');
      expect(intensityCall).toBeDefined();
      expect(intensityCall![1]).toBeCloseTo(0.65);

      // 10. uColorCycleAngle (uniform1f)
      const cycleAngleCall = uniform1fCalls.find(([loc]) => loc?.name === 'uColorCycleAngle');
      expect(cycleAngleCall).toBeDefined();
      expect(cycleAngleCall![1]).toBeCloseTo(2.1);
    });

    it('directly respects compositor.calm = true and passes uCalm = 1.0', () => {
      comp.calm = true;
      comp.setPost({ contrast: 1.2 }); // ensure post pass executes
      comp.draw(makeMockFrame(), clock, target);

      const uniform1fCalls = (gl.uniform1f as ReturnType<typeof vi.fn>).mock.calls;
      const uCalmCall = uniform1fCalls.find(([loc]) => loc?.name === 'uCalm');
      expect(uCalmCall).toBeDefined();
      expect(uCalmCall![1]).toBe(1.0);
      expect(comp.calm).toBe(true);
      expect(comp.getCalm()).toBe(true);
    });
  });
});
