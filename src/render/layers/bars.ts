// Log-frequency bars (Stage 2, slice 2.6). One bar per log-spaced frequency band,
// read from frame.smoothedSpectrum. Values travel to the shader in a one-row texture.
import type { AudioFrame } from '../../audio/types';
import { compileProgram, FULLSCREEN_VERT } from '../../gl/shader';
import { createDataTexture, type DataTexture, updateDataTexture } from '../../gl/texture';
import { createVao } from '../../gl/vao';
import type { RenderClock } from '../clock';
import { BAR_COUNT, barValues } from '../barsState';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import { buildBarEdges, type BarEdge } from '../logScale';
import { getPalette, type Palette } from '../palette';
import { getCurrentPalette } from '../paletteStore';
import fragSrc from '../shaders/bars.frag.glsl?raw';

export class BarsLayer implements RenderLayer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private bars: DataTexture | null = null;
  private uBars: WebGLUniformLocation | null = null;
  private uBase: WebGLUniformLocation | null = null;
  private uAccentA: WebGLUniformLocation | null = null;
  private uAccentB: WebGLUniformLocation | null = null;

  /** Bar edges are rebuilt only when the sample rate or FFT size changes. */
  private edges: BarEdge[] = [];
  private edgeSampleRate = -1;
  private edgeFftSize = -1;

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction: never reuse GL objects from before a context restore.
    this.gl = gl;
    this.program = compileProgram(gl, FULLSCREEN_VERT, fragSrc, 'bars');
    this.uBars = gl.getUniformLocation(this.program, 'uBars');
    this.uBase = gl.getUniformLocation(this.program, 'uBase');
    this.uAccentA = gl.getUniformLocation(this.program, 'uAccentA');
    this.uAccentB = gl.getUniformLocation(this.program, 'uAccentB');
    this.bars = createDataTexture(gl, BAR_COUNT);
    this.vao = createVao(gl);
    // Force the edges to be rebuilt after a context restore.
    this.edges = [];
    this.edgeSampleRate = -1;
    this.edgeFftSize = -1;
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Draws at the host's target size; nothing to reallocate.
  }

  draw(frame: AudioFrame, _clock: RenderClock, target: RenderTarget): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao || !this.bars) throw new Error('BarsLayer: draw before init');

    bindTarget(gl, target);

    const fftSize = frame.spectrum.length * 2;
    if (frame.sampleRate !== this.edgeSampleRate || fftSize !== this.edgeFftSize) {
      this.edges = buildBarEdges(BAR_COUNT, frame.sampleRate, fftSize);
      this.edgeSampleRate = frame.sampleRate;
      this.edgeFftSize = fftSize;
    }
    const values = barValues(frame.smoothedSpectrum, this.edges);
    updateDataTexture(gl, this.bars, values);

    const palette: Palette = getPalette(getCurrentPalette());

    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bars.texture);
    gl.uniform1i(this.uBars, 0); // must follow useProgram, or the call is an invalid operation
    gl.uniform3f(this.uBase, palette.base[0], palette.base[1], palette.base[2]);
    gl.uniform3f(this.uAccentA, palette.accentA[0], palette.accentA[1], palette.accentA[2]);
    gl.uniform3f(this.uAccentB, palette.accentB[0], palette.accentB[1], palette.accentB[2]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.bars) gl.deleteTexture(this.bars.texture);
    }
    this.program = null;
    this.vao = null;
    this.bars = null;
    this.uBars = null;
    this.uBase = null;
    this.uAccentA = null;
    this.uAccentB = null;
    this.edges = [];
    this.edgeSampleRate = -1;
    this.edgeFftSize = -1;
    this.gl = null;
  }
}
