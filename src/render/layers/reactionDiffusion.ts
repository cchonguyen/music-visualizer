// Reaction-Diffusion Layer (Slice 7.17): Isolated 256x256 ping-pong chemical state FBO
// running Gray-Scott kinetics on TEXTURE5, rendered with screen-space derivative normals
// and Blinn-Phong specular highlights.
import type { AudioFrame } from '../../audio/types';
import { compileProgram, FULLSCREEN_VERT } from '../../gl/shader';
import { createVao } from '../../gl/vao';
import type { RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import simFragSrc from '../shaders/rdSim.frag.glsl?raw';
import renderFragSrc from '../shaders/rdRender.frag.glsl?raw';
import { REACTION_DIFFUSION_DEFAULTS, type ReactionDiffusionParams } from '../../presets/schema';

export const RD_SIZE = 256;
export const RD_TEXTURE_UNIT = 5; // Dedicated TEXTURE5
export const NOMINAL_SUBSTEPS = 8;
export const MAX_SUBSTEPS = 10;
export const SUBSTEP_DT = (1 / 60) / NOMINAL_SUBSTEPS;

export interface SimTarget {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

/** Converts a #rrggbb hex string into RGB floats in [0, 1]. */
export function parseHexColor(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [1.0, 0.16, 0.55]; // Neon pink default
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255];
}

/** Silence-safe spectral centroid computation mapped to 0..1 (0 Hz..8 kHz). */
export function computeCentroid(frame: AudioFrame): number {
  if (typeof (frame as any).centroid === 'number') {
    const c = (frame as any).centroid;
    return c > 1 ? Math.min(1, Math.max(0, c / 8000)) : Math.min(1, Math.max(0, c));
  }
  const spectrum = frame.spectrum;
  if (!spectrum || spectrum.length === 0) return 0.5;
  const binHz = (frame.sampleRate || 44100) / (2 * spectrum.length);
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < spectrum.length; i++) {
    const s = spectrum[i] ?? 0;
    weighted += i * binHz * s;
    total += s;
  }
  return total <= 1e-4 ? 0.5 : Math.min(1, Math.max(0, (weighted / total) / 8000));
}

export class ReactionDiffusionLayer implements RenderLayer {
  private p: ReactionDiffusionParams;

  constructor(params: Partial<ReactionDiffusionParams> = {}) {
    this.p = { ...REACTION_DIFFUSION_DEFAULTS, ...params };
  }

  setParams(params: Partial<ReactionDiffusionParams>): void {
    this.p = { ...this.p, ...params };
  }

  private gl: WebGL2RenderingContext | null = null;
  private simProgram: WebGLProgram | null = null;
  private renderProgram: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  private simTargetA: SimTarget | null = null;
  private simTargetB: SimTarget | null = null;
  private currentSimTarget: 'a' | 'b' = 'a';
  private isFloatSupported = false;

  private accumulator = 0;
  private lastSubsteps = 0;

  // Simulation Uniforms
  private uSimState: WebGLUniformLocation | null = null;
  private uTexelSize: WebGLUniformLocation | null = null;
  private uDt: WebGLUniformLocation | null = null;
  private uDu: WebGLUniformLocation | null = null;
  private uDv: WebGLUniformLocation | null = null;
  private uFeed: WebGLUniformLocation | null = null;
  private uKill: WebGLUniformLocation | null = null;
  private u_mid: WebGLUniformLocation | null = null;
  private u_centroid: WebGLUniformLocation | null = null;
  private u_kickEnv: WebGLUniformLocation | null = null;
  private uInjectRing: WebGLUniformLocation | null = null;

  // Render Uniforms
  private uRenderState: WebGLUniformLocation | null = null;
  private uRes: WebGLUniformLocation | null = null;
  private uTime: WebGLUniformLocation | null = null;
  private uColorPink: WebGLUniformLocation | null = null;
  private uColorCobalt: WebGLUniformLocation | null = null;
  private uBrightness: WebGLUniformLocation | null = null;
  private uSpecular: WebGLUniformLocation | null = null;
  private uLayerOpacity: WebGLUniformLocation | null = null;

