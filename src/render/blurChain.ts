// Blur chain (Slice 18.6): blurred copies of the frame at half, quarter and eighth size. A level is built only
// when something asks for it this frame, and a level nobody has asked for in a while gives its memory back.
// Level 0 is the same blur bloom always used (draw the picture at half size, blur across, blur down). Each
// deeper level is made from the one above it, so a request for level 2 also builds levels 0 and 1.
import { PingPong } from '../gl/fbo';
import type { RenderTarget } from './layer';

export const BLUR_LEVELS = 3;
/** Frames a level can go unrequested before its buffers are freed. */
export const BLUR_IDLE_FRAMES = 240;

/** One blur pass: reads `src`, steps `stepX`/`stepY` in uv, writes `target`. Supplied by the compositor. */
export type BlurPassFn = (src: WebGLTexture, stepX: number, stepY: number, target: RenderTarget) => void;

/** Size of a level for a level 0 size of baseWidth by baseHeight. Never below 1 pixel. */
export function blurLevelSize(baseWidth: number, baseHeight: number, level: number): { width: number; height: number } {
  return { width: Math.max(1, Math.floor(baseWidth) >> level), height: Math.max(1, Math.floor(baseHeight) >> level) };
}

// gl.COLOR_ATTACHMENT0, kept in one array so invalidating allocates nothing.
/**
 * How the final pass reads the chain for a Bloom size (-1..2). Below 0 the half-size level is blurred with
 * its taps closer together (tight). 0 is the half-size blur bloom always used. Between 0 and 2 the glow
 * fades from the half-size to the quarter-size and then to the eighth-size blur (wide).
 * Fills `out` when given, so the render loop can reuse one object.
 */
export interface BloomPlan {
  /** Highest level to request. */
  level: number;
  /** Tap spacing multiplier for level 0 (1 = usual). */
  spread: number;
  /** Weight of each level in the glow. They add to 1. */
  weights: [number, number, number];
}

export function bloomPlan(size: number, out: BloomPlan = { level: 0, spread: 1, weights: [1, 0, 0] }): BloomPlan {
  const s = Number.isFinite(size) ? Math.min(2, Math.max(-1, size)) : 0;
  const w = out.weights;
  if (s <= 0) {
    out.level = 0; out.spread = 1 + 0.5 * s; w[0] = 1; w[1] = 0; w[2] = 0;
  } else if (s <= 1) {
    out.level = 1; out.spread = 1; w[0] = 1 - s; w[1] = s; w[2] = 0;
  } else {
    out.level = 2; out.spread = 1; w[0] = 0; w[1] = 2 - s; w[2] = s - 1;
  }
  return out;
}

const COLOR_ATTACHMENT: number[] = [0x8ce0];

export class BlurChain {
  private readonly gl: WebGL2RenderingContext;
  private baseW: number;
  private baseH: number;
  private readonly levels: (PingPong | null)[] = [null, null, null];
  private readonly wanted: boolean[] = [false, false, false];
  private readonly built: boolean[] = [false, false, false];
  private readonly idle: number[] = [0, 0, 0];
  private readonly target: { kind: 'fbo'; framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number } =
    { kind: 'fbo', framebuffer: null as unknown as WebGLFramebuffer, texture: null as unknown as WebGLTexture, width: 1, height: 1 };

  constructor(gl: WebGL2RenderingContext, baseWidth: number, baseHeight: number) {
    this.gl = gl;
    this.baseW = Math.max(1, Math.floor(baseWidth));
    this.baseH = Math.max(1, Math.floor(baseHeight));
  }

  /** Changes the level 0 size. Levels that exist are resized, the rest stay unallocated. */
  resize(baseWidth: number, baseHeight: number): void {
    this.baseW = Math.max(1, Math.floor(baseWidth));
    this.baseH = Math.max(1, Math.floor(baseHeight));
    for (let i = 0; i < BLUR_LEVELS; i++) {
      const pp = this.levels[i];
      if (!pp) continue;
      const size = blurLevelSize(this.baseW, this.baseH, i);
      pp.resize(size.width, size.height);
    }
  }

