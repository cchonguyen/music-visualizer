import { describe, it, expect, vi } from 'vitest';
import {
  BrightnessLimiter,
  CAP_FLOOR,
  RISE_PER_SEC,
  FALL_PER_SEC,
  REVERSAL_THRESHOLD,
  calmFactor,
  applyCalmMode,
  applyReversalDamp,
} from '../safety';
import compositeFragSrc from '../shaders/composite.frag.glsl?raw';
import { Compositor } from '../compositor';
import { Scene } from '../scene';
import type { AudioFrame } from '../../audio/types';
import type { RenderClock } from '../clock';
import type { RenderTarget } from '../layer';

interface MockGl extends WebGL2RenderingContext {
  _uniformValues: Map<string, unknown>;
}

function createMockGl(): MockGl {
  const uniformValues = new Map<string, unknown>();
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
    framebufferTexture2D: vi.fn(),
    drawArrays: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    blendEquation: vi.fn(),
    blendFunc: vi.fn(),
    viewport: vi.fn(),
    getUniformLocation: vi.fn().mockImplementation((_prog, name: string) => ({ name })),
    uniform1i: vi.fn().mockImplementation((loc: { name: string } | null, val: number) => {
      if (loc?.name) uniformValues.set(loc.name, val);
    }),
    uniform1f: vi.fn().mockImplementation((loc: { name: string } | null, val: number) => {
      if (loc?.name) uniformValues.set(loc.name, val);
    }),
    uniform2f: vi.fn(),
    deleteProgram: vi.fn(),
    deleteShader: vi.fn(),
    deleteTexture: vi.fn(),
    deleteFramebuffer: vi.fn(),
    deleteVertexArray: vi.fn(),
    _uniformValues: uniformValues,
  } as unknown as WebGL2RenderingContext & { _uniformValues: Map<string, unknown> };
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
    waveform: new Float32Array(16),
    bandWaveforms: {
      sub: new Float32Array(16),
      mid: new Float32Array(16),
      high: new Float32Array(16),
    },
    spectrum: new Float32Array(16),
    smoothedSpectrum: new Float32Array(16),
    sampleRate: 44100,
  };
}

describe('Bidirectional luminance slew clamping', () => {
  it('clamps rapid upward rise to RISE_PER_SEC * dt', () => {
    const lim = new BrightnessLimiter();
    const start = lim.value;
    const v = lim.step(1.0, 0.1);
    expect(v - start).toBeCloseTo(RISE_PER_SEC * 0.1, 5);
  });

  it('clamps rapid downward drop to FALL_PER_SEC * dt', () => {
    const lim = new BrightnessLimiter();
    // Warm up to high luminance
    for (let i = 0; i < 100; i++) lim.step(1.0, 0.05);
    const high = lim.value;
    expect(high).toBeGreaterThan(0.9);

    // Sudden plunge to CAP_FLOOR over 0.05s
    const afterDrop = lim.step(CAP_FLOOR, 0.05);
    const drop = high - afterDrop;
    expect(drop).toBeLessThanOrEqual(FALL_PER_SEC * 0.05 + 1e-6);
    expect(afterDrop).toBeGreaterThan(0.8);
  });

  it('catches rapid dark-to-light-to-dark inversions without sudden jumps', () => {
    const lim = new BrightnessLimiter();
    expect(lim.value).toBe(CAP_FLOOR);

    // Frame 1: Jump to full white over 16ms (60 fps)
    const riseVal = lim.step(1.0, 0.016);
    expect(riseVal - CAP_FLOOR).toBeLessThanOrEqual(RISE_PER_SEC * 0.016 + 1e-6);

    // Frame 2: Invert back to full black over 16ms
    const fallVal = lim.step(0.0, 0.016);
    expect(riseVal - fallVal).toBeLessThanOrEqual(FALL_PER_SEC * 0.016 + 1e-6);
    expect(fallVal).toBeGreaterThanOrEqual(CAP_FLOOR);
  });
});

