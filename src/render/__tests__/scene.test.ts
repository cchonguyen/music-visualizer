import { describe, it, expect, vi } from 'vitest';
import { Scene } from '../scene';
import { WaveformLayer } from '../layers/waveform';
import { ParticleLayer } from '../layers/particles';
import { buildScene, hasCrownLayer } from '../../presets/loader';
import { hasCrownLayer as mainHasCrownLayer } from '../../main';
import type { AudioFrame } from '../../audio/types';
import type { RenderClock } from '../clock';
import type { RenderLayer, RenderTarget } from '../layer';
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
    drawArraysInstanced: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    blendEquation: vi.fn(),
    blendFunc: vi.fn(),
    viewport: vi.fn(),
    getUniformLocation: vi.fn().mockImplementation((_prog, name) => ({ name })),
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

const mockClock: RenderClock = {
  timeSec: 1.0,
  dtSec: 0.016,
  frameIndex: 0,
};

describe('Scene blend state ownership and transitions (Slice 7.8)', () => {
  it('applies max, alpha, add, screen GL blend modes and restores max immediately after each layer draw', () => {
    const gl = createMockGl();
    const calls: string[] = [];

    const mockLayer1: RenderLayer = {
      init: vi.fn(),
      resize: vi.fn(),
      draw: vi.fn(() => calls.push('draw-layer1')),
      dispose: vi.fn(),
    };
    const mockLayer2: RenderLayer = {
      init: vi.fn(),
      resize: vi.fn(),
      draw: vi.fn(() => calls.push('draw-layer2')),
      dispose: vi.fn(),
    };
    const mockLayer3: RenderLayer = {
      init: vi.fn(),
      resize: vi.fn(),
      draw: vi.fn(() => calls.push('draw-layer3')),
      dispose: vi.fn(),
    };
    const mockLayer4: RenderLayer = {
      init: vi.fn(),
      resize: vi.fn(),
      draw: vi.fn(() => calls.push('draw-layer4')),
      dispose: vi.fn(),
    };

    (gl.blendEquation as ReturnType<typeof vi.fn>).mockImplementation((eq: number) => {
      calls.push(`blendEquation:${eq === gl.MAX ? 'MAX' : eq === gl.FUNC_ADD ? 'FUNC_ADD' : eq}`);
    });
    (gl.blendFunc as ReturnType<typeof vi.fn>).mockImplementation((src: number, dst: number) => {
      let srcName = `${src}`;
      let dstName = `${dst}`;
      if (src === gl.ONE) srcName = 'ONE';
      if (src === gl.SRC_ALPHA) srcName = 'SRC_ALPHA';
      if (dst === gl.ONE) dstName = 'ONE';
      if (dst === gl.ONE_MINUS_SRC_ALPHA) dstName = 'ONE_MINUS_SRC_ALPHA';
      if (dst === gl.ONE_MINUS_SRC_COLOR) dstName = 'ONE_MINUS_SRC_COLOR';
      calls.push(`blendFunc:${srcName},${dstName}`);
    });

    const scene = new Scene(
      'test-blend',
      [mockLayer1, mockLayer2, mockLayer3, mockLayer4],
      [
        { opacity: 1, blend: 'max' },
        { opacity: 0.8, blend: 'alpha' },
        { opacity: 0.5, blend: 'add' },
        { opacity: 0.7, blend: 'screen' },
      ],
    );

    scene.init(gl);
    calls.length = 0; // Clear init calls

    scene.draw(makeMockFrame(), mockClock);

    // Layer 1 ('max'): gl.MAX, SRC_ALPHA, ONE -> draw -> restore gl.MAX, SRC_ALPHA, ONE
    expect(calls).toContain('blendEquation:MAX');
    expect(calls).toContain('blendFunc:SRC_ALPHA,ONE');
    expect(calls).toContain('draw-layer1');

    // Layer 2 ('alpha'): gl.FUNC_ADD, SRC_ALPHA, ONE_MINUS_SRC_ALPHA -> draw -> restore gl.MAX, SRC_ALPHA, ONE
    expect(calls).toContain('blendEquation:FUNC_ADD');
    expect(calls).toContain('blendFunc:SRC_ALPHA,ONE_MINUS_SRC_ALPHA');
    expect(calls).toContain('draw-layer2');

    // Layer 3 ('add'): gl.FUNC_ADD, SRC_ALPHA, ONE -> draw -> restore gl.MAX, SRC_ALPHA, ONE
    expect(calls).toContain('blendFunc:SRC_ALPHA,ONE');
    expect(calls).toContain('draw-layer3');

    // Layer 4 ('screen'): gl.FUNC_ADD, ONE, ONE_MINUS_SRC_COLOR -> draw -> restore gl.MAX, SRC_ALPHA, ONE
    expect(calls).toContain('blendFunc:ONE,ONE_MINUS_SRC_COLOR');
    expect(calls).toContain('draw-layer4');

    // After each layer draw, restoration of MAX must occur immediately
    const l2Index = calls.indexOf('draw-layer2');
    expect(calls[l2Index + 1]).toBe('blendEquation:MAX');
    expect(calls[l2Index + 2]).toBe('blendFunc:SRC_ALPHA,ONE');

    const l3Index = calls.indexOf('draw-layer3');
    expect(calls[l3Index + 1]).toBe('blendEquation:MAX');
    expect(calls[l3Index + 2]).toBe('blendFunc:SRC_ALPHA,ONE');

    const l4Index = calls.indexOf('draw-layer4');
    expect(calls[l4Index + 1]).toBe('blendEquation:MAX');
    expect(calls[l4Index + 2]).toBe('blendFunc:SRC_ALPHA,ONE');
  });

  it('passes opacity into each layer draw and sets layer.opacity / setOpacity', () => {
    const gl = createMockGl();

    let receivedOptions1: unknown = null;
    let receivedOptions2: unknown = null;

    const layer1 = {
      opacity: 1,
      init: vi.fn(),
      resize: vi.fn(),
      draw: vi.fn((_f, _c, _t, opt) => { receivedOptions1 = opt; }),
      dispose: vi.fn(),
    };
    const layer2 = {
      currentOpacity: 1,
      setOpacity(o: number) { this.currentOpacity = o; },
      init: vi.fn(),
      resize: vi.fn(),
      draw: vi.fn((_f, _c, _t, opt) => { receivedOptions2 = opt; }),
      dispose: vi.fn(),
    };

    const scene = new Scene('test-opacity', [layer1 as unknown as RenderLayer, layer2 as unknown as RenderLayer], [
      { opacity: 0.35, blend: 'max' },
      { opacity: 0.85, blend: 'alpha' },
    ]);
    scene.init(gl);

    scene.draw(makeMockFrame(), mockClock);

    expect(layer1.opacity).toBe(0.35);
    expect(layer2.currentOpacity).toBe(0.85);
    expect(receivedOptions1).toEqual({ opacity: 0.35, uLayerOpacity: 0.35 });
    expect(receivedOptions2).toEqual({ opacity: 0.85, uLayerOpacity: 0.85 });
  });

  it('WaveformLayer applies opacity to uAlpha uniform and has no conflicting blendFunc calls', () => {
    const gl = createMockGl();
    const waveform = new WaveformLayer();
    waveform.init(gl);

    const uniformCalls: [string, number][] = [];
    (gl.uniform1f as ReturnType<typeof vi.fn>).mockImplementation((loc, val) => {
      if (loc && typeof loc === 'object' && 'name' in loc) {
        uniformCalls.push([(loc as { name: string }).name, val]);
      }
    });

    const target: RenderTarget = { kind: 'canvas', width: 800, height: 600 };
    waveform.draw(makeMockFrame(), mockClock, target, { opacity: 0.42, uLayerOpacity: 0.42 });

    const alphaCall = uniformCalls.find(([name]) => name === 'uAlpha');
    expect(alphaCall).toBeDefined();
    expect(alphaCall![1]).toBe(0.42);

    // WaveformLayer must NOT call gl.blendFunc or gl.enable(gl.BLEND) directly
    expect(gl.blendFunc).not.toHaveBeenCalled();
    expect(gl.enable).not.toHaveBeenCalled();
  });

  it('ParticleLayer applies opacity to uBrightness uniform and has no conflicting blendFunc calls', () => {
    const gl = createMockGl();
    const particles = new ParticleLayer({ brightness: 0.6 });
    particles.init(gl);

    const uniformCalls: [string, number][] = [];
    (gl.uniform1f as ReturnType<typeof vi.fn>).mockImplementation((loc, val) => {
      if (loc && typeof loc === 'object' && 'name' in loc) {
        uniformCalls.push([(loc as { name: string }).name, val]);
      }
    });

    const target: RenderTarget = { kind: 'canvas', width: 800, height: 600 };
    particles.draw(makeMockFrame(), mockClock, target, { opacity: 0.5, uLayerOpacity: 0.5 });

    const brightnessCall = uniformCalls.find(([name]) => name === 'uBrightness');
    expect(brightnessCall).toBeDefined();
    expect(brightnessCall![1]).toBeCloseTo(0.6 * 0.5);

    // ParticleLayer must NOT call gl.blendFunc or gl.blendEquation directly
    expect(gl.blendFunc).not.toHaveBeenCalled();
    expect(gl.blendEquation).not.toHaveBeenCalled();
  });
});

