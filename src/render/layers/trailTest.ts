// Slice 2.1 proof layer: a fading trail behind a dot that follows the bass.
// Not a shipped visual. It proves the feedback loop, resize and context-loss rebuild.
// This layer owns its own PingPong until the Scene owns feedback (slice 2.2).
import trailSrc from '../shaders/trail.frag.glsl?raw';
import copySrc from '../shaders/copy.frag.glsl?raw';
import type { AudioFrame } from '../../audio/types';
import { PingPong } from '../../gl/fbo';
import { compileProgram, FULLSCREEN_VERT } from '../../gl/shader';
import { createVao } from '../../gl/vao';
import type { RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';

const DECAY = 0.97;

export class TrailTestLayer implements RenderLayer {
  private gl: WebGL2RenderingContext | null = null;
  private trailProg: WebGLProgram | null = null;
  private copyProg: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private pp: PingPong | null = null;
  private dotX = 0.5;
  private dotDir = 1;

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction: every GL object is rebuilt, including the buffers.
    this.gl = gl;
    this.trailProg = compileProgram(gl, FULLSCREEN_VERT, trailSrc, 'trail');
    this.copyProg = compileProgram(gl, FULLSCREEN_VERT, copySrc, 'copy');
    this.vao = createVao(gl);
    this.pp = new PingPong(gl, 1, 1);
  }

  resize(width: number, height: number, _dpr: number): void {
    // Same size is a no-op inside PingPong; a real change clears the trail.
    this.pp?.resize(width, height);
  }

  draw(frame: AudioFrame, clock: RenderClock, target: RenderTarget): void {
    const gl = this.gl;
    const pp = this.pp;
    if (!gl || !this.trailProg || !this.copyProg || !this.vao || !pp) {
      throw new Error('TrailTestLayer: draw before init');
    }
    // Move the dot across the screen and back, so the trail is visible.
    this.dotX += this.dotDir * clock.dtSec * 0.2;
    if (this.dotX > 0.9 || this.dotX < 0.1) this.dotDir = -this.dotDir;

    // 1) Decay last frame + dot into the write target.
    bindTarget(gl, { kind: 'fbo', framebuffer: pp.write.framebuffer, texture: pp.write.texture, width: pp.width, height: pp.height });
    gl.useProgram(this.trailProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, pp.read.texture); // read and write are different textures
    gl.uniform1i(gl.getUniformLocation(this.trailProg, 'uPrev'), 0);
    gl.uniform1f(gl.getUniformLocation(this.trailProg, 'uDecay'), DECAY);
    gl.uniform1f(gl.getUniformLocation(this.trailProg, 'uDotLevel'), frame.env.sub);
    gl.uniform2f(gl.getUniformLocation(this.trailProg, 'uDotPos'), this.dotX, 0.5);
    gl.uniform2f(gl.getUniformLocation(this.trailProg, 'uRes'), pp.width, pp.height);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2) This frame becomes "previous".
    pp.swap();

    // 3) Copy the newest image (now `read`) to the screen target.
    bindTarget(gl, target);
    gl.useProgram(this.copyProg);
    gl.bindTexture(gl.TEXTURE_2D, pp.read.texture);
    gl.uniform1i(gl.getUniformLocation(this.copyProg, 'uSrc'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.trailProg) gl.deleteProgram(this.trailProg);
      if (this.copyProg) gl.deleteProgram(this.copyProg);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.pp?.dispose();
    this.pp = null;
    this.trailProg = null;
    this.copyProg = null;
    this.vao = null;
    this.gl = null;
  }
}
