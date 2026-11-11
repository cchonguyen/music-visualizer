// Compositor (slice 2.2, extended in 4.x): draws the active scenes, blends them, then runs the
// post chain and bloom (E4, E5), and finally the brightness safety pass. It is itself a
// RenderLayer, so the host needs no changes.
//
// Rules:
// - Each scene draws into its own feedback buffers (Scene). The compositor samples each scene's finished texture.
// - Crossfades blend whole scenes, never individual layers (muddied trails).
// - A scene is initialised the first time it gets weight (or earlier, with prepare()). When its weight
//   returns to 0 it is kept, up to a small count and memory cap, so coming back compiles and allocates
//   nothing; the oldest kept scenes are disposed first (Slice 16.3).
// - A fade does not start in the frame a scene is being initialised: the switch waits until it is ready.
// - At most two scenes can be active at once (the shader has two inputs).
// - Order: blend -> post chain (+ bloom) -> safety. Safety is always last; no preset can turn it off.
// - One full-size pass after the scenes (Slice 16.4): with no post effect, composite.frag does blend and safety;
//   with post effects, post.frag does blend, post and safety together. Bloom adds three half-size passes
//   (blend, blur, blur) before it, through the blur chain (Slice 18.6), which can also build quarter and eighth levels. Neither path has a full-size intermediate buffer.
// - Render scale (Slice 16.5) covers the whole chain: below 100% the final pass and the bloom buffers run at the
//   scaled size, and one copy pass upscales the result to the canvas. At 100% there is no copy pass.
import type { AudioFrame } from '../audio/types';
import { createVao } from '../gl/vao';
import { compileProgram, FULLSCREEN_VERT } from '../gl/shader';
import { LIGHT_FADE_MAX_SEC } from '../presets/cost';
import { PingPong, bytesPerPixel, detectFeedbackFormat, feedbackFormat, type BufferFormat } from '../gl/fbo';
import { getEffectiveRenderScale, scaledBufferSize } from '../gl/size';
import { type RenderClock } from './clock';
import { BrightnessLimiter } from './safety';
import { RELEASE_TAU_SEC, releaseEnvelope } from './releaseEnvelope';
import { bindTarget, type RenderLayer, type RenderTarget } from './layer';
import type { Scene } from './scene';
import type { ParamValue } from '../presets/schema';
import type { CameraUniforms, ColorUniforms } from './globalDirector';
import compositeSrc from './shaders/composite.frag.glsl?raw';
import postSrc from './shaders/post.frag.glsl?raw';
import blurSrc from './shaders/blur.frag.glsl?raw';
import { BlurChain, bloomPlan, type BloomPlan } from './blurChain';
import copySrc from './shaders/copy.frag.glsl?raw';

/** Post settings with identity values (see post.frag.glsl). */
export const POST_IDENTITY = {
  hueShift: 0, saturation: 1, contrast: 1, gamma: 1, brightness: 0, mirror: 0, vignette: 0, chroma: 0, bloom: 0, bloomThreshold: 0.6,
  bloomSize: 0, bloomTintAmount: 0, bloomTintHue: 0, bloomPulse: 0,
};
type PostValues = typeof POST_IDENTITY;
const POST_KEYS = Object.keys(POST_IDENTITY) as (keyof PostValues)[];

export const TRANSITIONS = ['crossfade', 'wipe', 'dissolve', 'zoom', 'morph'] as const;

// Aspect correction (slice 5.3): on by default. The scene is drawn into the largest 16:9 box that
// fits the window, centred, so shapes keep the proportions they were designed with. Off: the scene
// fills the whole window. The choice is saved locally.
const ASPECT_KEY = 'mv.aspectCorrect';
function readAspectSetting(): boolean {
  try {
    return localStorage.getItem(ASPECT_KEY) !== '0';
  } catch {
    return true;
  }
}
let aspectCorrect = readAspectSetting();

export function getAspectCorrect(): boolean {
  return aspectCorrect;
}

/** Turns aspect correction on or off. The compositor picks the change up on its next frame. */
export function setAspectCorrect(on: boolean): boolean {
  aspectCorrect = on;
  try {
    localStorage.setItem(ASPECT_KEY, on ? '1' : '0');
  } catch {
    // Private window or blocked storage: the choice still holds for this page load.
  }
  return aspectCorrect;
}

/** Largest 16:9 box that fits inside width x height (at least 1 px each side). */
export function fit16x9(width: number, height: number): { width: number; height: number } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  if (w * 9 > h * 16) {
    return { width: Math.min(w, Math.max(1, Math.round((h * 16) / 9))), height: h };
  }
  return { width: w, height: Math.min(h, Math.max(1, Math.round((w * 9) / 16))) };
}

