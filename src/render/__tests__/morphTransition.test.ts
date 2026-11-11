import { describe, it, expect, vi } from 'vitest';
import { Scene } from '../scene';
import { Compositor, TRANSITIONS } from '../compositor';
import type { AudioFrame } from '../../audio/types';
import type { RenderClock } from '../clock';
import type { RenderLayer, RenderTarget } from '../layer';
import { AutoCycler, DEFAULT_CYCLE, eligible, type CycleOptions } from '../../presets/autoCycler';
import {
  ALL_PRESETS,
  getPresetsByGroup,
  filterPresetsByGroup,
} from '../../presets/builtin';

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
    getUniformLocation: vi.fn().mockImplementation((_prog, name) => ({ name })),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
    deleteProgram: vi.fn(),
    isProgram: vi.fn().mockReturnValue(true),
    isContextLost: vi.fn().mockReturnValue(false),
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
    waveform: new Float32Array(4),
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

describe('Scene seedFromTexture FBO handoff (Slice 7.16)', () => {
  it('blits source texture into the read FBO and initializes with default foreground opacity 1.0', () => {
    const gl = createMockGl();
    const scene = new Scene('seed-test', []);
    scene.init(gl);

    expect(scene.getForegroundOpacity()).toBe(1.0);

    const dummySourceTex = { id: 'source-texture' } as unknown as WebGLTexture;
    scene.seedFromTexture(dummySourceTex);

    expect(gl.useProgram).toHaveBeenCalled();
    expect(gl.bindTexture).toHaveBeenCalledWith(gl.TEXTURE_2D, dummySourceTex);
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 3);
  });

  it('scales layer draw opacity by foregroundOpacity', () => {
    const gl = createMockGl();
    let drawnOpacity = -1;
    const mockLayer = {
      init: vi.fn(),
      resize: vi.fn(),
      draw: vi.fn((_f, _c, _t, opt?: { opacity?: number }) => {
        drawnOpacity = opt?.opacity ?? -1;
      }),
      dispose: vi.fn(),
    } as unknown as RenderLayer;

    const scene = new Scene('layer-opacity-test', [mockLayer], [{ opacity: 0.8, blend: 'max' }]);
    scene.init(gl);

    scene.setForegroundOpacity(0.5);
    expect(scene.getForegroundOpacity()).toBe(0.5);

    const clock: RenderClock = { timeSec: 1.0, dtSec: 0.016, frameIndex: 0 };
    scene.draw(makeMockFrame(), clock);

    expect(drawnOpacity).toBeCloseTo(0.4); // 0.8 * 0.5 = 0.4
  });
});

describe('Compositor morph transition lifecycle (Slice 7.16)', () => {
  it('includes morph in TRANSITIONS', () => {
    expect(TRANSITIONS).toContain('morph');
  });

  it('performs ghost-free morph handoff: seeds incoming scene, retires outgoing scene immediately, and ramps foreground opacity over 0.6s', () => {
    const gl = createMockGl();
    const sceneA = new Scene('scene-a', []);
    const sceneB = new Scene('scene-b', []);

    const comp = new Compositor([sceneA, sceneB]);
    comp.init(gl);

    const seedSpy = vi.spyOn(sceneB, 'seedFromTexture');
    const opacityBSpy = vi.spyOn(sceneB, 'setForegroundOpacity');
    const disposeASpy = vi.spyOn(sceneA, 'dispose');

    // 1) Initial state: sceneA active
    comp.setTransition('morph');
    expect(comp.getTransition()).toBe('morph');
    comp.setWeights({ 'scene-a': 1 });
    const target: RenderTarget = { kind: 'canvas', width: 800, height: 600 };
    const frame = makeMockFrame();
    const clock1: RenderClock = { timeSec: 1.0, dtSec: 0.016, frameIndex: 0 };
    comp.draw(frame, clock1, target);

    expect(comp.getWeight('scene-a')).toBe(1.0);
    expect(comp.getWeight('scene-b')).toBe(0.0);

    // 2) Transition to sceneB via 'morph'
    comp.setWeights({ 'scene-b': 1 });

    // 3) Frame at t = 0 (transition start, dt = 0.016s)
    const clock2: RenderClock = { timeSec: 1.016, dtSec: 0.016, frameIndex: 1 };
    comp.draw(frame, clock2, target);

    // Outgoing scene read FBO seeded into incoming scene read FBO
    expect(seedSpy).toHaveBeenCalledTimes(1);

    // Outgoing scene retired cleanly (weight 0, disposed, eliminated from dual-scene cost)
    expect(comp.getWeight('scene-a')).toBe(0.0);
    expect(disposeASpy).toHaveBeenCalled();

    // Incoming scene is the ONLY active scene (weight 1.0)
    expect(comp.getWeight('scene-b')).toBe(1.0);
    expect(comp.isMorphing()).toBe(true);

    // Foreground opacity started at 0.0 and stepped to dt / 0.6
    expect(opacityBSpy).toHaveBeenCalledWith(0.0);
    expect(sceneB.getForegroundOpacity()).toBeCloseTo(0.016 / 0.6);

    // 4) Mid-transition (after 0.3s)
    const clock3: RenderClock = { timeSec: 1.316, dtSec: 0.3, frameIndex: 2 };
    comp.draw(frame, clock3, target);

    expect(comp.isMorphing()).toBe(true);
    expect(sceneB.getForegroundOpacity()).toBeCloseTo((0.016 + 0.3) / 0.6);
    expect(comp.getWeight('scene-a')).toBe(0.0);

    // 5) Transition completion (after another 0.3s, total > 0.6s)
    const clock4: RenderClock = { timeSec: 1.616, dtSec: 0.3, frameIndex: 3 };
    comp.draw(frame, clock4, target);

    expect(sceneB.getForegroundOpacity()).toBe(1.0);
    expect(comp.isMorphing()).toBe(false);
    expect(comp.getWeight('scene-b')).toBe(1.0);
  });
});

