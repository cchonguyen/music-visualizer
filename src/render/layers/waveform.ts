// Tracer visual: the raw time-domain waveform drawn as a line strip.
import type { AudioFrame } from '../../audio/types';
import { createDataTexture, type DataTexture, updateDataTexture } from '../../gl/texture';
import { compileProgram } from '../../gl/shader';
import type { RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import vertSrc from '../shaders/waveform.vert.glsl?raw';
import fragSrc from '../shaders/waveform.frag.glsl?raw';
import { WAVEFORM_DEFAULTS, type WaveformParams } from '../../presets/layerSchemas';
import { BandTexture } from '../bandTexture';

/** First texture unit for the band textures (sub, mid, high take the next two). */
const BAND_UNIT = 1;

export class WaveformLayer implements RenderLayer {
  opacity = 1.0;
  private p: WaveformParams;

  constructor(params: Partial<WaveformParams> = {}) {
    this.p = { ...WAVEFORM_DEFAULTS, ...params };
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity;
  }

  setParams(params: Partial<WaveformParams>): void {
    this.p = { ...this.p, ...params };
  }

  private uMode: WebGLUniformLocation | null = null;
  private uAspect: WebGLUniformLocation | null = null;
  private uAmp: WebGLUniformLocation | null = null;
  private uDelta: WebGLUniformLocation | null = null;
  private delta = 0;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uWave: WebGLUniformLocation | null = null;
  private uCount: WebGLUniformLocation | null = null;
  private uAlpha: WebGLUniformLocation | null = null;
  private uRes: WebGLUniformLocation | null = null;
  private uTexOn: WebGLUniformLocation | null = null;
  private uTexGain: WebGLUniformLocation | null = null;
  private uTexHigh: WebGLUniformLocation | null = null;
  private readonly band = new BandTexture();
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
    this.uDelta = gl.getUniformLocation(this.program, 'uDelta');
    this.uAlpha = gl.getUniformLocation(this.program, 'uAlpha');
    this.uRes = gl.getUniformLocation(this.program, 'uRes');
    this.uTexOn = gl.getUniformLocation(this.program, 'uTexOn');
    this.uTexGain = gl.getUniformLocation(this.program, 'uTexGain');
    this.uTexHigh = gl.getUniformLocation(this.program, 'uTexHigh');
    this.band.init(gl);
    // Empty VAO: vertices are generated from gl_VertexID, no vertex buffer.
    this.vao = gl.createVertexArray();
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Draws at the host's target size; nothing to reallocate.
  }

  draw(frame: AudioFrame, _clock: RenderClock, target: RenderTarget, options?: { opacity?: number; uLayerOpacity?: number }): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('WaveformLayer: draw before init');

    const n = frame.waveform.length;
    // A line strip needs at least two vertices; nothing to draw otherwise.
    if (n < 2) return;
    if (frame.kickPulse) {
      this.delta += 0.4;
    }
    const mode = this.p.mode === 'circle' ? 1 : this.p.mode === 'star7' ? 2 : this.p.mode === 'lissajous' ? 3 : 0;

    // Recreate the texture only when the sample count changes; otherwise reuse it.
    if (!this.tex || this.tex.length !== n) {
      if (this.tex) gl.deleteTexture(this.tex.texture);
      this.tex = createDataTexture(gl, n);
    }
    updateDataTexture(gl, this.tex, frame.waveform);

    bindTarget(gl, target);

    gl.useProgram(this.program);
    gl.uniform1i(this.uCount, n);
    gl.uniform1i(this.uMode, mode);
    gl.uniform1f(this.uAspect, target.width / Math.max(target.height, 1));
    gl.uniform1f(this.uAmp, this.p.amplitude);
    gl.uniform1f(this.uDelta, this.delta);
    const opacity = options?.uLayerOpacity ?? options?.opacity ?? this.opacity;
    gl.uniform1f(this.uAlpha, opacity); // layer opacity
    gl.uniform2f(this.uRes, target.width, target.height);
    // Band texture (6.4): update and bind before the wave texture goes on unit 0, so nothing clobbers it.
    gl.uniform1f(this.uTexOn, this.p.texture ? 1 : 0);
    gl.uniform1f(this.uTexGain, this.p.textureGain);
    if (this.p.texture) this.band.update(gl, frame.bandWaveforms);
    const texUnit = this.band.bind(gl, BAND_UNIT);
    gl.uniform1i(this.uTexHigh, texUnit + 2);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.texture);
    gl.uniform1i(this.uWave, 0);

    gl.bindVertexArray(this.vao);
    const vertexCount = mode === 3 ? 1024 : (mode === 1 || mode === 2) ? n + 1 : n;
    gl.drawArrays(gl.LINE_STRIP, 0, vertexCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.tex) gl.deleteTexture(this.tex.texture);
      if (this.program) gl.deleteProgram(this.program);
      if (this.vao) gl.deleteVertexArray(this.vao);
      this.band.dispose(gl);
    }
    this.tex = null;
    this.program = null;
    this.vao = null;
    this.uWave = null;
    this.uCount = null;
    this.uMode = null;
    this.uAspect = null;
    this.uAmp = null;
    this.uDelta = null;
    this.uAlpha = null;
    this.uRes = null;
    this.uTexOn = null;
    this.uTexGain = null;
    this.uTexHigh = null;
    this.gl = null;
  }
}