describe('crownOn activation check (Slice 7.8)', () => {
  it('activates crownOn for non-crown preset IDs containing an enabled crown layer', () => {
    const presetWithCrown = {
      name: 'Custom Royal Preset',
      layers: [
        { type: 'tunnel', enabled: true },
        { type: 'crown', enabled: true },
      ],
    };
    expect(hasCrownLayer(presetWithCrown)).toBe(true);
    expect(mainHasCrownLayer(presetWithCrown)).toBe(true);
  });

  it('deactivates crownOn if crown layer is disabled regardless of ID', () => {
    const presetDisabledCrown = {
      name: 'crown',
      layers: [
        { type: 'tunnel', enabled: true },
        { type: 'crown', enabled: false },
      ],
    };
    expect(hasCrownLayer(presetDisabledCrown)).toBe(false);
    expect(mainHasCrownLayer(presetDisabledCrown)).toBe(false);
  });

  it('deactivates crownOn if preset ID is crown but contains no crown layer', () => {
    const fakeCrownPreset = {
      name: 'crown',
      layers: [
        { type: 'tunnel', enabled: true },
        { type: 'waveform', enabled: true },
      ],
    };
    expect(hasCrownLayer(fakeCrownPreset)).toBe(false);
    expect(mainHasCrownLayer(fakeCrownPreset)).toBe(false);
  });
});