/**
 * Where the scene is drawn inside the canvas (slice 8.2). Landscape (width > height) with aspect
 * correction on: the largest 16:9 box, centred (letterbox or pillarbox). Portrait, square, or
 * correction off: the full canvas at offset 0. Offsets are whole pixels.
 */
export function aspectBox(
  width: number,
  height: number,
  correct: boolean,
): { width: number; height: number; offX: number; offY: number } {
  if (!correct || height >= width) return { width, height, offX: 0, offY: 0 };
  const box = fit16x9(width, height);
  return {
    width: box.width,
    height: box.height,
    offX: Math.floor((width - box.width) / 2),
    offY: Math.floor((height - box.height) / 2),
  };
}

/** Most scenes kept initialised while off screen. */
export const RETAIN_MAX_SCENES = 3;
/** Memory the kept scenes may hold, estimated from their buffer sizes. */
export const RETAIN_MAX_BYTES = 256 * 1024 * 1024;
/** A scene holds two feedback buffers (in the feedback format) and one 8-bit snapshot buffer. */
const FEEDBACK_BUFFERS_PER_SCENE = 2;
const SNAPSHOT_BYTES_PER_PIXEL = 4;

/** Estimated GPU memory of one initialised scene at this canvas size and render scale. */
export function sceneBufferBytes(width: number, height: number, renderScale: number, format: BufferFormat = 'rgba8'): number {
  const b = scaledBufferSize(width, height, renderScale);
  return b.width * b.height * (bytesPerPixel(format) * FEEDBACK_BUFFERS_PER_SCENE + SNAPSHOT_BYTES_PER_PIXEL);
}

/** How many off-screen scenes may be kept: the count cap, reduced so their memory stays under the cap. */
export function retainLimit(width: number, height: number, renderScale: number, format: BufferFormat = 'rgba8'): number {
  const per = sceneBufferBytes(width, height, renderScale, format);
  return Math.max(0, Math.min(RETAIN_MAX_SCENES, Math.floor(RETAIN_MAX_BYTES / Math.max(1, per))));
}

export class Compositor implements RenderLayer {
  private scenes = new Map<string, Scene>();
  // `weights` is what is drawn now; `targets` is what the last key press asked for.
  // draw() eases weights toward targets, so a scene switch fades over fadeSec.
  private weights = new Map<string, number>();
  private targets = new Map<string, number>();
  private ready = new Set<string>();
  // Kept scenes that have drawn since they were initialised: their buffers hold an old image, cleared on return.
  private stale = new Set<string>();
  // Scenes drawn while they were on screen. When one reaches weight 0 it moves to `stale`.
  private drawn = new Set<string>();
  // When each scene was last on screen or prepared (a counter, not a time). The smallest is dropped first.
  private lastUsed = new Map<string, number>();
  private useTick = 0;
  // Reused by the morph search and the draw loop so a frame builds no arrays or objects (Slice 16.8).
  private readonly pair: [string, number] = ['', 0];
  private readonly pair2: [string, number] = ['', 0];
  private readonly activeNames: string[] = [];
  private readonly scaledTarget: RenderTarget = { kind: 'fbo', framebuffer: null as unknown as WebGLFramebuffer, texture: null as unknown as WebGLTexture, width: 1, height: 1 };
  private calmEl: HTMLInputElement | null | undefined = undefined;
  private gl: WebGL2RenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private postProg: WebGLProgram | null = null;
  private blurProg: WebGLProgram | null = null;
  private copyProg: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  // Blurred copies of the frame at half, quarter and eighth size, built only when asked for (Slice 18.6).
  private blurChain: BlurChain | null = null;
  private readonly plan: BloomPlan = { level: 0, spread: 1, weights: [1, 0, 0] };
  private beatEnv = 0;
  private readonly blurFn = (src: WebGLTexture, stepX: number, stepY: number, target: RenderTarget): void => {
    if (this.gl) this.blurPass(this.gl, src, stepX, stepY, target);
  };
  // Below 100% render scale the final pass draws into `scaled` (its `write` side only) and a copy pass upscales it.
  private scaled: PingPong | null = null;
  private appliedScale = 1;
  // Uniform locations, cached per program (a name can be missing from one program and present in another).
  private locs = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  private post: PostValues = { ...POST_IDENTITY };
  private directorCam: CameraUniforms = { panX: 0, panY: 0, zoom: 1, roll: 0, tiltX: 0, tiltY: 0 };
  private directorColor: ColorUniforms = { shadowTint: [1, 1, 1], highlightTint: [1, 1, 1], spatialSpread: 0, gradAngle: 0, intensity: 0, cycleAngle: 0 };
  private transition = 0; // 0 crossfade, 1 wipe, 2 dissolve, 3 zoom-through (T1), 4 morph (Slice 7.16)
  private morphing = false;
  private morphElapsed = 0;
  private morphScene: Scene | null = null;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private limiter = new BrightnessLimiter();
  calm = false;
  private lastNow: number | null = null;
  private loudnessSlow = 0;
  // How long a scene switch takes to fade (seconds). Each preset can ask for its own (slice 4.4).
  private fadeSec = RELEASE_TAU_SEC;
  // Lighter crossfade for slower devices (Slice 16.11): shorter fades, and the outgoing scene is not redrawn.
  private lightFade = false;
  // Slice 5.3: the canvas size as the host gave it, and the box the scene actually uses (w x h),
  // drawn at (offX, offY) on the canvas. appliedAspect is the setting the buffers were sized for.
  private rawW = 1;
  private rawH = 1;
  private offX = 0;
  private offY = 0;
  private appliedAspect = aspectCorrect;

