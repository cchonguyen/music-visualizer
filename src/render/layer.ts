// The render-layer contract. Every visual implements this; GlHost owns the
// canvas, the WebGL2 context and the compositing order.
import type { AudioFrame } from '../audio/types';

/** Where a layer draws: the screen, or an offscreen framebuffer. */
export type RenderTarget =
  | { kind: 'canvas' }
  | {
      kind: 'fbo';
      framebuffer: WebGLFramebuffer;
      texture: WebGLTexture;
      width: number;
      height: number;
    };

export interface RenderLayer {
  /** Fresh construction: compile shaders, create buffers/textures/framebuffers.
   *  Also called after a GPU context restore, so it must not assume old state. */
  init(gl: WebGL2RenderingContext): void;
  /** Drawing-buffer size in device pixels, plus the DPR used. */
  resize(width: number, height: number, dpr: number): void;
  /** Draw one frame. `alpha` (0..1) is set by GlHost for crossfades. */
  draw(frame: AudioFrame, timeSec: number, target: RenderTarget, alpha: number): void;
  /** Orderly removal only. Never called after context loss (objects are dead). */
  dispose(): void;
}
