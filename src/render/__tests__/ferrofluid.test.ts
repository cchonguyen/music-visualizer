import { describe, it, expect, vi } from 'vitest';
import { FerrofluidLayer, generateIcosahedronMesh } from '../layers/ferrofluid';
import { RingsLayer } from '../layers/rings';
import vertSrc from '../shaders/ferrofluid.vert.glsl?raw';
import fragSrc from '../shaders/ferrofluid.frag.glsl?raw';
import {
  assertValidSpec,
  FERROFLUID_SPECS,
  FERROFLUID_DEFAULTS,
} from '../../presets/schema';
import { LAYER_FACTORIES, applyValues, buildScene } from '../../presets/loader';
import { FLAGSHIP_PRESETS_11, ALL_PRESETS } from '../../presets/builtin';
import { PRESET_VERSION } from '../../presets/format';
import type { AudioFrame } from '../../audio/types';
import type { RenderClock } from '../clock';
import type { RenderTarget } from '../layer';

function createMockGl(): WebGL2RenderingContext & {
  calls: string[];
  depthTestEnabled: boolean;
  cullFaceEnabled: boolean;
  uniformValues: Map<string, any>;
} {
  const uniformValues = new Map<string, any>();
  const calls: string[] = [];
  let depthTestEnabled = false;
  let cullFaceEnabled = false;

  const gl = {
    DEPTH_TEST: 0x0b71,
    CULL_FACE: 0x0b44,
    BACK: 0x0405,
    LEQUAL: 0x0203,
    DEPTH_BUFFER_BIT: 0x00000100,
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    UNSIGNED_SHORT: 0x1403,
    TRIANGLES: 0x0004,
    FRAMEBUFFER: 0x8d40,

    calls,
    get depthTestEnabled() {
      return depthTestEnabled;
    },
    get cullFaceEnabled() {
      return cullFaceEnabled;
    },
    uniformValues,

    getExtension: vi.fn().mockReturnValue(null),
    enable: vi.fn((cap: number) => {
      if (cap === 0x0b71) {
        depthTestEnabled = true;
        calls.push('enable:DEPTH_TEST');
      } else if (cap === 0x0b44) {
        cullFaceEnabled = true;
        calls.push('enable:CULL_FACE');
      }
    }),
    disable: vi.fn((cap: number) => {
      if (cap === 0x0b71) {
        depthTestEnabled = false;
        calls.push('disable:DEPTH_TEST');
      } else if (cap === 0x0b44) {
        cullFaceEnabled = false;
        calls.push('disable:CULL_FACE');
      }
    }),
    cullFace: vi.fn((mode: number) => {
      calls.push(`cullFace:${mode}`);
    }),
    depthFunc: vi.fn((func: number) => {
      calls.push(`depthFunc:${func}`);
    }),
    clear: vi.fn((mask: number) => {
      calls.push(`clear:${mask}`);
    }),
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
    drawElements: vi.fn((mode: number, count: number, type: number, offset: number) => {
      calls.push(`drawElements:${mode}:${count}:${type}:${offset}:depth=${depthTestEnabled}`);
    }),
  };

  return gl as unknown as WebGL2RenderingContext & {
    calls: string[];
    depthTestEnabled: boolean;
    cullFaceEnabled: boolean;
    uniformValues: Map<string, any>;
  };
}

function makeMockFrame(): AudioFrame {
  const spectrum = new Float32Array(512);
  for (let i = 0; i < spectrum.length; i++) spectrum[i] = Math.sin(i * 0.1) * 0.5 + 0.5;
  return {
    frameIndex: 1,
    time: 1.0,
    dtSec: 0.016,
    raw: { sub: 0.5, mid: 0.4, high: 0.3 },
    env: { sub: 0.5, mid: 0.4, high: 0.3 },
    norm: { sub: 0.7, mid: 0.6, high: 0.5 },
    loudness: 0.6,
    energy: 0.5,
    flux: 0.2,
    fluxByBand: { sub: 0.2, mid: 0.3, high: 0.1 },
    beat: false,
    beatByBand: { sub: false, mid: false, high: false },
    beatStrength: 0.75,
    kickEnv: 0.85,
    kickPulse: false,
    waveform: new Float32Array(1024),
    bandWaveforms: {
      sub: new Float32Array(1024),
      mid: new Float32Array(1024),
      high: new Float32Array(1024),
    },
    spectrum,
    smoothedSpectrum: spectrum,
    sampleRate: 44100,
  };
}

const mockClock: RenderClock = {
  timeSec: 2.5,
  dtSec: 0.016,
  frameIndex: 150,
};

const mockTarget: RenderTarget = {
  kind: 'canvas',
  width: 1920,
  height: 1080,
};

