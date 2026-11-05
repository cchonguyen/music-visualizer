// A Scene is a group of layers with its own feedback history (slice 2.2).
// Per frame: decay last frame into `write`, add the layers on top (additive),
// then swap. After the swap, `outputTexture()` is the finished image.
import type { AudioFrame } from '../audio/types';
import { PingPong } from '../gl/fbo';
import { compileProgram, FULLSCREEN_VERT } from '../gl/shader';
import { createVao } from '../gl/vao';
import type { RenderClock } from './clock';
import { bindTarget, type RenderLayer } from './layer';
import decaySrc from './shaders/decay.frag.glsl?raw';

/** Persistence of the feedback trail, per frame. Was 0.97 (grey-teal haze); 0.92 clears trails faster (P1, 2026-11-04). */
export const SCENE_DECAY = 0.92;
/** Per-frame subtraction from the trail: with SCENE_DECAY, a trail reaches black in about 300 ms. */
export const SCENE_FADE = 0.004;

export class Scene {
  readonly name: string;
  readonly layers: RenderLayer[];
  private gl: WebGL2RenderingContext | null = null;
  private pp: PingPong | null = null;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private w = 1;
  private h = 1;

  constructor(name: string, layers: RenderLayer[]) {
    this.name = name;
    this.layers = layers;
  }

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.prog = compileProgram(gl, FULLSCREEN_VERT, decaySrc, `decay:${this.name}`);
    this.vao = createVao(gl);
    this.pp = new PingPong(gl, this.w, this.h);
    for (const l of this.layers) l.init(gl);
  }

  resize(width: number, height: number, dpr: number): void {
    this.w = width;
    this.h = height;
    this.pp?.resize(width, height);
    for (const l of this.layers) l.resize(width, height, dpr);
  }

  /** The finished image of the last draw (valid after draw()). */
  outputTexture(): WebGLTexture {
    if (!this.pp) throw new Error(`Scene ${this.name}: outputTexture before init`);
    return this.pp.read.texture;
  }

  draw(frame: AudioFrame, clock: RenderClock): void {
    const gl = this.gl;
    const pp = this.pp;
    if (!gl || !pp || !this.prog || !this.vao) throw new Error(`Scene ${this.name}: draw before init`);

    const target = {
      kind: 'fbo' as const,
      framebuffer: pp.write.framebuffer,
      texture: pp.write.texture,
      width: pp.width,
      height: pp.height,
    };

    // 1) Decay last frame into the write target (blending off: this is a copy).
    bindTarget(gl, target);
    gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, pp.read.texture);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uPrev'), 0);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uDecay'), SCENE_DECAY);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uFade'), SCENE_FADE);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2) Layers draw on top with a MAX blend: each pixel keeps the brighter of the
    // old trail and the new light. Additive blending was tried and saturated to white
    // within a second, because the trail re-adds the light every frame (browser check, 2026-11-04).
    // Each layer gets the MAX blend set again before its draw. Some layers (particles,
    // waveform) switch blending off or to another mode when they finish; without this reset,
    // a later full-screen layer (the kick shockwave) would overwrite the trail with black.
    for (const layer of this.layers) {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
      layer.draw(frame, clock, target);
    }
    gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.bindVertexArray(null);

    // 3) The finished image becomes "previous" and is what outputTexture() returns.
    pp.swap();
  }

  dispose(): void {
    const gl = this.gl;
    for (const l of this.layers) l.dispose();
    this.pp?.dispose();
    if (gl) {
      if (this.prog) gl.deleteProgram(this.prog);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.pp = null;
    this.prog = null;
    this.vao = null;
    this.gl = null;
  }
}
