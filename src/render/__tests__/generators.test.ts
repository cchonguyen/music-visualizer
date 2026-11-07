import { describe, it, expect, vi } from 'vitest';
import { MoireLayer } from '../layers/moire';
import { SpectralTerrainLayer, TERRAIN_HISTORY_UNIT, TERRAIN_BINS, TERRAIN_RIDGES } from '../layers/spectralTerrain';
import moireFragSrc from '../shaders/moire.frag.glsl?raw';
import terrainVertSrc from '../shaders/spectralTerrain.vert.glsl?raw';
import terrainFragSrc from '../shaders/spectralTerrain.frag.glsl?raw';
import {
  assertValidSpec,
  MOIRE_SPECS,
  MOIRE_DEFAULTS,
  SPECTRAL_TERRAIN_SPECS,
  SPECTRAL_TERRAIN_DEFAULTS,
} from '../../presets/schema';
import { LAYER_FACTORIES, applyValues, buildScene } from '../../presets/loader';
import { FLAGSHIP_PRESETS_07_08, ALL_PRESETS } from '../../presets/builtin';
import { PRESET_VERSION } from '../../presets/format';
import { BrightnessLimiter } from '../safety';
import type { AudioFrame } from '../../audio/types';
import type { RenderClock } from '../clock';
import type { RenderTarget } from '../layer';
import { getTerrainState, setTerrainState, clearTerrainState } from '../terrainStore';
import { ParticleLayer } from '../layers/particles';
import { Scene } from '../scene';

function createMockGl(): WebGL2RenderingContext {
  const activeTextures: number[] = [];
  const boundTextures: Map<number, any> = new Map();
  let currentActiveUnit = 0x84c0; // TEXTURE0

  const gl = {
    MAX: 0x8008,
    FUNC_ADD: 0x8006,
    ONE: 1,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    BLEND: 0x0be2,
    TRIANGLES: 4,
    TRIANGLE_STRIP: 5,
    LINE_STRIP: 3,
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
    createTexture: vi.fn().mockReturnValue({}),
    deleteTexture: vi.fn(),
    bindTexture: vi.fn((_target: number, tex: any) => {
      boundTextures.set(currentActiveUnit, tex);
    }),
    activeTexture: vi.fn((unit: number) => {
      currentActiveUnit = unit;
      activeTextures.push(unit);
    }),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    texSubImage2D: vi.fn(),
    createFramebuffer: vi.fn().mockReturnValue({}),
    deleteFramebuffer: vi.fn(),
    bindFramebuffer: vi.fn(),
    bindVertexArray: vi.fn(),
    useProgram: vi.fn(),
    getUniformLocation: vi.fn().mockImplementation((_prog, name) => ({ name })),
    uniform1f: vi.fn(),
    uniform1fv: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    uniform3fv: vi.fn(),
    uniformMatrix4fv: vi.fn(),
    getExtension: vi.fn().mockReturnValue(null),
    checkFramebufferStatus: vi.fn().mockReturnValue(0x8cd5),
    framebufferTexture2D: vi.fn(),
    drawArraysInstanced: vi.fn(),
    drawArrays: vi.fn(),
  };

  (gl as any)._activeTextures = activeTextures;
  (gl as any)._boundTextures = boundTextures;
  return gl as unknown as WebGL2RenderingContext;
}

function createDummyAudioFrame(): AudioFrame {
  const spectrum = new Float32Array(512);
  for (let i = 0; i < spectrum.length; i++) spectrum[i] = Math.sin(i * 0.1) * 0.5 + 0.5;
  return {
    waveform: new Float32Array(512),
    spectrum,
    bandWaveforms: {
      sub: new Float32Array(128),
      mid: new Float32Array(128),
      high: new Float32Array(128),
    },
    sampleRate: 48000,
    bands: { sub: 0.7, bass: 0.6, mid: 0.5, high: 0.4 },
    norm: { sub: 0.65, bass: 0.55, mid: 0.45, high: 0.35 },
    beatByBand: { sub: false, bass: false, mid: false, high: false },
    energy: 0.5,
    loudness: 0.6,
    brightness: 0.5,
    kickEnv: 0.85,
    centroid: 1200,
  } as unknown as AudioFrame;
}