  /** Says a level (and so every level above it) is sampled this frame. Allocates what is missing. */
  request(level: number): void {
    const top = Math.min(BLUR_LEVELS - 1, Math.max(0, Math.floor(level)));
    for (let i = 0; i <= top; i++) {
      this.wanted[i] = true;
      if (!this.levels[i]) {
        const size = blurLevelSize(this.baseW, this.baseH, i);
        this.levels[i] = new PingPong(this.gl, size.width, size.height);
      }
    }
  }

  /** Number of levels that will be built this frame (0 when nothing was requested). */
  get levelsWanted(): number {
    let n = 0;
    for (let i = 0; i < BLUR_LEVELS; i++) if (this.wanted[i]) n = i + 1;
    return n;
  }

  /** Levels that currently hold buffers. */
  get levelsAllocated(): number {
    return this.levels.filter((l) => l !== null).length;
  }

  /** Where to draw the unblurred frame for level 0. Valid after `request(0)`. The returned object is reused. */
  sourceTarget(): RenderTarget {
    const pp = this.levels[0];
    if (!pp) throw new Error('BlurChain: sourceTarget before request');
    return this.pointAt(pp.write, pp.width, pp.height);
  }

  /**
   * Blurs every requested level. `spread` scales the tap spacing of level 0 (below 1 gives a tighter blur). Level 0 expects the unblurred frame to have been drawn into `sourceTarget()`.
   * Buffers whose contents are no longer needed are invalidated so tiled GPUs can skip writing them back.
   */
  build(pass: BlurPassFn, spread = 1): void {
    const gl = this.gl;
    const wanted = this.levelsWanted;
    for (let i = 0; i < wanted; i++) {
      const pp = this.levels[i]!;
      let src: WebGLTexture;
      if (i === 0) {
        pp.swap(); // the frame drawn into `write` becomes `read`
        src = pp.read.texture;
      } else {
        src = this.levels[i - 1]!.read.texture;
      }
      const k = i === 0 ? spread : 1;
      pass(src, (1 / pp.width) * k, 0, this.pointAt(pp.write, pp.width, pp.height));
      pp.swap();
      pass(pp.read.texture, 0, (1 / pp.height) * k, this.pointAt(pp.write, pp.width, pp.height));
      pp.swap();
      // `write` now holds the across-blur, which nothing reads again.
      gl.bindFramebuffer(gl.FRAMEBUFFER, pp.write.framebuffer);
      gl.invalidateFramebuffer(gl.FRAMEBUFFER, COLOR_ATTACHMENT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.built[i] = true;
    }
  }

  /** The blurred picture for a level, or null if it was not built this frame. */
  texture(level: number): WebGLTexture | null {
    const pp = this.levels[level];
    return pp && this.built[level] ? pp.read.texture : null;
  }

  /** Call once per frame, after drawing. Clears the requests and frees levels that have sat unused too long. */
  endFrame(): void {
    for (let i = 0; i < BLUR_LEVELS; i++) {
      if (this.wanted[i]) {
        this.idle[i] = 0;
      } else if (this.levels[i] && ++this.idle[i]! > BLUR_IDLE_FRAMES) {
        this.levels[i]!.dispose();
        this.levels[i] = null;
        this.idle[i] = 0;
      }
      this.wanted[i] = false;
      this.built[i] = false;
    }
  }

  dispose(): void {
    for (let i = 0; i < BLUR_LEVELS; i++) {
      this.levels[i]?.dispose();
      this.levels[i] = null;
      this.wanted[i] = false;
      this.built[i] = false;
      this.idle[i] = 0;
    }
  }

  private pointAt(pass: { framebuffer: WebGLFramebuffer; texture: WebGLTexture }, width: number, height: number): RenderTarget {
    const t = this.target;
    t.framebuffer = pass.framebuffer;
    t.texture = pass.texture;
    t.width = width;
    t.height = height;
    return t as RenderTarget;
  }
}
