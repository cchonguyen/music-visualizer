import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ShapeLayer,
  SHAPE_AMP_MAX,
  SHAPE_REACTIVITY_MAX,
  SHAPE_HISTORY_FRAMES,
  SHAPE_TEXELS,
  BOUNCE_WALL_INSET,
  elementLagFrames,
  applyCopyMotion,
  bucketExtreme,
  peakBandValues,
  computeShapeBounceExtents,
  stepBouncePhysics,
} from '../layers/shape';
import { SHAPE_DEFAULTS, SHAPE_SPECS } from '../../presets/layerSchemas';
import { getVisualGain, setVisualGain } from '../gainStore';
import type { AudioFrame } from '../../audio/types';
import type { RenderClock } from '../clock';
import type { RenderTarget } from '../layer';
import vertSrc from '../shaders/shape.vert.glsl?raw';
import fragSrc from '../shaders/shape.frag.glsl?raw';

function createMockGl(): WebGL2RenderingContext & {
  uniformValues: Map<string, any>;
  drawCalls: Array<{ mode: number; first: number; count: number; primcount: number }>;
} {
  const uniformValues = new Map<string, any>();
  const drawCalls: Array<{ mode: number; first: number; count: number; primcount: number }> = [];

  const gl = {
    TRIANGLES: 0x0004,
    TRIANGLE_STRIP: 0x0005,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE_2D: 0x0de1,
    FRAMEBUFFER: 0x8d40,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    R32F: 0x822e,
    RED: 0x1903,
    FLOAT: 0x1406,
    LINEAR: 0x2601,
    NEAREST: 0x2600,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    CLAMP_TO_EDGE: 0x812f,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,

    uniformValues,
    drawCalls,

    getExtension: vi.fn().mockReturnValue(null),
    enable: vi.fn(),
    disable: vi.fn(),
    blendFunc: vi.fn(),
    viewport: vi.fn(),
    bindFramebuffer: vi.fn(),
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
    bindVertexArray: vi.fn(),
    createTexture: vi.fn().mockReturnValue({}),
    deleteTexture: vi.fn(),
    bindTexture: vi.fn(),
    activeTexture: vi.fn(),
    texImage2D: vi.fn(),
    texSubImage2D: vi.fn(),
    texParameteri: vi.fn(),
    useProgram: vi.fn(),
    getUniformLocation: vi.fn().mockImplementation((_prog, name) => ({ name })),
    uniform1f: vi.fn((loc: any, val: number) => {
      if (loc?.name) uniformValues.set(loc.name, val);
    }),
    uniform1i: vi.fn((loc: any, val: number) => {
      if (loc?.name) uniformValues.set(loc.name, val);
    }),
    uniform2f: vi.fn((loc: any, x: number, y: number) => {
      if (loc?.name) uniformValues.set(loc.name, [x, y]);
    }),
    uniform3f: vi.fn((loc: any, x: number, y: number, z: number) => {
      if (loc?.name) uniformValues.set(loc.name, [x, y, z]);
    }),
    uniform4f: vi.fn((loc: any, x: number, y: number, z: number, w: number) => {
      if (loc?.name) uniformValues.set(loc.name, [x, y, z, w]);
    }),
    uniform2fv: vi.fn((loc: any, val: Float32Array) => {
      if (loc?.name) uniformValues.set(loc.name, new Float32Array(val));
    }),
    uniform4fv: vi.fn((loc: any, val: Float32Array) => {
      if (loc?.name) uniformValues.set(loc.name, new Float32Array(val));
    }),
    drawArraysInstanced: vi.fn((mode: number, first: number, count: number, primcount: number) => {
      drawCalls.push({ mode, first, count, primcount });
    }),
  };

  return gl as unknown as WebGL2RenderingContext & {
    uniformValues: Map<string, any>;
    drawCalls: Array<{ mode: number; first: number; count: number; primcount: number }>;
  };
}

function makeMockFrame(overrides: Partial<AudioFrame> = {}): AudioFrame {
  const spectrum = new Float32Array(256).fill(0.5);
  const waveform = new Float32Array(1024).fill(0.0);
  const subWf = new Float32Array(1024).fill(0.4);
  const midWf = new Float32Array(1024).fill(0.3);
  const highWf = new Float32Array(1024).fill(0.2);

  return {
    frameIndex: 1,
    time: 1.0,
    dtSec: 0.016,
    raw: { sub: 0.5, mid: 0.4, high: 0.3 },
    env: { sub: 0.6, mid: 0.4, high: 0.3 },
    norm: { sub: 0.7, mid: 0.5, high: 0.4 },
    loudness: 0.5,
    energy: 0.6,
    flux: 0.1,
    fluxByBand: { sub: 0.1, mid: 0.1, high: 0.1 },
    beat: false,
    beatByBand: { sub: false, mid: false, high: false },
    beatStrength: 0.5,
    kickEnv: 0.3,
    kickPulse: false,
    waveform,
    bandWaveforms: { sub: subWf, mid: midWf, high: highWf },
    spectrum,
    smoothedSpectrum: spectrum,
    sampleRate: 44100,
    ...overrides,
  };
}

const mockClock: RenderClock = {
  timeSec: 10.0,
  dtSec: 0.016,
  frameIndex: 100,
};

const mockTarget: RenderTarget = {
  kind: 'canvas',
  width: 1920,
  height: 1080,
};

