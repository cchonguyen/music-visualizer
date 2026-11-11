// Julia set layer (Slice 20.3). A single fragment pass with a fixed iteration cap. The Julia constant is the
// preset's chosen shape plus a small slow orbit, moved by mid and bass after heavy smoothing, so the set
// breathes with the music and cannot flash. Nothing here is a simulation: no state beyond three smoothed numbers.
import type { AudioFrame } from '../../audio/types';
import { compileProgram, FULLSCREEN_VERT } from '../../gl/shader';
import { createVao } from '../../gl/vao';
import { MAX_DT_SEC, Phase, type RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import { getPalette } from '../palette';
import { getCurrentPalette } from '../paletteStore';
import { JULIA_DEFAULTS, JULIA_SHAPES, type JuliaParams } from '../../presets/layerSchemas';
import fragSrc from '../shaders/julia.frag.glsl?raw';

/** Starting constants for each shape name (position in JULIA_SHAPES). */
const SHAPE_CONSTANTS: Readonly<Record<string, readonly [number, number]>> = {
  classic: [-0.8, 0.156],
  dendrite: [0.0, 1.0],
  spiral: [-0.7269, 0.1889],
  rabbit: [-0.123, 0.745],
};

/**
 * Most iterations the device is trusted with. Cost is pixels times iterations, so bigger targets get a lower cap:
 * 96 up to about 1.2 million pixels, 48 up to 4 million, 24 above that.
 */
export function juliaIterationCap(width: number, height: number): number {
  const pixels = Math.max(0, width) * Math.max(0, height);
  if (pixels > 4_000_000) return 24;
  if (pixels > 1_200_000) return 48;
  return 96;
}

/** What the shader gets for iterations: the setting, never above the device cap, never below 8. */
export function juliaIterations(setting: number, width: number, height: number): number {
  return Math.max(8, Math.min(Math.round(setting), juliaIterationCap(width, height)));
}

/** One-pole smoothing step. `seconds` is the time constant; a longer one reacts more slowly. */
export function smoothToward(current: number, target: number, dtSec: number, seconds: number): number {
  const k = 1 - Math.exp(-Math.max(0, dtSec) / Math.max(seconds, 0.05));
  return current + (target - current) * k;
}

/** The constant for this frame from the shape, the slow orbit angle and the smoothed mid and bass. */
export function juliaConstant(shape: string, orbit: number, mid: number, bass: number, reactivity: number): [number, number] {
  const base = SHAPE_CONSTANTS[shape] ?? SHAPE_CONSTANTS.classic!;
  const radius = 0.015 + 0.06 * reactivity;
  return [
    base[0] + Math.cos(orbit) * radius + (mid - 0.3) * 0.12 * reactivity,
    base[1] + Math.sin(orbit * 0.83) * radius + (bass - 0.3) * 0.12 * reactivity,
  ];
}

export class JuliaLayer implements RenderLayer {
  readonly type = 'julia';
  private p: JuliaParams;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private readonly u = new Map<string, WebGLUniformLocation | null>();
  private readonly orbit = new Phase();
  private readonly rotation = new Phase();
  private readonly colourPhase = new Phase();
  private mid = 0;
  private bass = 0;

  constructor(params: Partial<JuliaParams> = {}) {
    this.p = { ...JULIA_DEFAULTS, ...params };
  }

  setParams(params: Partial<JuliaParams>): void {
    this.p = { ...this.p, ...params };
  }

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.program = compileProgram(gl, FULLSCREEN_VERT, fragSrc, 'julia');
    for (const name of ['uRes', 'uC', 'uRot', 'uZoom', 'uMaxIter', 'uBrightness', 'uColourSpread', 'uHueShift', 'uColorA', 'uColorB', 'uLayerOpacity']) {
      this.u.set(name, gl.getUniformLocation(this.program, name));
    }
    this.vao = createVao(gl);
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Fullscreen procedural pass; uses the target size directly.
  }

  draw(frame: AudioFrame, clock: RenderClock, target: RenderTarget, options?: { opacity?: number; uLayerOpacity?: number }): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('JuliaLayer: draw before init');

    const dt = Math.min(MAX_DT_SEC, Math.max(0, clock.dtSec));
    const smoothing = Math.max(0.2, this.p.smoothing);
    this.mid = smoothToward(this.mid, frame.norm?.mid ?? 0, dt, smoothing);
    this.bass = smoothToward(this.bass, frame.norm?.sub ?? 0, dt, smoothing);
    const orbit = this.orbit.advance(dt, 0.4 * this.p.speed);
    const rotation = this.rotation.advance(dt, 0.05 * this.p.speed);
    const colour = this.colourPhase.advance(dt, 0.02 * this.p.speed);
    const c = juliaConstant(this.p.shape, orbit, this.mid, this.bass, this.p.reactivity);

    bindTarget(gl, target);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    const palette = getPalette(getCurrentPalette());
    const U = (n: string) => this.u.get(n) ?? null;
    gl.uniform2f(U('uRes'), target.width, target.height);
    gl.uniform2f(U('uC'), c[0], c[1]);
    gl.uniform1f(U('uRot'), rotation);
    gl.uniform1f(U('uZoom'), this.p.zoom);
    gl.uniform1i(U('uMaxIter'), juliaIterations(this.p.iterations, target.width, target.height));
    gl.uniform1f(U('uBrightness'), this.p.brightness);
    gl.uniform1f(U('uColourSpread'), this.p.colourSpread);
    gl.uniform1f(U('uHueShift'), colour);
    gl.uniform3fv(U('uColorA'), palette.accentA);
    gl.uniform3fv(U('uColorB'), palette.accentB);
    gl.uniform1f(U('uLayerOpacity'), options?.uLayerOpacity ?? options?.opacity ?? 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.gl = null;
    this.program = null;
    this.vao = null;
    this.u.clear();
  }
}

export { JULIA_SHAPES };
