// Tracer visual: full-screen gray level driven by the absolute sub-bass envelope.
import type { AudioFrame } from '../../audio/types';
import { compileProgram, FULLSCREEN_VERT } from '../../gl/shader';
import type { RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import fragSrc from '../shaders/bassPulse.frag.glsl?raw';

export class BassPulseLayer implements RenderLayer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uSub: WebGLUniformLocation | null = null;
  private uAlpha: WebGLUniformLocation | null = null;

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction: never reuse GL objects from before a context restore.
    this.gl = gl;
    this.program = compileProgram(gl, FULLSCREEN_VERT, fragSrc, 'bassPulse');
    this.uSub = gl.getUniformLocation(this.program, 'uSub');
    this.uAlpha = gl.getUniformLocation(this.program, 'uAlpha');
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
    this.uSub = null;
    this.uAlpha = null;
    this.gl = null;
  }
}
