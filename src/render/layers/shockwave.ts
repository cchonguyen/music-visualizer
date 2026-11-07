// Kick shockwave (Stage 2, P4, 2026-11-04). On a sub-band kick, a thin bright ring
// travels from radius 0.16 to 0.95 over 350 ms and fades. It is a local ring, not a
// full-screen flash, and it sits on the same centre as the tunnel rim.
// Band texture (6.3): sub by angle sets the ring's edge brightness.
import type { AudioFrame } from '../../audio/types';
import { compileProgram, FULLSCREEN_VERT } from '../../gl/shader';
import { createVao } from '../../gl/vao';
import type { RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import { blendAccents } from '../colourSwap';
import { getPalette, type Palette } from '../palette';
import { getCurrentPalette } from '../paletteStore';
import { flashGovernor } from '../safety';
import fragSrc from '../shaders/shockwave.frag.glsl?raw';
import { SHOCKWAVE_DEFAULTS, type ShockwaveParams } from '../../presets/layerSchemas';
import { BandTexture } from '../bandTexture';

/** First texture unit for the band textures (sub, mid, high take the next two). */
const BAND_UNIT = 1;

// One kick, one flash token (P4, owner patch 2026-11-04). The tunnel's beat flash and
// the shockwave both ask here. The first caller in a frame asks the governor and the
// answer is reused for the rest of that frame, so one kick never spends two tokens.
let grantFrame = -1;
let grantValue = false;

/** Whether this frame's kick is granted a flash. Shared by the tunnel and the shockwave. */
export function kickGrant(frame: AudioFrame, clock: RenderClock, calm: boolean): boolean {
  if (calm || !frame.beatByBand.sub) return false;
  if (clock.frameIndex !== grantFrame) {
    grantFrame = clock.frameIndex;
    grantValue = flashGovernor.tryFlash(clock.timeSec);
  }
  return grantValue;
}

export class ShockwaveLayer implements RenderLayer {
  /** Calm mode: no shockwave. */
  calm = false;
  /** Accent swap mix from ColourSwap (0 = normal, 1 = swapped). */
  accentSwap = 0;
  /** Settings (slice 4.2). Read every frame. */
  private p: ShockwaveParams;

  constructor(params: Partial<ShockwaveParams> = {}) {
    this.p = { ...SHOCKWAVE_DEFAULTS, ...params };
  }

  setParams(params: Partial<ShockwaveParams>): void {
    this.p = { ...this.p, ...params };
  }

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uRes: WebGLUniformLocation | null = null;
  private uCenter: WebGLUniformLocation | null = null;
  private uRadius: WebGLUniformLocation | null = null;
  private uFade: WebGLUniformLocation | null = null;
  private uGlow: WebGLUniformLocation | null = null;
  private uAccent: WebGLUniformLocation | null = null;
  private uTexOn: WebGLUniformLocation | null = null;
  private uTexGain: WebGLUniformLocation | null = null;
  private uTexSub: WebGLUniformLocation | null = null;
  private uLayerOpacity: WebGLUniformLocation | null = null;
  private readonly band = new BandTexture();

  private active = false;
  private age = 0;

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction: never reuse GL objects from before a context restore.
    this.gl = gl;
    this.program = compileProgram(gl, FULLSCREEN_VERT, fragSrc, 'shockwave');
    this.uRes = gl.getUniformLocation(this.program, 'uRes');
    this.uCenter = gl.getUniformLocation(this.program, 'uCenter');
    this.uRadius = gl.getUniformLocation(this.program, 'uRadius');
    this.uFade = gl.getUniformLocation(this.program, 'uFade');
    this.uGlow = gl.getUniformLocation(this.program, 'uGlow');
    this.uAccent = gl.getUniformLocation(this.program, 'uAccent');
    this.uTexOn = gl.getUniformLocation(this.program, 'uTexOn');
    this.uTexGain = gl.getUniformLocation(this.program, 'uTexGain');
    this.uTexSub = gl.getUniformLocation(this.program, 'uTexSub');
    this.uLayerOpacity = gl.getUniformLocation(this.program, 'uLayerOpacity');
    this.band.init(gl);
    this.active = false;
    this.age = 0;
    this.vao = createVao(gl);
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Draws at the host's target size; nothing to reallocate.
  }

  draw(
    frame: AudioFrame,
    clock: RenderClock,
    target: RenderTarget,
    options?: { opacity?: number; uLayerOpacity?: number },
  ): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('ShockwaveLayer: draw before init');

    // Advance the running ring, then start a new one if this kick is granted.
    if (this.active) this.age += Math.max(0, clock.dtSec);
    if (kickGrant(frame, clock, this.calm)) {
      this.active = true;
      this.age = 0;
    }
    if (this.calm || this.age >= this.p.ringSec) this.active = false;
    if (!this.active) return;

    bindTarget(gl, target);
    const k = Math.min(1, this.age / this.p.ringSec);
    const radius = this.p.ringStart + (this.p.ringEnd - this.p.ringStart) * k;
    const fade = (1 - k) * (1 - k);
    const palette: Palette = getPalette(getCurrentPalette());
    const accent = blendAccents(palette.accentA, palette.accentB, this.accentSwap).a;

    gl.useProgram(this.program);
    // Uniforms must follow useProgram, or the calls are an invalid operation.
    gl.uniform2f(this.uRes, target.width, target.height);
    // Shockwave emanates from exact center (0, 0)
    gl.uniform2f(this.uCenter, 0.0, 0.0);
    gl.uniform1f(this.uRadius, radius);
    gl.uniform1f(this.uFade, fade);
    gl.uniform1f(this.uGlow, this.p.style === 'glow' ? 1 : 0);
    gl.uniform3f(this.uAccent, accent[0], accent[1], accent[2]);
    const layerOpacity = options?.uLayerOpacity ?? options?.opacity ?? 1.0;
    gl.uniform1f(this.uLayerOpacity, layerOpacity);
    // Band texture (6.3): always bound so the sampler has a valid texture; updated only when on.
    gl.uniform1f(this.uTexOn, this.p.texture ? 1 : 0);
    gl.uniform1f(this.uTexGain, this.p.textureGain);
    if (this.p.texture) this.band.update(gl, frame.bandWaveforms);
    const texUnit = this.band.bind(gl, BAND_UNIT);
    gl.uniform1i(this.uTexSub, texUnit);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.vao) gl.deleteVertexArray(this.vao);
      this.band.dispose(gl);
    }
    this.program = null;
    this.vao = null;
    this.uRes = null;
    this.uCenter = null;
    this.uRadius = null;
    this.uFade = null;
    this.uAccent = null;
    this.uTexOn = null;
    this.uTexGain = null;
    this.uTexSub = null;
    this.uLayerOpacity = null;
    this.active = false;
    this.gl = null;
  }
}
