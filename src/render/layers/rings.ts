// Concentric rings (Stage 2, slice 2.6). Ring count follows frame.energy,
// stroke width follows frame.norm. Band texture (6.3): sub by angle sets stroke
// brightness, mid by ring radius sets stroke width.
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
import { RINGS_DEFAULTS, type RingsParams } from '../../presets/layerSchemas';
import { BandTexture } from '../bandTexture';

/** First texture unit for the band textures (sub, mid, high take the next two). */
const BAND_UNIT = 1;

/** Clamp to 0..1; non-finite values count as 0. */
function unit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export class RingsLayer implements RenderLayer {
  opacity = 1.0;
  /** Calm mode: at most 3 rings and half-width strokes. */
  calm = false;
  /** Settings (slice 4.2). Read every frame. */
  private p: RingsParams;

  constructor(params: Partial<RingsParams> = {}) {
    this.p = { ...RINGS_DEFAULTS, ...params };
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity;
  }

  setParams(params: Partial<RingsParams>): void {
    this.p = { ...this.p, ...params };
  }

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
  private uSides: WebGLUniformLocation | null = null;
  private uFilled: WebGLUniformLocation | null = null;
  private uTexOn: WebGLUniformLocation | null = null;
  private uTexGain: WebGLUniformLocation | null = null;
  private uTexSub: WebGLUniformLocation | null = null;
  private uTexMid: WebGLUniformLocation | null = null;
  private uMode: WebGLUniformLocation | null = null;
  private uTime: WebGLUniformLocation | null = null;
  private uMid: WebGLUniformLocation | null = null;
  private uColorA: WebGLUniformLocation | null = null;
  private uColorB: WebGLUniformLocation | null = null;
  private uKick: WebGLUniformLocation | null = null;
  private uLayerOpacity: WebGLUniformLocation | null = null;
  private readonly band = new BandTexture();

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
    this.uColorA = gl.getUniformLocation(this.program, 'uColorA');
    this.uColorB = gl.getUniformLocation(this.program, 'uColorB');
    this.uSides = gl.getUniformLocation(this.program, 'uSides');
    this.uFilled = gl.getUniformLocation(this.program, 'uFilled');
    this.uTexOn = gl.getUniformLocation(this.program, 'uTexOn');
    this.uTexGain = gl.getUniformLocation(this.program, 'uTexGain');
    this.uTexSub = gl.getUniformLocation(this.program, 'uTexSub');
    this.uTexMid = gl.getUniformLocation(this.program, 'uTexMid');
    this.uMode = gl.getUniformLocation(this.program, 'uMode');
    this.uTime = gl.getUniformLocation(this.program, 'uTime');
    this.uMid = gl.getUniformLocation(this.program, 'uMid');
    this.uKick = gl.getUniformLocation(this.program, 'uKick');
    this.uLayerOpacity = gl.getUniformLocation(this.program, 'uLayerOpacity');
    this.band.init(gl);
    this.vao = createVao(gl);
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Draws at the host's target size; nothing to reallocate.
  }

  draw(
    frame: AudioFrame,
    _clock: RenderClock,
    target: RenderTarget,
    options?: { opacity?: number; uLayerOpacity?: number },
  ): void {
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

    let count = Math.round(level * this.p.maxRings);
    let stroke = this.p.strokeBase + this.p.strokeNormGain * normMean + 0.012 * bassPunch * getVisualGain();
    if (this.calm) {
      count = Math.min(count, this.p.maxRingsCalm);
      stroke *= 0.5;
    }

    const palette: Palette = getPalette(getCurrentPalette());
    const aspect = target.width / Math.max(target.height, 1);
    const modeStr = this.p.mode ?? (this.p as any).shape ?? 'rings';
    const mode = modeStr === 'orbitTriangles' ? 1 : modeStr === 'polarGrid' ? 2 : 0;
    const layerOpacity = options?.uLayerOpacity ?? options?.opacity ?? this.opacity ?? 1.0;
    const kickVal = frame.kickEnv ?? (frame.beatByBand?.sub ? 1 : 0);

    gl.useProgram(this.program);
    gl.uniform1i(this.uCount, count); // must follow useProgram, or the call is an invalid operation
    gl.uniform1f(this.uNorm, normMean);
    gl.uniform1f(this.uStroke, stroke);
    gl.uniform1f(this.uAspect, aspect);
    gl.uniform1f(this.uSides, this.p.sides);
    gl.uniform1f(this.uFilled, this.p.style === 'filled' ? 1 : 0);
    gl.uniform1i(this.uMode, mode);
    gl.uniform1f(this.uTime, _clock.timeSec);
    gl.uniform1f(this.uMid, unit(frame.norm.mid));
    gl.uniform3f(this.uBase, palette.base[0], palette.base[1], palette.base[2]);
    gl.uniform3f(this.uAccent, palette.accentB[0], palette.accentB[1], palette.accentB[2]);
    if (this.uColorA) gl.uniform3f(this.uColorA, palette.accentA[0], palette.accentA[1], palette.accentA[2]);
    if (this.uColorB) gl.uniform3f(this.uColorB, palette.accentB[0], palette.accentB[1], palette.accentB[2]);
    if (this.uKick) gl.uniform1f(this.uKick, kickVal);
    if (this.uLayerOpacity) gl.uniform1f(this.uLayerOpacity, layerOpacity);
    // Band texture (6.3): always bound so the samplers have a valid texture; updated only when on.
    gl.uniform1f(this.uTexOn, this.p.texture ? 1 : 0);
    gl.uniform1f(this.uTexGain, this.p.textureGain);
    if (this.p.texture) this.band.update(gl, frame.bandWaveforms);
    const texUnit = this.band.bind(gl, BAND_UNIT);
    gl.uniform1i(this.uTexSub, texUnit);
    gl.uniform1i(this.uTexMid, texUnit + 1);
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
    this.uCount = null;
    this.uNorm = null;
    this.uStroke = null;
    this.uAspect = null;
    this.uBase = null;
    this.uAccent = null;
    this.uColorA = null;
    this.uColorB = null;
    this.uKick = null;
    this.uLayerOpacity = null;
    this.uTexOn = null;
    this.uTexGain = null;
    this.uTexSub = null;
    this.uTexMid = null;
    this.uMode = null;
    this.uTime = null;
    this.uMid = null;
    this.gl = null;
  }
}
