// The render-layer contract. Every visual implements this; GlHost owns the
// canvas, the WebGL2 context and the draw order.
//
// Revised after Council round 2 (2026-11-04):
// - draw() gets the RENDER clock (RenderClock), separate from the audio clock
//   in AudioFrame. Motion uses Phase accumulators driven by clock.dtSec.
// - The old `alpha` argument is removed: it mixed three meanings (layer
//   opacity, scene crossfade weight, compositing). Layer opacity is a layer
//   setting; scene crossfades happen in a Compositor that blends whole scenes
//   rendered to their own framebuffers (Stage 2/4, see SYSTEM_SPEC §7).
// - GPU state: before each draw the host binds the target, sets the viewport
//   and disables blending. A layer sets any other state it needs itself and
//   must not rely on state left by another layer.
import type { AudioFrame } from '../audio/types';
import type { RenderClock } from './clock';

/** Where a layer draws: the screen, or an offscreen framebuffer. */
export type RenderTarget =
  | { kind: 'canvas'; width: number; height: number }
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
  /** Drawing-buffer size in device pixels, plus the DPR used. Layers that own
   *  framebuffers (trails) reallocate them here. */
  resize(width: number, height: number, dpr: number): void;
  /** Draw one frame into `target` (already bound by the host). */
  draw(frame: AudioFrame, clock: RenderClock, target: RenderTarget): void;
  /** Orderly removal only. Never called after context loss (objects are dead). */
  dispose(): void;
}

/** Bind a target and set its viewport. Host calls this; layers may re-call it. */
export function bindTarget(gl: WebGL2RenderingContext, target: RenderTarget): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.kind === 'fbo' ? target.framebuffer : null);
  gl.viewport(0, 0, target.width, target.height);
}
