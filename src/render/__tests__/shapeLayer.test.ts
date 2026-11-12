import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShapeLayer, SHAPE_AMP_MAX, SHAPE_REACTIVITY_MAX, SHAPE_HISTORY_FRAMES, elementLagFrames, applyCopyMotion } from '../layers/shape';
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
      expect(SHAPE_DEFAULTS.reactivity).toBe(1.0);
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
      for (let j = 0; j < 256; j++) expect(layer.smoothedSamples[j]).toBe(0);
    });

    it('keeps the sign of the waveform, unlike the unsigned waveform source', () => {
      const wf = new Float32Array(1024);
      for (let i = 0; i < wf.length; i++) wf[i] = i < 512 ? 0.5 : -0.5;
      const scope = new ShapeLayer({ audioSource: 'scope', reactivity: 1.0, attackMs: 5 });
      scope.init(gl);
      for (let k = 0; k < 20; k++) scope.draw(makeMockFrame({ waveform: wf }), mockClock, mockTarget);
      expect(scope.smoothedSamples[10]).toBeGreaterThan(0.4);
      expect(scope.smoothedSamples[250]).toBeLessThan(-0.4);

      const legacy = new ShapeLayer({ audioSource: 'waveform', reactivity: 1.0, attackMs: 5 });
      legacy.init(gl);
      for (let k = 0; k < 20; k++) legacy.draw(makeMockFrame({ waveform: wf }), mockClock, mockTarget);
      expect(legacy.smoothedSamples[250]).toBeGreaterThan(0);
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
      expect(elementLagFrames(1, 255)).toBe(SHAPE_HISTORY_FRAMES - 1);
      expect(elementLagFrames(0.5, 255)).toBe(Math.round((SHAPE_HISTORY_FRAMES - 1) / 2));
      expect(elementLagFrames(0, 255)).toBe(0);
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