describe('Ferrofluid Mesh Generation (Slice 7.15)', () => {
  it('generates 4-subdivision icosahedron with exact vertex and triangle counts', () => {
    const mesh = generateIcosahedronMesh(4);
    // 2,562 vertices (7,686 floats)
    expect(mesh.positions.length).toBe(2562 * 3);
    // 5,120 triangles (15,360 indices)
    expect(mesh.indices.length).toBe(5120 * 3);
  });

  it('generates base icosahedron at subdivision 0 with 12 vertices and 20 triangles', () => {
    const mesh0 = generateIcosahedronMesh(0);
    expect(mesh0.positions.length).toBe(12 * 3);
    expect(mesh0.indices.length).toBe(20 * 3);
  });

  it('subdivides powers-of-4 geometrically at subdivisions 1, 2, and 3', () => {
    const mesh1 = generateIcosahedronMesh(1);
    expect(mesh1.positions.length).toBe(42 * 3);
    expect(mesh1.indices.length).toBe(80 * 3);

    const mesh2 = generateIcosahedronMesh(2);
    expect(mesh2.positions.length).toBe(162 * 3);
    expect(mesh2.indices.length).toBe(320 * 3);

    const mesh3 = generateIcosahedronMesh(3);
    expect(mesh3.positions.length).toBe(642 * 3);
    expect(mesh3.indices.length).toBe(1280 * 3);
  });

  it('all vertices are strictly normalized to unit sphere radius 1.0', () => {
    const mesh = generateIcosahedronMesh(4);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i]!;
      const y = mesh.positions[i + 1]!;
      const z = mesh.positions[i + 2]!;
      const len = Math.hypot(x, y, z);
      expect(Math.abs(len - 1.0)).toBeLessThan(1e-5);
    }
  });

  it('all triangle indices are strictly within valid bounds [0, 2561]', () => {
    const mesh = generateIcosahedronMesh(4);
    const maxIndex = mesh.positions.length / 3 - 1;
    for (let i = 0; i < mesh.indices.length; i++) {
      const idx = mesh.indices[i]!;
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(maxIndex);
    }
  });
});

describe('Ferrofluid Shaders & GL Invariants (Slice 7.15)', () => {
  it('vertex shader contains 3D simplex displacement and finite difference normal computation', () => {
    expect(vertSrc).toContain('snoise(');
    expect(vertSrc).toContain('u_sub');
    expect(vertSrc).toContain('u_mid');
    expect(vertSrc).toContain('u_kickEnv');
    expect(vertSrc).toContain('vNormal');
    expect(vertSrc).toContain('perturbedNormal');
  });

  it('fragment shader implements procedural MatCap Chrome and cyan/amber Fresnel rim halo', () => {
    expect(fragSrc).toContain('matcapUv');
    expect(fragSrc).toContain('pow(1.0 - NdotV, 3.0)');
    expect(fragSrc).toContain('uBrightness');
    expect(fragSrc).toContain('uFresnelGain');
    expect(fragSrc).toContain('uLayerOpacity');
  });

  it('enforces depth testing enabled during draw() and disabled immediately afterward', () => {
    const gl = createMockGl();
    const layer = new FerrofluidLayer();
    layer.init(gl);

    expect(gl.depthTestEnabled).toBe(false);

    layer.draw(makeMockFrame(), mockClock, mockTarget);

    // Verify depth testing was enabled when drawElements executed
    const drawCall = gl.calls.find((c) => c.startsWith('drawElements'));
    expect(drawCall).toBeDefined();
    expect(drawCall).toContain('depth=true');

    // Verify sequence: enable -> draw -> disable
    const enableIdx = gl.calls.indexOf('enable:DEPTH_TEST');
    const drawIdx = gl.calls.findIndex((c) => c.startsWith('drawElements'));
    const disableIdx = gl.calls.lastIndexOf('disable:DEPTH_TEST');

    expect(enableIdx).toBeGreaterThanOrEqual(0);
    expect(drawIdx).toBeGreaterThan(enableIdx);
    expect(disableIdx).toBeGreaterThan(drawIdx);

    // Verify depth test is disabled after draw() completes
    expect(gl.depthTestEnabled).toBe(false);

    layer.dispose();
  });

  it('enforces backface culling enabled during draw() and disabled immediately afterward', () => {
    const gl = createMockGl();
    const layer = new FerrofluidLayer();
    layer.init(gl);

    expect(gl.cullFaceEnabled).toBe(false);

    layer.draw(makeMockFrame(), mockClock, mockTarget);

    const enableIdx = gl.calls.indexOf('enable:CULL_FACE');
    const cullFaceCall = gl.calls.find((c) => c.startsWith('cullFace:'));
    const drawIdx = gl.calls.findIndex((c) => c.startsWith('drawElements'));
    const disableIdx = gl.calls.lastIndexOf('disable:CULL_FACE');

    expect(enableIdx).toBeGreaterThanOrEqual(0);
    expect(cullFaceCall).toBe(`cullFace:${gl.BACK}`);
    expect(drawIdx).toBeGreaterThan(enableIdx);
    expect(disableIdx).toBeGreaterThan(drawIdx);
    expect(gl.cullFaceEnabled).toBe(false);

    layer.dispose();
  });

  it('passes audio frames and parameter settings to uniforms', () => {
    const gl = createMockGl();
    const layer = new FerrofluidLayer({
      radius: 0.52,
      spikeAmp: 0.42,
      spikeFreq: 1.25,
      spikeSharp: 4.0,
      rotSpeed: 0.5,
      brightness: 1.4,
      fresnelGain: 1.8,
    });
    layer.init(gl);

    const frame = makeMockFrame();
    layer.draw(frame, mockClock, mockTarget, { opacity: 0.9 });

    expect(gl.uniformValues.get('uRadius')).toBe(0.52);
    expect(gl.uniformValues.get('uSpikeAmp')).toBe(0.42);
    expect(gl.uniformValues.get('uSpikeFreq')).toBe(1.25);
    expect(gl.uniformValues.get('uSpikeSharp')).toBe(4.0);
    expect(gl.uniformValues.get('uRotSpeed')).toBe(0.5);
    expect(gl.uniformValues.get('uBrightness')).toBe(1.4);
    expect(gl.uniformValues.get('uFresnelGain')).toBe(1.8);
    expect(gl.uniformValues.get('uLayerOpacity')).toBe(0.9);
    expect(gl.uniformValues.get('u_sub')).toBe(0.7);
    expect(gl.uniformValues.get('u_mid')).toBe(0.6);
    expect(gl.uniformValues.get('u_kickEnv')).toBe(0.85);

    layer.dispose();
  });
});