  init(gl: WebGL2RenderingContext): void {
    // If re-initializing after context loss, clean up any previous references
    this.dispose();

    this.gl = gl;

    // Detect EXT_color_buffer_float runtime support with graceful RGBA8 fallback
    const ext = gl.getExtension('EXT_color_buffer_float');
    this.isFloatSupported = ext !== null;

    // Compile simulation and render programs
    this.simProgram = compileProgram(gl, FULLSCREEN_VERT, simFragSrc, 'rdSim');
    this.renderProgram = compileProgram(gl, FULLSCREEN_VERT, renderFragSrc, 'rdRender');
    this.vao = createVao(gl);

    // Retrieve simulation uniform locations
    this.uSimState = gl.getUniformLocation(this.simProgram, 'uState');
    this.uTexelSize = gl.getUniformLocation(this.simProgram, 'uTexelSize');
    this.uDt = gl.getUniformLocation(this.simProgram, 'uDt');
    this.uDu = gl.getUniformLocation(this.simProgram, 'uDu');
    this.uDv = gl.getUniformLocation(this.simProgram, 'uDv');
    this.uFeed = gl.getUniformLocation(this.simProgram, 'uFeed');
    this.uKill = gl.getUniformLocation(this.simProgram, 'uKill');
    this.u_mid = gl.getUniformLocation(this.simProgram, 'u_mid');
    this.u_centroid = gl.getUniformLocation(this.simProgram, 'u_centroid');
    this.u_kickEnv = gl.getUniformLocation(this.simProgram, 'u_kickEnv');
    this.uInjectRing = gl.getUniformLocation(this.simProgram, 'uInjectRing');

    // Retrieve render uniform locations
    this.uRenderState = gl.getUniformLocation(this.renderProgram, 'uState');
    this.uRes = gl.getUniformLocation(this.renderProgram, 'uRes');
    this.uTime = gl.getUniformLocation(this.renderProgram, 'uTime');
    this.uColorPink = gl.getUniformLocation(this.renderProgram, 'uColorPink');
    this.uColorCobalt = gl.getUniformLocation(this.renderProgram, 'uColorCobalt');
    this.uBrightness = gl.getUniformLocation(this.renderProgram, 'uBrightness');
    this.uSpecular = gl.getUniformLocation(this.renderProgram, 'uSpecular');
    this.uLayerOpacity = gl.getUniformLocation(this.renderProgram, 'uLayerOpacity');

    // Seed chemical state: U = 1.0, V = 0.0 with a central ring of V = 0.5
    this.simTargetA = this.allocateTarget(gl);
    this.simTargetB = this.allocateTarget(gl);
    this.currentSimTarget = 'a';
    this.accumulator = 0;
    this.lastSubsteps = 0;
  }

  private seedInitialState(seed: Float32Array | Uint8Array, isFloat: boolean): void {
    const buds = [
      { x: 0.14, y: 0.11, r: 0.045 },
      { x: -0.15, y: 0.09, r: 0.040 },
      { x: 0.08, y: -0.16, r: 0.042 },
      { x: -0.12, y: -0.14, r: 0.045 },
      { x: 0.18, y: -0.05, r: 0.038 },
      { x: -0.04, y: 0.20, r: 0.035 },
    ];

    for (let y = 0; y < RD_SIZE; y++) {
      for (let x = 0; x < RD_SIZE; x++) {
        const idx = (y * RD_SIZE + x) * 4;
        const dx = (x + 0.5) / RD_SIZE - 0.5;
        const dy = (y + 0.5) / RD_SIZE - 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        let v = 0.0;
        let u = 1.0;

        // Break radial symmetry on the initial seed ring (dist >= 0.14 && dist <= 0.28)
        // by modulating chemical V with deterministic angular/spatial hashes
        if (dist >= 0.14 && dist <= 0.28) {
          const hashMod = 0.5 + 0.25 * (Math.sin(angle * 7.0) + Math.cos(angle * 13.0));
          if (hashMod > 0.3) {
            v = Math.min(0.65, hashMod);
            u = 1.0 - v;
          }
        }

        // Secondary organic coral buds
        for (const bud of buds) {
          const bDist = Math.hypot(dx - bud.x, dy - bud.y);
          if (bDist < bud.r) {
            const budV = 0.55 * (1.0 - bDist / bud.r);
            if (budV > v) {
              v = budV;
              u = 1.0 - v;
            }
          }
        }

        if (isFloat) {
          seed[idx] = u;
          seed[idx + 1] = v;
          seed[idx + 2] = 0.0;
          seed[idx + 3] = 1.0;
        } else {
          seed[idx] = Math.round(u * 255);
          seed[idx + 1] = Math.round(v * 255);
          seed[idx + 2] = 0;
          seed[idx + 3] = 255;
        }
      }
    }
  }

  private allocateTarget(gl: WebGL2RenderingContext): SimTarget {
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) throw new Error('ReactionDiffusionLayer: failed to allocate simulation target');

    gl.bindTexture(gl.TEXTURE_2D, tex);