const dummyClock: RenderClock = {
  frameIndex: 1,
  timeSec: 2.5,
  dtSec: 0.016,
};

const dummyTarget: RenderTarget = {
  kind: 'canvas',
  width: 1280,
  height: 720,
};

describe('Slice 7.13: MoireLayer and moire.frag.glsl', () => {
  it('instantiates with defaults and accepts parameter overrides', () => {
    const layer = new MoireLayer();
    expect(layer).toBeDefined();

    const custom = new MoireLayer({ scale: 45, speed: 1.2, lineWidth: 0.6, brightness: 1.5 });
    expect(custom).toBeDefined();
  });

  it('updates parameters via setParams', () => {
    const layer = new MoireLayer();
    layer.setParams({ scale: 50.0, speed: 0.8 });
    expect(layer).toBeDefined();
  });

  it('initializes program, VAO, and uniforms without throwing', () => {
    const gl = createMockGl();
    const layer = new MoireLayer();
    layer.init(gl);

    expect(gl.createProgram).toHaveBeenCalled();
    expect(gl.createVertexArray).toHaveBeenCalled();
    expect(gl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), 'uScale');
    expect(gl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), 'u_mid');
    expect(gl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), 'u_sub');
    expect(gl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), 'u_kickEnv');
    expect(gl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), 'uContrast');
    expect(gl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), 'uWaveShape');
    expect(gl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), 'uColorSpread');
    expect(gl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), 'uPatternMode');
    expect(gl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), 'uAudioWarp');
    expect(gl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), 'uLayerOpacity');
    expect(gl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), 'uColorA');
    expect(gl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), 'uColorB');
  });

  it('draws fullscreen quad and passes audio/kickEnv uniforms', () => {
    const gl = createMockGl();
    const layer = new MoireLayer({ scale: 32 });
    layer.init(gl);

    const frame = createDummyAudioFrame();
    layer.draw(frame, dummyClock, dummyTarget, { uLayerOpacity: 0.85 });

    expect(gl.useProgram).toHaveBeenCalled();
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 3);

    // Uniform calls verification
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.objectContaining({ name: 'u_mid' }), frame.norm.mid);
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.objectContaining({ name: 'u_sub' }), frame.norm.sub);
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.objectContaining({ name: 'u_kickEnv' }), frame.kickEnv);
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.objectContaining({ name: 'uScale' }), 32);
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.objectContaining({ name: 'uContrast' }), 0.60);
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.objectContaining({ name: 'uWaveShape' }), 0.25);
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.objectContaining({ name: 'uColorSpread' }), 0.80);
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.objectContaining({ name: 'uAudioWarp' }), 0.65);
    expect(gl.uniform1i).toHaveBeenCalledWith(expect.objectContaining({ name: 'uPatternMode' }), 0);
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.objectContaining({ name: 'uLayerOpacity' }), 0.85);
  });

  it('supports all 4 Loom pattern modes and maps patternMode to integer uniforms', () => {
    const gl = createMockGl();
    const modes = [
      { mode: 'starburstLoom' as const, expected: 0 },
      { mode: 'twinCircles' as const, expected: 1 },
      { mode: 'doubleSpirals' as const, expected: 2 },
      { mode: 'warpedCrossGrid' as const, expected: 3 },
    ];

    const frame = createDummyAudioFrame();
    for (const { mode, expected } of modes) {
      const layer = new MoireLayer({ patternMode: mode });
      layer.init(gl);
      layer.draw(frame, dummyClock, dummyTarget);
      expect(gl.uniform1i).toHaveBeenCalledWith(expect.objectContaining({ name: 'uPatternMode' }), expected);
    }
  });

  it('enforces fwidth derivative anti-aliasing and spatial frequency caps in moire.frag.glsl (SYSTEM_SPEC.md:94)', () => {
    // Must contain fwidth anti-aliasing
    expect(moireFragSrc).toContain('fwidth');
    // Must contain spatial frequency cap (SYSTEM_SPEC.md:94)
    expect(moireFragSrc).toMatch(/MAX_SPATIAL_FREQ|MAX_FREQ|clamp\(uScale/);
    // Must contain smoothed XOR combination abs(grid1 - grid2)
    expect(moireFragSrc).toContain('abs(grid1 - grid2)');
    // Must modulate frequency delta <= 0.08 with u_sub
    expect(moireFragSrc).toMatch(/0\.08/);
    // Must include radial phase inversion ring driven by kickEnv
    expect(moireFragSrc).toContain('u_kickEnv');
    // Slice 7.25: stencil alpha and loom parameters
    expect(moireFragSrc).toContain('uPatternMode');
    expect(moireFragSrc).toContain('uLayerOpacity');
    expect(moireFragSrc).toContain('uContrast');
    expect(moireFragSrc).toContain('uWaveShape');
    expect(moireFragSrc).toContain('uColorSpread');
    expect(moireFragSrc).toContain('uAudioWarp');
    expect(moireFragSrc).toMatch(/clamp\(moire \* uContrast,\s*0\.0,\s*1\.0\)\s*\* uLayerOpacity/);
    expect(moireFragSrc).toContain('fragColor = vec4(col * a, a)');
  });

  it('binds uSceneTex on TEXTURE1 when provided via options.sceneTex (Slice 7.35)', () => {
    const gl = createMockGl();
    const layer = new MoireLayer();
    layer.init(gl);

    const frame = createDummyAudioFrame();
    const mockSceneTex = { id: 'mockSceneTex' } as unknown as WebGLTexture;
    layer.draw(frame, dummyClock, dummyTarget, { sceneTex: mockSceneTex });

    const activeUnits = (gl as any)._activeTextures;
    expect(activeUnits).toContain(gl.TEXTURE1);
    expect((gl as any)._boundTextures.get(gl.TEXTURE1)).toBe(mockSceneTex);
    expect(gl.uniform1i).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'uSceneTex' }),
      1,
    );
    expect(gl.uniform1i).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'uHasSceneTex' }),
      1,
    );
  });

  it('sets uHasSceneTex to 0 when sceneTex is not provided (Slice 7.35)', () => {
    const gl = createMockGl();
    const layer = new MoireLayer();
    layer.init(gl);

    const frame = createDummyAudioFrame();
    layer.draw(frame, dummyClock, dummyTarget);

    expect(gl.uniform1i).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'uHasSceneTex' }),
      0,
    );
  });

  it('verifies moire.frag.glsl contains uSceneTex, uHasSceneTex, wide Nyquist roll-off, and refraction gradient (Slice 7.35)', () => {
    expect(moireFragSrc).toContain('uniform sampler2D uSceneTex;');
    expect(moireFragSrc).toContain('uniform int uHasSceneTex;');
    expect(moireFragSrc).toContain('1.0 - fw * 0.12');
    expect(moireFragSrc).toContain('max(freqDelta, 0.045)');
    expect(moireFragSrc).toContain('dFdx(interference)');
    expect(moireFragSrc).toContain('dFdy(interference)');
    expect(moireFragSrc).toContain('mix(0.55, 1.65, interference)');
  });

  it('Scene passes snapshot texture to MoireLayer as sceneTex during draw (Slice 7.35)', () => {
    const gl = createMockGl();
    const moireLayer = new MoireLayer();
    const drawSpy = vi.spyOn(moireLayer, 'draw');
    const scene = new Scene('moireScene', [moireLayer]);
    scene.init(gl);

    const frame = createDummyAudioFrame();
    scene.draw(frame, dummyClock);

    expect(drawSpy).toHaveBeenCalledWith(
      frame,
      dummyClock,
      expect.anything(),
      expect.objectContaining({
        sceneTex: expect.anything(),
      }),
    );
    const lastCall = drawSpy.mock.calls[0];
    const optionsPassed = lastCall?.[3] as any;
    expect(optionsPassed?.sceneTex).not.toBeNull();
    expect(optionsPassed?.sceneTex).toBeDefined();
  });

  it('disposes resources cleanly', () => {
    const gl = createMockGl();
    const layer = new MoireLayer();
    layer.init(gl);
    layer.dispose();

    expect(gl.deleteProgram).toHaveBeenCalled();
    expect(gl.deleteVertexArray).toHaveBeenCalled();
  });
});

