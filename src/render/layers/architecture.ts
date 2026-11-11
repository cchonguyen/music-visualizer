// Architecture layer (Slice 20.5). A simple 3D room drawn by analytic perspective in one fragment pass: a floor and
// ceiling with grid lines, walls with repeated pillars, and a camera that glides forward. No ray marching and no
// loops in the shader. Bass slowly widens the grid lines (smoothed over about a second) and loudness nudges the glide
// speed; nothing flashes.
import type { AudioFrame } from '../../audio/types';
import { compileProgram, FULLSCREEN_VERT } from '../../gl/shader';
import { createVao } from '../../gl/vao';
import { MAX_DT_SEC, Phase, type RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import { getPalette } from '../palette';
import { getCurrentPalette } from '../paletteStore';
import { smoothToward } from './julia';
import { ARCHITECTURE_DEFAULTS, ARCHITECTURE_MODES, type ArchitectureParams } from '../../presets/layerSchemas';
import fragSrc from '../shaders/architecture.frag.glsl?raw';

/** Grid line width after the bass has widened it. The widening is at most 0.1 of a cell and is scaled by reactivity. */
export function architectureLineWidth(base: number, smoothedBass: number, reactivity: number): number {
  const bass = Math.max(0, Math.min(1, smoothedBass));
  return Math.min(0.3, Math.max(0.02, base + bass * 0.1 * Math.max(0, Math.min(1, reactivity))));
}

export class ArchitectureLayer implements RenderLayer {
  readonly type = 'architecture';
  private p: ArchitectureParams;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private readonly u = new Map<string, WebGLUniformLocation | null>();
  private readonly travel = new Phase();
  private bass = 0;

  constructor(params: Partial<ArchitectureParams> = {}) {
    this.p = { ...ARCHITECTURE_DEFAULTS, ...params };
  }

  setParams(params: Partial<ArchitectureParams>): void {
    this.p = { ...this.p, ...params };
  }

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.program = compileProgram(gl, FULLSCREEN_VERT, fragSrc, 'architecture');
    for (const name of ['uRes', 'uTravel', 'uMode', 'uHalfWidth', 'uHalfHeight', 'uCell', 'uPillarGap', 'uLineWidth', 'uFog', 'uBrightness', 'uHorizon', 'uColorA', 'uColorB', 'uLayerOpacity']) {
      this.u.set(name, gl.getUniformLocation(this.program, name));
    }
    this.vao = createVao(gl);
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Fullscreen procedural pass; uses the target size directly.
  }

  draw(frame: AudioFrame, clock: RenderClock, target: RenderTarget, options?: { opacity?: number; uLayerOpacity?: number }): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('ArchitectureLayer: draw before init');

    const dt = Math.min(MAX_DT_SEC, Math.max(0, clock.dtSec));
    const energy = Math.max(0, Math.min(1, frame.energy ?? 0));
    this.bass = smoothToward(this.bass, frame.norm?.sub ?? 0, dt, 1);
    // The glide only moves forward and keeps going in silence.
    const travel = this.travel.advance(dt, this.p.speed * (0.7 + 0.6 * energy));

    bindTarget(gl, target);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    const U = (n: string) => this.u.get(n) ?? null;
    const palette = getPalette(getCurrentPalette());
    gl.uniform2f(U('uRes'), target.width, target.height);
    gl.uniform1f(U('uTravel'), travel);
    gl.uniform1i(U('uMode'), Math.max(0, (ARCHITECTURE_MODES as readonly string[]).indexOf(this.p.mode)));
    gl.uniform1f(U('uHalfWidth'), this.p.roomWidth);
    gl.uniform1f(U('uHalfHeight'), this.p.roomHeight);
    gl.uniform1f(U('uCell'), this.p.gridSize);
    gl.uniform1f(U('uPillarGap'), this.p.pillarSpacing);
    gl.uniform1f(U('uLineWidth'), architectureLineWidth(this.p.lineWidth, this.bass, this.p.reactivity));
    gl.uniform1f(U('uFog'), this.p.fog);
    gl.uniform1f(U('uBrightness'), this.p.brightness);
    gl.uniform1f(U('uHorizon'), this.p.horizon);
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
