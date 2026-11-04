// Ping-pong framebuffers: two RGBA8 targets. A layer draws into `write` while
// it reads last frame's image from `read`; swap() exchanges them after each frame.
//
// Rules (architect review, 2026-11-04):
// - Never sample a texture while it is the write target.
// - resize() reallocates both targets. That clears the trail, which is accepted.
// - resize() with the same size is a no-op.
// - Rebuilt inside init() after a context restore; never reuse old GL objects.

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

export class PingPong {
  private readonly gl: WebGL2RenderingContext;
  private a: PassTarget | null = null;
  private b: PassTarget | null = null;
  private current: 'a' | 'b' = 'a';
  private w: number;
  private h: number;

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl;
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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
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