describe('AutoCycler 3.0s beatless fallback (Slice 7.16)', () => {
  const opts = (over: Partial<CycleOptions>): CycleOptions => ({ ...DEFAULT_CYCLE, ...over });

  it('beat mode advances on a strong beat once minGapSec has passed', () => {
    const c = new AutoCycler();
    const o = opts({ mode: 'beat', minGapSec: 5 });

    expect(c.next(2, true, 'a', ['a', 'b'], o)).toBeNull(); // min gap not reached
    expect(c.next(3.5, false, 'a', ['a', 'b'], o)).toBeNull(); // gap reached (5.5s), but no beat
    expect(c.next(0.1, true, 'a', ['a', 'b'], o)).toBe('b'); // strong beat triggers switch
  });

  it('beat mode advances automatically after 3.0s max-wait fallback during beatless ambient breakdowns', () => {
    const c = new AutoCycler();
    const o = opts({ mode: 'beat', minGapSec: 5 });

    // Step 1: 5.0s pass (minGapSec met, no beat)
    expect(c.next(5.0, false, 'a', ['a', 'b', 'c'], o)).toBeNull();

    // Step 2: 2.9s pass (total 7.9s since switch, fallback timeout not yet reached)
    expect(c.next(2.9, false, 'a', ['a', 'b', 'c'], o)).toBeNull();

    // Step 3: 0.1s pass (total 8.0s = 5.0s minGap + 3.0s fallback timeout reached)
    expect(c.next(0.1, false, 'a', ['a', 'b', 'c'], o)).toBe('b');

    // After fallback trigger, timer resets and requires minGapSec again
    expect(c.next(2.0, false, 'b', ['a', 'b', 'c'], o)).toBeNull();
  });
});

describe('Preset group organization (Slice 7.16)', () => {
  it('assigns all presets to flagship, textures, classic, or archive groups', () => {
    for (const p of ALL_PRESETS) {
      expect(['flagship', 'textures', 'classic', 'archive']).toContain(p.group);
    }
  });

  it('groups presets 01 through 11 in flagship group', () => {
    const flagship = getPresetsByGroup('flagship');
    const ids = flagship.map((p) => p.id);
    expect(ids).toContain('01-curl-fluid-warp');
    expect(ids).toContain('02-kaleidoscopic-mandala');
    expect(ids).toContain('03-solarized-contour-rings');
    expect(ids).toContain('04-mobius-dual-vortex');
    expect(ids).toContain('05-rgb-aberration-vortex');
    expect(ids).toContain('06-lissajous-vector-crt');
    expect(ids).toContain('07-moire-interference-loom');
    expect(ids).toContain('08-spectral-ridge-terrain');
    expect(ids).toContain('09-chladni-cymatic-sand');
    expect(ids).toContain('10-phyllotaxis-spiral-bloom');
    expect(ids).toContain('11-ferrofluid-magnetic-crown');
    expect(flagship.length).toBeGreaterThanOrEqual(11);
  });

  it('groups crown, flight, and bars in classic group', () => {
    const classic = getPresetsByGroup('classic');
    const ids = classic.map((p) => p.id);
    expect(ids).toEqual(['crown', 'flight', 'bars']);
  });

  it('groups the remaining tex-* presets in textures group (the rest moved to review, Slice 15.10)', () => {
    const textures = getPresetsByGroup('textures');
    expect(textures.length).toBe(2);
    for (const p of textures) {
      expect(p.id.startsWith('tex-')).toBe(true);
    }
  });

  it('groups the remaining starter-* preset in archive group (the rest moved to review, Slice 15.10)', () => {
    const archive = getPresetsByGroup('archive');
    expect(archive.length).toBe(1);
    for (const p of archive) {
      expect(p.id.startsWith('starter-')).toBe(true);
    }
  });

  it('excludes archive presets from default auto-cycle eligible pool but leaves them loadable by ID', () => {
    const candidates = ALL_PRESETS.map((p) => ({
      id: p.id,
      tags: p.preset.tags,
      group: p.group,
    }));

    const pool = eligible(candidates, DEFAULT_CYCLE);

    // Archive starter-* presets should be excluded from default pool
    for (const p of ALL_PRESETS.filter((x) => x.group === 'archive')) {
      expect(pool).not.toContain(p.id);
    }

    // Flagship and classic presets should be present
    expect(pool).toContain('crown');
    expect(pool).toContain('01-curl-fluid-warp');
    expect(pool).toContain('11-ferrofluid-magnetic-crown');

    // Archive presets remain in ALL_PRESETS and loadable by ID
    const starterVortex = ALL_PRESETS.find((p) => p.id === 'starter-vortex');
    expect(starterVortex).toBeDefined();
    expect(starterVortex?.preset.name).toBe('Vortex');
  });

  it('filterPresetsByGroup filters correctly', () => {
    const classics = filterPresetsByGroup(ALL_PRESETS, 'classic');
    expect(classics.map((p) => p.id)).toEqual(['crown', 'flight', 'bars']);
  });
});
