// Ping-pong framebuffers: two RGBA8 targets. A layer draws into `write` while
// it reads last frame's image from `read`; swap() exchanges them after each frame.
//
// Rules (architect review, 2026-11-04):
// - Never sample a texture while it is the write target.
// - resize() reallocates both targets. That clears the trail, which is accepted.
// - resize() with the same size is a no-op.
// - Rebuilt inside init() after a context restore; never reuse old GL objects.
// - Format (Slice 16.7): RGBA8, or RGBA16F (half-float) where the browser can render to it. Half-float keeps
//   slow trail fades and gradients smooth; 8-bit rounds them to 1/255 steps. The format is chosen once per
//   context by `detectFeedbackFormat`, which also checks that a half-float framebuffer is complete.

export interface PassTarget {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
}

/** Clamp a requested size to at least 1×1 pixel. */
export function clampSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(Number.isFinite(width) ? width : 1)),
    height: Math.max(1, Math.floor(Number.isFinite(height) ? height : 1)),
  };
}

export type BufferFormat = 'rgba8' | 'rgba16f';

/** Bytes one pixel of a buffer takes. */
export function bytesPerPixel(format: BufferFormat): number {
  return format === 'rgba16f' ? 8 : 4;
}

let floatBuffersEnabled = true;

/** Turns half-float feedback buffers on or off for contexts checked after this call (a diagnostic switch). */
export function setFloatBuffersEnabled(on: boolean): void {
  floatBuffersEnabled = on;
}

const formatCache = new WeakMap<WebGL2RenderingContext, BufferFormat>();

/**
 * Chooses the feedback buffer format for a context and remembers it. Half-float needs EXT_color_buffer_float
 * or EXT_color_buffer_half_float, and a 1x1 RGBA16F framebuffer must report complete. Anything else is RGBA8.
 * Call again after a context restore: extensions have to be enabled on the new context.
 */
export function detectFeedbackFormat(gl: WebGL2RenderingContext): BufferFormat {
  let format: BufferFormat = 'rgba8';
  const hasExt = gl.getExtension("EXT_color_buffer_float") !== null || gl.getExtension("EXT_color_buffer_half_float") !== null;
  if (floatBuffersEnabled && hasExt) {
    if (halfFloatFramebufferIsComplete(gl)) format = 'rgba16f';
  }
  formatCache.set(gl, format);
  return format;
}

/** The format chosen for this context (detected on first use). */
export function feedbackFormat(gl: WebGL2RenderingContext): BufferFormat {
  return formatCache.get(gl) ?? detectFeedbackFormat(gl);
}

function halfFloatFramebufferIsComplete(gl: WebGL2RenderingContext): boolean {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) return false;
  try {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  } catch {
    return false;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
  }
}

export class PingPong {
  private readonly gl: WebGL2RenderingContext;
  private a: PassTarget | null = null;
  private b: PassTarget | null = null;
  private current: 'a' | 'b' = 'a';
  private w: number;
  private h: number;
  readonly format: BufferFormat;

  constructor(gl: WebGL2RenderingContext, width: number, height: number, format: BufferFormat = 'rgba8') {
    this.gl = gl;
    this.format = format;
    const size = clampSize(width, height);
    this.w = size.width;
    this.h = size.height;
    this.a = this.allocate();
    this.b = this.allocate();
  }

  get width(): number {
    return this.w;
  }

  get height(): number {
    return this.h;
  }

  /** The image drawn last frame. Sample this; never draw into it. */
  get read(): PassTarget {
    const t = this.current === 'a' ? this.b : this.a;
    if (!t) throw new Error('PingPong used after dispose');
    return t;
  }

  /** The target to draw this frame into. */
  get write(): PassTarget {
    const t = this.current === 'a' ? this.a : this.b;
    if (!t) throw new Error('PingPong used after dispose');
    return t;
  }

  /** Call once per frame, after drawing into `write`. */
  swap(): void {
    this.current = this.current === 'a' ? 'b' : 'a';
  }

  /** Reallocate for a new size. Same size is a no-op. The trail resets. */
  resize(width: number, height: number): void {
    const size = clampSize(width, height);
    if (size.width === this.w && size.height === this.h) return;
    this.w = size.width;
    this.h = size.height;
    this.freeTargets();
    this.a = this.allocate();
    this.b = this.allocate();
    this.current = 'a';
  }

  dispose(): void {
    this.freeTargets();
    this.a = null;
    this.b = null;
  }

  private allocate(): PassTarget {
    const gl = this.gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('could not create ping-pong target');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (this.format === 'rgba16f') {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.w, this.h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`framebuffer incomplete (status ${status})`);
    }
    return { framebuffer, texture };
  }

  private freeTargets(): void {
    const gl = this.gl;
    for (const t of [this.a, this.b]) {
      if (!t) continue;
      gl.deleteTexture(t.texture);
      gl.deleteFramebuffer(t.framebuffer);
    }
  }
}