describe('Rolling 1-second reversal counter and damping', () => {
  it('does not damp when reversals are <= 3 per second', () => {
    const lim = new BrightnessLimiter();
    // 3 reversals within 0.6 seconds
    lim.step(0.2, 0.1);
    lim.step(0.8, 0.1); // up
    lim.step(0.2, 0.1); // down (rev 1)
    lim.step(0.8, 0.1); // up (rev 2)
    lim.step(0.2, 0.1); // down (rev 3)

    expect(lim.reversalCount).toBe(3);
    expect(lim.reversalDamp).toBe(0);
  });

  it('automatically increases damping when reversals exceed 3 per second', () => {
    const lim = new BrightnessLimiter();
    lim.step(0.2, 0.1);
    lim.step(0.8, 0.1); // up
    lim.step(0.2, 0.1); // rev 1
    lim.step(0.8, 0.1); // rev 2
    lim.step(0.2, 0.1); // rev 3
    lim.step(0.8, 0.1); // rev 4 (>3!)

    expect(lim.reversalCount).toBe(4);
    expect(lim.reversalDamp).toBeGreaterThan(0);
    expect(lim.reversalDamp).toBeCloseTo(0.25, 2);

    // Further reversals increase damping toward 1.0
    lim.step(0.2, 0.05); // rev 5
    expect(lim.reversalCount).toBe(5);
    expect(lim.reversalDamp).toBeCloseTo(0.5, 2);

    lim.step(0.8, 0.05); // rev 6
    expect(lim.reversalDamp).toBeCloseTo(0.75, 2);

    lim.step(0.2, 0.05); // rev 7
    expect(lim.reversalDamp).toBe(1.0);
  });

  it('expires older reversals after 1 second of steady signal', () => {
    const lim = new BrightnessLimiter();
    lim.step(0.2, 0.05);
    lim.step(0.8, 0.05);
    lim.step(0.2, 0.05); // 1
    lim.step(0.8, 0.05); // 2
    lim.step(0.2, 0.05); // 3
    lim.step(0.8, 0.05); // 4
    expect(lim.reversalDamp).toBeGreaterThan(0);

    // 1.2s of steady signal: advance past 1.0s without direction reversals
    lim.step(0.8, 0.6);
    lim.step(0.8, 0.6);
    expect(lim.reversalCount).toBe(0);
    expect(lim.reversalDamp).toBe(0);
  });

  it('respects REVERSAL_THRESHOLD = 0.12 for detecting directional changes', () => {
    expect(REVERSAL_THRESHOLD).toBe(0.12);
    const lim = new BrightnessLimiter();
    lim.step(0.5, 0.1);
    // Delta of 0.11 is below REVERSAL_THRESHOLD (0.12), does not trigger direction change
    lim.step(0.61, 0.1);
    lim.step(0.50, 0.1);
    expect(lim.reversalCount).toBe(0);

    // Delta of 0.20 is above REVERSAL_THRESHOLD (0.12)
    lim.step(0.70, 0.1); // up (+0.20)
    lim.step(0.50, 0.1); // down (-0.20, reversal 1)
    expect(lim.reversalCount).toBe(1);
  });
});

