// Tracer visual: full-screen gray level driven by the absolute sub-bass envelope.
import type { AudioFrame } from '../../audio/types';
import { compileProgram, FULLSCREEN_VERT } from '../../gl/shader';
import type { RenderLayer, RenderTarget } from '../layer';
import fragSrc from '../shaders/bassPulse.frag.glsl?raw';

export class BassPulseLayer implements RenderLayer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uSub: WebGLUniformLocation | null = null;
  private uAlpha: WebGLUniformLocation | null = null;
  private width = 1;
  private height = 1;

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction: never reuse GL objects from before a context restore.
    this.gl = gl;
    this.program = compileProgram(gl, FULLSCREEN_VERT, fragSrc, 'bassPulse');
    this.uSub = gl.getUniformLocation(this.program, 'uSub');
    this.uAlpha = gl.getUniformLocation(this.program, 'uAlpha');
    // Empty VAO: the full-screen triangle comes from gl_VertexID, no buffers.
    this.vao = gl.createVertexArray();
  }

  resize(width: number, height: number, _dpr: number): void {
    this.width = width;
    this.height = height;
  }

  draw(frame: AudioFrame, _timeSec: number, target: RenderTarget, alpha: number): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('BassPulseLayer: draw before init');

    if (target.kind === 'canvas') {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
    }

    gl.useProgram(this.program);
    gl.uniform1f(this.uSub, frame.env.sub);
    gl.uniform1f(this.uAlpha, alpha);
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
