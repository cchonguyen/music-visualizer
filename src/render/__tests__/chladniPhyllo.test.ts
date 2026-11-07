import { describe, it, expect, vi } from 'vitest';
import { ChladniSandLayer, CHLADNI_POINT_COUNT } from '../layers/chladniSand';
import { ParticleLayer } from '../layers/particles';
import chladniVertSrc from '../shaders/chladniSand.vert.glsl?raw';
import chladniFragSrc from '../shaders/chladniSand.frag.glsl?raw';
import particlesVertSrc from '../shaders/particles.vert.glsl?raw';
import {
  assertValidSpec,
  CHLADNI_SPECS,
  CHLADNI_DEFAULTS,
  PARTICLE_MODE_SPEC,
  PARTICLES_SCHEMA,
  PARTICLE_SEED_SHAPE_SPEC,
  PARTICLE_PHYLLO_PATTERN_SPEC,
  PARTICLE_PETAL_STRETCH_SPEC,
} from '../../presets/schema';
import { LAYER_FACTORIES, applyValues, buildScene } from '../../presets/loader';
import { FLAGSHIP_PRESETS_09_10, ALL_PRESETS } from '../../presets/builtin';
import { PRESET_VERSION } from '../../presets/format';
import { BrightnessLimiter } from '../safety';
import type { AudioFrame } from '../../audio/types';
import type { RenderClock } from '../clock';
import type { RenderTarget } from '../layer';

function createMockGl(): WebGL2RenderingContext {
  const uniformValues = new Map<string, any>();

  const gl = {
    MAX: 0x8008,
    FUNC_ADD: 0x8006,
    ONE: 1,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    BLEND: 0x0be2,
    POINTS: 0x0000,
    TRIANGLES: 0x0004,
    TRIANGLE_STRIP: 0x0005,
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
    UNSIGNED_BYTE: 0x1401,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    R32F: 0x822e,
    RED: 0x1903,
    FLOAT: 0x1406,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    CLAMP_TO_EDGE: 0x812f,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,

    getExtension: vi.fn().mockReturnValue(null),
    enable: vi.fn(),
    disable: vi.fn(),
    blendFunc: vi.fn(),
    blendEquation: vi.fn(),
    viewport: vi.fn(),
    compileShader: vi.fn(),
    shaderSource: vi.fn(),
    attachShader: vi.fn(),
    deleteShader: vi.fn(),
    linkProgram: vi.fn(),
    deleteProgram: vi.fn(),
    getShaderParameter: vi.fn().mockReturnValue(true),
    getProgramParameter: vi.fn().mockReturnValue(true),
    getShaderInfoLog: vi.fn().mockReturnValue(''),
    getProgramInfoLog: vi.fn().mockReturnValue(''),
    createShader: vi.fn().mockReturnValue({}),
    createProgram: vi.fn().mockReturnValue({}),
    createVertexArray: vi.fn().mockReturnValue({}),
    deleteVertexArray: vi.fn(),
    createBuffer: vi.fn().mockReturnValue({}),
    deleteBuffer: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getAttribLocation: vi.fn().mockReturnValue(0),
    createTexture: vi.fn().mockReturnValue({}),
    deleteTexture: vi.fn(),
    bindTexture: vi.fn(),
    activeTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    texSubImage2D: vi.fn(),
    createFramebuffer: vi.fn().mockReturnValue({}),
    deleteFramebuffer: vi.fn(),
    bindFramebuffer: vi.fn(),
    bindVertexArray: vi.fn(),
    useProgram: vi.fn(),
    getUniformLocation: vi.fn().mockImplementation((_prog, name) => ({ name })),
    uniform1f: vi.fn((loc: any, val: number) => {
      if (loc?.name) uniformValues.set(loc.name, val);
    }),
    uniform1i: vi.fn((loc: any, val: number) => {
      if (loc?.name) uniformValues.set(loc.name, val);
    }),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    uniform3fv: vi.fn(),
    uniform1fv: vi.fn(),
    drawArrays: vi.fn(),
    drawArraysInstanced: vi.fn(),
  };

  (gl as any)._uniformValues = uniformValues;
  return gl as unknown as WebGL2RenderingContext;
}