describe('Calm mode contrast reduction and saturation capping', () => {
  it('exposes calmFactor as 1.0 when normal and 0.5 when Calm is enabled', () => {
    expect(calmFactor(false)).toBe(1.0);
    expect(calmFactor(true)).toBe(0.5);

    const lim = new BrightnessLimiter();
    expect(lim.calmFactor).toBe(1.0);
    lim.setCalm(true);
    expect(lim.calmFactor).toBe(0.5);
    lim.setCalm(false);
    expect(lim.calmFactor).toBe(1.0);
  });

  it('reduces contrast excursions from midpoint luminance (0.5) by 50%', () => {
    // White: excursion from 0.5 was +0.5, becomes +0.25 -> 0.75
    const white = applyCalmMode([1, 1, 1]);
    expect(white[0]).toBeCloseTo(0.75, 5);
    expect(white[1]).toBeCloseTo(0.75, 5);
    expect(white[2]).toBeCloseTo(0.75, 5);

    // Black: excursion from 0.5 was -0.5, becomes -0.25 -> 0.25
    const black = applyCalmMode([0, 0, 0]);
    expect(black[0]).toBeCloseTo(0.25, 5);
    expect(black[1]).toBeCloseTo(0.25, 5);
    expect(black[2]).toBeCloseTo(0.25, 5);

    // Midpoint: excursion from 0.5 is 0 -> remains 0.5
    const mid = applyCalmMode([0.5, 0.5, 0.5]);
    expect(mid[0]).toBeCloseTo(0.5, 5);
    expect(mid[1]).toBeCloseTo(0.5, 5);
    expect(mid[2]).toBeCloseTo(0.5, 5);
  });

  it('caps peak saturation in Calm mode to <= 0.75', () => {
    const saturatedRed = applyCalmMode([1, 0, 0]);
    const maxC = Math.max(...saturatedRed);
    const minC = Math.min(...saturatedRed);
    const sat = (maxC - minC) / maxC;
    expect(sat).toBeLessThanOrEqual(0.75 + 1e-6);
  });

  it('applyReversalDamp attenuates contrast toward 0.5', () => {
    const out = applyReversalDamp([1, 1, 1], 1.0);
    // When damp = 1.0, d = 0.5, result = 1 * 0.5 + 0.5 * 0.5 = 0.75
    expect(out[0]).toBeCloseTo(0.75, 5);
    expect(out[1]).toBeCloseTo(0.75, 5);
    expect(out[2]).toBeCloseTo(0.75, 5);
  });
});

describe('Compositor uniform integration with Calm and Reversal Damping', () => {
  it('passes uCalm and uReversalDamp uniforms to composite pass', () => {
    const gl = createMockGl();
    const scene = new Scene('s1', []);
    const comp = new Compositor([scene]);
    comp.init(gl);
    comp.setWeights({ s1: 1 });

    const frame = makeMockFrame();
    const clock: RenderClock = { frameIndex: 0, timeSec: 1.0, dtSec: 0.016 };
    const target: RenderTarget = { kind: 'canvas', width: 800, height: 600 };

    // Initially calm is off
    comp.draw(frame, clock, target);
    expect(gl._uniformValues.get('uCalm')).toBe(0.0);
    expect(gl._uniformValues.get('uReversalDamp')).toBe(0.0);

    // Set calm mode on
    comp.setCalm(true);
    expect(comp.getCalm()).toBe(true);
    expect(comp.calmFactor).toBe(0.5);

    comp.draw(frame, clock, target);
    expect(gl._uniformValues.get('uCalm')).toBe(1.0);
  });
});

describe('Dark-floor preservation under Calm and Reversal Damping', () => {
  it('preserves 0.0 black under uCalm highlight roll-off and uReversalDamp', () => {
    // Shader calm formula: c = c / (1.0 + c * (1.0 - contrastFactor)) * contrastFactor
    const contrastFactor = 0.5;
    const calmShaderLuma = (c: number) => (c / (1.0 + c * (1.0 - contrastFactor))) * contrastFactor;
    const reversalDampShaderLuma = (c: number, damp: number) => c * (1.0 - damp * 0.35);

    // Dark-floor preservation: 0.0 black stays strictly 0.0 under uCalm and uReversalDamp
    expect(calmShaderLuma(0.0)).toBe(0.0);
    expect(reversalDampShaderLuma(0.0, 0.0)).toBe(0.0);
    expect(reversalDampShaderLuma(0.0, 0.5)).toBe(0.0);
    expect(reversalDampShaderLuma(0.0, 1.0)).toBe(0.0);
    expect(reversalDampShaderLuma(calmShaderLuma(0.0), 1.0)).toBe(0.0);

    // Non-zero values roll off smoothly without darkening below 0.0
    expect(calmShaderLuma(1.0)).toBeCloseTo((1.0 / 1.5) * 0.5, 5);
    expect(calmShaderLuma(0.5)).toBeGreaterThan(0.0);
    expect(calmShaderLuma(0.5)).toBeLessThan(0.5);
  });

  it('verifies composite shader source preserves dark floor (c = 0.0 stays 0.0)', () => {
    expect(compositeFragSrc).toContain('c = c / (1.0 + c * (1.0 - contrastFactor)) * contrastFactor');
    expect(compositeFragSrc).toContain('c *= (1.0 - uReversalDamp * 0.35)');
  });
});
