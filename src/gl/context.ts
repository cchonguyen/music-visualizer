// GlHost owns the canvas, the WebGL2 context, the layer list and the draw loop.
// On GPU context loss it stops drawing; on restore it rebuilds every layer from
// scratch (owner decision: clean restart, no state restore). Audio is untouched.
import type { AudioFrame } from '../audio/types';
import { bindTarget, type RenderLayer, type RenderTarget } from '../render/layer';
import { clampDt, type RenderClock } from '../render/clock';
import { FrameStepper, STEP_DT_SEC } from '../render/frameStep';
import { canvasSize } from './size';
import { ContextLossState } from './lossState';

export class WebGL2UnavailableError extends Error {
  constructor() {
    super('WebGL2 is not available in this browser. Use a recent Chrome or Edge on desktop.');
  }
}

export class GlHost {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private layers: RenderLayer[] = [];
  private loss = new ContextLossState();
  private rafId = 0;
  private resizeTimer = 0;
  private observer: ResizeObserver;
  private dprQuery: MediaQueryList | null = null;
  private size = { width: 1, height: 1, dpr: 1 };
  private clock: RenderClock = { timeSec: 0, dtSec: 0, frameIndex: 0 };
  private lastNow: number | null = null;
  private getFrame: (() => AudioFrame) | null = null;
  /** Freeze mode (k) and single-frame steps (.). */
  readonly stepper = new FrameStepper();
  /** Called after each drawn frame with the frame time in ms (for the debug panel). */
  onFrameTime: ((ms: number) => void) | null = null;
  /** Called when the GPU context is lost or restored. */
  onContextChange: ((state: 'lost' | 'restored') => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new WebGL2UnavailableError();
    this.gl = gl;

    canvas.addEventListener('webglcontextlost', this.handleLost);
    canvas.addEventListener('webglcontextrestored', this.handleRestored);
    this.observer = new ResizeObserver(() => this.scheduleResize());
    this.observer.observe(canvas);
    this.applySize();
    this.watchDpr();
  }

  /**
   * Watches for a devicePixelRatio change (window moved to another monitor, browser zoom) with no
   * CSS size change, which fires no ResizeObserver. Re-registers on each change. No-op without matchMedia.
   */
  private watchDpr(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    const dpr = window.devicePixelRatio || 1;
    this.dprQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
    this.dprQuery.addEventListener('change', this.onDprChange);
  }

  private onDprChange = (): void => {
    this.scheduleResize();
    this.watchDpr();
  };

  /** Add a layer; layers draw in the order added (first = bottom). */
  addLayer(layer: RenderLayer): void {
    this.layers.push(layer);
    if (!this.loss.isLost) {
      layer.init(this.gl);
      layer.resize(this.size.width, this.size.height, this.size.dpr);
    }
  }

  /** Start the draw loop. `getFrame` is called once per animation frame. */
  start(getFrame: () => AudioFrame): void {
    this.getFrame = getFrame;
    if (!this.rafId) this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /** Orderly teardown (page leave). Not used for context loss. */
  dispose(): void {
    this.stop();
    this.observer.disconnect();
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
    if (!this.loss.isLost) for (const l of this.layers) l.dispose();
    this.layers = [];
  }

  private tick = (now: number): void => {
    this.rafId = requestAnimationFrame(this.tick);
    // Browsers pause rAF in hidden tabs, so nothing renders there (spec).
    if (this.loss.isLost || !this.getFrame) return;
    if (!this.stepper.consumeDraw()) {
      this.lastNow = now;
      return;
    }
    const t0 = performance.now();
    // Frozen steps advance by a fixed frame so each step is one frame of motion.
    const dt = this.stepper.isFrozen ? STEP_DT_SEC : this.lastNow === null ? 0 : clampDt((now - this.lastNow) / 1000);
    this.lastNow = now;
    this.clock = { timeSec: this.clock.timeSec + dt, dtSec: dt, frameIndex: this.clock.frameIndex + 1 };
    const frame = this.getFrame();
    const gl = this.gl;
    const target: RenderTarget = { kind: 'canvas', width: this.size.width, height: this.size.height };
    bindTarget(gl, target);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const layer of this.layers) {
      // Known starting state for every layer, so one can't break another.
      bindTarget(gl, target);
      gl.disable(gl.BLEND);
      layer.draw(frame, this.clock, target);
    }
    this.onFrameTime?.(performance.now() - t0);
  };

  private scheduleResize(): void {
    // Debounce: window drags fire many resize events; resizing GPU buffers is costly.
    clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => this.applySize(), 100);
  }

  private applySize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.size = canvasSize(rect.width, rect.height, window.devicePixelRatio || 1);
    this.canvas.width = this.size.width;
    this.canvas.height = this.size.height;
    if (this.loss.isLost) return;
    for (const l of this.layers) l.resize(this.size.width, this.size.height, this.size.dpr);
  }

  private handleLost = (e: Event): void => {
    // preventDefault tells the browser we want a restore event later.
    e.preventDefault();
    const ev = this.loss.markLost();
    if (ev) this.onContextChange?.(ev);
  };

  private handleRestored = (): void => {
    if (this.loss.markRestored() === null) return;
    // Fresh construction: every GL object from before the loss is dead.
    for (const l of this.layers) {
      l.init(this.gl);
      l.resize(this.size.width, this.size.height, this.size.dpr);
    }
    this.onContextChange?.('restored');
  };
}
