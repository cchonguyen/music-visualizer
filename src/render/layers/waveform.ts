// Tracer visual: the raw time-domain waveform drawn as a line strip.
import type { AudioFrame } from '../../audio/types';
import { createDataTexture, type DataTexture, updateDataTexture } from '../../gl/texture';
import { compileProgram } from '../../gl/shader';
import type { RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import vertSrc from '../shaders/waveform.vert.glsl?raw';
import fragSrc from '../shaders/waveform.frag.glsl?raw';
import { WAVEFORM_DEFAULTS, type WaveformParams } from '../../presets/layerSchemas';

export class WaveformLayer implements RenderLayer {
  private p: WaveformParams;

  constructor(params: Partial<WaveformParams> = {}) {
    this.p = { ...WAVEFORM_DEFAULTS, ...params };
  }

  setParams(params: Partial<WaveformParams>): void {
    this.p = { ...this.p, ...params };
  }

  private uMode: WebGLUniformLocation | null = null;
  private uAspect: WebGLUniformLocation | null = null;
  private uAmp: WebGLUniformLocation | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uWave: WebGLUniformLocation | null = null;
  private uCount: WebGLUniformLocation | null = null;
  private uAlpha: WebGLUniformLocation | null = null;
  // Created lazily on first draw, because the sample count comes from the frame.
  private tex: DataTexture | null = null;

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction: drop any texture reference from before a context restore.
    this.gl = gl;
    this.tex = null;
    this.program = compileProgram(gl, vertSrc, fragSrc, 'waveform');
    this.uWave = gl.getUniformLocation(this.program, 'uWave');
    this.uCount = gl.getUniformLocation(this.program, 'uCount');
    this.uMode = gl.getUniformLocation(this.program, 'uMode');
    this.uAspect = gl.getUniformLocation(this.program, 'uAspect');
    this.uAmp = gl.getUniformLocation(this.program, 'uAmp');
    this.uAlpha = gl.getUniformLocation(this.program, 'uAlpha');
    // Empty VAO: vertices are generated from gl_VertexID, no vertex buffer.
    this.vao = gl.createVertexArray();
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Draws at the host's target size; nothing to reallocate.
  }

  draw(frame: AudioFrame, _clock: RenderClock, target: RenderTarget): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('WaveformLayer: draw before init');

    const n = frame.waveform.length;
    // A line strip needs at least two vertices; nothing to draw otherwise.
    if (n < 2) return;
    const circle = this.p.mode === 'circle';

    // Recreate the texture only when the sample count changes; otherwise reuse it.
    if (!this.tex || this.tex.length !== n) {
      if (this.tex) gl.deleteTexture(this.tex.texture);
      this.tex = createDataTexture(gl, n);
    }
    updateDataTexture(gl, this.tex, frame.waveform);

    bindTarget(gl, target);

    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.texture);
    gl.uniform1i(this.uWave, 0);
    gl.uniform1i(this.uCount, n);
    gl.uniform1i(this.uMode, circle ? 1 : 0);
    gl.uniform1f(this.uAspect, target.width / Math.max(target.height, 1));
    gl.uniform1f(this.uAmp, this.p.amplitude);
    gl.uniform1f(this.uAlpha, 1); // layer opacity (crossfades happen in the compositor)

    // Blend only for this draw so other layers keep their own blend state.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.LINE_STRIP, 0, circle ? n + 1 : n);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.tex) gl.deleteTexture(this.tex.texture);
      if (this.program) gl.deleteProgram(this.program);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.tex = null;
    this.program = null;
    this.vao = null;
    this.uWave = null;
    this.uCount = null;
    this.uAlpha = null;
    this.gl = null;
  }
}