describe('buildScene preserving layer opacity and blend mode (Slice 7.8)', () => {
  it('preserves layer opacity and blend mode from preset layers', () => {
    const preset: Preset = {
      version: 1,
      name: 'Blend Test',
      tags: [],
      transition: { style: 'crossfade', seconds: 1 },
      feedback: {},
      layers: [
        { type: 'waveform', enabled: true, opacity: 0.75, blend: 'alpha' as unknown as 'max', params: {} },
        { type: 'particles', enabled: true, opacity: 0.4, blend: 'add', params: {} },
        { type: 'waveform', enabled: false, opacity: 0.1, blend: 'screen' as unknown as 'max', params: {} },
      ],
      post: {},
    };

    const scene = buildScene('test', preset);
    expect(scene.layers).toHaveLength(2);
    const configs = scene.getLayerConfigs();
    expect(configs).toEqual([
      { opacity: 0.75, blend: 'alpha', trails: true },
      { opacity: 0.4, blend: 'add', trails: true },
    ]);
  });

  it('defaults opacity to 1.0 and blend to max when unspecified', () => {
    const preset: Preset = {
      version: 1,
      name: 'Default Test',
      tags: [],
      transition: { style: 'crossfade', seconds: 1 },
      feedback: {},
      layers: [
        { type: 'waveform', enabled: true, opacity: undefined as unknown as number, blend: undefined as unknown as 'max', params: {} },
      ],
      post: {},
    };

    const scene = buildScene('test-def', preset);
    expect(scene.getLayerConfigs()).toEqual([
      { opacity: 1.0, blend: 'max', trails: true },
    ]);
  });
});