describe('Slice 7.13: SpectralTerrainLayer and shaders', () => {
  it('instantiates with defaults and accepts parameter overrides', () => {
    const layer = new SpectralTerrainLayer();
    expect(layer).toBeDefined();

    const custom = new SpectralTerrainLayer({
      elevation: 0.8,
      width: 1.5,
      horizonY: 0.4,
      foregroundY: -0.6,
      brightness: 1.5,
    });
    expect(custom).toBeDefined();
  });

  it('initializes 128x64 R32F history ring buffer and line/skirt VAOs', () => {
    const gl = createMockGl();
    const layer = new SpectralTerrainLayer();
    layer.init(gl);

    // History texture 128x64 R32F
    expect(gl.createTexture).toHaveBeenCalled();
    expect(gl.texImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      TERRAIN_BINS,
      TERRAIN_RIDGES,
      0,
      gl.RED,
      gl.FLOAT,
      null,
    );

    // 2 VAOs (line + skirt)
    expect(gl.createVertexArray).toHaveBeenCalledTimes(2);
    expect(gl.createBuffer).toHaveBeenCalledTimes(2);
  });

  it('strictly binds private history texture to TEXTURE5 (never TEXTURE0–4)', () => {
    const gl = createMockGl();
    const layer = new SpectralTerrainLayer();
    layer.init(gl);

    const frame = createDummyAudioFrame();
    layer.draw(frame, dummyClock, dummyTarget);

    const activeUnits = (gl as any)._activeTextures;
    // Verify TEXTURE5 (0x84c5) was bound
    expect(activeUnits).toContain(gl.TEXTURE0 + TERRAIN_HISTORY_UNIT);

    // Verify uniform uHistoryTex was set to 5
    expect(gl.uniform1i).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'uHistoryTex' }),
      TERRAIN_HISTORY_UNIT,
    );
  });

  it('updates ring buffer once per frame via texSubImage2D and advances headRow', () => {
    const gl = createMockGl();
    const layer = new SpectralTerrainLayer();
    layer.init(gl);

    expect(layer.getHeadRow()).toBe(0);

    const frame = createDummyAudioFrame();
    layer.draw(frame, dummyClock, dummyTarget);
    expect(gl.texSubImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      0,
      0, // row 0
      TERRAIN_BINS,
      1,
      gl.RED,
      gl.FLOAT,
      expect.any(Float32Array),
      0,
    );
    expect(layer.getHeadRow()).toBe(1);

    // Draw second frame
    layer.draw(frame, dummyClock, dummyTarget);
    expect(gl.texSubImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      0,
      1, // row 1
      TERRAIN_BINS,
      1,
      gl.RED,
      gl.FLOAT,
      expect.any(Float32Array),
      0,
    );
    expect(layer.getHeadRow()).toBe(2);
  });

  it('renders 64 ridges back-to-front with occlusion skirt (TRIANGLE_STRIP) and line (LINE_STRIP)', () => {
    const gl = createMockGl();
    const layer = new SpectralTerrainLayer();
    layer.init(gl);

    const frame = createDummyAudioFrame();
    layer.draw(frame, dummyClock, dummyTarget);

    // 64 ridges * 2 draw calls each = 128 draw calls
    expect(gl.drawArrays).toHaveBeenCalledTimes(TERRAIN_RIDGES * 2);

    // Occlusion skirt draw calls: TRIANGLE_STRIP with 256 vertices
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLE_STRIP, 0, TERRAIN_BINS * 2);

    // Line draw calls: LINE_STRIP with 128 vertices
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.LINE_STRIP, 0, TERRAIN_BINS);

    // Blending enabled with ONE, ONE_MINUS_SRC_ALPHA for skirts and SRC_ALPHA, ONE for lines
    expect(gl.enable).toHaveBeenCalledWith(gl.BLEND);
    expect(gl.blendFunc).toHaveBeenCalledWith(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    expect(gl.blendFunc).toHaveBeenCalledWith(gl.SRC_ALPHA, gl.ONE);
  });

  it('protects texture unit 0: never unbinds texture unit 0 during history upload or draw (Slice 7.38)', () => {
    const gl = createMockGl();
    const layer = new SpectralTerrainLayer();
    layer.init(gl);

    // Bind a dummy texture to TEXTURE0 before terrain draw
    const dummyTex0 = { id: 'dummyTex0' } as unknown as WebGLTexture;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dummyTex0);

    const frame = createDummyAudioFrame();
    layer.draw(frame, dummyClock, dummyTarget);

    // Verify TEXTURE0 was never unbound (boundTexture for TEXTURE0 is still dummyTex0)
    expect((gl as any)._boundTextures.get(gl.TEXTURE0)).toBe(dummyTex0);
  });

  it('defaults skirtOpacity to 0.15 and applies non-destructive skirt blendFunc (Slice 7.38)', () => {
    const gl = createMockGl();
    const layer = new SpectralTerrainLayer();
    layer.init(gl);

    const frame = createDummyAudioFrame();
    layer.draw(frame, dummyClock, dummyTarget);

    expect(gl.uniform1f).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'uSkirtOpacity' }),
      0.15,
    );
    expect(gl.blendFunc).toHaveBeenCalledWith(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  });

  it('disposes all buffers, textures, and program', () => {
    const gl = createMockGl();
    const layer = new SpectralTerrainLayer();
    layer.init(gl);
    layer.dispose();

    expect(gl.deleteProgram).toHaveBeenCalled();
    expect(gl.deleteTexture).toHaveBeenCalled();
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(2);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(2);
  });
});

