// Orbit layer (Slice 20.4). Shapes on tilted orbits with depth sizing: a handful of orbits, each carrying bodies
// that circle in 3D and are drawn as point sprites sized by distance. One draw call, no buffers, no simulation.
// Bodies pulse in size (never in brightness) with their own slice of the spectrum, so the music cannot make it flash.
import type { AudioFrame } from '../../audio/types';
import { compileProgram } from '../../gl/shader';
import { createVao } from '../../gl/vao';
import { MAX_DT_SEC, Phase, type RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import { barValues } from '../barsState';
import { buildBarEdges, type BarEdge } from '../logScale';
import { getPalette } from '../palette';
import { getCurrentPalette } from '../paletteStore';
import { ORBIT_DEFAULTS, ORBIT_SHAPES, type OrbitParams } from '../../presets/layerSchemas';
import vertSrc from '../shaders/orbit.vert.glsl?raw';
import fragSrc from '../shaders/orbit.frag.glsl?raw';

export const ORBIT_BANDS = 16;

/** Bodies on each orbit, and the total drawn. The total is a multiple of the orbit count so every orbit is full. */
export function orbitCounts(count: number, orbits: number): { orbits: number; perOrbit: number; total: number } {
  const o = Math.max(1, Math.min(5, Math.round(orbits)));
  const perOrbit = Math.max(1, Math.ceil(Math.max(1, Math.round(count)) / o));
  return { orbits: o, perOrbit, total: o * perOrbit };
}

export class OrbitLayer implements RenderLayer {
  readonly type = 'orbit';
  private p: OrbitParams;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private readonly u = new Map<string, WebGLUniformLocation | null>();
  private readonly phase = new Phase();
  private readonly yaw = new Phase();
  private edges: BarEdge[] = [];
  private edgeRate = 0;
  private edgeFft = 0;

  constructor(params: Partial<OrbitParams> = {}) {
    this.p = { ...ORBIT_DEFAULTS, ...params };
  }

  setParams(params: Partial<OrbitParams>): void {
    this.p = { ...this.p, ...params };
  }

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.program = compileProgram(gl, vertSrc, fragSrc, 'orbit');
    for (const name of ['uRes', 'uOrbits', 'uPerOrbit', 'uRadius', 'uTilt', 'uDepth', 'uPhase', 'uYaw', 'uSize', 'uReact', 'uKick', 'uBands', 'uShape', 'uBrightness', 'uColorA', 'uColorB', 'uLayerOpacity']) {
      this.u.set(name, gl.getUniformLocation(this.program, name));
    }
    this.vao = createVao(gl);
    this.edges = [];
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Point sprites are sized from the target height every frame.
  }

  draw(frame: AudioFrame, clock: RenderClock, target: RenderTarget, options?: { opacity?: number; uLayerOpacity?: number }): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('OrbitLayer: draw before init');

    const dt = Math.min(MAX_DT_SEC, Math.max(0, clock.dtSec));
    const energy = Math.max(0, Math.min(1, frame.energy ?? 0));
    // Orbit speed follows track-relative energy but never stops, and the phase only moves forward.
    const phase = this.phase.advance(dt, this.p.speed * (0.7 + 0.6 * energy));
    const yaw = this.yaw.advance(dt, this.p.yawSpeed);

    const fftSize = (frame.spectrum?.length ?? 0) * 2;
    if (fftSize > 0 && (frame.sampleRate !== this.edgeRate || fftSize !== this.edgeFft)) {
      this.edges = buildBarEdges(ORBIT_BANDS, frame.sampleRate, fftSize);
      this.edgeRate = frame.sampleRate;
      this.edgeFft = fftSize;
    }
    const bands = this.edges.length > 0 && frame.smoothedSpectrum ? barValues(frame.smoothedSpectrum, this.edges) : new Float32Array(ORBIT_BANDS);

    const { orbits, perOrbit, total } = orbitCounts(this.p.count, this.p.orbits);
    const U = (n: string) => this.u.get(n) ?? null;
    bindTarget(gl, target);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(U('uRes'), target.width, target.height);
    gl.uniform1i(U('uOrbits'), orbits);
    gl.uniform1i(U('uPerOrbit'), perOrbit);
    gl.uniform1f(U('uRadius'), this.p.radius);
    gl.uniform1f(U('uTilt'), this.p.tilt);
    gl.uniform1f(U('uDepth'), this.p.depth);
    gl.uniform1f(U('uPhase'), phase);
    gl.uniform1f(U('uYaw'), yaw);
    gl.uniform1f(U('uSize'), this.p.size);
    gl.uniform1f(U('uReact'), this.p.reactivity);
    gl.uniform1f(U('uKick'), Math.max(0, Math.min(1, frame.kickEnv ?? 0)));
    gl.uniform1fv(U('uBands'), bands.length === ORBIT_BANDS ? bands : new Float32Array(ORBIT_BANDS));
    gl.uniform1i(U('uShape'), Math.max(0, (ORBIT_SHAPES as readonly string[]).indexOf(this.p.shape)));
    gl.uniform1f(U('uBrightness'), this.p.brightness);
    const palette = getPalette(getCurrentPalette());
    gl.uniform3fv(U('uColorA'), palette.accentA);
    gl.uniform3fv(U('uColorB'), palette.accentB);
    gl.uniform1f(U('uLayerOpacity'), options?.uLayerOpacity ?? options?.opacity ?? 1);
    gl.drawArrays(gl.POINTS, 0, total);
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