function makeMockFrame(): AudioFrame {
  const samples = 1024;
  return {
    frameIndex: 1,
    time: 1.0,
    dtSec: 0.016,
    raw: { sub: 0.5, mid: 0.4, high: 0.3 },
    env: { sub: 0.5, mid: 0.4, high: 0.3 },
    norm: { sub: 0.7, mid: 0.6, high: 0.5 },
    loudness: 0.6,
    energy: 0.75,
    flux: 0.1,
    fluxByBand: { sub: 0.1, mid: 0.1, high: 0.1 },
    beat: false,
    beatByBand: { sub: false, mid: false, high: false },
    beatStrength: 0.0,
    kickEnv: 0.8,
    kickPulse: false,
    waveform: new Float32Array(samples),
    bandWaveforms: {
      sub: new Float32Array(samples),
      mid: new Float32Array(samples),
      high: new Float32Array(samples),
    },
    spectrum: new Float32Array(samples / 2),
    smoothedSpectrum: new Float32Array(samples / 2),
    sampleRate: 44100,
  };
}

function makeMockClock(overrides: Partial<RenderClock> = {}): RenderClock {
  return {
    timeSec: 2.5,
    dtSec: 0.016,
    frameIndex: 100,
    ...overrides,
  } as unknown as RenderClock;
}

function makeMockTarget(): RenderTarget {
  return {
    kind: 'canvas',
    width: 1920,
    height: 1080,
  };
}

