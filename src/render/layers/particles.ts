// Treble sparkle particles (Stage 2, slice 2.5). A fixed pool of quads streams
// outward from the vanishing point. Density rises with energy; the sparkle
// follows a CPU flash envelope on the high band, never the one-frame flag.
import type { AudioFrame } from '../../audio/types';
import { compileProgram } from '../../gl/shader';
import { createVao } from '../../gl/vao';
import { Phase, type RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import { DEFAULT_PALETTE, getPalette, type Palette } from '../palette';
import fragSrc from '../shaders/particles.frag.glsl?raw';
import vertSrc from '../shaders/particles.vert.glsl?raw';
import { highFlash, POOL_SIZE } from '../particleState';

const BRIGHTNESS = 1.0;
const CALM_SPARKLE_SCALE = 0.3;
const CALM_PHASE_RATE = 0.2;
const BASE_PHASE_RATE = 0.2;
const ENERGY_PHASE_RATE = 0.8;
const FLASH_SPARKLE_SCALE = 0.5;

export class ParticleLayer implements RenderLayer {
  /** Calm mode: no energy-driven density, dimmer sparkle. */
  calm = false;

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uPhase: WebGLUniformLocation | null = null;
  private uAspect: WebGLUniformLocation | null = null;
  private uAccent: WebGLUniformLocation | null = null;
  private uAccentA: WebGLUniformLocation | null = null;
  private uSwirl: WebGLUniformLocation | null = null;
  private uSparkle: WebGLUniformLocation | null = null;
  private uBrightness: WebGLUniformLocation | null = null;

  private paletteName: string = DEFAULT_PALETTE;
  private readonly phase = new Phase();
  private flash = 0;

  setPalette(name: string): void {
    this.paletteName = name;
  }

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction: never reuse GL objects from before a context restore.
    this.gl = gl;
    this.program = compileProgram(gl, vertSrc, fragSrc, 'particles');
    this.uPhase = gl.getUniformLocation(this.program, 'uPhase');
    this.uAspect = gl.getUniformLocation(this.program, 'uAspect');
    this.uAccent = gl.getUniformLocation(this.program, 'uAccent');
    this.uAccentA = gl.getUniformLocation(this.program, 'uAccentA');
    this.uSwirl = gl.getUniformLocation(this.program, 'uSwirl');
    this.uSparkle = gl.getUniformLocation(this.program, 'uSparkle');
    this.uBrightness = gl.getUniformLocation(this.program, 'uBrightness');
    this.phase.reset();
    this.flash = 0;
    this.vao = createVao(gl);
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Draws at the host's target size; nothing to reallocate.
  }

  draw(frame: AudioFrame, clock: RenderClock, target: RenderTarget): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('ParticleLayer: draw before init');

    bindTarget(gl, target);

    // Flash envelope: instant attack on a high-band onset, 150 ms release.
    this.flash = highFlash(this.flash, frame.beatByBand.high, clock.dtSec);

    // Density rises with energy only in loud sections; phase never decreases.
    const rate = this.calm
      ? CALM_PHASE_RATE
      : BASE_PHASE_RATE + ENERGY_PHASE_RATE * frame.energy;
    const phase = this.phase.advance(clock.dtSec, rate);

    // norm.high (track-relative): raw treble is often under 0.3 on real music, so env.high barely lit the particles.
    let sparkle = clamp01(frame.norm.high + this.flash * FLASH_SPARKLE_SCALE);
    if (this.calm) sparkle *= CALM_SPARKLE_SCALE;

    const palette: Palette = getPalette(this.paletteName);

    gl.useProgram(this.program);
    // Uniforms must follow useProgram, or the calls are an invalid operation.
    gl.uniform1f(this.uPhase, phase);
    gl.uniform1f(this.uAspect, target.width / target.height);
    gl.uniform3f(this.uAccent, palette.accentB[0], palette.accentB[1], palette.accentB[2]);
    gl.uniform3f(this.uAccentA, palette.accentA[0], palette.accentA[1], palette.accentA[2]);
    // Midrange drives a swirl, so the sparkles curve as they travel (2026-11-04).
    gl.uniform1f(this.uSwirl, this.calm ? 0 : Math.min(1, frame.norm.mid));
    gl.uniform1f(this.uSparkle, sparkle);
    gl.uniform1f(this.uBrightness, BRIGHTNESS);

    // Particles must ADD onto the tunnel. Inside a scene the blend equation is MAX
    // (a tunnel-brightness pass), where quiet sparkles were invisible (measured
    // 2026-11-04). So switch to ADD for this draw only, then restore MAX.
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, POOL_SIZE);
    gl.bindVertexArray(null);
    gl.blendEquation(gl.MAX);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.program = null;
    this.vao = null;
    this.uPhase = null;
    this.uAspect = null;
    this.uAccent = null;
    this.uAccentA = null;
    this.uSwirl = null;
    this.uSparkle = null;
    this.uBrightness = null;
    this.gl = null;
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