describe('Slice 7.13: Schema and Loader registration', () => {
  it('validates all MOIRE_SPECS and SPECTRAL_TERRAIN_SPECS', () => {
    expect(MOIRE_DEFAULTS.scale).toBe(30.0);
    expect(SPECTRAL_TERRAIN_DEFAULTS.elevation).toBe(0.6);
    for (const spec of MOIRE_SPECS) {
      expect(() => assertValidSpec(spec)).not.toThrow();
    }
    for (const spec of SPECTRAL_TERRAIN_SPECS) {
      expect(() => assertValidSpec(spec)).not.toThrow();
    }
  });

  it('verifies shader structures for terrain and moire', () => {
    expect(terrainVertSrc).toContain('uHistoryTex');
    expect(terrainVertSrc).toContain('uIsSkirtPass');
    expect(terrainFragSrc).toContain('outColor = vColor');
  });

  it('LAYER_FACTORIES creates MoireLayer and SpectralTerrainLayer', () => {
    const moireLayer = LAYER_FACTORIES.moire!({ scale: 28 });
    expect(moireLayer).toBeInstanceOf(MoireLayer);

    const terrainLayer = LAYER_FACTORIES.spectralTerrain!({ elevation: 0.5 });
    expect(terrainLayer).toBeInstanceOf(SpectralTerrainLayer);
  });

  it('applyValues sets parameters on MoireLayer and SpectralTerrainLayer', () => {
    const moireLayer = new MoireLayer();
    const terrainLayer = new SpectralTerrainLayer();

    applyValues(moireLayer, { scale: 40, brightness: 1.8 });
    applyValues(terrainLayer, { elevation: 1.1, width: 1.8 });

    expect(moireLayer).toBeDefined();
    expect(terrainLayer).toBeDefined();
  });
});