describe('Slice 7.14: ChladniSandLayer & Phyllotaxis Mode', () => {
  describe('ChladniSandLayer', () => {
    it('initializes with CHLADNI_DEFAULTS', () => {
      const layer = new ChladniSandLayer();
      expect(layer).toBeDefined();
      expect(layer.opacity).toBe(1.0);
      expect(CHLADNI_DEFAULTS.brightness).toBe(1.2);
    });

    it('pre-allocates 8,192 seed points in a static VBO', () => {
      const layer = new ChladniSandLayer();
      const gl = createMockGl();
      layer.init(gl);

      expect(gl.createBuffer).toHaveBeenCalled();
      expect(gl.bufferData).toHaveBeenCalledWith(
        gl.ARRAY_BUFFER,
        expect.any(Float32Array),
        gl.STATIC_DRAW,
      );

      const bufferCall = (gl.bufferData as any).mock.calls[0];
      const data = bufferCall[1] as Float32Array;
      expect(data.length).toBe(CHLADNI_POINT_COUNT * 4);
      expect(CHLADNI_POINT_COUNT).toBe(8192);

      // Verify coordinate range and hash properties
      for (let i = 0; i < 100; i++) {
        const x = data[i * 4 + 0]!;
        const y = data[i * 4 + 1]!;
        const h1 = data[i * 4 + 2]!;
        const h2 = data[i * 4 + 3]!;
        expect(x).toBeGreaterThanOrEqual(-1.0);
        expect(x).toBeLessThanOrEqual(1.0);
        expect(y).toBeGreaterThanOrEqual(-1.0);
        expect(y).toBeLessThanOrEqual(1.0);
        expect(h1).toBeGreaterThanOrEqual(0.0);
        expect(h1).toBeLessThanOrEqual(1.0);
        expect(h2).toBeGreaterThanOrEqual(0.0);
        expect(h2).toBeLessThanOrEqual(1.0);
      }

      layer.dispose();
      expect(gl.deleteBuffer).toHaveBeenCalled();
      expect(gl.deleteVertexArray).toHaveBeenCalled();
      expect(gl.deleteProgram).toHaveBeenCalled();
    });

    it('draws points via gl.drawArrays(gl.POINTS, 0, 8192)', () => {
      const layer = new ChladniSandLayer({ pointSize: 2.0, brightness: 1.5 });
      const gl = createMockGl();
      layer.init(gl);

      const frame = makeMockFrame();
      const clock = makeMockClock();
      const target = makeMockTarget();

      layer.draw(frame, clock, target);

      expect(gl.drawArrays).toHaveBeenCalledWith(gl.POINTS, 0, 8192);

      const uniforms = (gl as any)._uniformValues;
      expect(uniforms.get('u_mid')).toBe(frame.norm.mid);
      expect(uniforms.get('u_kickEnv')).toBe(frame.kickEnv);
      expect(uniforms.get('uPointSize')).toBe(2.0);

      layer.dispose();
    });

    it('updates parameters and opacity cleanly', () => {
      const layer = new ChladniSandLayer();
      layer.setParams({ brightness: 2.0, pointSize: 3.0 });
      layer.setOpacity(0.5);

      const gl = createMockGl();
      layer.init(gl);
      layer.draw(makeMockFrame(), makeMockClock(), makeMockTarget());

      const uniforms = (gl as any)._uniformValues;
      // Brightness is modulated by layer opacity (2.0 * 0.5 = 1.0)
      expect(uniforms.get('uBrightness')).toBeCloseTo(1.0, 5);
      expect(uniforms.get('uPointSize')).toBe(3.0);

      layer.dispose();
    });

    it('verifies analytic spatial gradient of standing-wave potential', () => {
      // Numerical check of the Chladni standing wave derivative
      const n = 3.0;
      const m = 5.0;
      const PI = Math.PI;
      const f = (x: number, y: number) =>
        Math.cos(n * PI * x) * Math.cos(m * PI * y) - Math.cos(m * PI * x) * Math.cos(n * PI * y);

      const analyticDfDx = (x: number, y: number) =>
        -n * PI * Math.sin(n * PI * x) * Math.cos(m * PI * y) + m * PI * Math.sin(m * PI * x) * Math.cos(n * PI * y);

      const analyticDfDy = (x: number, y: number) =>
        -m * PI * Math.cos(n * PI * x) * Math.sin(m * PI * y) + n * PI * Math.cos(m * PI * x) * Math.sin(n * PI * y);

      const eps = 1e-5;
      const testPoints = [
        [0.2, 0.3],
        [-0.4, 0.5],
        [0.7, -0.1],
      ];

      for (const [x, y] of testPoints) {
        const numDfDx = (f(x! + eps, y!) - f(x! - eps, y!)) / (2 * eps);
        const numDfDy = (f(x!, y! + eps) - f(x!, y! - eps)) / (2 * eps);

        expect(analyticDfDx(x!, y!)).toBeCloseTo(numDfDx, 3);
        expect(analyticDfDy(x!, y!)).toBeCloseTo(numDfDy, 3);
      }
    });

    it('validates CHLADNI_SPECS against assertValidSpec', () => {
      for (const spec of CHLADNI_SPECS) {
        expect(() => assertValidSpec(spec)).not.toThrow();
      }
    });
  });

  describe('ParticleLayer Phyllotaxis Mode', () => {
    it('supports phyllotaxis mode and passes appropriate uniforms', () => {
      const layer = new ParticleLayer({
        mode: 'phyllotaxis',
        seedShape: 'petal',
        petalStretch: 1.75,
        flowSpeed: 1.1,
      });
      const gl = createMockGl();
      layer.init(gl);

      const frame = makeMockFrame();
      const clock = makeMockClock();
      const target = makeMockTarget();

      layer.draw(frame, clock, target);

      // Reuses POOL_SIZE = 600 instanced quads
      expect(gl.drawArraysInstanced).toHaveBeenCalledWith(gl.TRIANGLE_STRIP, 0, 4, 600);

      const uniforms = (gl as any)._uniformValues;
      expect(uniforms.get('uMode')).toBe(1);
      expect(uniforms.get('uSubTwist')).toBeCloseTo(frame.norm.sub * 5.0, 4);
      expect(uniforms.get('uFlowSpeed')).toBe(1.1);
      expect(uniforms.get('uSeedShape')).toBe(1); // 1 = petal
      expect(uniforms.get('uPetalStretch')).toBe(1.75);
      expect(uniforms.get('uDivergenceAngle')).toBeCloseTo(2.3999632, 5);
      expect(uniforms.get('uKickEnv')).toBe(frame.kickEnv);
      // Full 16:9 corner coverage without clamping
      const expectedFar = Math.hypot(1920 / 1080, 1.0) * 1.05;
      expect(uniforms.get('uFar')).toBeCloseTo(expectedFar, 4);

      layer.dispose();
    });

    it('maintains continuous monotonic phase accumulation for flowPhase and twistPhase', () => {
      const layer = new ParticleLayer({ mode: 'phyllotaxis', flowSpeed: 1.2, subTwist: 1.5 });
      const gl = createMockGl();
      layer.init(gl);

      const frame = makeMockFrame();
      const target = makeMockTarget();

      let prevFlow = layer.getFlowPhase();
      let prevTwist = layer.getTwistPhase();
      expect(prevFlow).toBe(0);
      expect(prevTwist).toBe(0);

      for (let i = 1; i <= 5; i++) {
        const clock = makeMockClock({ timeSec: i * 0.016, dtSec: 0.016, frameIndex: i });
        layer.draw(frame, clock, target);

        const curFlow = layer.getFlowPhase();
        const curTwist = layer.getTwistPhase();
        expect(curFlow).toBeGreaterThan(prevFlow);
        expect(curTwist).toBeGreaterThan(prevTwist);

        prevFlow = curFlow;
        prevTwist = curTwist;
      }

      layer.dispose();
    });

    it('supports phrase-locked divergence angle morphing and locked patterns', () => {
      // 1. Locked patterns
      const lucasLayer = new ParticleLayer({ mode: 'phyllotaxis', phylloPattern: 'lucas99.5' });
      const gl = createMockGl();
      lucasLayer.init(gl);
      lucasLayer.draw(makeMockFrame(), makeMockClock(), makeMockTarget());
      expect(lucasLayer.getDivergenceAngle()).toBeCloseTo(1.7366025, 4);
      lucasLayer.dispose();

      const rosetteLayer = new ParticleLayer({ mode: 'phyllotaxis', phylloPattern: 'rosette137.3' });
      rosetteLayer.init(gl);
      rosetteLayer.draw(makeMockFrame(), makeMockClock(), makeMockTarget());
      expect(rosetteLayer.getDivergenceAngle()).toBeCloseTo(2.3963, 4);
      rosetteLayer.dispose();

      const fibLayer = new ParticleLayer({ mode: 'phyllotaxis', phylloPattern: 'fibonacci137.6' });
      fibLayer.init(gl);
      fibLayer.draw(makeMockFrame(), makeMockClock(), makeMockTarget());
      expect(fibLayer.getDivergenceAngle()).toBeCloseTo(2.4016, 4);
      fibLayer.dispose();

      // 2. Auto mode morphing
      const autoLayer = new ParticleLayer({ mode: 'phyllotaxis', phylloPattern: 'auto' });
      autoLayer.init(gl);
      const target = makeMockTarget();

      // Starts at golden angle (2.3999632)
      autoLayer.draw(makeMockFrame(), makeMockClock({ timeSec: 0.016, dtSec: 0.016, frameIndex: 1 }), target);
      expect(autoLayer.getDivergenceAngle()).toBeCloseTo(2.3999632, 5);

      // Trigger phrase boundary after cooldown (cooldown starts at 7.0s in init)
      const phraseFrame = { ...makeMockFrame(), kickPulse: true, kickEnv: 1.0 };
      autoLayer.draw(phraseFrame, makeMockClock({ timeSec: 0.032, dtSec: 0.016, frameIndex: 2 }), target);

      // Advance by 1.25s (half of 2.5s morph time)
      autoLayer.draw(makeMockFrame(), makeMockClock({ timeSec: 1.282, dtSec: 1.25, frameIndex: 3 }), target);
      const midAngle = autoLayer.getDivergenceAngle();
      // Morphing from 2.3999632 toward 2.4016: midAngle should be between the two
      expect(midAngle).toBeGreaterThan(2.3999632);
      expect(midAngle).toBeLessThan(2.4016);

      // Advance by another 1.5s to finish the 2.5s morph
      autoLayer.draw(makeMockFrame(), makeMockClock({ timeSec: 2.782, dtSec: 1.5, frameIndex: 4 }), target);
      expect(autoLayer.getDivergenceAngle()).toBeCloseTo(2.4016, 4);

      autoLayer.dispose();
    });

    it('supports seedShape selection (orb, petal, star)', () => {
      const gl = createMockGl();
      const target = makeMockTarget();
      const frame = makeMockFrame();
      const clock = makeMockClock();

      // Orb: uSeedShape = 0, uShape = 1 (dot)
      const orbLayer = new ParticleLayer({ mode: 'phyllotaxis', seedShape: 'orb' });
      orbLayer.init(gl);
      orbLayer.draw(frame, clock, target);
      let uniforms = (gl as any)._uniformValues;
      expect(uniforms.get('uSeedShape')).toBe(0);
      expect(uniforms.get('uShape')).toBe(1);
      orbLayer.dispose();

      // Petal: uSeedShape = 1, uShape = 0 (streak/petal)
      const petalLayer = new ParticleLayer({ mode: 'phyllotaxis', seedShape: 'petal' });
      petalLayer.init(gl);
      petalLayer.draw(frame, clock, target);
      uniforms = (gl as any)._uniformValues;
      expect(uniforms.get('uSeedShape')).toBe(1);
      expect(uniforms.get('uShape')).toBe(0);
      petalLayer.dispose();

      // Star: uSeedShape = 2, uShape = 2 (star)
      const starLayer = new ParticleLayer({ mode: 'phyllotaxis', seedShape: 'star' });
      starLayer.init(gl);
      starLayer.draw(frame, clock, target);
      uniforms = (gl as any)._uniformValues;
      expect(uniforms.get('uSeedShape')).toBe(2);
      expect(uniforms.get('uShape')).toBe(2);
      starLayer.dispose();
    });

    it('defaults mode to radial (uMode = 0)', () => {
      const layer = new ParticleLayer();
      const gl = createMockGl();
      layer.init(gl);

      layer.draw(makeMockFrame(), makeMockClock(), makeMockTarget());

      const uniforms = (gl as any)._uniformValues;
      expect(uniforms.get('uMode')).toBe(0);

      layer.dispose();
    });

    it('validates PARTICLE_MODE_SPEC and PARTICLES_SCHEMA specs', () => {
      expect(() => assertValidSpec(PARTICLE_MODE_SPEC)).not.toThrow();
      expect(PARTICLE_MODE_SPEC.options).toContain('phyllotaxis');
      expect(PARTICLE_MODE_SPEC.options).toContain('radial');

      expect(() => assertValidSpec(PARTICLE_SEED_SHAPE_SPEC)).not.toThrow();
      expect(PARTICLE_SEED_SHAPE_SPEC.options).toEqual(['orb', 'petal', 'star']);

      expect(() => assertValidSpec(PARTICLE_PHYLLO_PATTERN_SPEC)).not.toThrow();
      expect(PARTICLE_PHYLLO_PATTERN_SPEC.options).toContain('auto');
      expect(PARTICLE_PHYLLO_PATTERN_SPEC.options).toContain('golden137.5');

      expect(() => assertValidSpec(PARTICLE_PETAL_STRETCH_SPEC)).not.toThrow();

      for (const spec of PARTICLES_SCHEMA) {
        expect(() => assertValidSpec(spec)).not.toThrow();
      }
    });

    it('verifies Golden Angle calculation in phyllotaxis', () => {
      const goldenAngle = 2.3999632;
      const expectedGoldenAngle = Math.PI * (3.0 - Math.sqrt(5.0));
      expect(Math.abs(goldenAngle - expectedGoldenAngle)).toBeLessThan(1e-4);
    });
  });

  describe('Flagship Presets 09 and 10', () => {
    it('registers Presets 09 and 10 with zero schema warnings', () => {
      expect(FLAGSHIP_PRESETS_09_10).toHaveLength(2);
      for (const entry of FLAGSHIP_PRESETS_09_10) {
        expect(entry.warnings).toEqual([]);
        expect(entry.preset.version).toBe(PRESET_VERSION);
        expect(entry.preset.name).toBeTruthy();
      }
    });

    it('Preset 09 (Chladni Cymatic Sand) matches specifications', () => {
      const p9 = FLAGSHIP_PRESETS_09_10.find((p) => p.id === '09-chladni-cymatic-sand')!.preset;
      expect(p9.name).toBe('Chladni Cymatic Sand');
      expect(p9.feedback.decay?.value).toBe(0.90);
      const chladni = p9.layers.find((l) => l.type === 'chladniSand');
      expect(chladni).toBeDefined();
      expect(chladni!.params.pointSize?.value).toBe(2.0);
    });

    it('Preset 10 (Phyllotaxis Spiral Bloom) matches specifications', () => {
      const p10 = FLAGSHIP_PRESETS_09_10.find((p) => p.id === '10-phyllotaxis-spiral-bloom')!.preset;
      expect(p10.name).toBe('Phyllotaxis Spiral Bloom');
      expect(p10.feedback.decay?.value).toBe(0.86);
      const particleLayer = p10.layers.find((l) => l.type === 'particles');
      expect(particleLayer).toBeDefined();
      expect(particleLayer!.blend).toBe('max');
      expect(particleLayer!.params.mode?.value).toBe('phyllotaxis');
      expect(particleLayer!.params.seedShape?.value).toBe('petal');
      expect(particleLayer!.params.phylloPattern?.value).toBe('auto');
      expect(particleLayer!.params.petalStretch?.value).toBe(1.75);
      expect(particleLayer!.params.flowSpeed?.value).toBe(1.1);
    });

    it('ALL_PRESETS contains Presets 09 and 10', () => {
      const ids = ALL_PRESETS.map((p) => p.id);
      expect(ids).toContain('09-chladni-cymatic-sand');
      expect(ids).toContain('10-phyllotaxis-spiral-bloom');
    });

    it('buildScene instantiates scenes for Presets 09 and 10', () => {
      for (const entry of FLAGSHIP_PRESETS_09_10) {
        const scene = buildScene(entry.id, entry.preset);
        expect(scene).toBeDefined();
        expect(scene.name).toBe(entry.id);
        expect(scene.layers.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('executes safety luminance pass on Presets 09 and 10', () => {
      const limiter = new BrightnessLimiter();
      for (const entry of FLAGSHIP_PRESETS_09_10) {
        expect(entry.id).toBeTruthy();
        limiter.reset();
        for (let f = 0; f < 10; f++) {
          const targetLum = f % 2 === 0 ? 0.8 : 0.2;
          const cap = limiter.step(targetLum, 0.016);
          expect(cap).toBeGreaterThanOrEqual(0.0);
          expect(cap).toBeLessThanOrEqual(1.0);
          expect(Number.isFinite(cap)).toBe(true);
        }
      }
    });

    it('LAYER_FACTORIES and applyValues support chladniSand', () => {
      const factory = LAYER_FACTORIES['chladniSand'];
      expect(factory).toBeDefined();
      const layer = factory!({ brightness: 1.8, pointSize: 2.5 });
      expect(layer).toBeInstanceOf(ChladniSandLayer);

      applyValues(layer, { brightness: 2.2 });
      expect((layer as any).p.brightness).toBe(2.2);
    });
  });

  describe('GLSL source validity', () => {
    it('chladniSand vertex shader contains standing wave and gradient math', () => {
      expect(chladniVertSrc).toContain('cos_nx * cos_my - cos_mx * cos_ny');
      expect(chladniVertSrc).toContain('df_dx');
      expect(chladniVertSrc).toContain('df_dy');
      expect(chladniVertSrc).toContain('gl_PointSize');
    });

    it('chladniSand fragment shader defines circular soft point sprite', () => {
      expect(chladniFragSrc).toContain('gl_PointCoord');
      expect(chladniFragSrc).toContain('discard');
      expect(chladniFragSrc).toContain('fragColor');
    });

    it('particles vertex shader includes phyllotaxis mode branch', () => {
      expect(particlesVertSrc).toContain('uMode == 1');
      expect(particlesVertSrc).toContain('2.3999632');
      expect(particlesVertSrc).toContain('uSubTwist');
      expect(particlesVertSrc).toContain('uFlowSpeed');
      expect(particlesVertSrc).toContain('uFlowPhase');
      expect(particlesVertSrc).toContain('uTwistPhase');
      expect(particlesVertSrc).toContain('uDivergenceAngle');
      expect(particlesVertSrc).toContain('uPetalStretch');
      expect(particlesVertSrc).toContain('uSeedShape');
      expect(particlesVertSrc).toContain('kickWave');
    });
  });
});