  constructor(scenes: Scene[]) {
    for (const s of scenes) this.scenes.set(s.name, s);
  }

  /** Add a scene, or replace one with the same name (its old buffers are freed). Used when a preset is rebuilt. */
  setScene(scene: Scene): void {
    const old = this.scenes.get(scene.name);
    if (old && this.ready.has(scene.name)) {
      old.dispose();
      this.ready.delete(scene.name);
      this.stale.delete(scene.name);
      this.drawn.delete(scene.name);
    }
    this.scenes.set(scene.name, scene);
  }

  /** Remove a scene that is not on screen (weight 0). Frees its buffers. */
  removeScene(name: string): void {
    if ((this.weights.get(name) ?? 0) > 0 || (this.targets.get(name) ?? 0) > 0) {
      throw new Error(`Compositor: cannot remove "${name}" while it is on screen`);
    }
    if (this.ready.has(name)) {
      this.scenes.get(name)?.dispose();
      this.ready.delete(name);
    }
    this.stale.delete(name);
    this.drawn.delete(name);
    this.lastUsed.delete(name);
    this.scenes.delete(name);
    this.weights.delete(name);
    this.targets.delete(name);
  }

  /** Crossfade time for scene switches, in seconds (0.05 to 10). Set per preset. */
  setFadeSeconds(seconds: number): void {
    this.fadeSec = Math.min(10, Math.max(0.05, seconds));
  }

  /**
   * Lighter crossfade for slow devices. While two scenes blend, the outgoing one is not redrawn (its last image fades
   * out) and fades last at most LIGHT_FADE_MAX_SEC. Off by default.
   */
  setLightFade(on: boolean): void {
    this.lightFade = on;
  }

  isLightFade(): boolean {
    return this.lightFade;
  }

  /** Crossfade time in use: the preset's own, capped when the lighter crossfade is on. */
  private effectiveFadeSec(): number {
    return this.lightFade ? Math.min(this.fadeSec, LIGHT_FADE_MAX_SEC) : this.fadeSec;
  }

  /** Transition style for scene switches (T1). Applies while two scenes blend. */
  setTransition(style: string): void {
    const idx = TRANSITIONS.indexOf(style as (typeof TRANSITIONS)[number]);
    this.transition = Math.max(0, idx >= 0 ? idx : 0);
  }

  getTransition(): (typeof TRANSITIONS)[number] {
    return TRANSITIONS[this.transition] ?? 'crossfade';
  }

  isMorphing(): boolean {
    return this.morphing;
  }

  getWeight(name: string): number {
    return this.weights.get(name) ?? 0;
  }

  /** Post chain settings from the shown preset (E4, E5). Missing keys keep their identity value. */
  setPost(values: Record<string, ParamValue>): void {
    // Filled in place: linked presets call this every frame.
    const post = this.post;
    for (let i = 0; i < POST_KEYS.length; i++) {
      const key = POST_KEYS[i]!;
      const v = values[key];
      post[key] = typeof v === 'number' ? v : POST_IDENTITY[key];
    }
  }

  /** Global Director camera and color uniforms (Sector 483, Slice 7.31). */
  setDirectorState(cam: CameraUniforms, color: ColorUniforms): void {
    // Copied into the existing objects: main calls this every frame.
    const dc = this.directorCam;
    dc.panX = cam.panX; dc.panY = cam.panY; dc.zoom = cam.zoom; dc.roll = cam.roll; dc.tiltX = cam.tiltX; dc.tiltY = cam.tiltY;
    const col = this.directorColor;
    col.shadowTint[0] = color.shadowTint[0]; col.shadowTint[1] = color.shadowTint[1]; col.shadowTint[2] = color.shadowTint[2];
    col.highlightTint[0] = color.highlightTint[0]; col.highlightTint[1] = color.highlightTint[1]; col.highlightTint[2] = color.highlightTint[2];
    col.spatialSpread = color.spatialSpread;
    col.gradAngle = color.gradAngle;
    col.intensity = color.intensity;
    col.cycleAngle = color.cycleAngle;
  }