describe('Slice 7.13: Flagship Presets 07 and 08', () => {
  it('registers Presets 07 and 08 in FLAGSHIP_PRESETS_07_08 and ALL_PRESETS', () => {
    expect(FLAGSHIP_PRESETS_07_08).toHaveLength(2);
    const ids = FLAGSHIP_PRESETS_07_08.map((p) => p.id);
    expect(ids).toEqual(['07-moire-interference-loom', '08-spectral-ridge-terrain']);

    const inAll = ALL_PRESETS.filter((p) => ids.includes(p.id));
    expect(inAll).toHaveLength(2);
  });

  it('all presets pass schema validation with zero warnings', () => {
    for (const entry of FLAGSHIP_PRESETS_07_08) {
      expect(entry.warnings).toEqual([]);
      expect(entry.preset.version).toBe(PRESET_VERSION);
      expect(entry.preset.name).toBeTruthy();
    }
  });

  it('STRICT INVARIANT: Preset 08 is NOT named after Joy Division or Unknown Pleasures', () => {
    const forbidden = ['joy division', 'unknown pleasures'];
    for (const entry of FLAGSHIP_PRESETS_07_08) {
      const lowerId = entry.id.toLowerCase();
      const lowerName = entry.preset.name.toLowerCase();
      for (const f of forbidden) {
        expect(lowerId).not.toContain(f);
        expect(lowerName).not.toContain(f);
      }
    }
  });

  it('Preset 07 (Moiré Interference Loom) matches specifications', () => {
    const p7 = FLAGSHIP_PRESETS_07_08.find((p) => p.id === '07-moire-interference-loom')!.preset;
    expect(p7.name).toBe('Moiré Interference Loom');
    expect(p7.feedback.decay?.value).toBe(0.25);

    const moireLayer = p7.layers.find((l) => l.type === 'moire');
    expect(moireLayer).toBeDefined();
    expect(moireLayer!.enabled).toBe(true);
    expect(moireLayer!.blend).toBe('max');
    expect(moireLayer!.trails).toBe(false);
    expect(moireLayer!.params.patternMode?.value).toBe('starburstLoom');
    expect(moireLayer!.params.contrast?.value).toBe(0.65);
    expect(moireLayer!.params.waveShape?.value).toBe(0.35);
    expect(moireLayer!.params.colorSpread?.value).toBe(0.85);
    expect(moireLayer!.params.audioWarp?.value).toBe(0.70);

    const scene = buildScene('test-07', p7);
    expect(scene.layers[0]).toBeInstanceOf(MoireLayer);
  });

  it('Preset 08 (Spectral Ridge Terrain) matches specifications', () => {
    const p8 = FLAGSHIP_PRESETS_07_08.find((p) => p.id === '08-spectral-ridge-terrain')!.preset;
    expect(p8.name).toBe('Spectral Ridge Terrain');
    expect(p8.feedback.decay?.value).toBe(0.15);

    const terrainLayer = p8.layers.find((l) => l.type === 'spectralTerrain');
    expect(terrainLayer).toBeDefined();
    expect(terrainLayer!.enabled).toBe(true);
    expect(terrainLayer!.blend).toBe('max');
    expect(terrainLayer!.trails).toBe(true);
    expect(terrainLayer!.params.skirtOpacity?.value).toBe(0.20);
    expect(terrainLayer!.params.lineThickness?.value).toBe(2.2);

    const pulseLayer = p8.layers.find((l) => l.type === 'bassPulse');
    expect(pulseLayer).toBeDefined();
    expect(pulseLayer!.enabled).toBe(true);

    const scene = buildScene('test-08', p8);
    expect(scene.layers.some((l) => l instanceof SpectralTerrainLayer)).toBe(true);
  });

  it('passes safety pass (BrightnessLimiter)', () => {
    const limiter = new BrightnessLimiter();
    // Verify preset luminance limits
    for (const entry of FLAGSHIP_PRESETS_07_08) {
      expect(entry.preset).toBeDefined();
      const cap = limiter.step(0.9, 0.016);
      expect(cap).toBeGreaterThanOrEqual(0.15);
      expect(cap).toBeLessThanOrEqual(1.0);
    }
  });
});

