// A Scene is a group of layers with its own feedback history (slice 2.2).
// Per frame: decay last frame into `write`, add the layers on top (additive),
// then swap. After the swap, `outputTexture()` is the finished image.
import type { AudioFrame } from '../audio/types';
import { PingPong } from '../gl/fbo';
import { compileProgram, FULLSCREEN_VERT } from '../gl/shader';
import { createVao } from '../gl/vao';
import type { RenderClock } from './clock';
import { bindTarget, type RenderLayer } from './layer';
import feedbackSrc from './shaders/feedback.frag.glsl?raw';
import { FEEDBACK_DEFAULTS } from '../presets/layerSchemas';
import { advanceSceneTransform } from './sceneTransformStore';
import type { ParamValue } from '../presets/schema';
import { getRenderScale, scaledBufferSize } from '../gl/size';

const UNIFORMS = [
  'uPrev', 'uCentre', 'uDrift', 'uStretch', 'uZoom', 'uRot', 'uWarp', 'uWarpScale', 'uWarpSpeed',
  'uTime', 'uAspect', 'uWrap', 'uHueDrift', 'uBlur', 'uTexel', 'uDecay', 'uFade',
] as const;

export class Scene {
  readonly name: string;
  readonly layers: RenderLayer[];
  private gl: WebGL2RenderingContext | null = null;
  private pp: PingPong | null = null;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private w = 1;
  private h = 1;
  /** Render scale the feedback buffer was last sized for (slice 5.2). */
  private appliedScale: number | null = null;
  /** Feedback settings (slice E1/E3). Set from the preset; defaults keep the old look. */
  private fb: Record<string, number | string> = { ...FEEDBACK_DEFAULTS };
  private uni = new Map<string, WebGLUniformLocation | null>();

  constructor(name: string, layers: RenderLayer[]) {
    this.name = name;
    this.layers = layers;
  }

  /** Sets the trail motion and colour settings. Read on the next frame. */
  setFeedback(values: Record<string, ParamValue>): void {
    this.fb = { ...FEEDBACK_DEFAULTS, ...values };
  }

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.prog = compileProgram(gl, FULLSCREEN_VERT, feedbackSrc, `feedback:${this.name}`);
    this.uni.clear();
    for (const name of UNIFORMS) this.uni.set(name, gl.getUniformLocation(this.prog, name));
    this.vao = createVao(gl);
    const b = scaledBufferSize(this.w, this.h, getRenderScale());
    this.pp = new PingPong(gl, b.width, b.height);
    this.appliedScale = getRenderScale();
    for (const l of this.layers) l.init(gl);
  }

  resize(width: number, height: number, dpr: number): void {
    this.w = width;
    this.h = height;
    this.applyScale();
    for (const l of this.layers) l.resize(width, height, dpr);
  }

  /** Sizes the feedback buffer for the current render scale (slice 5.2). */
  private applyScale(): void {
    const b = scaledBufferSize(this.w, this.h, getRenderScale());
    this.pp?.resize(b.width, b.height);
    this.appliedScale = getRenderScale();
  }

  /** The finished image of the last draw (valid after draw()). */
  outputTexture(): WebGLTexture {
    if (!this.pp) throw new Error(`Scene ${this.name}: outputTexture before init`);
    return this.pp.read.texture;
  }

  draw(frame: AudioFrame, clock: RenderClock): void {
    const gl = this.gl;
    if (gl && this.pp && getRenderScale() !== this.appliedScale) this.applyScale();
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
    this.setFeedbackUniforms(gl, clock.timeSec, pp.width, pp.height);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Particles that follow the scene read this frame's zoom and rotation (2026-11-06).
    advanceSceneTransform(
      {
        zoom: Number(this.fb.zoom),
        rotate: Number(this.fb.rotate),
        centreX: Number(this.fb.centreX),
        centreY: Number(this.fb.centreY),
        stretchX: Number(this.fb.stretchX),
        stretchY: Number(this.fb.stretchY),
        warp: Number(this.fb.warp),
        warpScale: Number(this.fb.warpScale),
        warpSpeed: Number(this.fb.warpSpeed),
      },
      clock.timeSec,
    );

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

  private setFeedbackUniforms(gl: WebGL2RenderingContext, timeSec: number, width: number, height: number): void {
    const n = (key: string) => Number(this.fb[key]);
    const u = (name: string) => this.uni.get(name) ?? null;
    gl.uniform1i(u('uPrev'), 0);
    gl.uniform2f(u('uCentre'), n('centreX'), n('centreY'));
    gl.uniform2f(u('uDrift'), n('driftX'), n('driftY'));
    gl.uniform2f(u('uStretch'), n('stretchX'), n('stretchY'));
    gl.uniform1f(u('uZoom'), n('zoom'));
    gl.uniform1f(u('uRot'), n('rotate'));
    gl.uniform1f(u('uWarp'), n('warp'));
    gl.uniform1f(u('uWarpScale'), n('warpScale'));
    gl.uniform1f(u('uWarpSpeed'), n('warpSpeed'));
    gl.uniform1f(u('uTime'), timeSec);
    gl.uniform1f(u('uAspect'), width / Math.max(height, 1));
    gl.uniform1f(u('uWrap'), this.fb.wrap === 'wrap' ? 1 : 0);
    gl.uniform1f(u('uHueDrift'), n('hueDrift'));
    gl.uniform1f(u('uBlur'), n('blur'));
    gl.uniform2f(u('uTexel'), 1 / Math.max(width, 1), 1 / Math.max(height, 1));
    gl.uniform1f(u('uDecay'), n('decay'));
    gl.uniform1f(u('uFade'), n('fade'));
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