describe('Ferrofluid Schema & Loader Registration (Slice 7.15)', () => {
  it('all ferrofluid parameter specifications are valid according to schema checker', () => {
    for (const spec of FERROFLUID_SPECS) {
      expect(() => assertValidSpec(spec)).not.toThrow();
    }
  });

  it('creates FerrofluidLayer instance via LAYER_FACTORIES', () => {
    const factory = LAYER_FACTORIES['ferrofluid'];
    expect(factory).toBeDefined();
    const layer = factory!(FERROFLUID_DEFAULTS as any);
    expect(layer).toBeInstanceOf(FerrofluidLayer);
  });

  it('applyValues updates layer parameters', () => {
    const layer = new FerrofluidLayer();
    applyValues(layer, {
      radius: 0.6,
      spikeAmp: 0.5,
      brightness: 1.5,
    });
    const gl = createMockGl();
    layer.init(gl);
    layer.draw(makeMockFrame(), mockClock, mockTarget);

    expect(gl.uniformValues.get('uRadius')).toBe(0.6);
    expect(gl.uniformValues.get('uSpikeAmp')).toBe(0.5);
    expect(gl.uniformValues.get('uBrightness')).toBe(1.5);
    layer.dispose();
  });
});

describe('Flagship Preset 11 (Ferrofluid Magnetic Crown)', () => {
  it('registers Preset 11 in FLAGSHIP_PRESETS_11 and ALL_PRESETS with 0 warnings', () => {
    expect(FLAGSHIP_PRESETS_11).toHaveLength(1);
    const entry = FLAGSHIP_PRESETS_11[0]!;
    expect(entry.id).toBe('11-ferrofluid-magnetic-crown');
    expect(entry.warnings).toEqual([]);
    expect(entry.preset.version).toBe(PRESET_VERSION);
    expect(entry.preset.name).toBe('Ferrofluid Magnetic Crown');

    const inAll = ALL_PRESETS.find((p) => p.id === '11-ferrofluid-magnetic-crown');
    expect(inAll).toBeDefined();
  });

  it('Preset 11 matches brief specifications (decay: 0.82, zoom: 1.02, alpha blend)', () => {
    const p11 = FLAGSHIP_PRESETS_11[0]!.preset;
    expect(p11.feedback.decay?.value).toBe(0.82);
    expect(p11.feedback.zoom?.value).toBe(1.02);

    const ferroLayer = p11.layers.find((l) => l.type === 'ferrofluid');
    expect(ferroLayer).toBeDefined();
    expect(ferroLayer?.blend).toBe('alpha');

    const ringsLayer = p11.layers.find((l) => l.type === 'rings');
    expect(ringsLayer).toBeDefined();
  });

  it('buildScene constructs valid scene from Preset 11', () => {
    const p11 = FLAGSHIP_PRESETS_11[0]!.preset;
    const scene = buildScene('test-p11', p11);
    expect(scene.name).toBe('test-p11');
    expect(scene.layers.length).toBe(2);
    expect(scene.layers[0]).toBeInstanceOf(RingsLayer);
    expect(scene.layers[1]).toBeInstanceOf(FerrofluidLayer);

    const configs = scene.getLayerConfigs();
    expect(configs[1]?.blend).toBe('alpha');
  });
});