  hasDirectorEffect(): boolean {
    const c = this.directorCam;
    return (
      c.zoom !== 1 ||
      c.panX !== 0 ||
      c.panY !== 0 ||
      c.roll !== 0 ||
      c.tiltX !== 0 ||
      c.tiltY !== 0 ||
      this.directorColor.intensity > 0
    );
  }

  hasPost(): boolean {
    const p = this.post;
    const postActive = (
      p.hueShift !== 0 ||
      p.saturation !== 1 ||
      p.contrast !== 1 ||
      p.gamma !== 1 ||
      p.brightness !== 0 ||
      p.mirror >= 2 ||
      p.vignette > 0 ||
      p.chroma > 0 ||
      p.bloom > 0
    );
    return postActive || this.hasDirectorEffect();
  }

  /** Calm mode toggle. Scales contrast excursions and caps peak saturation. */
  setCalm(calm: boolean): void {
    this.calm = calm;
    this.limiter.calm = calm;
  }

  getCalm(): boolean {
    return this.limiter.calm;
  }

  get calmFactor(): number {
    return this.limiter.calmFactor;
  }

  get reversalDamp(): number {
    return this.limiter.reversalDamp;
  }

  get brightnessLimiter(): BrightnessLimiter {
    return this.limiter;
  }

  /** Uniform location for `name` in `prog`, looked up once and cached. */
  private u(prog: WebGLProgram, name: string): WebGLUniformLocation | null {
    const gl = this.gl!;
    let map = this.locs.get(prog);
    if (!map) {
      map = new Map();
      this.locs.set(prog, map);
    }
    if (!map.has(name)) map.set(name, gl.getUniformLocation(prog, name));
    return map.get(name) ?? null;
  }

  private loc(prog: WebGLProgram | null, name: string): WebGLUniformLocation | null {
    if (!prog) return null;
    return this.u(prog, name);
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
   * Initialises a scene ahead of its fade, so its shaders compile and its buffers are allocated while it is
   * still hidden (Slice 16.3). Returns true if the scene is ready. Does nothing before init() or for an unknown name.
   */
  prepare(name: string): boolean {
    const gl = this.gl;
    const scene = this.scenes.get(name);
    if (!gl || !scene) return false;
    if (!this.ready.has(name)) this.initScene(gl, name, scene);
    this.lastUsed.set(name, ++this.useTick);
    return true;
  }

  /** True if the scene is initialised (on screen, prepared, or kept). */
  isReady(name: string): boolean {
    return this.ready.has(name);
  }

  private initScene(gl: WebGL2RenderingContext, name: string, scene: Scene): void {
    scene.init(gl);
    scene.resize(this.w, this.h, this.dpr);
    this.ready.add(name);
    this.stale.delete(name);
    this.drawn.delete(name);
  }

  /**
   * Makes a scene that should now be shown usable. A kept scene gets its old image cleared; a scene that is not
   * initialised is initialised. Returns true when it had to be initialised (the expensive case).
   */
  private bringUp(gl: WebGL2RenderingContext, name: string): boolean {
    const scene = this.scenes.get(name);
    if (!scene) return false;
    this.lastUsed.set(name, ++this.useTick);
    if (!this.ready.has(name)) {
      this.initScene(gl, name, scene);
      return true;
    }
    if (this.stale.delete(name)) scene.clearBuffers();
    return false;
  }

  /** Disposes the oldest off-screen scenes beyond what the count and memory caps allow. */
  private trimKept(): void {
    // Count first: the common frame has nothing to drop and builds no array.
    let keptCount = 0;
    for (const n of this.ready) if ((this.weights.get(n) ?? 0) === 0 && (this.targets.get(n) ?? 0) === 0) keptCount++;
    if (keptCount === 0) return;
    const limit = retainLimit(this.w, this.h, getEffectiveRenderScale(), this.gl ? feedbackFormat(this.gl) : 'rgba8');
    if (keptCount <= limit) return;
    const kept = [...this.ready].filter((n) => (this.weights.get(n) ?? 0) === 0 && (this.targets.get(n) ?? 0) === 0);
    kept.sort((x, y) => (this.lastUsed.get(x) ?? 0) - (this.lastUsed.get(y) ?? 0));
    for (const name of kept.slice(0, kept.length - limit)) {
      this.scenes.get(name)?.dispose();
      this.ready.delete(name);
      this.stale.delete(name);
      this.drawn.delete(name);
    }
  }

  /**
   * Ease each scene's weight toward its target. A scene that is still fading out and a new one
   * fading in can overlap briefly; if that would make three scenes visible (the shader has two
   * inputs), the weakest fading-out scene is snapped to 0 so the cap holds.
   */
  private easeWeights(dtSec: number): void {
    // Scenes with a weight, then scenes that only have a target. Setting an existing key while looping is safe.
    for (const [name, w] of this.weights) this.easeOne(name, w, dtSec);
    for (const name of this.targets.keys()) {
      if (!this.weights.has(name)) this.easeOne(name, 0, dtSec);
    }
    let visibleCount = 0;
    for (const w of this.weights.values()) if (w > 0) visibleCount++;
    if (visibleCount > 2) {
      // Rare: three scenes visible at once. Snap the weakest fading-out ones to 0.
      const visible = [...this.weights.entries()].filter(([, w]) => w > 0);
      visible.sort((x, y) => (this.targets.get(x[0]) ?? 0) - (this.targets.get(y[0]) ?? 0) || x[1] - y[1]);
      for (const [name] of visible.slice(0, visible.length - 2)) this.weights.set(name, 0);
    }
  }

  private easeOne(name: string, w: number, dtSec: number): void {
    const t = this.targets.get(name) ?? 0;
    const fade = this.effectiveFadeSec();
    let next = releaseEnvelope(w, t, dtSec, fade, fade);
    if (Math.abs(next - t) < 1e-3) next = t; // settle exactly, so finished fades free buffers
    this.weights.set(name, next);
  }

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction after a context restore: every GL object is rebuilt.
    this.gl = gl;
    // Choose the feedback buffer format for this context (again after a restore): scenes read it when they init.
    detectFeedbackFormat(gl);
    this.prog = compileProgram(gl, FULLSCREEN_VERT, compositeSrc, 'composite');
    this.postProg = compileProgram(gl, FULLSCREEN_VERT, postSrc, 'post');
    this.blurProg = compileProgram(gl, FULLSCREEN_VERT, blurSrc, 'blur');
    this.copyProg = compileProgram(gl, FULLSCREEN_VERT, copySrc, 'copy');
    this.locs.clear();
    this.vao = createVao(gl);
    this.blurChain?.dispose();
    this.scaled?.dispose();
    this.blurChain = null;
    this.scaled = null;
    this.fitScaleBuffers(gl);
    this.ready.clear();
    this.stale.clear();
    this.drawn.clear();
    this.limiter.reset();
    this.lastNow = null;
  }

