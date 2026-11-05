// Concentric rings (Stage 2, slice 2.6). Ring count follows frame.energy,
// stroke width follows frame.norm. No data texture: everything is a uniform.
import type { AudioFrame } from '../../audio/types';
import { compileProgram, FULLSCREEN_VERT } from '../../gl/shader';
import { createVao } from '../../gl/vao';
import type { RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import { getPalette, type Palette } from '../palette';
import { SlowFollower, punch } from '../dynamics';
import { getVisualGain, shapeReaction } from '../gainStore';
import { getCurrentPalette } from '../paletteStore';
import fragSrc from '../shaders/rings.frag.glsl?raw';

/** Ring count at full energy. */
const MAX_RINGS = 6;
/** Calm mode caps the ring count here. */
const MAX_RINGS_CALM = 3;
const STROKE_BASE = 0.004;
const STROKE_NORM_GAIN = 0.01;

/** Clamp to 0..1; non-finite values count as 0. */
function unit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export class RingsLayer implements RenderLayer {
  /** Calm mode: at most 3 rings and half-width strokes. */
  calm = false;
  private readonly slowLoud = new SlowFollower(3);
  private readonly slowSub = new SlowFollower(2);

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uCount: WebGLUniformLocation | null = null;
  private uNorm: WebGLUniformLocation | null = null;
  private uStroke: WebGLUniformLocation | null = null;
  private uAspect: WebGLUniformLocation | null = null;
  private uBase: WebGLUniformLocation | null = null;
  private uAccent: WebGLUniformLocation | null = null;

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction: never reuse GL objects from before a context restore.
    this.gl = gl;
    this.program = compileProgram(gl, FULLSCREEN_VERT, fragSrc, 'rings');
    this.uCount = gl.getUniformLocation(this.program, 'uCount');
    this.uNorm = gl.getUniformLocation(this.program, 'uNorm');
    this.uStroke = gl.getUniformLocation(this.program, 'uStroke');
    this.uAspect = gl.getUniformLocation(this.program, 'uAspect');
    this.uBase = gl.getUniformLocation(this.program, 'uBase');
    this.uAccent = gl.getUniformLocation(this.program, 'uAccent');
    this.vao = createVao(gl);
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Draws at the host's target size; nothing to reallocate.
  }

  draw(frame: AudioFrame, _clock: RenderClock, target: RenderTarget): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('RingsLayer: draw before init');

    bindTarget(gl, target);

    // Ring count follows change in loudness as well as level (energy sits near its
    // maximum for loud music, so level alone barely moved the rings; measured).
    const dt = Math.max(0, _clock.dtSec);
    const loudAvg = this.slowLoud.step(frame.loudness, dt);
    const energy = unit(frame.energy);
    const level = shapeReaction(Math.min(1, 0.4 * energy + 0.6 * punch(frame.loudness, loudAvg, 4)), getVisualGain());
    const bassPunch = punch(frame.env.sub, this.slowSub.step(frame.env.sub, dt), 4);
    const normMean = (unit(frame.norm.sub) + unit(frame.norm.mid) + unit(frame.norm.high)) / 3;

    let count = Math.round(level * MAX_RINGS);
    let stroke = STROKE_BASE + STROKE_NORM_GAIN * normMean + 0.012 * bassPunch * getVisualGain();
    if (this.calm) {
      count = Math.min(count, MAX_RINGS_CALM);
      stroke *= 0.5;
    }

    const palette: Palette = getPalette(getCurrentPalette());
    const aspect = target.width / Math.max(target.height, 1);

    gl.useProgram(this.program);
    gl.uniform1i(this.uCount, count); // must follow useProgram, or the call is an invalid operation
    gl.uniform1f(this.uNorm, normMean);
    gl.uniform1f(this.uStroke, stroke);
    gl.uniform1f(this.uAspect, aspect);
    gl.uniform3f(this.uBase, palette.base[0], palette.base[1], palette.base[2]);
    gl.uniform3f(this.uAccent, palette.accentB[0], palette.accentB[1], palette.accentB[2]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.program = null;
    this.vao = null;
    this.uCount = null;
    this.uNorm = null;
    this.uStroke = null;
    this.uAspect = null;
    this.uBase = null;
    this.uAccent = null;
    this.gl = null;
  }
}