describe('Slice 7.18: Blend defaults, screen mode, energy compensation, and trails pass split', () => {
  it('defaults blend to max and uses SRC_ALPHA, ONE for max blend mode', () => {
    const gl = createMockGl();
    const calls: string[] = [];

    const mockLayer: RenderLayer = {
      init: vi.fn(),
      resize: vi.fn(),
      draw: vi.fn(() => calls.push('draw-layer')),
      dispose: vi.fn(),
    };

    (gl.blendEquation as ReturnType<typeof vi.fn>).mockImplementation((eq: number) => {
      calls.push(`blendEquation:${eq === gl.MAX ? 'MAX' : eq === gl.FUNC_ADD ? 'FUNC_ADD' : eq}`);
    });
    (gl.blendFunc as ReturnType<typeof vi.fn>).mockImplementation((src: number, dst: number) => {
      let srcName = `${src}`;
      let dstName = `${dst}`;
      if (src === gl.ONE) srcName = 'ONE';
      if (src === gl.SRC_ALPHA) srcName = 'SRC_ALPHA';
      if (dst === gl.ONE) dstName = 'ONE';
      calls.push(`blendFunc:${srcName},${dstName}`);
    });

    const scene = new Scene('test-default-max', [mockLayer], [{}]); // blend not specified -> defaults to 'max'
    expect(scene.getLayerConfigs()[0]?.blend).toBe('max');
    expect(scene.getLayerConfigs()[0]?.trails).toBe(true);

    scene.init(gl);
    calls.length = 0;
    scene.draw(makeMockFrame(), mockClock);

    expect(calls).toContain('blendEquation:MAX');
    expect(calls).toContain('blendFunc:SRC_ALPHA,ONE');
    expect(calls).toContain('draw-layer');
  });

  it('sets screen blend mode with gl.FUNC_ADD and gl.ONE, gl.ONE_MINUS_SRC_COLOR', () => {
    const gl = createMockGl();
    const calls: string[] = [];

    const mockLayer: RenderLayer = {
      init: vi.fn(),
      resize: vi.fn(),
      draw: vi.fn(() => calls.push('draw-screen')),
      dispose: vi.fn(),
    };

    (gl.blendEquation as ReturnType<typeof vi.fn>).mockImplementation((eq: number) => {
      calls.push(`blendEquation:${eq === gl.MAX ? 'MAX' : eq === gl.FUNC_ADD ? 'FUNC_ADD' : eq}`);
    });
    (gl.blendFunc as ReturnType<typeof vi.fn>).mockImplementation((src: number, dst: number) => {
      let srcName = `${src}`;
      let dstName = `${dst}`;
      if (src === gl.ONE) srcName = 'ONE';
      if (dst === gl.ONE_MINUS_SRC_COLOR) dstName = 'ONE_MINUS_SRC_COLOR';
      calls.push(`blendFunc:${srcName},${dstName}`);
    });

    const scene = new Scene('test-screen', [mockLayer], [{ blend: 'screen' }]);
    scene.init(gl);
    calls.length = 0;
    scene.draw(makeMockFrame(), mockClock);

    expect(calls).toContain('blendEquation:FUNC_ADD');
    expect(calls).toContain('blendFunc:ONE,ONE_MINUS_SRC_COLOR');
    expect(calls).toContain('draw-screen');
  });

  it('attenuates additive and screen layer opacity under feedback decay > 0.05', () => {
    const gl = createMockGl();
    let receivedAddOpt: { opacity: number; uLayerOpacity: number } | null = null;
    let receivedScreenOpt: { opacity: number; uLayerOpacity: number } | null = null;
    let receivedMaxOpt: { opacity: number; uLayerOpacity: number } | null = null;

    const layerAdd = {
      init: vi.fn(),
      resize: vi.fn(),
      draw: vi.fn((_f, _c, _t, opt) => { receivedAddOpt = opt; }),
      dispose: vi.fn(),
    };
    const layerScreen = {
      init: vi.fn(),
      resize: vi.fn(),
      draw: vi.fn((_f, _c, _t, opt) => { receivedScreenOpt = opt; }),
      dispose: vi.fn(),
    };
    const layerMax = {
      init: vi.fn(),
      resize: vi.fn(),
      draw: vi.fn((_f, _c, _t, opt) => { receivedMaxOpt = opt; }),
      dispose: vi.fn(),
    };

    const scene = new Scene(
      'test-decay-attenuation',
      [layerAdd as unknown as RenderLayer, layerScreen as unknown as RenderLayer, layerMax as unknown as RenderLayer],
      [
        { opacity: 1.0, blend: 'add', trails: true },
        { opacity: 0.8, blend: 'screen', trails: true },
        { opacity: 1.0, blend: 'max', trails: true },
      ],
    );
    // decay = 0.90 (> 0.05). scaling factor = 1.0 - 0.90 * 0.82 = 0.262
    scene.setFeedback({ decay: 0.9 });
    scene.init(gl);

    scene.draw(makeMockFrame(), mockClock);

    const expectedAdd = 1.0 * (1.0 - 0.9 * 0.82);
    const expectedScreen = 0.8 * (1.0 - 0.9 * 0.82);

    expect(receivedAddOpt!.opacity).toBeCloseTo(expectedAdd, 5);
    expect(receivedScreenOpt!.opacity).toBeCloseTo(expectedScreen, 5);
    // max blend does not attenuate with decay
    expect(receivedMaxOpt!.opacity).toBeCloseTo(1.0, 5);
  });

  it('does not scale opacity for decay <= 0.05 or when trails is false', () => {
    const gl = createMockGl();
    let receivedLowDecayOpt: { opacity: number; uLayerOpacity: number } | null = null;
    let receivedNoTrailsOpt: { opacity: number; uLayerOpacity: number } | null = null;

    const layerLowDecay = {
      init: vi.fn(),
      resize: vi.fn(),
      draw: vi.fn((_f, _c, _t, opt) => { receivedLowDecayOpt = opt; }),
      dispose: vi.fn(),
    };
    const layerNoTrails = {
      init: vi.fn(),
      resize: vi.fn(),
      draw: vi.fn((_f, _c, _t, opt) => { receivedNoTrailsOpt = opt; }),
      dispose: vi.fn(),
    };

    const scene = new Scene(
      'test-decay-edge',
      [layerLowDecay as unknown as RenderLayer, layerNoTrails as unknown as RenderLayer],
      [
        { opacity: 1.0, blend: 'add', trails: true },
        { opacity: 1.0, blend: 'add', trails: false },
      ],
    );
    scene.setFeedback({ decay: 0.04 }); // <= 0.05
    scene.init(gl);

    scene.draw(makeMockFrame(), mockClock);

    expect(receivedLowDecayOpt!.opacity).toBeCloseTo(1.0, 5);
    expect(receivedNoTrailsOpt!.opacity).toBeCloseTo(1.0, 5);
  });

  it('isolates trails: false overlay layers from feedback loop history', () => {
    const gl = createMockGl();
    const calls: string[] = [];

    const trailingLayer: RenderLayer = {
      init: vi.fn(),
      resize: vi.fn(),
      draw: vi.fn((_f, _c, target) => {
        calls.push(`draw-trailing:fbo=${target.framebuffer ? 'write' : 'canvas'}`);
      }),
      dispose: vi.fn(),
    };

    const overlayLayer: RenderLayer = {
      init: vi.fn(),
      resize: vi.fn(),
      draw: vi.fn((_f, _c, target) => {
        calls.push(`draw-overlay:fbo=${target.framebuffer ? 'write' : 'canvas'}`);
      }),
      dispose: vi.fn(),
    };

    const scene = new Scene(
      'test-trails-isolation',
      [trailingLayer, overlayLayer],
      [
        { opacity: 1.0, blend: 'max', trails: true },
        { opacity: 1.0, blend: 'alpha', trails: false },
      ],
    );

    scene.init(gl);

    // Frame 1 draw
    calls.length = 0;
    scene.draw(makeMockFrame(), mockClock);

    // Order must be: draw trailing layer -> swap -> blit read to write -> draw overlay layer
    expect(calls).toEqual([
      'draw-trailing:fbo=write',
      'draw-overlay:fbo=write',
    ]);

    // scene.texture should return outputTex (write buffer texture containing overlay)
    const outTex = scene.texture;
    expect(outTex).toBeDefined();
    expect(scene.outputTexture()).toBe(outTex);
  });
});
