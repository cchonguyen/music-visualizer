import { describe, it, expect, vi } from 'vitest';
import { TunnelState, stepTunnel } from '../tunnelState';
import { TunnelLayer } from '../layers/tunnel';
import { TUNNEL_DEFAULTS, TUNNEL_SPECS } from '../../presets/layerSchemas';
import tunnelFragSrc from '../shaders/tunnel.frag.glsl?raw';
import type { AudioFrame } from '../../audio/types';
import type { RenderClock } from '../clock';
import type { RenderTarget } from '../layer';

function createMockAudioFrame(overrides: Partial<AudioFrame> = {}): AudioFrame {
  return {
    frameIndex: 1,
    time: 10.0,
    dtSec: 0.016,
    raw: { sub: 0.5, mid: 0.4, high: 0.3 },
    env: { sub: 0.5, mid: 0.4, high: 0.3 },
    norm: { sub: 0.5, mid: 0.4, high: 0.3 },
    loudness: 0.5,
    energy: 0.6,
    flux: 0.1,
    fluxByBand: { sub: 0.1, mid: 0.1, high: 0.1 },
    beat: false,
    beatByBand: { sub: false, mid: false, high: false },
    beatStrength: 0,
    kickEnv: 0,
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
    ...overrides,
  };
}

function createMockGl(): WebGL2RenderingContext {
  const uniforms = new Map<string, any>();
  const uniformValues = new Map<string, any>();

  const gl = {
    MAX: 0x8008,
    FUNC_ADD: 0x8006,
    ONE: 1,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    BLEND: 0x0be2,
    TRIANGLES: 4,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE2: 0x84c2,
    TEXTURE_2D: 0x0de1,
    FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
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
    getExtension: vi.fn().mockReturnValue(null),
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
    viewport: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    drawArrays: vi.fn(),
    deleteProgram: vi.fn(),
    deleteShader: vi.fn(),
    deleteVertexArray: vi.fn(),
    deleteTexture: vi.fn(),
    deleteFramebuffer: vi.fn(),
    getUniformLocation: vi.fn((_program: any, name: string) => {
      if (!uniforms.has(name)) {
        uniforms.set(name, { name });
      }
      return uniforms.get(name);
    }),
    uniform1f: vi.fn((loc: any, val: number) => {
      if (loc?.name) uniformValues.set(loc.name, val);
    }),
    uniform2f: vi.fn((loc: any, x: number, y: number) => {
      if (loc?.name) uniformValues.set(loc.name, [x, y]);
    }),
    uniform3f: vi.fn((loc: any, x: number, y: number, z: number) => {
      if (loc?.name) uniformValues.set(loc.name, [x, y, z]);
    }),
    uniform1i: vi.fn((loc: any, val: number) => {
      if (loc?.name) uniformValues.set(loc.name, val);
    }),
    _uniformValues: uniformValues,
  };
  return gl as unknown as WebGL2RenderingContext;
}

