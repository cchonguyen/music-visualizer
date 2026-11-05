// Compositor (slice 2.2): draws the active scenes, blends them and applies the
// brightness safety rules in one final pass. It is itself a RenderLayer, so the
// host needs no changes.
//
// Rules:
// - Each scene draws into its own feedback buffers (Scene). The compositor creates
//   no extra framebuffers: it samples each scene's finished texture directly.
// - Crossfades blend whole scenes, never individual layers (muddied trails).
// - A scene is initialised the first time it gets weight, and disposed when its
//   weight returns to 0 (its fade has finished).
// - At most two scenes can be active at once (the shader has two inputs).
import type { AudioFrame } from '../audio/types';
import { createVao } from '../gl/vao';
import { compileProgram, FULLSCREEN_VERT } from '../gl/shader';
import { type RenderClock } from './clock';
import { BrightnessLimiter } from './safety';
import { RELEASE_TAU_SEC, releaseEnvelope } from './releaseEnvelope';
import { bindTarget, type RenderLayer, type RenderTarget } from './layer';
import type { Scene } from './scene';
import compositeSrc from './shaders/composite.frag.glsl?raw';

export class Compositor implements RenderLayer {
  private scenes = new Map<string, Scene>();
  // `weights` is what is drawn now; `targets` is what the last key press asked for.
  // draw() eases weights toward targets, so a scene switch fades over RELEASE_TAU_SEC.
  private weights = new Map<string, number>();
  private targets = new Map<string, number>();
  private ready = new Set<string>();
  private gl: WebGL2RenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private limiter = new BrightnessLimiter();
  private lastNow: number | null = null;

  constructor(scenes: Scene[]) {
    for (const s of scenes) this.scenes.set(s.name, s);
  }

  /** Set how much each scene shows (0..1). Weights are normalised by the caller. */
  setWeights(weights: Record<string, number>): void {
    const active = Object.entries(weights).filter(([, w]) => w > 0);
    if (active.length > 2) throw new Error('Compositor: at most two scenes can be active at once');
    for (const name of Object.keys(weights)) {
      if (!this.scenes.has(name)) throw new Error(`Compositor: unknown scene "${name}"`);
    }
    this.targets = new Map(Object.entries(weights).map(([k, v]) => [k, Math.min(1, Math.max(0, v))]));
  }

  /**
   * Ease each scene's weight toward its target (C2 release envelope). A scene that is
   * still fading out and a new one fading in can overlap briefly; if that would make
   * three scenes visible (the shader has two inputs), the weakest fading-out scene is
   * snapped to 0 so the cap holds.
   */
  private easeWeights(dtSec: number): void {
    const names = new Set([...this.weights.keys(), ...this.targets.keys()]);
    for (const name of names) {
      const w = this.weights.get(name) ?? 0;
      const t = this.targets.get(name) ?? 0;
      let next = releaseEnvelope(w, t, dtSec, RELEASE_TAU_SEC, RELEASE_TAU_SEC);
      if (Math.abs(next - t) < 1e-3) next = t; // settle exactly, so finished fades free buffers
      this.weights.set(name, next);
    }
    const visible = [...this.weights.entries()].filter(([, w]) => w > 0);
    if (visible.length > 2) {
      visible.sort((x, y) => (this.targets.get(x[0]) ?? 0) - (this.targets.get(y[0]) ?? 0) || x[1] - y[1]);
      for (const [name] of visible.slice(0, visible.length - 2)) this.weights.set(name, 0);
    }
  }

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction after a context restore: every GL object is rebuilt.
    this.gl = gl;
    this.prog = compileProgram(gl, FULLSCREEN_VERT, compositeSrc, 'composite');
    this.vao = createVao(gl);
    this.ready.clear();
    this.limiter.reset();
    this.lastNow = null;
  }

  resize(width: number, height: number, dpr: number): void {
    this.w = width;
    this.h = height;
    this.dpr = dpr;
    for (const name of this.ready) this.scenes.get(name)?.resize(width, height, dpr);
  }

  draw(frame: AudioFrame, clock: RenderClock, target: RenderTarget): void {
    const gl = this.gl;
    if (!gl || !this.prog || !this.vao) throw new Error('Compositor: draw before init');

    // Bring scenes up and down with their weights (eased toward the key-press targets).
    this.easeWeights(clock.dtSec);
    const active: string[] = [];
    for (const [name, weight] of this.weights) {
      if (weight > 0) {
        if (!this.ready.has(name)) {
          const scene = this.scenes.get(name)!;
          scene.init(gl);
          scene.resize(this.w, this.h, this.dpr);
          this.ready.add(name);
        }
        active.push(name);
      }
    }

    // Each active scene renders its own buffers.
    for (const name of active) this.scenes.get(name)!.draw(frame, clock);

    // Estimated brightness target: loudness-driven, with a dim floor (the limiter
    // enforces the floor). Real pixels are never read back (see safety.ts).
    const now = performance.now();
    const dt = this.lastNow === null ? 0 : Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    const cap = this.limiter.step(0.2 + 0.8 * frame.loudness, dt);

    // Final pass: blend the two active scenes and apply the safety rules.
    bindTarget(gl, target);
    gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    const a = active[0];
    const b = active[1];
    const sceneA = a ? this.scenes.get(a) : undefined;
    const sceneB = b ? this.scenes.get(b) : undefined;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneA ? sceneA.outputTexture() : null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sceneB ? sceneB.outputTexture() : null);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uA'), 0);
    gl.uniform1i(gl.getUniformLocation(this.prog, 'uB'), 1);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uWA'), a ? this.weights.get(a) ?? 0 : 0);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uWB'), b ? this.weights.get(b) ?? 0 : 0);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uCap'), cap);
    gl.uniform1f(gl.getUniformLocation(this.prog, 'uSafety'), 1);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    // Fades that have finished free their buffers.
    for (const name of [...this.ready]) {
      if ((this.weights.get(name) ?? 0) === 0) {
        this.scenes.get(name)!.dispose();
        this.ready.delete(name);
      }
    }
  }

  dispose(): void {
    for (const name of this.ready) this.scenes.get(name)?.dispose();
    this.ready.clear();
    const gl = this.gl;
    if (gl) {
      if (this.prog) gl.deleteProgram(this.prog);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.prog = null;
    this.vao = null;
    this.gl = null;
  }
}