describe('ShapeLayer', () => {
  let gl: ReturnType<typeof createMockGl>;

  beforeEach(() => {
    gl = createMockGl();
  });

  describe('Lifecycle & Parameter Management', () => {
    it('initializes with SHAPE_DEFAULTS', () => {
      const layer = new ShapeLayer();
      expect(layer.getParams()).toEqual(SHAPE_DEFAULTS);
    });

    it('accepts partial param overrides in constructor', () => {
      const layer = new ShapeLayer({ baseShape: 'star', sides: 8, reactivity: 2.0 });
      const p = layer.getParams();
      expect(p.baseShape).toBe('star');
      expect(p.sides).toBe(8);
      expect(p.reactivity).toBe(2.0);
      expect(p.size).toBe(SHAPE_DEFAULTS.size);
    });

    it('updates parameters dynamically via setParams', () => {
      const layer = new ShapeLayer();
      layer.setParams({ effectType: 'auroraFill', colorMode: 'amplitudeHot' });
      const p = layer.getParams();
      expect(p.effectType).toBe('auroraFill');
      expect(p.colorMode).toBe('amplitudeHot');
    });

    it('throws error when draw is called before init', () => {
      const layer = new ShapeLayer();
      expect(() => layer.draw(makeMockFrame(), mockClock, mockTarget)).toThrowError(
        'ShapeLayer: draw before init',
      );
    });

    it('initializes GL resources in init and cleans them up in dispose', () => {
      const layer = new ShapeLayer();
      layer.init(gl);
      expect(gl.createProgram).toHaveBeenCalled();
      expect(gl.createVertexArray).toHaveBeenCalled();
      expect(gl.createTexture).toHaveBeenCalledTimes(2); // audioTex & peakTex

      layer.dispose();
      expect(gl.deleteProgram).toHaveBeenCalled();
      expect(gl.deleteVertexArray).toHaveBeenCalled();
      expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    });

    it('supports resize call safely', () => {
      const layer = new ShapeLayer();
      layer.init(gl);
      expect(() => layer.resize(2560, 1440, 2)).not.toThrow();
    });
  });

  describe('Audio Envelope Smoothing & Reactivity', () => {
    it('applies asymmetric attack and release smoothing to audio samples', () => {
      const layer = new ShapeLayer({
        audioSource: 'energy',
        reactivity: 1.0,
        attackMs: 50,
        releaseMs: 200,
      });
      layer.init(gl);

      // Frame 1: sudden jump to energy = 1.0
      const frameHigh = makeMockFrame({ energy: 1.0 });
      layer.draw(frameHigh, { timeSec: 0.05, dtSec: 0.05, frameIndex: 1 }, mockTarget);
      const afterJump = layer.smoothedSamples[0]!;
      expect(afterJump).toBeGreaterThan(0.5);
      expect(afterJump).toBeLessThan(1.0); // attack in progress

      // Frame 2: sudden drop to energy = 0.0
      const frameLow = makeMockFrame({ energy: 0.0 });
      layer.draw(frameLow, { timeSec: 0.1, dtSec: 0.05, frameIndex: 2 }, mockTarget);
      const afterDrop = layer.smoothedSamples[0]!;
      expect(afterDrop).toBeLessThan(afterJump);
      expect(afterDrop).toBeGreaterThan(0.0); // release in progress
    });

    it('extracts band waveforms for sub, mid, treble sources', () => {
      for (const source of ['sub', 'mid', 'treble', 'waveform', 'spectrum'] as const) {
        const layer = new ShapeLayer({ audioSource: source });
        layer.init(gl);
        expect(() => layer.draw(makeMockFrame(), mockClock, mockTarget)).not.toThrow();
      }
    });
  });

  describe('Peak Caps Buffer & Gravity Decay', () => {
    it('tracks peaks and falls with gravity when peakCaps is true', () => {
      const layer = new ShapeLayer({
        audioSource: 'energy',
        peakCaps: true,
        attackMs: 5,
        releaseMs: 500,
      });
      layer.init(gl);

      // Frame 1: Peak hit
      const frame1 = makeMockFrame({ energy: 1.0 });
      layer.draw(frame1, { timeSec: 0.02, dtSec: 0.02, frameIndex: 1 }, mockTarget);
      const peak1 = layer.peakHoldSamples[0]!;
      expect(peak1).toBeGreaterThan(0.9);

      // Frame 2: Energy drops, peak cap decays under gravity
      const frame2 = makeMockFrame({ energy: 0.1 });
      layer.draw(frame2, { timeSec: 0.1, dtSec: 0.08, frameIndex: 2 }, mockTarget);
      const peak2 = layer.peakHoldSamples[0]!;
      expect(peak2).toBeLessThanOrEqual(peak1);
      expect(peak2).toBeGreaterThan(layer.smoothedSamples[0]!);
    });

    it('zeroes peakHoldSamples when peakCaps is false', () => {
      const layer = new ShapeLayer({
        audioSource: 'energy',
        peakCaps: false,
      });
      layer.init(gl);
      layer.draw(makeMockFrame({ energy: 1.0 }), mockClock, mockTarget);
      expect(layer.peakHoldSamples[0]).toBe(0);
      expect(gl.uniformValues.get('uPeakCaps')).toBe(0);
    });
  });

  describe('Base Geometries', () => {
    const geometries = [
      'centerLine',
      'edgeLine',
      'circle',
      'arc',
      'polygon',
      'star',
      'spiral',
      'figure8',
      'knot3d',
      'twistWave',
    ] as const;

    it.each(geometries)('renders baseShape %s with proper uniform upload', (shape) => {
      const layer = new ShapeLayer({ baseShape: shape, sides: 5, starInner: 0.45, cornerRadius: 0.1 });
      layer.init(gl);
      layer.draw(makeMockFrame(), mockClock, mockTarget);

      expect(gl.drawCalls.length).toBeGreaterThan(0);
      expect(gl.uniformValues.has('uBaseShape')).toBe(true);
    });

    it('passes edgeMode variants correctly for edgeLine', () => {
      const edgeModes = ['bottom', 'top', 'dualHorizontal', 'dualVertical', 'frame'] as const;
      for (let i = 0; i < edgeModes.length; i++) {
        const layer = new ShapeLayer({ baseShape: 'edgeLine', edgeMode: edgeModes[i] });
        layer.init(gl);
        layer.draw(makeMockFrame(), mockClock, mockTarget);
        expect(gl.uniformValues.get('uEdgeMode')).toBe(i);
      }
    });
  });

  describe('Reactive Effects (Ribbons vs Discrete)', () => {
    it('renders continuous ribbon effects with uIsRibbon = 1 and (sampleCount + 1) * 2 vertices', () => {
      const ribbonEffects = ['solidLine', 'pulsingLine', 'waveform', 'harmonicWave', 'auroraFill'] as const;
      for (const effect of ribbonEffects) {
        gl.drawCalls.length = 0;
        const sampleCount = 64;
        const layer = new ShapeLayer({ effectType: effect, sampleCount });
        layer.init(gl);
        layer.draw(makeMockFrame(), mockClock, mockTarget);

        expect(gl.uniformValues.get('uIsRibbon')).toBe(1);
        expect(gl.drawCalls[0]?.mode).toBe(gl.TRIANGLE_STRIP);
        expect(gl.drawCalls[0]?.count).toBe((sampleCount + 1) * 2);
      }
    });

    it('renders discrete effects (bars, segmentedBars, dots) with uIsRibbon = 0 and 4 vertices per quad', () => {
      const discreteEffects = ['bars', 'segmentedBars', 'dots'] as const;
      for (const effect of discreteEffects) {
        gl.drawCalls.length = 0;
        const sampleCount = 32;
        const layer = new ShapeLayer({ effectType: effect, sampleCount, propMode: 'single' });
        layer.init(gl);
        layer.draw(makeMockFrame(), mockClock, mockTarget);

        expect(gl.uniformValues.get('uIsRibbon')).toBe(0);
        expect(gl.drawCalls[0]?.mode).toBe(gl.TRIANGLE_STRIP);
        expect(gl.drawCalls[0]?.count).toBe(4);
        expect(gl.drawCalls[0]?.primcount).toBe(32); // 32 instances
      }
    });
  });

  describe('Extrusion & Direction Modes', () => {
    it('sets extrudeDirection uniform correctly', () => {
      const dirs = ['outward', 'inward', 'bilateral', 'alternating'] as const;
      for (let i = 0; i < dirs.length; i++) {
        const layer = new ShapeLayer({ extrudeDirection: dirs[i] });
        layer.init(gl);
        layer.draw(makeMockFrame(), mockClock, mockTarget);
        expect(gl.uniformValues.get('uExtrudeDir')).toBe(i);
      }
    });
  });

  describe('Symmetry Mappings', () => {
    it('sets symmetry uniform correctly', () => {
      const symmetries = ['wrap', 'mirror', 'repeat2', 'repeat4'] as const;
      for (let i = 0; i < symmetries.length; i++) {
        const layer = new ShapeLayer({ symmetry: symmetries[i] });
        layer.init(gl);
        layer.draw(makeMockFrame(), mockClock, mockTarget);
        expect(gl.uniformValues.get('uSymmetry')).toBe(i);
      }
    });
  });

  describe('Propagation Modes', () => {
    it('handles single, concentric, stream, orbit, and polar modes', () => {
      const modes = ['single', 'concentric', 'stream', 'orbit', 'polar'] as const;
      for (const mode of modes) {
        gl.drawCalls.length = 0;
        const layer = new ShapeLayer({ propMode: mode, propCount: 5 });
        layer.init(gl);
        layer.draw(makeMockFrame(), mockClock, mockTarget);

        expect(gl.drawCalls.length).toBeGreaterThan(0);
        const offsets = gl.uniformValues.get('uInstOffset[0]') as Float32Array;
        const transforms = gl.uniformValues.get('uInstTransform[0]') as Float32Array;
        expect(offsets).toBeDefined();
        expect(transforms).toBeDefined();
      }
    });

    it('triggers shockwave on sub-bass kicks', () => {
      const layer = new ShapeLayer({ propMode: 'shockwave', propSpeed: 1.0 });
      layer.init(gl);

      // Frame with kick
      const frameKick = makeMockFrame({
        beat: true,
        beatByBand: { sub: true, mid: false, high: false },
      });
      layer.draw(frameKick, mockClock, mockTarget);

      expect(gl.drawCalls.length).toBeGreaterThan(0);
      const transforms = gl.uniformValues.get('uInstTransform[0]') as Float32Array;
      expect(transforms[2]).toBeGreaterThan(0); // alpha > 0
    });
  });

  describe('Color Modes, Opacity & Glow', () => {
    it('sets colorMode and parses solidColor', () => {
      const layer = new ShapeLayer({ colorMode: 'solid', solidColor: '#ff8800' });
      layer.init(gl);
      layer.draw(makeMockFrame(), mockClock, mockTarget);

      expect(gl.uniformValues.get('uColorMode')).toBe(0);
      const solidRgb = gl.uniformValues.get('uSolidColor');
      expect(solidRgb[0]).toBeCloseTo(1.0, 2);
      expect(solidRgb[1]).toBeCloseTo(0.533, 2);
      expect(solidRgb[2]).toBeCloseTo(0.0, 2);
    });

    it('applies layer opacity options correctly', () => {
      const layer = new ShapeLayer();
      layer.init(gl);
      layer.draw(makeMockFrame(), mockClock, mockTarget, { uLayerOpacity: 0.65 });
      expect(gl.uniformValues.get('uLayerOpacity')).toBeCloseTo(0.65, 2);
    });

    it('scales output color by layer opacity so additive blend respects the opacity slider', () => {
      const scaleIdx = fragSrc.indexOf('col *= uLayerOpacity;');
      const outIdx = fragSrc.indexOf('fragColor = vec4(');
      expect(scaleIdx).toBeGreaterThan(-1);
      expect(scaleIdx).toBeLessThan(outIdx);
    });

    it('sets glow bloom uniform', () => {
      const layer = new ShapeLayer({ glow: 1.25 });
      layer.init(gl);
      layer.draw(makeMockFrame(), mockClock, mockTarget);
      expect(gl.uniformValues.get('uGlow')).toBeCloseTo(1.25, 2);
    });
  });

  describe('Reactivity ceiling (Slice 15.8)', () => {
    const settle = (energy: number, reactivity: number): number => {
      const layer = new ShapeLayer({ audioSource: 'energy', reactivity, attackMs: 1 });
      layer.init(gl);
      layer.draw(makeMockFrame({ energy }), { timeSec: 100, dtSec: 100, frameIndex: 1 }, mockTarget);
      return layer.smoothedSamples[0]!;
    };

    it('old maximum 3.0 draws the same as before (pinned 0.5 * 3.0 = 1.5, unclamped)', () => {
      expect(settle(0.5, 3.0)).toBeCloseTo(1.5, 3);
      expect(settle(0.6, 3.0)).toBeCloseTo(1.8, 3);
    });

    it('old clamp output at 2.0 is still reachable and unchanged for values below it', () => {
      expect(settle(2.0 / 3.0, 3.0)).toBeCloseTo(2.0, 3);
    });

    it('no longer clamps to 2.0 above the old ceiling, and clamps at the new ceiling', () => {
      expect(settle(1.0, 3.0)).toBeCloseTo(3.0, 3);
      expect(settle(1.0, 6.0)).toBeCloseTo(6.0, 3);
      expect(settle(1.0, SHAPE_REACTIVITY_MAX)).toBeCloseTo(SHAPE_AMP_MAX, 3);
    });

    it('schema accepts values above the old maximum of 3.0, about 5x', () => {
      const spec = SHAPE_SPECS.find((sp) => sp.name === 'reactivity') as { min: number; max: number };
      expect(spec.max).toBe(SHAPE_REACTIVITY_MAX);
      expect(spec.max).toBe(15.0);
      expect(SHAPE_AMP_MAX).toBe(10.0);
      expect(SHAPE_DEFAULTS.reactivity).toBe(1.25);
    });

    it('GLSL AMP_MAX constant matches the TypeScript constant', () => {
      const m = vertSrc.match(/const float AMP_MAX = ([0-9.]+);/);
      expect(m).not.toBeNull();
      expect(parseFloat(m![1]!)).toBe(SHAPE_AMP_MAX);
    });
  });

  describe('Signed scope source (Slice 19.1)', () => {
    it('draws a flat trace for silence', () => {
      const layer = new ShapeLayer({ audioSource: 'scope', reactivity: 1.0 });
      layer.init(gl);
      layer.draw(makeMockFrame(), mockClock, mockTarget);
      for (let j = 0; j < SHAPE_TEXELS; j++) expect(layer.smoothedSamples[j]).toBe(0);
    });

    it('keeps the sign of the waveform, unlike the unsigned waveform source', () => {
      const wf = new Float32Array(1024);
      for (let i = 0; i < wf.length; i++) wf[i] = i < 512 ? 0.5 : -0.5;
      const scope = new ShapeLayer({ audioSource: 'scope', reactivity: 1.0, attackMs: 5 });
      scope.init(gl);
      for (let k = 0; k < 20; k++) scope.draw(makeMockFrame({ waveform: wf }), mockClock, mockTarget);
      expect(scope.smoothedSamples[40]).toBeGreaterThan(0.4);
      expect(scope.smoothedSamples[1000]).toBeLessThan(-0.4);

      const legacy = new ShapeLayer({ audioSource: 'waveform', reactivity: 1.0, attackMs: 5 });
      legacy.init(gl);
      for (let k = 0; k < 20; k++) legacy.draw(makeMockFrame({ waveform: wf }), mockClock, mockTarget);
      expect(legacy.smoothedSamples[1000]).toBeGreaterThan(0);
    });

    it('clamps to the amplitude ceiling both ways', () => {
      const wf = new Float32Array(1024).fill(-1);
      const layer = new ShapeLayer({ audioSource: 'scope', reactivity: SHAPE_REACTIVITY_MAX, attackMs: 5 });
      layer.init(gl);
      for (let k = 0; k < 50; k++) layer.draw(makeMockFrame({ waveform: wf }), mockClock, mockTarget);
      expect(layer.smoothedSamples[0]).toBeGreaterThanOrEqual(-SHAPE_AMP_MAX);
      expect(layer.smoothedSamples[0]).toBeLessThan(-1);
    });

    it('is a schema option and the vertex shader colours by absolute amplitude', () => {
      const spec = SHAPE_SPECS.find((s) => s.name === 'audioSource') as unknown as { options: string[] };
      expect(spec.options).toContain('scope');
      expect(vertSrc).toContain('vAudioAmp = abs(audioAmp);');
    });
  });

  describe('Punch option (Slice 19.9a)', () => {
    const flat = (v: number) => {
      const s = new Float32Array(256).fill(v);
      return makeMockFrame({ spectrum: s, smoothedSpectrum: s });
    };
    /** Calm for 100 frames, then a sudden rise. Returns the sample after `after` loud frames. */
    const runRise = (params: Record<string, unknown>, after: number): number => {
      const layer = new ShapeLayer({ audioSource: 'spectrum', reactivity: 1.0, attackMs: 5, ...params });
      layer.init(gl);
      for (let k = 0; k < 100; k++) layer.draw(flat(0.3), mockClock, mockTarget);
      for (let k = 0; k < after; k++) layer.draw(flat(0.7), mockClock, mockTarget);
      return layer.smoothedSamples[128]!;
    };

    it('is a bool schema option, off by default, shown for the spectrum source only', () => {
      const spec = SHAPE_SPECS.find((s) => s.name === 'punch') as unknown as { type: string; default: boolean; showWhen: Record<string, string> };
      expect(spec.type).toBe('bool');
      expect(spec.default).toBe(false);
      expect(SHAPE_DEFAULTS.punch).toBe(false);
      expect(spec.showWhen).toEqual({ audioSource: 'spectrum' });
    });

    it('lifts a sudden rise above what the plain spectrum gives', () => {
      expect(runRise({ punch: true }, 5)).toBeGreaterThan(runRise({ punch: false }, 5));
    });

    it('settles once the rise has been held, because the average catches up', () => {
      expect(runRise({ punch: true }, 400)).toBeLessThan(runRise({ punch: true }, 5));
    });

    it('leaves other audio sources untouched', () => {
      const wf = new Float32Array(1024).fill(0.4);
      const run = (punchOn: boolean) => {
        const layer = new ShapeLayer({ audioSource: 'waveform', reactivity: 1.0, attackMs: 5, punch: punchOn });
        layer.init(gl);
        for (let k = 0; k < 20; k++) layer.draw(makeMockFrame({ waveform: wf }), mockClock, mockTarget);
        return layer.smoothedSamples[100]!;
      };
      expect(run(true)).toBe(run(false));
    });

    it('is scaled by the global visual gain', () => {
      const original = getVisualGain();
      try {
        setVisualGain(0.5);
        const calm = runRise({ punch: true }, 5);
        setVisualGain(1);
        const normal = runRise({ punch: true }, 5);
        expect(calm).toBeLessThan(normal);
      } finally {
        setVisualGain(original);
      }
    });
  });

  describe('Loudness-driven rings (Slice 19.9d)', () => {
    const quiet = () => makeMockFrame({ loudness: 0, energy: 0, norm: { sub: 0, mid: 0, high: 0 }, env: { sub: 0, mid: 0, high: 0 } });
    const loud = () => makeMockFrame({ loudness: 1, energy: 1, norm: { sub: 1, mid: 1, high: 1 }, env: { sub: 1, mid: 1, high: 1 } });
    /** Quiet for 100 frames, then `after` loud frames. Returns the last draw's instance count and stroke width. */
    const run = (params: Record<string, unknown>, after: number) => {
      const g = createMockGl();
      const layer = new ShapeLayer({ propMode: 'concentric', propCount: 8, effectType: 'solidLine', thickness: 2, ...params });
      layer.init(g);
      for (let k = 0; k < 100; k++) layer.draw(quiet(), mockClock, mockTarget);
      for (let k = 0; k < after; k++) layer.draw(loud(), mockClock, mockTarget);
      return { rings: g.drawCalls[g.drawCalls.length - 1]!.primcount, stroke: g.uniformValues.get('uThickness') as number };
    };

    it('is a bool schema option, off by default, shown for concentric mode only', () => {
      const spec = SHAPE_SPECS.find((s) => s.name === 'loudnessRings') as unknown as { type: string; default: boolean; showWhen: Record<string, string> };
      expect(spec.type).toBe('bool');
      expect(spec.default).toBe(false);
      expect(SHAPE_DEFAULTS.loudnessRings).toBe(false);
      expect(spec.showWhen).toEqual({ propMode: 'concentric' });
    });

    it('stays off by default: the full instance count and the set stroke width', () => {
      const r = run({}, 5);
      expect(r.rings).toBe(8);
      expect(r.stroke).toBe(2);
    });

    it('shows one thin ring in calm and more, wider rings when the music rises', () => {
      const calm = run({ loudnessRings: true }, 0);
      const rise = run({ loudnessRings: true }, 3);
      expect(calm.rings).toBe(1);
      expect(calm.stroke).toBeCloseTo(2 * 0.6, 5);
      expect(rise.rings).toBe(8);
      expect(rise.stroke).toBeGreaterThan(calm.stroke);
    });

    it('never shows more rings than the instance count', () => {
      expect(run({ loudnessRings: true, propCount: 3 }, 3).rings).toBeLessThanOrEqual(3);
    });

    it('settles to fewer rings once the loudness has been held, because its average catches up', () => {
      expect(run({ loudnessRings: true }, 500).rings).toBeLessThan(run({ loudnessRings: true }, 3).rings);
    });

    it('leaves other propagation modes untouched', () => {
      const r = run({ loudnessRings: true, propMode: 'single' }, 3);
      expect(r.rings).toBe(1);
      expect(r.stroke).toBe(2);
    });
  });

  describe('3D curve base (Slice 19.9c)', () => {
    const knot = (g: ReturnType<typeof createMockGl>) => g.uniformValues.get('uKnot') as number[];
    const run = (params: Record<string, unknown>, frames: number, frame = makeMockFrame()) => {
      const g = createMockGl();
      const layer = new ShapeLayer(params);
      layer.init(g);
      for (let k = 0; k < frames; k++) layer.draw(frame, mockClock, mockTarget);
      return g;
    };

    it('is a base shape option with a spin control that only shows for it', () => {
      const base = SHAPE_SPECS.find((s) => s.name === 'baseShape') as unknown as { options: string[] };
      expect(base.options).toContain('knot3d');
      const spin = SHAPE_SPECS.find((s) => s.name === 'knotSpin') as unknown as { type: string; default: number; min: number; max: number; showWhen: Record<string, string> };
      expect(spin.type).toBe('float');
      expect(spin.default).toBe(1);
      expect(spin.min).toBe(0);
      expect(spin.max).toBe(3);
      expect(spin.showWhen).toEqual({ baseShape: 'knot3d' });
    });

    it('uploads base shape 8 and turns over time', () => {
      const g = run({ baseShape: 'knot3d' }, 1);
      expect(g.uniformValues.get('uBaseShape')).toBe(8);
      const first = [...knot(g)];
      const later = [...knot(run({ baseShape: 'knot3d' }, 30))];
      expect(later[0]).toBeGreaterThan(first[0]!);
      expect(later[1]).toBeGreaterThan(first[1]!);
      expect(later[2]).toBeGreaterThan(first[2]!);
    });

    it('drives pitch from sub, yaw from high and phase from kicks', () => {
      const calm = makeMockFrame({ norm: { sub: 0, mid: 0, high: 0 }, kickPulse: false });
      const loud = makeMockFrame({ norm: { sub: 1, mid: 1, high: 1 }, kickPulse: true });
      const a = knot(run({ baseShape: 'knot3d' }, 10, calm));
      const b = knot(run({ baseShape: 'knot3d' }, 10, loud));
      expect(b[0]).toBeGreaterThan(a[0]!);
      expect(b[1]).toBeGreaterThan(a[1]!);
      expect(b[2]).toBeGreaterThan(a[2]!);
    });

    it('holds still at spin 0 and never turns for other base shapes', () => {
      expect(knot(run({ baseShape: 'knot3d', knotSpin: 0 }, 20))).toEqual([0, 0, 0]);
      expect(knot(run({ baseShape: 'circle' }, 20))).toEqual([0, 0, 0]);
    });

    it('has the shader branch and the perspective knot', () => {
      expect(vertSrc).toContain('uniform vec3 uKnot;');
      expect(vertSrc).toContain('} else if (uBaseShape == 8) {');
      expect(vertSrc).toContain('vec2 knotPoint(float u, float effSize)');
    });
  });

  describe('Band texture option (Slice 19.9b)', () => {
    const textureCount = (params: Record<string, unknown>) => {
      const g = createMockGl();
      const layer = new ShapeLayer(params);
      layer.init(g);
      layer.draw(makeMockFrame(), mockClock, mockTarget);
      return { layer, g, created: (g.createTexture as unknown as { mock: { calls: unknown[] } }).mock.calls.length };
    };

    it('is a float schema option, 0 to 2 and off by default', () => {
      const spec = SHAPE_SPECS.find((s) => s.name === 'bandTexture') as unknown as { type: string; default: number; min: number; max: number };
      expect(spec.type).toBe('float');
      expect(spec.default).toBe(0);
      expect(spec.min).toBe(0);
      expect(spec.max).toBe(2);
      expect(SHAPE_DEFAULTS.bandTexture).toBe(0);
    });

    it('stays off by default: strength 0 and no band textures created', () => {
      const off = textureCount({});
      expect(off.g.uniformValues.get('uTexGain')).toBe(0);
      const on = textureCount({ bandTexture: 1 });
      // Three band rows plus the shared audio texture.
      expect(on.created - off.created).toBe(4);
    });

    it('passes the strength and points the samplers at the mid and high rows', () => {
      const { g } = textureCount({ bandTexture: 1.5 });
      expect(g.uniformValues.get('uTexGain')).toBe(1.5);
      // Units 0 and 1 hold the audio and peak rows; the band rows follow as sub, mid, high.
      expect(g.uniformValues.get('uTexMid')).toBe(3);
      expect(g.uniformValues.get('uTexHigh')).toBe(4);
    });

    it('releases the band textures on dispose', () => {
      const { layer, g } = textureCount({ bandTexture: 1 });
      const before = (g.deleteTexture as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
      layer.dispose();
      const after = (g.deleteTexture as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
      // Audio and peak rows, three band rows and the shared texture.
      expect(after - before).toBe(6);
    });

    it('has the shader hooks: mid scales height, high scales brightness, off when the strength is 0', () => {
      expect(vertSrc).toContain('uniform float uTexGain;');
      expect(vertSrc).toContain('uniform sampler2D uTexMid;');
      expect(vertSrc).toContain('uniform sampler2D uTexHigh;');
      expect(vertSrc).toContain('if (uTexGain > 0.0) {');
      expect(vertSrc).toContain('audioAmp *= heightMul;');
      expect(vertSrc).toContain('vAlpha = instAlpha * brightMul;');
    });
  });

  describe('Per-element delay (Slice 19.2)', () => {
    it('defaults to no delay so existing presets are unchanged', () => {
      expect(SHAPE_DEFAULTS.elementDelay).toBe(0);
      const layer = new ShapeLayer({ audioSource: 'energy', attackMs: 5 });
      layer.init(gl);
      layer.draw(makeMockFrame({ energy: 0.5 }), mockClock, mockTarget);
      expect(Array.from(layer.delayedSamples)).toEqual(Array.from(layer.smoothedSamples));
    });

    it('lag grows from zero at the first element to the full window at the last', () => {
      expect(elementLagFrames(1, 0)).toBe(0);
      expect(elementLagFrames(1, 1023)).toBe(SHAPE_HISTORY_FRAMES - 1);
      expect(elementLagFrames(0.5, 1023)).toBe(Math.round((SHAPE_HISTORY_FRAMES - 1) / 2));
      expect(elementLagFrames(0, 1023)).toBe(0);
    });

    it('later elements see an older frame after a sudden jump', () => {
      const layer = new ShapeLayer({ audioSource: 'energy', attackMs: 1, releaseMs: 20, elementDelay: 1 });
      layer.init(gl);
      const quiet = makeMockFrame({ energy: 0 });
      for (let k = 0; k < 40; k++) layer.draw(quiet, mockClock, mockTarget);
      layer.draw(makeMockFrame({ energy: 1 }), { timeSec: 1, dtSec: 0.1, frameIndex: 1 }, mockTarget);
      expect(layer.delayedSamples[0]).toBeGreaterThan(0.5);
      expect(layer.delayedSamples[255]).toBeLessThan(0.01);
    });

    it('is a schema option in the Audio & Style group', () => {
      const spec = SHAPE_SPECS.find((s) => s.name === 'elementDelay') as unknown as { min: number; max: number; group: string };
      expect(spec.min).toBe(0);
      expect(spec.max).toBe(1);
      expect(spec.group).toBe('Audio & Style');
    });
  });

  describe('Shape motion over time (Slice 19.3)', () => {
    it('defaults are all off so existing presets are unchanged', () => {
      expect(SHAPE_DEFAULTS.pathTravel).toBe(0);
      expect(SHAPE_DEFAULTS.scaleWobble).toBe(0);
      expect(SHAPE_DEFAULTS.copyRotation).toBe(0);
      const t = new Float32Array([1, 0.5, 1, 1, 1.5, 0.25, 1, 1]);
      const before = Array.from(t);
      applyCopyMotion(t, 2, 0, 1.3, 0);
      expect(Array.from(t)).toEqual(before);
    });

    it('rotates each extra copy by one more step and leaves the first copy alone', () => {
      const t = new Float32Array([1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1]);
      applyCopyMotion(t, 3, 0, 0, 90);
      expect(t[1]).toBeCloseTo(0);
      expect(t[5]).toBeCloseTo(Math.PI / 2);
      expect(t[9]).toBeCloseTo(Math.PI);
    });

    it('wobbles scale around 1 within the set amount', () => {
      for (let k = 0; k < 50; k++) {
        const t = new Float32Array([1, 0, 1, 1]);
        applyCopyMotion(t, 1, 0.3, k * 0.37, 0);
        expect(t[0]).toBeGreaterThanOrEqual(0.7 - 1e-6);
        expect(t[0]).toBeLessThanOrEqual(1.3 + 1e-6);
      }
    });

    it('slides the travel phase over time and sends it to the shader', () => {
      const layer = new ShapeLayer({ pathTravel: 1, audioSource: 'energy' });
      layer.init(gl);
      layer.draw(makeMockFrame(), { timeSec: 1, dtSec: 0.25, frameIndex: 1 }, mockTarget);
      expect(gl.uniformValues.get('uTravel')).toBeCloseTo(0.25);
      const still = new ShapeLayer({ audioSource: 'energy' });
      still.init(gl);
      still.draw(makeMockFrame(), { timeSec: 1, dtSec: 0.25, frameIndex: 1 }, mockTarget);
      expect(gl.uniformValues.get('uTravel')).toBe(0);
    });

    it('vertex shader only shifts the path lookup when travel is non-zero', () => {
      expect(vertSrc).toContain('uniform float uTravel;');
      expect(vertSrc).toContain('abs(uTravel) > 0.00001');
    });
  });

  describe('Shader Source Integrity', () => {
    it('shape.vert.glsl starts with #version 300 es and defines key uniforms and attributes', () => {
      expect(vertSrc.startsWith('#version 300 es')).toBe(true);
      expect(vertSrc).toContain('uniform int uBaseShape;');
      expect(vertSrc).toContain('uniform int uEffectType;');
      expect(vertSrc).toContain('uniform vec2 uInstOffset[16];');
      expect(vertSrc).toContain('uniform vec4 uInstTransform[16];');
      expect(vertSrc).toContain('out vec2 vLocalUv;');
    });

    it('shape.frag.glsl starts with #version 300 es and handles LED segment ticks & peak caps', () => {
      expect(fragSrc.startsWith('#version 300 es')).toBe(true);
      expect(fragSrc).toContain('uniform int uEffectType;');
      expect(fragSrc).toContain('uniform int uColorMode;');
      expect(fragSrc).toContain('uniform int uPeakCaps;');
      expect(fragSrc).toContain('uniform int uLedSegments;');
      expect(fragSrc).toContain('out vec4 fragColor;');
    });
  });
});

describe('Peak-preserving sampling (Slice 19.13)', () => {
  it('bucketExtreme keeps the sample with the largest magnitude, with its sign', () => {
    const wf = new Float32Array([0.1, -0.9, 0.3, 0.2, 0.5, 0.4, -0.2, 0.1]);
    expect(bucketExtreme(wf, 0, 4)).toBeCloseTo(-0.9);
    expect(bucketExtreme(wf, 1, 4)).toBeCloseTo(0.5);
  });

  it('peakBandValues leans on the loudest bin instead of the mean', () => {
    const smoothed = new Float32Array([0, 0, 1, 0]);
    const v = peakBandValues(smoothed, [{ loBin: 0, hiBin: 4 }]);
    expect(v[0]).toBeCloseTo(0.7 + 0.3 * 0.25);
  });
});

describe('Raised sample cap (Slice 19.14)', () => {
  it('holds 1024 texels and accepts a 1024 sample count', () => {
    expect(SHAPE_TEXELS).toBe(1024);
    const layer = new ShapeLayer({ audioSource: 'scope', sampleCount: 1024 });
    const gl = createMockGl();
    layer.init(gl);
    expect(() => layer.draw(makeMockFrame(), mockClock, mockTarget)).not.toThrow();
    expect(layer.smoothedSamples.length).toBe(1024);
  });

  it('spreads the per-element delay across all 1024 texels', () => {
    expect(elementLagFrames(1, 1023)).toBe(SHAPE_HISTORY_FRAMES - 1);
    expect(elementLagFrames(1, 0)).toBe(0);
  });
});

describe('Wall-bounce physics (Slice 27.1)', () => {
  it('keeps bounceSpeed === 0 as a complete no-op on position and spin', () => {
    const gl = createMockGl();
    const layer = new ShapeLayer({ posX: 0.35, posY: -0.25, spinSpeed: 1.5, bounceSpeed: 0 });
    layer.init(gl);
    const frame = makeMockFrame({ kickEnv: 0.8, energy: 0.9 });
    layer.draw(frame, { timeSec: 1.0, dtSec: 0.25, frameIndex: 1 }, mockTarget);

    const offsets = gl.uniformValues.get('uInstOffset[0]') as Float32Array;
    const transforms = gl.uniformValues.get('uInstTransform[0]') as Float32Array;
    expect(offsets[0]).toBeCloseTo(0.35, 6);
    expect(offsets[1]).toBeCloseTo(-0.25, 6);
    expect(transforms[1]).toBeCloseTo(1.5 * 0.25, 6);
    expect(layer.getBounceState().active).toBe(false);
  });

  it('reflects horizontally and vertically within 16:9 viewport bounds', () => {
    const aspect = 16 / 9;
    const extents = { halfX: 0.2, halfY: 0.2 };
    const limitX = aspect - BOUNCE_WALL_INSET - extents.halfX;
    const limitY = 1.0 - BOUNCE_WALL_INSET - extents.halfY;

    // Horizontal reflection off right wall (+limitX)
    const rightHit = stepBouncePhysics(
      { x: limitX - 0.02, y: 0, vx: 2.0, vy: 0, spinDir: 1, active: true },
      { posX: 0, posY: 0, bounceSpeed: 2.0, bounceAngle: 0, bounceAudioBoost: 0, bounceFlipSpin: true },
      0.05,
      aspect,
      extents,
      0,
    );
    expect(rightHit.hit).toBe(true);
    expect(rightHit.state.x).toBeLessThanOrEqual(limitX);
    expect(rightHit.state.x).toBeCloseTo(limitX - 0.08, 6);
    expect(rightHit.state.vx).toBeLessThan(0);

    // Vertical reflection off bottom wall (-limitY)
    const bottomHit = stepBouncePhysics(
      { x: 0, y: -limitY + 0.02, vx: 0, vy: -2.0, spinDir: 1, active: true },
      { posX: 0, posY: 0, bounceSpeed: 2.0, bounceAngle: 270, bounceAudioBoost: 0, bounceFlipSpin: true },
      0.05,
      aspect,
      extents,
      0,
    );
    expect(bottomHit.hit).toBe(true);
    expect(bottomHit.state.y).toBeGreaterThanOrEqual(-limitY);
    expect(bottomHit.state.y).toBeCloseTo(-limitY + 0.08, 6);
    expect(bottomHit.state.vy).toBeGreaterThan(0);
  });

  it('computes rotated AABB half-extents for centerLine', () => {
    const aspect = 16 / 9;
    const size = 0.3;
    const unrotated = computeShapeBounceExtents({ baseShape: 'centerLine' }, size, 0, aspect);
    expect(unrotated.halfX).toBeCloseTo(size * aspect, 6);
    expect(unrotated.halfY).toBeCloseTo(0, 6);

    const rot90 = computeShapeBounceExtents({ baseShape: 'centerLine' }, size, Math.PI / 2, aspect);
    expect(rot90.halfX).toBeCloseTo(0, 6);
    expect(rot90.halfY).toBeCloseTo(size * aspect, 6);

    const rot45 = computeShapeBounceExtents({ baseShape: 'centerLine' }, size, Math.PI / 4, aspect);
    const expected = size * aspect * Math.SQRT1_2;
    expect(rot45.halfX).toBeCloseTo(expected, 6);
    expect(rot45.halfY).toBeCloseTo(expected, 6);
  });

  it('flips spinDir and reverses spinPhase advance on wall hit when bounceFlipSpin is enabled', () => {
    const gl = createMockGl();
    const layer = new ShapeLayer({
      baseShape: 'circle',
      size: 0.2,
      posX: 1.4,
      posY: 0,
      spinSpeed: 2.0,
      bounceSpeed: 2.0,
      bounceAngle: 0,
      bounceAudioBoost: 0,
      bounceFlipSpin: true,
      basePulse: 0,
    });
    layer.init(gl);

    const quiet = makeMockFrame({ kickEnv: 0, energy: 0 });
    // First draw: activates at posX=1.4 (within limitX ≈ 1.5577), moves +0.1 -> 1.5, no wall hit yet
    layer.draw(quiet, { timeSec: 0.05, dtSec: 0.05, frameIndex: 1 }, mockTarget);
    const stateBeforeHit = layer.getBounceState();
    const spinAfterFirst = (gl.uniformValues.get('uInstTransform[0]') as Float32Array)[1]!;
    expect(stateBeforeHit.spinDir).toBe(1);
    expect(spinAfterFirst).toBeCloseTo(2.0 * 0.05, 6);

    // Second draw: crosses limitX -> reflects and flips spinDir to -1
    layer.draw(quiet, { timeSec: 0.10, dtSec: 0.05, frameIndex: 2 }, mockTarget);
    const stateAfterHit = layer.getBounceState();
    const spinAfterHit = (gl.uniformValues.get('uInstTransform[0]') as Float32Array)[1]!;
    expect(stateAfterHit.spinDir).toBe(-1);
    expect(spinAfterHit).toBeLessThan(spinAfterFirst);
    expect(spinAfterHit).toBeCloseTo(0, 6);
  });

  it('scales bounce velocity dynamically via bounceAudioBoost', () => {
    const aspect = 16 / 9;
    const extents = { halfX: 0.1, halfY: 0.1 };
    const initial = { x: 0, y: 0, vx: 1.0, vy: 0, spinDir: 1 as const, active: true };
    const params = { posX: 0, posY: 0, bounceSpeed: 1.0, bounceAngle: 0, bounceAudioBoost: 1.5, bounceFlipSpin: true };

    const quietStep = stepBouncePhysics(initial, params, 0.1, aspect, extents, 0);
    const loudStep = stepBouncePhysics(initial, params, 0.1, aspect, extents, 0.8);

    expect(quietStep.state.x).toBeCloseTo(0.1, 6);
    expect(loudStep.state.x).toBeCloseTo(0.1 * (1 + 1.5 * 0.8), 6);
    expect(loudStep.state.x).toBeGreaterThan(quietStep.state.x);
  });

  it('preserves mid-flight bounce state across setParams() calls', () => {
    const gl = createMockGl();
    const layer = new ShapeLayer({
      baseShape: 'circle',
      size: 0.2,
      posX: 0,
      posY: 0,
      bounceSpeed: 1.0,
      bounceAngle: 37,
      bounceAudioBoost: 0,
    });
    layer.init(gl);

    const frame = makeMockFrame({ kickEnv: 0, energy: 0 });
    layer.draw(frame, { timeSec: 0.05, dtSec: 0.05, frameIndex: 1 }, mockTarget);
    const midFlight = layer.getBounceState();
    expect(midFlight.active).toBe(true);
    expect(midFlight.x).toBeGreaterThan(0);

    // Simulate per-frame audio link / reaction parameter mutation
    layer.setParams({ glow: 1.5, bounceSpeed: 2.0 });
    const afterSetParams = layer.getBounceState();
    expect(afterSetParams).toEqual(midFlight);

    layer.draw(frame, { timeSec: 0.10, dtSec: 0.05, frameIndex: 2 }, mockTarget);
    const nextFlight = layer.getBounceState();
    expect(nextFlight.x).toBeGreaterThan(midFlight.x);
  });

  it('clamps large dt without tunneling past viewport bounds', () => {
    const aspect = 16 / 9;
    const extents = { halfX: 0.2, halfY: 0.2 };
    const limitX = aspect - BOUNCE_WALL_INSET - extents.halfX;
    const limitY = 1.0 - BOUNCE_WALL_INSET - extents.halfY;

    const clamped = stepBouncePhysics(
      { x: 0, y: 0, vx: 1.0, vy: 0.5, spinDir: 1, active: true },
      { posX: 0, posY: 0, bounceSpeed: 1.0, bounceAngle: 26, bounceAudioBoost: 0, bounceFlipSpin: false },
      5.0,
      aspect,
      extents,
      0,
    );
    // Clamped to MAX_DT_SEC = 0.1 and normalized heading to speed 1.0
    const invNorm = 1 / Math.hypot(1.0, 0.5);
    expect(clamped.state.x).toBeCloseTo(1.0 * invNorm * 0.1, 6);
    expect(clamped.state.y).toBeCloseTo(0.5 * invNorm * 0.1, 6);
    expect(Math.abs(clamped.state.x)).toBeLessThanOrEqual(limitX);
    expect(Math.abs(clamped.state.y)).toBeLessThanOrEqual(limitY);
  });
});

describe('Organic twistWave baseShape (Stage 28.1)', () => {
  it('uploads uBaseShape == 9, uTwistA, uTwistB, and uTwistChaos', () => {
    const gl = createMockGl();
    const layer = new ShapeLayer({ baseShape: 'twistWave', twistChaos: 0.42 });
    layer.init(gl);
    layer.draw(makeMockFrame(), mockClock, mockTarget);

    expect(gl.uniformValues.get('uBaseShape')).toBe(9);
    expect(gl.uniformValues.get('uTwistChaos')).toBeCloseTo(0.42, 5);
    const a = gl.uniformValues.get('uTwistA') as number[];
    const b = gl.uniformValues.get('uTwistB') as number[];
    expect(a).toHaveLength(4);
    expect(b).toHaveLength(4);
    expect(a.every(Number.isFinite)).toBe(true);
    expect(b.every(Number.isFinite)).toBe(true);
  });

  it('initializes persistent twist state, progresses non-monotonically, resets on init(), and preserves across setParams()', () => {
    const gl = createMockGl();
    const layer = new ShapeLayer({ baseShape: 'twistWave', twistSpeed: 1.5 });
    expect(layer.getTwistState()).toEqual({
      phaseA: [0.7, 1.9, 3.1, 4.7],
      phaseB: [0.3, 1.4, 2.6, 0.9],
    });

    layer.init(gl);
    const frame = makeMockFrame({ norm: { sub: 0.1, mid: 0.1, high: 0.1 }, energy: 0.1, kickEnv: 0 });
    let minDelta = Infinity;
    let maxDelta = -Infinity;
    let prevB0 = layer.getTwistState().phaseB[0];
    for (let i = 0; i < 400; i++) {
      layer.draw(frame, { timeSec: i * 0.05, dtSec: 0.05, frameIndex: i }, mockTarget);
      const curB0 = layer.getTwistState().phaseB[0];
      const delta = curB0 - prevB0;
      if (delta < minDelta) minDelta = delta;
      if (delta > maxDelta) maxDelta = delta;
      prevB0 = curB0;
    }
    // Wander/reversals produce both negative and positive velocity over time
    expect(minDelta).toBeLessThan(0);
    expect(maxDelta).toBeGreaterThan(0);

    const midState = layer.getTwistState();
    layer.setParams({ glow: 1.2, twistChaos: 0.9 });
    expect(layer.getTwistState()).toEqual(midState);

    layer.init(gl);
    expect(layer.getTwistState()).toEqual({
      phaseA: [0.7, 1.9, 3.1, 4.7],
      phaseB: [0.3, 1.4, 2.6, 0.9],
    });
  });

  it('responds to audio bands and kick impulses, holds still at twistSpeed === 0 or other baseShapes, and clamps large dt', () => {
    const run = (params: Record<string, unknown>, frames: number, frame: AudioFrame, dtSec = 0.016) => {
      const g = createMockGl();
      const l = new ShapeLayer(params);
      l.init(g);
      for (let i = 0; i < frames; i++) l.draw(frame, { timeSec: i * dtSec, dtSec, frameIndex: i }, mockTarget);
      return l.getTwistState();
    };

    const calm = makeMockFrame({ norm: { sub: 0, mid: 0, high: 0 }, energy: 0, kickEnv: 0, kickPulse: false });
    const loudKick = makeMockFrame({ norm: { sub: 1, mid: 1, high: 1 }, energy: 1, kickEnv: 1, kickPulse: true });

    const sCalm = run({ baseShape: 'twistWave', twistSpeed: 1.0 }, 10, calm);
    const sLoud = run({ baseShape: 'twistWave', twistSpeed: 1.0 }, 10, loudKick);
    expect(sLoud.phaseA[0]).not.toBeCloseTo(sCalm.phaseA[0], 3);
    expect(sLoud.phaseA[3]).toBeGreaterThan(sCalm.phaseA[3]);

    // Hold still when twistSpeed === 0 or when baseShape !== 'twistWave'
    const frozen = run({ baseShape: 'twistWave', twistSpeed: 0 }, 20, loudKick);
    expect(frozen).toEqual({ phaseA: [0.7, 1.9, 3.1, 4.7], phaseB: [0.3, 1.4, 2.6, 0.9] });
    const otherShape = run({ baseShape: 'circle', twistSpeed: 2.0 }, 20, loudKick);
    expect(otherShape).toEqual({ phaseA: [0.7, 1.9, 3.1, 4.7], phaseB: [0.3, 1.4, 2.6, 0.9] });

    // Large dtSec is clamped via clampDt() so 10s step matches 0.1s step
    const sClamped = run({ baseShape: 'twistWave', twistSpeed: 1.0 }, 1, calm, 10.0);
    const sMaxDt = run({ baseShape: 'twistWave', twistSpeed: 1.0 }, 1, calm, 0.1);
    expect(sClamped).toEqual(sMaxDt);
  });

  it('computes 1.15 * effSize bounce extents for twistWave', () => {
    const ext = computeShapeBounceExtents({ baseShape: 'twistWave' }, 0.6, 0.8, 16 / 9);
    expect(ext.halfX).toBeCloseTo(0.6 * 1.15, 6);
    expect(ext.halfY).toBeCloseTo(0.6 * 1.15, 6);
  });

  it('samples a smooth 1024-sample recent tail window on 8192-sample scope waveforms for twistWave while preserving 1024 and non-twistWave behavior', () => {
    const wf8192 = new Float32Array(8192);
    // Put huge spikes in the pre-tail region [0..7167] and a clean linear ramp [-0.5 .. +0.5] in the tail [7168..8191]
    for (let i = 0; i < 7168; i++) {
      wf8192[i] = i % 2 === 0 ? 1.0 : -1.0;
    }
    for (let i = 0; i < 1024; i++) {
      wf8192[7168 + i] = -0.5 + (i / 1023);
    }

    const glTwist = createMockGl();
    const twistLayer = new ShapeLayer({
      baseShape: 'twistWave',
      audioSource: 'scope',
      sampleCount: 256,
      reactivity: 1.0,
      attackMs: 1,
    });
    twistLayer.init(glTwist);
    twistLayer.draw(makeMockFrame({ waveform: wf8192 }), { timeSec: 1, dtSec: 0.1, frameIndex: 1 }, mockTarget);

    // Pre-tail ±1 spikes are ignored; tail starts at -0.5 and ends at +0.5 smoothly
    expect(twistLayer.smoothedSamples[0]).toBeCloseTo(-0.5, 2);
    expect(twistLayer.smoothedSamples[SHAPE_TEXELS - 1]).toBeCloseTo(0.5, 2);
    expect(twistLayer.smoothedSamples[SHAPE_TEXELS / 2]).toBeCloseTo(0, 1);

    // Non-twistWave still uses bucketExtreme over the whole 8192 buffer (picks up pre-tail ±1 spikes)
    const glCircle = createMockGl();
    const circleLayer = new ShapeLayer({
      baseShape: 'circle',
      audioSource: 'scope',
      sampleCount: 256,
      reactivity: 1.0,
      attackMs: 1,
    });
    circleLayer.init(glCircle);
    circleLayer.draw(makeMockFrame({ waveform: wf8192 }), { timeSec: 1, dtSec: 0.1, frameIndex: 1 }, mockTarget);
    expect(Math.abs(circleLayer.smoothedSamples[0]!)).toBeGreaterThan(0.9);

    // 1024-sample waveform on twistWave still uses standard bucketExtreme verbatim
    const wf1024 = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) wf1024[i] = i === 1 ? -0.9 : 0.1;
    const glTwist1024 = createMockGl();
    const twist1024 = new ShapeLayer({
      baseShape: 'twistWave',
      audioSource: 'scope',
      sampleCount: 256,
      reactivity: 1.0,
      attackMs: 1,
    });
    twist1024.init(glTwist1024);
    twist1024.draw(makeMockFrame({ waveform: wf1024 }), { timeSec: 1, dtSec: 0.1, frameIndex: 1 }, mockTarget);
    expect(twist1024.smoothedSamples[0]).toBeCloseTo(-0.9, 2);
  });

  it('defines twistWave shader uniforms, branch, 3D projection, and leaves knot3d & bandTexture hooks intact', () => {
    expect(vertSrc).toContain('uniform vec4 uTwistA;');
    expect(vertSrc).toContain('uniform vec4 uTwistB;');
    expect(vertSrc).toContain('uniform float uTwistChaos;');
    expect(vertSrc).toContain('} else if (uBaseShape == 9) {');
    expect(vertSrc).toContain('vec3 twistWave3D(float u, float effSize)');
    expect(vertSrc).toContain('2.4 - p3.z * 0.55');
    // knot3d & existing test hooks preserved
    expect(vertSrc).toContain('} else if (uBaseShape == 8) {');
    expect(vertSrc).toContain('vec2 knotPoint(float u, float effSize)');
    expect(vertSrc).toContain('vAlpha = instAlpha * brightMul;');
  });
});