describe('Tunnel Overhaul (Slice 7.21)', () => {
  describe('TUNNEL_SCHEMA & TUNNEL_DEFAULTS in layerSchemas.ts', () => {
    it('has all 7 new flight, color, and texture controls with valid specs', () => {
      expect(TUNNEL_DEFAULTS.flightMode).toBe('dropReverse');
      expect(TUNNEL_DEFAULTS.reverseOnBreakdown).toBe(true);
      expect(TUNNEL_DEFAULTS.hueSpread).toBe(0.55);
      expect(TUNNEL_DEFAULTS.wallTexture).toBe(0.55);
      expect(TUNNEL_DEFAULTS.zoomPunch).toBe(0.40);
      expect(TUNNEL_DEFAULTS.swirlPulse).toBe(0.35);
      expect(TUNNEL_DEFAULTS.horizonDrift).toBe(0.40);

      const flightModeSpec = TUNNEL_SPECS.find(s => s.name === 'flightMode');
      expect(flightModeSpec).toBeDefined();
      expect(flightModeSpec?.type).toBe('enum');

      const reverseSpec = TUNNEL_SPECS.find(s => s.name === 'reverseOnBreakdown');
      expect(reverseSpec?.type).toBe('bool');

      const hueSpreadSpec = TUNNEL_SPECS.find(s => s.name === 'hueSpread');
      expect(hueSpreadSpec?.type).toBe('float');

      const wallTextureSpec = TUNNEL_SPECS.find(s => s.name === 'wallTexture');
      expect(wallTextureSpec?.type).toBe('float');

      const zoomPunchSpec = TUNNEL_SPECS.find(s => s.name === 'zoomPunch');
      expect(zoomPunchSpec?.type).toBe('float');

      const swirlPulseSpec = TUNNEL_SPECS.find(s => s.name === 'swirlPulse');
      expect(swirlPulseSpec?.type).toBe('float');

      const horizonDriftSpec = TUNNEL_SPECS.find(s => s.name === 'horizonDrift');
      expect(horizonDriftSpec?.type).toBe('float');
    });
  });

  describe('18-second minimum cooldown on breakdown flight reversal', () => {
    it('starts forward with ready cooldown (18s) and flips to reverse on breakdown', () => {
      const state = new TunnelState();
      expect(state.flightSign).toBe(1);
      expect(state.reverseCooldownSec).toBe(18);

      // Normal flight frame
      stepTunnel(state, { energy: 0.6, sectionContrast: 0 }, 0.1, { flightMode: 'dropReverse' });
      expect(state.flightSign).toBe(1);

      // Breakdown occurs: energy < 0.18
      stepTunnel(state, { energy: 0.12, sectionContrast: -0.1 }, 0.1, { flightMode: 'dropReverse' });
      expect(state.flightSign).toBe(-1);
      expect(state.reverseCooldownSec).toBe(0);
      expect(state.reverseHoldSec).toBe(4.5);
    });

    it('enforces 4.5s reverse hold before drops can launch forward', () => {
      const state = new TunnelState();
      // Trigger breakdown
      stepTunnel(state, { energy: 0.1, sectionContrast: -0.1 }, 0.1, { flightMode: 'dropReverse' });
      expect(state.flightSign).toBe(-1);

      // A drop kick arrives after only 2s (reverseHoldSec not elapsed)
      stepTunnel(state, { kick: 0.9, energy: 0.8 }, 2.0, { flightMode: 'dropReverse' });
      expect(state.flightSign).toBe(-1); // Still reverse!

      // After 3 more seconds (total 5s elapsed > 4.5s hold), a drop kick arrives
      stepTunnel(state, { kick: 0.8, energy: 0.8 }, 3.0, { flightMode: 'dropReverse' });
      expect(state.flightSign).toBe(1); // Launched forward!
      expect(state.reverseCooldownSec).toBe(0); // Reset to 0 at flip
    });

    it('enforces minimum 18-second cooldown between reversals', () => {
      const state = new TunnelState();
      // 1. Breakdown flip
      stepTunnel(state, { energy: 0.1, sectionContrast: -0.1 }, 0.1, { flightMode: 'dropReverse' });
      expect(state.flightSign).toBe(-1);

      // 2. Advance past hold and trigger drop
      stepTunnel(state, { energy: 0.2 }, 5.0, { flightMode: 'dropReverse' });
      stepTunnel(state, { kick: 0.8, sectionContrast: 0.2 }, 0.1, { flightMode: 'dropReverse' });
      expect(state.flightSign).toBe(1);

      // Now reverseCooldownSec is 0.
      // Advance by 10 seconds (total 10.0s < 18s).
      stepTunnel(state, { energy: 0.7 }, 10.0, { flightMode: 'dropReverse' });
      expect(state.reverseCooldownSec).toBeCloseTo(10.0, 1);

      // Another breakdown dip occurs at 10.0s
      stepTunnel(state, { energy: 0.1, sectionContrast: -0.1 }, 0.1, { flightMode: 'dropReverse' });
      // Cooldown NOT reached (10.1s < 18.0s), must stay forward!
      expect(state.flightSign).toBe(1);

      // Advance by another 8 seconds (total > 18s)
      stepTunnel(state, { energy: 0.7 }, 8.0, { flightMode: 'dropReverse' });
      expect(state.reverseCooldownSec).toBeGreaterThanOrEqual(18.0);

      // Now a breakdown dip CAN reverse
      stepTunnel(state, { energy: 0.1, sectionContrast: -0.1 }, 0.1, { flightMode: 'dropReverse' });
      expect(state.flightSign).toBe(-1);
    });
  });

  describe('flightMode switching and smooth velocity slewing', () => {
    it('supports flightMode forward with target +1.0', () => {
      const state = new TunnelState({ velocityMultiplier: 0.2 });
      // Even on breakdown, forward stays +1.0
      for (let i = 0; i < 60; i++) {
        stepTunnel(state, { energy: 0.05, sectionContrast: -0.2 }, 0.1, { flightMode: 'forward' });
      }
      expect(state.velocityMultiplier).toBeCloseTo(1.0, 1);
      expect(state.flightSign).toBe(1);
    });

    it('supports flightMode reverse with target -0.75', () => {
      const state = new TunnelState({ velocityMultiplier: 1.0 });
      for (let i = 0; i < 50; i++) {
        stepTunnel(state, { energy: 0.8 }, 0.1, { flightMode: 'reverse' });
      }
      expect(state.velocityMultiplier).toBeCloseTo(-0.75, 1);
    });

    it('supports flightMode pendulum with sinusoidal target', () => {
      const state = new TunnelState({ velocityMultiplier: 0 });
      stepTunnel(state, { time: 5.61 }, 0.05, { flightMode: 'pendulum' });
      // target is Math.sin(5.61 * 0.28) = Math.sin(1.5708) ~ 1.0
      expect(state.velocityMultiplier).toBeGreaterThan(0);
    });

    it('supports reverseOnBreakdown = false in dropReverse mode', () => {
      const state = new TunnelState({ velocityMultiplier: 0.5 });
      stepTunnel(state, { energy: 0.05, sectionContrast: -0.2 }, 0.1, {
        flightMode: 'dropReverse',
        reverseOnBreakdown: false,
      });
      // Does not reverse
      expect(state.flightSign).toBe(1);
      expect(state.velocityMultiplier).toBeGreaterThan(0.5);
    });

    it('smoothly slews velocity with 1.4s time constant', () => {
      const state = new TunnelState({ velocityMultiplier: 1.0 });
      // In 1 step of dt = 1.4s toward target -0.75:
      // alpha = 1 - exp(-1) = 0.63212
      // new vel = 1.0 + (-0.75 - 1.0) * 0.63212 = 1.0 - 1.75 * 0.63212 ~ -0.106
      stepTunnel(state, { energy: 0.5 }, 1.4, { flightMode: 'reverse' });
      expect(state.velocityMultiplier).toBeCloseTo(1.0 + (-0.75 - 1.0) * (1 - Math.exp(-1)), 3);
    });

    it('computes vanishing point sway with horizonDrift banking', () => {
      const state = new TunnelState({ vanishX: 0 });
      stepTunnel(state, { norm: { sub: 0.5 } }, 0.5, { horizonDrift: 0.6 });
      expect(state.horizonSwayPhase).toBeCloseTo(0.5 * (0.45 + 0.5 * 0.85), 3);
      expect(state.vanishX).toBeCloseTo(Math.sin(state.horizonSwayPhase) * 0.22 * 0.6, 3);
    });
  });

  describe('Shader checks: Circular r, kick warp ripple, and stencil alpha', () => {
    it('keeps r = length(q) circular when uSides < 2.5 with zero polygonal wobble', () => {
      expect(tunnelFragSrc).toContain('if (uSides < 2.5)');
      expect(tunnelFragSrc).toContain('r = length(q);');
      // Verify no HEX_AMOUNT wobble remains in uSides < 2.5
      expect(tunnelFragSrc).not.toContain('HEX_AMOUNT');
    });

    it('implements kick FOV warp jump & travelling ripple (uZoomPunch)', () => {
      expect(tunnelFragSrc).toContain('float rMod = max(r * (1.0 - uKick * uZoomPunch * 0.22), 0.025);');
      expect(tunnelFragSrc).toContain('uKick * uZoomPunch * 0.35 * sin(0.28 / rMod * 3.0 - forwardPhase * 4.0)');
    });

    it('implements mid corkscrew swirl & twist (uSwirlPulse)', () => {
      expect(tunnelFragSrc).toContain('(spiral + uMid * uSwirlPulse * 0.9) / max(rMod, 0.08)');
      expect(tunnelFragSrc).toContain('fract(a / 6.2831853)');
    });

    it('implements Multi-Color Depth Rainbow (uHueSpread) and Cosmic Star-Streaks (uWallTexture)', () => {
      expect(tunnelFragSrc).toContain('ringIdx * 0.14 * uHueSpread');
      expect(tunnelFragSrc).toContain('sin(a * 24.0 + floor(z * 2.0) * 1.9)');
      expect(tunnelFragSrc).toContain('wallNebula');
    });

    it('implements proportional stencil alpha for see-through empty space', () => {
      expect(tunnelFragSrc).toContain('clamp(ringLuma + wallNebula + streak, 0.0, 1.0) * uLayerOpacity');
      expect(tunnelFragSrc).toContain('fragColor = vec4(col * uLayerOpacity, alpha);');
    });
  });

  describe('TunnelLayer WebGL integration and uLayerOpacity', () => {
    it('uploads uLayerOpacity and new flight uniforms without disabling GL blend', () => {
      const gl = createMockGl();
      const layer = new TunnelLayer({
        flightMode: 'forward',
        hueSpread: 0.7,
        wallTexture: 0.8,
        zoomPunch: 0.5,
        swirlPulse: 0.4,
      });

      layer.init(gl);

      const frame = createMockAudioFrame({
        norm: { sub: 0.6, mid: 0.45, high: 0.3 },
        kickEnv: 0.75,
      });
      const clock: RenderClock = { frameIndex: 1, timeSec: 12.0, dtSec: 0.016 };
      const target: RenderTarget = { kind: 'canvas', width: 1280, height: 720 };

      layer.draw(frame, clock, target, { uLayerOpacity: 0.85 });

      const uniformValues = (gl as any)._uniformValues as Map<string, any>;
      expect(uniformValues.get('uLayerOpacity')).toBeCloseTo(0.85);
      expect(uniformValues.get('uHueSpread')).toBeCloseTo(0.7);
      expect(uniformValues.get('uWallTexture')).toBeCloseTo(0.8);
      expect(uniformValues.get('uZoomPunch')).toBeCloseTo(0.5);
      expect(uniformValues.get('uSwirlPulse')).toBeCloseTo(0.4);
      expect(uniformValues.get('uKick')).toBeCloseTo(0.75);
      expect(uniformValues.get('uMid')).toBeCloseTo(0.45);

      // Ensure TunnelLayer does NOT touch gl.disable(gl.BLEND) or gl.enable(gl.BLEND)
      expect(gl.disable).not.toHaveBeenCalledWith(gl.BLEND);
      expect(gl.enable).not.toHaveBeenCalledWith(gl.BLEND);
    });

    it('cleans up resources on dispose()', () => {
      const gl = createMockGl();
      const layer = new TunnelLayer();
      layer.init(gl);
      layer.dispose();
      expect(gl.deleteProgram).toHaveBeenCalled();
      expect(gl.deleteVertexArray).toHaveBeenCalled();
    });
  });
});