  resize(width: number, height: number, dpr: number): void {
    this.rawW = width;
    this.rawH = height;
    this.dpr = dpr;
    const box = aspectBox(width, height, aspectCorrect);
    this.w = box.width;
    this.h = box.height;
    this.offX = box.offX;
    this.offY = box.offY;
    this.appliedAspect = aspectCorrect;
    if (this.gl) this.fitScaleBuffers(this.gl);
    for (const name of this.ready) this.scenes.get(name)?.resize(this.w, this.h, dpr);
  }

  /**
   * Sizes the bloom buffers, and the buffer the final pass draws into when the render scale is below 100%, for
   * the current box and scale. A size that is unchanged is left alone.
   */
  private fitScaleBuffers(gl: WebGL2RenderingContext): void {
    const scale = getEffectiveRenderScale();
    this.appliedScale = scale;
    const sc = scaledBufferSize(this.w, this.h, scale);
    const hw = Math.max(1, sc.width >> 1);
    const hh = Math.max(1, sc.height >> 1);
    if (this.blurChain) this.blurChain.resize(hw, hh);
    else this.blurChain = new BlurChain(gl, hw, hh);
    if (sc.width === this.w && sc.height === this.h) {
      this.scaled?.dispose();
      this.scaled = null;
    } else if (this.scaled) {
      this.scaled.resize(sc.width, sc.height);
    } else {
      this.scaled = new PingPong(gl, sc.width, sc.height);
    }
  }

  private postActive(): boolean {
    return this.hasPost();
  }