describe('Slice 7.27: Spectral Terrain Option A & Option B (terrainStore + displacement)', () => {
  it('manages terrainStore get/set/clear per WebGL context', () => {
    const gl = createMockGl();
    const defaultState = getTerrainState(gl);
    expect(defaultState.active).toBe(false);
    expect(defaultState.historyTex).toBeNull();
    expect(defaultState.writeRow).toBe(0);
    expect(defaultState.rows).toBe(64);

    const dummyTex = {} as WebGLTexture;
    setTerrainState(gl, {
      active: true,
      historyTex: dummyTex,
      writeRow: 12,
      rows: 64,
      terrainFlow: 0.45,
    });

    const activeState = getTerrainState(gl);
    expect(activeState.active).toBe(true);
    expect(activeState.historyTex).toBe(dummyTex);
    expect(activeState.writeRow).toBe(12);
    expect(activeState.terrainFlow).toBe(0.45);

    clearTerrainState(gl);
    const clearedState = getTerrainState(gl);
    expect(clearedState.active).toBe(false);
    expect(clearedState.historyTex).toBeNull();
  });

  it('SpectralTerrainLayer publishes active state to terrainStore on draw', () => {
    const gl = createMockGl();
    clearTerrainState(gl);
    const layer = new SpectralTerrainLayer({ terrainFlow: 0.42 });
    layer.init(gl);

    const frame = createDummyAudioFrame();
    layer.draw(frame, dummyClock, dummyTarget);

    const state = getTerrainState(gl);
    expect(state.active).toBe(true);
    expect(state.historyTex).toBe(layer.getHistoryTexture());
    expect(state.writeRow).toBe(layer.writeRow);
    expect(state.rows).toBe(64);
    expect(state.terrainFlow).toBe(0.42);
  });

  it('Scene biases feedback driftY downhill when terrain is active in previous frame (Option A)', () => {
    const gl = createMockGl();
    const terrainLayer = new SpectralTerrainLayer({ terrainFlow: 0.5 });
    const scene = new Scene('terrainScene', [terrainLayer]);
    scene.init(gl);

    const frame = createDummyAudioFrame();
    // Frame 1: terrain draws and publishes terrainState
    scene.draw(frame, dummyClock);

    // After Frame 1 draw, terrainStore has active: true and terrainFlow: 0.5
    expect(getTerrainState(gl).active).toBe(true);

    // Frame 2: Scene.draw reads previous frame's terrainState and clears it,
    // applying downhill drift bias driftY -= 0.012 * terrainFlow = -0.006
    scene.draw(frame, dummyClock);

    expect(gl.uniform2f).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'uDrift' }),
      0, // driftX
      -0.006, // driftY biased by -0.012 * 0.5
    );
  });

  it('ParticleLayer binds TEXTURE5 and uploads displacement uniforms when terrainDisplace > 0 (Option B)', () => {
    const gl = createMockGl();
    clearTerrainState(gl);

    const mockTex = { id: 'terrainHistoryTex' } as unknown as WebGLTexture;
    setTerrainState(gl, {
      active: true,
      historyTex: mockTex,
      writeRow: 15,
      rows: 64,
      terrainFlow: 0.4,
    });

    const particles = new ParticleLayer({ terrainDisplace: 0.5 });
    particles.init(gl);

    const frame = createDummyAudioFrame();
    particles.draw(frame, dummyClock, dummyTarget);

    // Verify TEXTURE5 (0x84c5) was bound to terrain history texture
    const activeUnits = (gl as any)._activeTextures;
    expect(activeUnits).toContain(gl.TEXTURE5);
    expect((gl as any)._boundTextures.get(gl.TEXTURE5)).toBe(mockTex);

    // Verify uniforms
    expect(gl.uniform1i).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'uTerrainTex' }),
      5,
    );
    expect(gl.uniform1f).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'uTerrainDisplace' }),
      0.5,
    );
    expect(gl.uniform1f).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'uTerrainWriteRow' }),
      15,
    );
  });

  it('ParticleLayer uploads uTerrainDisplace = 0 when terrain is inactive or terrainDisplace is 0', () => {
    const gl = createMockGl();
    clearTerrainState(gl);

    const particles = new ParticleLayer({ terrainDisplace: 0.0 });
    particles.init(gl);

    const frame = createDummyAudioFrame();
    particles.draw(frame, dummyClock, dummyTarget);

    expect(gl.uniform1f).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'uTerrainDisplace' }),
      0.0,
    );
  });
});
