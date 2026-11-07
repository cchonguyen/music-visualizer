import { describe, it, expect, beforeEach, vi } from 'vitest';
import { advanceCrown, getCrownHeights, resetCrown } from '../crownStore';
import { CROWN_SCHEMA, CROWN_DEFAULTS } from '../../presets/layerSchemas';
import { CrownLayer } from '../layers/crown';
import type { AudioFrame } from '../../audio/types';
import type { RenderClock } from '../clock';
import type { RenderTarget } from '../layer';

function createMockGl() {
  const uniformValues = new Map<string, any>();
  const gl = {
    TRIANGLES: 0x0004,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE_2D: 0x0de1,
    R32F: 0x822e,
    RED: 0x1903,
    FLOAT: 0x1406,
    STATIC_DRAW: 0x88e4,
    ARRAY_BUFFER: 0x8892,
    COLOR_ATTACHMENT0: 0x8ce0,
    FRAMEBUFFER: 0x8d40,
    getExtension: vi.fn().mockReturnValue(null),
    enable: vi.fn(),
    disable: vi.fn(),
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
    uniform1fv: vi.fn(),
    drawArrays: vi.fn(),
    _uniformValues: uniformValues,
  };
  return gl as unknown as WebGL2RenderingContext & { _uniformValues: Map<string, any> };
}

describe('crownStore smooth release envelope & CrownLayer size', () => {
  beforeEach(() => {
    resetCrown();
  });

  it('exposes size = 2.0 default and slider spec in CROWN_SCHEMA', () => {
    expect(CROWN_DEFAULTS.size).toBe(2.0);
    expect(CROWN_SCHEMA.size).toMatchObject({
      key: 'size',
      label: 'Size',
      kind: 'number',
      default: 2.0,
      min: 0.5,
      max: 3.0,
      step: 0.05,
    });
  });

  it('smooths bar heights with asymmetric attack (20ms) and release (140ms) envelope', () => {
    const dt = 1 / 60;
    const loudSmoothed = new Float32Array(1024).fill(0.9);
    const silentSmoothed = new Float32Array(1024).fill(0.0);

    // Warm up crown with loud audio across 30 frames
    for (let i = 0; i < 30; i++) {
      advanceCrown(loudSmoothed, 48000, 2048, dt, false, true);
    }
    const peakHeights = new Float32Array(getCrownHeights());
    const peak = peakHeights[10] ?? 0;
    expect(peak).toBeGreaterThan(0.3);

    // Sudden complete silence on next frame
    advanceCrown(silentSmoothed, 48000, 2048, dt, false, true);
    const postSilenceHeights = getCrownHeights();
    const post = postSilenceHeights[10] ?? 0;

    // Bars must NOT jump immediately to 0; 140ms release ensures smooth glide
    // Over 1 frame of 16.6ms, decay factor is ~exp(-0.01667 / 0.140) ≈ 0.887
    expect(post).toBeGreaterThan(peak * 0.7);
    expect(post).toBeLessThan(peak);
  });

  it('CrownLayer uploads uSize uniform according to size parameter', () => {
    const gl = createMockGl();
    const layer = new CrownLayer({ size: 2.5 });
    layer.init(gl);

    const frame = {
      frameIndex: 1,
      time: 1.0,
      dtSec: 1 / 60,
      raw: { sub: 0.4, mid: 0.4, high: 0.4 },
      env: { sub: 0.4, mid: 0.4, high: 0.4 },
      norm: { sub: 0.4, mid: 0.4, high: 0.4 },
      loudness: 0.5,
      energy: 0.5,
      flux: 0.1,
      fluxByBand: { sub: 0.1, mid: 0.1, high: 0.1 },
      beat: false,
      beatByBand: { sub: false, mid: false, high: false },
      beatStrength: 0.0,
      kickEnv: 0.5,
      kickPulse: false,
      waveform: new Float32Array(128),
      bandWaveforms: {
        sub: new Float32Array(128),
        mid: new Float32Array(128),
        high: new Float32Array(128),
      },
      spectrum: new Float32Array(64),
      smoothedSpectrum: new Float32Array(64),
      sampleRate: 44100,
    } as unknown as AudioFrame;

    const clock = { timeSec: 1.0, dtSec: 1 / 60, frameIndex: 60 } as unknown as RenderClock;
    const target = { framebuffer: {} as WebGLFramebuffer, width: 800, height: 600 } as RenderTarget;

    layer.draw(frame, clock, target);
    expect(gl._uniformValues.get('uSize')).toBe(2.5);

    layer.dispose();
  });
});