  draw(frame: AudioFrame, clock: RenderClock, target: RenderTarget): void {
    const gl = this.gl;
    if (!gl || !this.prog || !this.vao) throw new Error('Compositor: draw before init');
    // The setting was toggled since the buffers were sized: re-fit them (slice 5.3).
    if (aspectCorrect !== this.appliedAspect) this.resize(this.rawW, this.rawH, this.dpr);
    // The render scale changed (the owner's choice or automatic scaling): re-fit the chain's buffers.
    if (getEffectiveRenderScale() !== this.appliedScale) this.fitScaleBuffers(gl);

    const isMorph = TRANSITIONS[this.transition] === 'morph';

    if (isMorph) {
      // Find outgoing scene (weight > 0, target == 0) and incoming scene (target > 0)
      let outgoingEntry: [string, number] | null = null;
      for (const [name, w] of this.weights) {
        if (w > 0 && (this.targets.get(name) ?? 0) === 0) {
          outgoingEntry = this.pair;
          this.pair[0] = name;
          this.pair[1] = w;
          break;
        }
      }
      let incomingEntry: [string, number] | null = null;
      for (const [name, t] of this.targets) {
        if (t > 0 && (this.weights.get(name) ?? 0) < t) {
          incomingEntry = this.pair2;
          this.pair2[0] = name;
          this.pair2[1] = t;
          break;
        }
      }

      if (outgoingEntry && incomingEntry) {
        const outName = outgoingEntry[0];
        const inName = incomingEntry[0];
        const outScene = this.scenes.get(outName);
        const inScene = this.scenes.get(inName);

        if (inScene) this.bringUp(gl, inName);

        if (outScene && inScene && this.ready.has(outName)) {
          inScene.seedFromTexture(outScene.outputTexture());
        }

        // Retire outgoing scene cleanly
        this.weights.set(outName, 0);
        outScene?.dispose();
        this.ready.delete(outName);
        this.stale.delete(outName);
        this.drawn.delete(outName);

        // Incoming scene takes over immediately
        this.weights.set(inName, incomingEntry[1]);

        // Start foreground layer ramp 0.0 -> 1.0 over 0.6s
        this.morphing = true;
        this.morphElapsed = 0;
        this.morphScene = inScene ?? null;
        inScene?.setForegroundOpacity(0.0);
      } else if (!outgoingEntry && incomingEntry) {
        const inName = incomingEntry[0];
        const inScene = this.scenes.get(inName);
        if (inScene) this.bringUp(gl, inName);
        this.weights.set(inName, incomingEntry[1]);
        inScene?.setForegroundOpacity(1.0);
      }

      if (this.morphing && this.morphScene) {
        this.morphElapsed += clock.dtSec;
        const progress = Math.min(1.0, this.morphElapsed / 0.6);
        this.morphScene.setForegroundOpacity(progress);
        if (progress >= 1.0) {
          this.morphing = false;
          this.morphScene = null;
        }
      }
    } else {
      this.morphing = false;
      this.morphScene = null;
      // A scene that is about to fade in is made ready first. If that took a compile, the fade starts
      // next frame, so the compile hitch is not counted into the first step of the fade.
      let initialising = false;
      for (const [name, t] of this.targets) {
        if (t > 0 && this.bringUp(gl, name)) initialising = true;
      }
      // Bring scenes up and down with their weights (eased toward the key-press targets).
      if (!initialising) this.easeWeights(clock.dtSec);
    }
    const active = this.activeNames;
    active.length = 0;
    for (const [name, weight] of this.weights) {
      if (weight > 0) {
        if (!this.ready.has(name)) this.bringUp(gl, name);
        this.lastUsed.set(name, ++this.useTick);
        active.push(name);
      }
    }

    // Each active scene renders its own buffers. It is now stale for whenever it comes back after being kept.
    const crossfading = active.length > 1;
    for (const name of active) {
      // Lighter crossfade: a scene that is on its way out keeps its last image instead of being drawn again.
      if (this.lightFade && crossfading && (this.targets.get(name) ?? 0) === 0 && this.drawn.has(name)) continue;
      this.scenes.get(name)!.draw(frame, clock);
      this.drawn.add(name);
    }

    // Estimated brightness target: loudness-driven, with a dim floor (the limiter enforces the floor).
    // The calm checkbox is looked up once, not on every frame.
    if (this.calmEl === undefined && typeof document !== 'undefined') {
      this.calmEl = document.getElementById('calm') as HTMLInputElement | null;
    }
    const isCalm = this.calm || Boolean(this.calmEl?.checked);
    this.limiter.calm = isCalm;

    const now = performance.now();
    const dt = this.lastNow === null ? 0 : Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    // The brightness target follows a slowed loudness, so the screen does not dim with every beat.
    this.loudnessSlow = releaseEnvelope(this.loudnessSlow, frame.loudness, dt, 0.5, 1.0);
    const cap = this.limiter.step(0.2 + 0.8 * this.loudnessSlow, dt, isCalm);

    const a = active[0];
    const b = active[1];
    const wA = a ? this.weights.get(a) ?? 0 : 0;
    const wB = b ? this.weights.get(b) ?? 0 : 0;
    const sceneA = a ? this.scenes.get(a) : undefined;
    const sceneB = b ? this.scenes.get(b) : undefined;

    const texA = sceneA?.outputTexture() ?? null;
    const texB = sceneB?.outputTexture() ?? null;
    const chain = this.blurChain;
    // Below 100% the final pass draws into the scaled buffer; the copy pass after it upscales to the target.
    const scaled = this.scaled;
    const finalDest: RenderTarget = scaled ? this.bufferTarget(this.scaledTarget, scaled.write, scaled.width, scaled.height) : target;
    if (!this.postActive() || !chain || !this.postProg || !this.blurProg) {
      // No post effect: one pass, blend and safety together (the look before E4).
      this.blendPass(gl, texA, texB, wA, wB, cap, 1, finalDest);
    } else {
      // Bloom (E5) needs a blurred copy of the blended image: blend at half size, then the blur chain blurs it
      // across and down. These are quarter-area passes. Only level 0 is asked for: nothing samples the deeper ones yet.
      let bloomTex: WebGLTexture | null = null;
      if (this.post.bloom > 0) {
        const plan = bloomPlan(this.post.bloomSize, this.plan);
        chain.request(plan.level);
        this.blendPass(gl, texA, texB, wA, wB, cap, 0, chain.sourceTarget());
        chain.build(this.blurFn, plan.spread);
        bloomTex = chain.texture(0);
      }
      // The one full-size pass: blend, post chain and safety, straight into the real target.
      this.beatEnv = Number.isFinite(frame.kickEnv) ? Math.min(1, Math.max(0, frame.kickEnv)) : 0;
      this.finalPass(gl, texA, texB, wA, wB, cap, bloomTex, finalDest);
    }
    if (scaled) this.upscalePass(gl, scaled.write.texture, target);
    this.blurChain?.endFrame();

    // Fades that have finished keep their buffers, up to the cap (oldest first out).
    for (const name of this.ready) {
      if ((this.weights.get(name) ?? 0) === 0 && this.drawn.delete(name)) this.stale.add(name);
    }
    this.trimKept();
  }