    if (this.isFloatSupported) {
      // Allocate seeded RGBA16F state
      const seed = new Float32Array(RD_SIZE * RD_SIZE * 4);
      this.seedInitialState(seed, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, (gl as any).RGBA16F ?? gl.RGBA, RD_SIZE, RD_SIZE, 0, gl.RGBA, gl.FLOAT, seed);
    } else {
      // Allocate seeded RGBA8 fallback state
      const seed = new Uint8Array(RD_SIZE * RD_SIZE * 4);
      this.seedInitialState(seed, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, RD_SIZE, RD_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, seed);
    }

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return { framebuffer: fbo, texture: tex };
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Isolated 256x256 simulation resolution is fixed; main pass draws into target dimensions.
  }

  draw(
    frame: AudioFrame,
    clock: RenderClock,
    target: RenderTarget,
    options?: { uLayerOpacity?: number; opacity?: number },
  ): void {
    const gl = this.gl;
    if (
      !gl ||
      !this.simProgram ||
      !this.renderProgram ||
      !this.vao ||
      !this.simTargetA ||
      !this.simTargetB
    ) {
      throw new Error('ReactionDiffusionLayer: draw before init');
    }

    // Fixed-timestep simulation accumulator
    const dt = Math.min(clock.dtSec > 0 ? clock.dtSec : 1 / 60, 0.1);
    this.accumulator += dt * this.p.speed;

    let subSteps = Math.floor(this.accumulator / SUBSTEP_DT);
    if (subSteps > MAX_SUBSTEPS) {
      subSteps = MAX_SUBSTEPS; // Capped at 10
    }
    this.accumulator -= subSteps * SUBSTEP_DT;
    if (this.accumulator > SUBSTEP_DT * 2) {
      this.accumulator = 0;
    }
    this.lastSubsteps = subSteps;

    // Audio inputs
    const midVal = frame.norm?.mid ?? 0.0;
    const centroidVal = computeCentroid(frame);
    const kickPulse = Boolean(frame.kickPulse || frame.beatByBand?.sub);
    const kickEnv = frame.kickEnv ?? 0.0;
    const shouldInject = kickPulse || kickEnv > 0.7;

    // 1. Run simulation sub-steps on dedicated 256x256 PingPong FBO
    gl.disable(gl.BLEND);
    gl.useProgram(this.simProgram);
    gl.bindVertexArray(this.vao);

    gl.uniform2f(this.uTexelSize, 1.0 / RD_SIZE, 1.0 / RD_SIZE);
    gl.uniform1f(this.uDt, 1.0);
    gl.uniform1f(this.uDu, this.p.du);
    gl.uniform1f(this.uDv, this.p.dv);
    gl.uniform1f(this.uFeed, this.p.feed);
    gl.uniform1f(this.uKill, this.p.kill);
    gl.uniform1f(this.u_mid, midVal);
    gl.uniform1f(this.u_centroid, centroidVal);
    if (this.u_kickEnv) gl.uniform1f(this.u_kickEnv, kickEnv);
    gl.uniform1f(this.uInjectRing, shouldInject ? 1.0 : 0.0);

    for (let s = 0; s < subSteps; s++) {
      const readTarget = this.currentSimTarget === 'a' ? this.simTargetA : this.simTargetB;
      const writeTarget = this.currentSimTarget === 'a' ? this.simTargetB : this.simTargetA;

      gl.bindFramebuffer(gl.FRAMEBUFFER, writeTarget.framebuffer);
      gl.viewport(0, 0, RD_SIZE, RD_SIZE);

      // Dedicated simulation state bound on TEXTURE5
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, readTarget.texture);
      gl.uniform1i(this.uSimState, RD_TEXTURE_UNIT);

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Swap ping-pong targets
      this.currentSimTarget = this.currentSimTarget === 'a' ? 'b' : 'a';
    }

    // 2. Render pass: Draw embossed coral into main scene FBO
    bindTarget(gl, target);
    gl.enable(gl.BLEND);
    gl.useProgram(this.renderProgram);

    const latestState = this.currentSimTarget === 'a' ? this.simTargetA : this.simTargetB;
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, latestState.texture);
    gl.uniform1i(this.uRenderState, RD_TEXTURE_UNIT);

    gl.uniform2f(this.uRes, target.width, target.height);
    gl.uniform1f(this.uTime, clock.timeSec);
    gl.uniform3fv(this.uColorPink, parseHexColor(this.p.colorPink));
    gl.uniform3fv(this.uColorCobalt, parseHexColor(this.p.colorCobalt));
    gl.uniform1f(this.uBrightness, this.p.brightness);
    gl.uniform1f(this.uSpecular, this.p.specular);
    const layerOpacity = options?.uLayerOpacity ?? options?.opacity ?? 1.0;
    if (this.uLayerOpacity) gl.uniform1f(this.uLayerOpacity, layerOpacity);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Clean up GL state
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
  }

  getLastSubsteps(): number {
    return this.lastSubsteps;
  }

  isUsingFloat(): boolean {
    return this.isFloatSupported;
  }

  getStateTexture(): WebGLTexture | null {
    if (!this.simTargetA) return null;
    return this.currentSimTarget === 'a' ? this.simTargetA.texture : this.simTargetB!.texture;
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.simProgram) gl.deleteProgram(this.simProgram);
      if (this.renderProgram) gl.deleteProgram(this.renderProgram);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.simTargetA) {
        if (this.simTargetA.framebuffer) gl.deleteFramebuffer(this.simTargetA.framebuffer);
        if (this.simTargetA.texture) gl.deleteTexture(this.simTargetA.texture);
      }
      if (this.simTargetB) {
        if (this.simTargetB.framebuffer) gl.deleteFramebuffer(this.simTargetB.framebuffer);
        if (this.simTargetB.texture) gl.deleteTexture(this.simTargetB.texture);
      }
    }
    this.gl = null;
    this.simProgram = null;
    this.renderProgram = null;
    this.vao = null;
    this.simTargetA = null;
    this.simTargetB = null;
  }
}
