// Chladni Sand Layer (Slice 7.14): Cymatic sand simulation with 8,192 points
// displaced analytically down the gradient of standing-wave potential f(x, y).
import type { AudioFrame } from '../../audio/types';
import { compileProgram } from '../../gl/shader';
import { createVao } from '../../gl/vao';
import type { RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import vertSrc from '../shaders/chladniSand.vert.glsl?raw';
import fragSrc from '../shaders/chladniSand.frag.glsl?raw';
import { CHLADNI_DEFAULTS, type ChladniSandParams } from '../../presets/schema';

export const CHLADNI_POINT_COUNT = 8192;

/** Silence-safe spectral centroid computation mapped to 0..1 (0 Hz..8 kHz). */
function computeCentroid(frame: AudioFrame): number {
  if (typeof (frame as any).centroid === 'number') {
    const c = (frame as any).centroid;
    return c > 1 ? Math.min(1, Math.max(0, c / 8000)) : Math.min(1, Math.max(0, c));
  }
  const spectrum = frame.spectrum;
  if (!spectrum || spectrum.length === 0) return 0.5;
  const binHz = (frame.sampleRate || 44100) / (2 * spectrum.length);
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < spectrum.length; i++) {
    const s = spectrum[i] ?? 0;
    weighted += i * binHz * s;
    total += s;
  }
  return total <= 1e-4 ? 0.5 : Math.min(1, Math.max(0, (weighted / total) / 8000));
}

/** Converts a #rrggbb hex string into RGB floats in [0, 1]. */
function parseHexColor(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0.94, 0.77, 0.35]; // Warm gold/amber default
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255];
}

export class ChladniSandLayer implements RenderLayer {
  opacity = 1.0;
  private p: ChladniSandParams;
  private seedData: Float32Array;
  private dpr = 1.0;

  constructor(params: Partial<ChladniSandParams> = {}) {
    this.p = { ...CHLADNI_DEFAULTS, ...params };
    // Pre-allocate 8,192 static 2D seed points vec4(x, y, hash1, hash2)
    this.seedData = new Float32Array(CHLADNI_POINT_COUNT * 4);
    for (let i = 0; i < CHLADNI_POINT_COUNT; i++) {
      // Stratified jittered distribution across plate [-0.92, 0.92]
      const gx = (i % 91) / 90.0;
      const gy = Math.floor(i / 91) / 90.0;
      const jx = (Math.random() - 0.5) * (1.84 / 90.0);
      const jy = (Math.random() - 0.5) * (1.84 / 90.0);
      const x = (gx * 1.84 - 0.92) + jx;
      const y = (gy * 1.84 - 0.92) + jy;
      const h1 = Math.random();
      const h2 = Math.random();
      this.seedData[i * 4 + 0] = Math.max(-0.95, Math.min(0.95, x));
      this.seedData[i * 4 + 1] = Math.max(-0.95, Math.min(0.95, y));
      this.seedData[i * 4 + 2] = h1;
      this.seedData[i * 4 + 3] = h2;
    }
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity;
  }

  setParams(params: Partial<ChladniSandParams>): void {
    this.p = { ...this.p, ...params };
  }

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private seedVbo: WebGLBuffer | null = null;

  private uAspect: WebGLUniformLocation | null = null;
  private uTime: WebGLUniformLocation | null = null;
  private u_mid: WebGLUniformLocation | null = null;
  private u_centroid: WebGLUniformLocation | null = null;
  private u_kickEnv: WebGLUniformLocation | null = null;
  private uPointSize: WebGLUniformLocation | null = null;
  private uAttraction: WebGLUniformLocation | null = null;
  private uJitter: WebGLUniformLocation | null = null;
  private uDpr: WebGLUniformLocation | null = null;
  private uColor: WebGLUniformLocation | null = null;
  private uBrightness: WebGLUniformLocation | null = null;

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.program = compileProgram(gl, vertSrc, fragSrc, 'chladniSand');
    this.uAspect = gl.getUniformLocation(this.program, 'uAspect');
    this.uTime = gl.getUniformLocation(this.program, 'uTime');
    this.u_mid = gl.getUniformLocation(this.program, 'u_mid');
    this.u_centroid = gl.getUniformLocation(this.program, 'u_centroid');
    this.u_kickEnv = gl.getUniformLocation(this.program, 'u_kickEnv');
    this.uPointSize = gl.getUniformLocation(this.program, 'uPointSize');
    this.uAttraction = gl.getUniformLocation(this.program, 'uAttraction');
    this.uJitter = gl.getUniformLocation(this.program, 'uJitter');
    this.uDpr = gl.getUniformLocation(this.program, 'uDpr');
    this.uColor = gl.getUniformLocation(this.program, 'uColor');
    this.uBrightness = gl.getUniformLocation(this.program, 'uBrightness');

    this.vao = createVao(gl);
    this.seedVbo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.seedVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.seedData, gl.STATIC_DRAW);

    const aSeedLoc = gl.getAttribLocation(this.program, 'aSeed');
    const attrLoc = aSeedLoc >= 0 ? aSeedLoc : 0;
    gl.enableVertexAttribArray(attrLoc);
    gl.vertexAttribPointer(attrLoc, 4, gl.FLOAT, false, 16, 0);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  resize(_width: number, _height: number, dpr: number): void {
    this.dpr = dpr;
  }

  draw(frame: AudioFrame, clock: RenderClock, target: RenderTarget, options?: { opacity?: number; uLayerOpacity?: number }): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('ChladniSandLayer: draw before init');

    bindTarget(gl, target);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.uniform1f(this.uAspect, target.width / target.height);
    gl.uniform1f(this.uTime, clock.timeSec);

    const midVal = frame.norm?.mid ?? 0.0;
    const kickEnvVal = frame.kickEnv ?? 0.0;
    const centroidVal = computeCentroid(frame);

    gl.uniform1f(this.u_mid, midVal);
    gl.uniform1f(this.u_centroid, centroidVal);
    gl.uniform1f(this.u_kickEnv, kickEnvVal);

    gl.uniform1f(this.uPointSize, this.p.pointSize);
    gl.uniform1f(this.uAttraction, this.p.attraction);
    gl.uniform1f(this.uJitter, this.p.jitter);
    gl.uniform1f(this.uDpr, this.dpr);

    const rgb = parseHexColor(this.p.color);
    gl.uniform3f(this.uColor, rgb[0], rgb[1], rgb[2]);

    const opacity = options?.uLayerOpacity ?? options?.opacity ?? this.opacity;
    gl.uniform1f(this.uBrightness, this.p.brightness * opacity);

    gl.drawArrays(gl.POINTS, 0, CHLADNI_POINT_COUNT);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.seedVbo) gl.deleteBuffer(this.seedVbo);
    }
    this.gl = null;
    this.program = null;
    this.vao = null;
    this.seedVbo = null;
    this.uAspect = null;
    this.uTime = null;
    this.u_mid = null;
    this.u_centroid = null;
    this.u_kickEnv = null;
    this.uPointSize = null;
    this.uAttraction = null;
    this.uJitter = null;
    this.uDpr = null;
    this.uColor = null;
    this.uBrightness = null;
  }
}
