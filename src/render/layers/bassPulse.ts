// Tracer visual: full-screen gray level driven by the absolute sub-bass envelope.
// Band texture (6.4): sub by angle sets the pulse brightness.
import type { AudioFrame } from '../../audio/types';
import { compileProgram, FULLSCREEN_VERT } from '../../gl/shader';
import type { RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import fragSrc from '../shaders/bassPulse.frag.glsl?raw';
import { BASS_PULSE_DEFAULTS, type BassPulseParams } from '../../presets/layerSchemas';
import { BandTexture } from '../bandTexture';

/** First texture unit for the band textures (sub, mid, high take the next two). */
const BAND_UNIT = 1;

export class BassPulseLayer implements RenderLayer {
  /** Settings (6.4). Read every frame. */
  private p: BassPulseParams;

  constructor(params: Partial<BassPulseParams> = {}) {
    this.p = { ...BASS_PULSE_DEFAULTS, ...params };
  }

  setParams(params: Partial<BassPulseParams>): void {
    this.p = { ...this.p, ...params };
  }

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uSub: WebGLUniformLocation | null = null;
  private uAlpha: WebGLUniformLocation | null = null;
  private uAspect: WebGLUniformLocation | null = null;
  private uTexOn: WebGLUniformLocation | null = null;
  private uTexGain: WebGLUniformLocation | null = null;
  private uTexSub: WebGLUniformLocation | null = null;
  private readonly band = new BandTexture();

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction: never reuse GL objects from before a context restore.
    this.gl = gl;
    this.program = compileProgram(gl, FULLSCREEN_VERT, fragSrc, 'bassPulse');
    this.uSub = gl.getUniformLocation(this.program, 'uSub');
    this.uAlpha = gl.getUniformLocation(this.program, 'uAlpha');
    this.uAspect = gl.getUniformLocation(this.program, 'uAspect');
    this.uTexOn = gl.getUniformLocation(this.program, 'uTexOn');
    this.uTexGain = gl.getUniformLocation(this.program, 'uTexGain');
    this.uTexSub = gl.getUniformLocation(this.program, 'uTexSub');
    this.band.init(gl);
    // Empty VAO: the full-screen triangle comes from gl_VertexID, no buffers.
    this.vao = gl.createVertexArray();
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Draws at the host's target size; nothing to reallocate.
  }

  draw(frame: AudioFrame, _clock: RenderClock, target: RenderTarget): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('BassPulseLayer: draw before init');

    bindTarget(gl, target);

    gl.useProgram(this.program);
    gl.uniform1f(this.uSub, frame.env.sub);
    gl.uniform1f(this.uAlpha, 1); // layer opacity (crossfades happen in the compositor)
    gl.uniform1f(this.uAspect, target.width / Math.max(target.height, 1));
    // Band texture (6.4): always bound so the sampler has a valid texture; updated only when on.
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
    this.uSub = null;
    this.uAlpha = null;
    this.uAspect = null;
    this.uTexOn = null;
    this.uTexGain = null;
    this.uTexSub = null;
    this.gl = null;
  }
}