  /** Points a reused target object at a buffer. The same two objects are filled every frame. */
  private bufferTarget(out: RenderTarget, pass: { framebuffer: WebGLFramebuffer; texture: WebGLTexture }, width: number, height: number): RenderTarget {
    const t = out as { kind: 'fbo'; framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number };
    t.framebuffer = pass.framebuffer;
    t.texture = pass.texture;
    t.width = width;
    t.height = height;
    return out;
  }

  /** Binds an output target. Canvas output is drawn into the centred box (slice 5.3). */
  private bindTo(gl: WebGL2RenderingContext, target: RenderTarget): void {
    if (target.kind === 'fbo') {
      bindTarget(gl, target);
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(this.offX, this.offY, this.w, this.h);
  }

  /** Blend up to two textures with their weights and the brightness cap. `safety` 1 = apply the safety rules. */
  private blendPass(gl: WebGL2RenderingContext, texA: WebGLTexture | null, texB: WebGLTexture | null, wA: number, wB: number, cap: number, safety: number, target: RenderTarget): void {
    const prog = this.prog!;
    this.bindTo(gl, target);
    gl.disable(gl.BLEND);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texB);
    gl.uniform1i(this.u(prog, 'uA'), 0);
    gl.uniform1i(this.u(prog, 'uB'), 1);
    gl.uniform1f(this.u(prog, 'uWA'), wA);
    gl.uniform1f(this.u(prog, 'uWB'), wB);
    gl.uniform1f(this.u(prog, 'uCap'), cap);
    gl.uniform1f(this.u(prog, 'uSafety'), safety);
    gl.uniform1f(this.u(prog, 'uCalm'), this.limiter.calm ? 1.0 : 0.0);
    gl.uniform1f(this.u(prog, 'uReversalDamp'), this.limiter.reversalDamp);
    gl.uniform1i(this.u(prog, 'uStyle'), this.transition);
    const sum = wA + wB;
    gl.uniform1f(this.u(prog, 'uT'), sum > 0 ? wB / sum : 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** Copies the scaled picture to the real target, stretched to fill it. The one upscale in the chain. */
  private upscalePass(gl: WebGL2RenderingContext, src: WebGLTexture, target: RenderTarget): void {
    const prog = this.copyProg!;
    this.bindTo(gl, target);
    gl.disable(gl.BLEND);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(this.u(prog, 'uSrc'), 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  private blurPass(gl: WebGL2RenderingContext, src: WebGLTexture, stepX: number, stepY: number, target: RenderTarget): void {
    this.bindTo(gl, target);
    gl.disable(gl.BLEND);
    const prog = this.blurProg!;
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(this.u(prog, 'uSrc'), 0);
    gl.uniform2f(this.u(prog, 'uStep'), stepX, stepY);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** Blend, post chain and safety in one pass (post.frag.glsl). Safety is applied last and cannot be turned off. */
  private finalPass(gl: WebGL2RenderingContext, texA: WebGLTexture | null, texB: WebGLTexture | null, wA: number, wB: number, cap: number, bloom: WebGLTexture | null, target: RenderTarget): void {
    const p = this.post;
    const prog = this.postProg!;
    this.bindTo(gl, target);
    gl.disable(gl.BLEND);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texB);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, bloom);
    // Wider glows read the quarter and eighth levels too. A level with weight 0 is bound to the half-size one so the sampler is never empty.
    const chain = this.blurChain;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, chain?.texture(1) ?? bloom);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, chain?.texture(2) ?? bloom);
    gl.uniform1i(this.u(prog, 'uA'), 0);
    gl.uniform1i(this.u(prog, 'uB'), 1);
    gl.uniform1i(this.u(prog, 'uBloom'), 2);
    gl.uniform1i(this.loc(prog, 'uBloom1'), 3);
    gl.uniform1i(this.loc(prog, 'uBloom2'), 4);
    gl.uniform1f(this.u(prog, 'uWA'), wA);
    gl.uniform1f(this.u(prog, 'uWB'), wB);
    gl.uniform1i(this.u(prog, 'uStyle'), this.transition);
    const sum = wA + wB;
    gl.uniform1f(this.u(prog, 'uT'), sum > 0 ? wB / sum : 0);
    gl.uniform1f(this.u(prog, 'uCap'), cap);
    gl.uniform1f(this.u(prog, 'uCalm'), this.limiter.calm ? 1.0 : 0.0);
    gl.uniform1f(this.u(prog, 'uReversalDamp'), this.limiter.reversalDamp);
    gl.uniform1f(this.u(prog, 'uHue'), p.hueShift);
    gl.uniform1f(this.u(prog, 'uSat'), p.saturation);
    gl.uniform1f(this.u(prog, 'uContrast'), p.contrast);
    gl.uniform1f(this.u(prog, 'uGamma'), p.gamma);
    gl.uniform1f(this.u(prog, 'uBright'), p.brightness);
    gl.uniform1f(this.u(prog, 'uMirror'), p.mirror);
    gl.uniform1f(this.u(prog, 'uVignette'), p.vignette);
    gl.uniform1f(this.u(prog, 'uChroma'), p.chroma);
    gl.uniform1f(this.loc(prog, 'uBloomAmt'), p.bloom);
    gl.uniform1f(this.loc(prog, 'uBloomThr'), p.bloomThreshold);
    const w = this.plan.weights;
    gl.uniform3f(this.loc(prog, 'uBloomW'), w[0], w[1], w[2]);
    gl.uniform1f(this.loc(prog, 'uBloomTintAmt'), p.bloomTintAmount);
    gl.uniform1f(this.loc(prog, 'uBloomTintHue'), p.bloomTintHue);
    gl.uniform1f(this.loc(prog, 'uBloomPulse'), p.bloomPulse);
    gl.uniform1f(this.loc(prog, 'uBeat'), this.beatEnv);

    // Global Director uniforms (Sector 483, Slice 7.31)
    gl.uniform2f(this.loc(this.postProg, 'uCamPan'), this.directorCam.panX, this.directorCam.panY);
    gl.uniform1f(this.loc(this.postProg, 'uCamZoom'), this.directorCam.zoom);
    gl.uniform1f(this.loc(this.postProg, 'uCamRoll'), this.directorCam.roll);
    gl.uniform2f(this.loc(this.postProg, 'uCamTilt'), this.directorCam.tiltX, this.directorCam.tiltY);
    gl.uniform3fv(this.loc(this.postProg, 'uColorShadowTint'), this.directorColor.shadowTint);
    gl.uniform3fv(this.loc(this.postProg, 'uColorHighlightTint'), this.directorColor.highlightTint);
    gl.uniform1f(this.loc(this.postProg, 'uColorSpatialSpread'), this.directorColor.spatialSpread);
    gl.uniform1f(this.loc(this.postProg, 'uColorGradAngle'), this.directorColor.gradAngle);
    gl.uniform1f(this.loc(this.postProg, 'uColorIntensity'), this.directorColor.intensity);
    gl.uniform1f(this.loc(this.postProg, 'uColorCycleAngle'), this.directorColor.cycleAngle ?? 0);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.morphing = false;
    this.morphScene = null;
    for (const name of this.ready) this.scenes.get(name)?.dispose();
    this.ready.clear();
    this.stale.clear();
    this.drawn.clear();
    this.blurChain?.dispose();
    this.blurChain = null;
    this.scaled?.dispose();
    this.scaled = null;
    const gl = this.gl;
    if (gl) {
      for (const prog of [this.prog, this.postProg, this.blurProg, this.copyProg]) if (prog) gl.deleteProgram(prog);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.prog = null;
    this.postProg = null;
    this.blurProg = null;
    this.copyProg = null;
    this.locs.clear();
    this.vao = null;
    this.gl = null;
  }
}
