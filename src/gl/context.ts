// GlHost owns the canvas, the WebGL2 context, the layer list and the draw loop.
// On GPU context loss it stops drawing; on restore it rebuilds every layer from
// scratch (owner decision: clean restart, no state restore). Audio is untouched.
import type { AudioFrame } from '../audio/types';
import type { RenderLayer, RenderTarget } from '../render/layer';
import { canvasSize } from './size';

const CANVAS: RenderTarget = { kind: 'canvas' };

export class WebGL2UnavailableError extends Error {
  constructor() {
    super('WebGL2 is not available in this browser. Use a recent Chrome or Edge on desktop.');
  }
}

export class GlHost {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private layers: RenderLayer[] = [];
  private lost = false;
  private rafId = 0;
  private resizeTimer = 0;
  private observer: ResizeObserver;
  private size = { width: 1, height: 1, dpr: 1 };
  private getFrame: (() => AudioFrame) | null = null;
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
  }

  /** Add a layer; layers draw in the order added (first = bottom). */
  addLayer(layer: RenderLayer): void {
    this.layers.push(layer);
    if (!this.lost) {
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
    if (!this.lost) for (const l of this.layers) l.dispose();
    this.layers = [];
  }

  private tick = (now: number): void => {
    this.rafId = requestAnimationFrame(this.tick);
    // Browsers pause rAF in hidden tabs, so nothing renders there (spec).
    if (this.lost || !this.getFrame) return;
    const t0 = performance.now();
    const frame = this.getFrame();
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.size.width, this.size.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const layer of this.layers) layer.draw(frame, now / 1000, CANVAS, 1);
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
    if (this.lost) return;
    for (const l of this.layers) l.resize(this.size.width, this.size.height, this.size.dpr);
  }

  private handleLost = (e: Event): void => {
    // preventDefault tells the browser we want a restore event later.
    e.preventDefault();
    this.lost = true;
    this.onContextChange?.('lost');
  };

  private handleRestored = (): void => {
    this.lost = false;
    // Fresh construction: every GL object from before the loss is dead.
    for (const l of this.layers) {
      l.init(this.gl);
      l.resize(this.size.width, this.size.height, this.size.dpr);
    }
    this.onContextChange?.('restored');
  };
}
