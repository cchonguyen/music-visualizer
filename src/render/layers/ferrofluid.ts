// FerrofluidLayer (Slice 7.15): 4-subdivision icosahedron mesh (2,562 vertices / 5,120 triangles)
// with 3D Simplex displacement, finite-difference perturbed normals, and MatCap Chrome shading.
import type { AudioFrame } from '../../audio/types';
import { compileProgram } from '../../gl/shader';
import { createVao } from '../../gl/vao';
import type { RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import vertSrc from '../shaders/ferrofluid.vert.glsl?raw';
import fragSrc from '../shaders/ferrofluid.frag.glsl?raw';
import { FERROFLUID_DEFAULTS, type FerrofluidParams } from '../../presets/schema';

/**
 * Generates an indexed unit sphere triangle mesh by recursively subdividing an icosahedron.
 * Subdivision 0: 12 vertices / 20 triangles
 * Subdivision 1: 42 vertices / 80 triangles
 * Subdivision 2: 162 vertices / 320 triangles
 * Subdivision 3: 642 vertices / 1,280 triangles
 * Subdivision 4: 2,562 vertices / 5,120 triangles (15,360 indices)
 */
export function generateIcosahedronMesh(subdivisions = 4): { positions: Float32Array; indices: Uint16Array } {
  const t = (1.0 + Math.sqrt(5.0)) / 2.0;

  let vertices: number[][] = [
    [-1,  t,  0],
    [ 1,  t,  0],
    [-1, -t,  0],
    [ 1, -t,  0],
    [ 0, -1,  t],
    [ 0,  1,  t],
    [ 0, -1, -t],
    [ 0,  1, -t],
    [ t,  0, -1],
    [ t,  0,  1],
    [-t,  0, -1],
    [-t,  0,  1],
  ].map((v) => {
    const len = Math.hypot(v[0]!, v[1]!, v[2]!);
    return [v[0]! / len, v[1]! / len, v[2]! / len];
  });

  let faces: [number, number, number][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];

  for (let s = 0; s < subdivisions; s++) {
    const edgeCache = new Map<string, number>();

    const getMidpoint = (i1: number, i2: number): number => {
      const key = i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`;
      const cached = edgeCache.get(key);
      if (cached !== undefined) return cached;

      const v1 = vertices[i1]!;
      const v2 = vertices[i2]!;
      const mx = (v1[0]! + v2[0]!) * 0.5;
      const my = (v1[1]! + v2[1]!) * 0.5;
      const mz = (v1[2]! + v2[2]!) * 0.5;
      const len = Math.hypot(mx, my, mz);
      const newIdx = vertices.length;
      vertices.push([mx / len, my / len, mz / len]);
      edgeCache.set(key, newIdx);
      return newIdx;
    };

    const nextFaces: [number, number, number][] = [];
    for (const [v1, v2, v3] of faces) {
      const a = getMidpoint(v1, v2);
      const b = getMidpoint(v2, v3);
      const c = getMidpoint(v3, v1);
      nextFaces.push([v1, a, c]);
      nextFaces.push([v2, b, a]);
      nextFaces.push([v3, c, b]);
      nextFaces.push([a, b, c]);
    }
    faces = nextFaces;
  }

  const positions = new Float32Array(vertices.length * 3);
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i]!;
    positions[i * 3 + 0] = v[0]!;
    positions[i * 3 + 1] = v[1]!;
    positions[i * 3 + 2] = v[2]!;
  }

  const indices = new Uint16Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i]!;
    indices[i * 3 + 0] = f[0];
    indices[i * 3 + 1] = f[1];
    indices[i * 3 + 2] = f[2];
  }

  return { positions, indices };
}

export class FerrofluidLayer implements RenderLayer {
  opacity = 1.0;
  private p: FerrofluidParams;
  private indexCount = 0;

  constructor(params: Partial<FerrofluidParams> = {}) {
    this.p = { ...FERROFLUID_DEFAULTS, ...params };
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity;
  }

  setParams(params: Partial<FerrofluidParams>): void {
    this.p = { ...this.p, ...params };
  }

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private ibo: WebGLBuffer | null = null;

  private uAspect: WebGLUniformLocation | null = null;
  private uTime: WebGLUniformLocation | null = null;
  private u_sub: WebGLUniformLocation | null = null;
  private u_mid: WebGLUniformLocation | null = null;
  private u_kickEnv: WebGLUniformLocation | null = null;
  private uRadius: WebGLUniformLocation | null = null;
  private uSpikeAmp: WebGLUniformLocation | null = null;
  private uSpikeFreq: WebGLUniformLocation | null = null;
  private uSpikeSharp: WebGLUniformLocation | null = null;
  private uRotSpeed: WebGLUniformLocation | null = null;
  private uBrightness: WebGLUniformLocation | null = null;
  private uFresnelGain: WebGLUniformLocation | null = null;
  private uLayerOpacity: WebGLUniformLocation | null = null;

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.program = compileProgram(gl, vertSrc, fragSrc, 'ferrofluid');

    this.uAspect = gl.getUniformLocation(this.program, 'uAspect');
    this.uTime = gl.getUniformLocation(this.program, 'uTime');
    this.u_sub = gl.getUniformLocation(this.program, 'u_sub');
    this.u_mid = gl.getUniformLocation(this.program, 'u_mid');
    this.u_kickEnv = gl.getUniformLocation(this.program, 'u_kickEnv');
    this.uRadius = gl.getUniformLocation(this.program, 'uRadius');
    this.uSpikeAmp = gl.getUniformLocation(this.program, 'uSpikeAmp');
    this.uSpikeFreq = gl.getUniformLocation(this.program, 'uSpikeFreq');
    this.uSpikeSharp = gl.getUniformLocation(this.program, 'uSpikeSharp');
    this.uRotSpeed = gl.getUniformLocation(this.program, 'uRotSpeed');
    this.uBrightness = gl.getUniformLocation(this.program, 'uBrightness');
    this.uFresnelGain = gl.getUniformLocation(this.program, 'uFresnelGain');
    this.uLayerOpacity = gl.getUniformLocation(this.program, 'uLayerOpacity');

    // Generate static 4-subdivision unit icosahedron mesh once during init()
    const mesh = generateIcosahedronMesh(4);
    this.indexCount = mesh.indices.length;

    this.vao = createVao(gl);
    this.vbo = gl.createBuffer();
    this.ibo = gl.createBuffer();

    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);

    const aPosLoc = gl.getAttribLocation(this.program, 'aPosition');
    const attrLoc = aPosLoc >= 0 ? aPosLoc : 0;
    gl.enableVertexAttribArray(attrLoc);
    gl.vertexAttribPointer(attrLoc, 3, gl.FLOAT, false, 12, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Draws at host target size
  }

  draw(
    frame: AudioFrame,
    clock: RenderClock,
    target: RenderTarget,
    options?: { opacity?: number; uLayerOpacity?: number },
  ): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('FerrofluidLayer: draw before init');

    bindTarget(gl, target);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.uniform1f(this.uAspect, target.width / target.height);
    gl.uniform1f(this.uTime, clock.timeSec);

    const subVal = frame.norm?.sub ?? frame.env?.sub ?? 0.0;
    const midVal = frame.norm?.mid ?? frame.env?.mid ?? 0.0;
    const kickVal = frame.kickEnv ?? 0.0;

    gl.uniform1f(this.u_sub, subVal);
    gl.uniform1f(this.u_mid, midVal);
    gl.uniform1f(this.u_kickEnv, kickVal);

    gl.uniform1f(this.uRadius, this.p.radius);
    gl.uniform1f(this.uSpikeAmp, this.p.spikeAmp);
    gl.uniform1f(this.uSpikeFreq, this.p.spikeFreq);
    gl.uniform1f(this.uSpikeSharp, this.p.spikeSharp);
    gl.uniform1f(this.uRotSpeed, this.p.rotSpeed);
    gl.uniform1f(this.uBrightness, this.p.brightness);
    gl.uniform1f(this.uFresnelGain, this.p.fresnelGain);

    const opacity = options?.uLayerOpacity ?? options?.opacity ?? this.opacity;
    gl.uniform1f(this.uLayerOpacity, opacity);

    // Invariant: gl.DEPTH_TEST enabled ONLY during FerrofluidLayer.draw()
    // and disabled immediately afterward so 2D layers are unaffected.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);

    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.vbo) gl.deleteBuffer(this.vbo);
      if (this.ibo) gl.deleteBuffer(this.ibo);
    }
    this.gl = null;
    this.program = null;
    this.vao = null;
    this.vbo = null;
    this.ibo = null;
    this.uAspect = null;
    this.uTime = null;
    this.u_sub = null;
    this.u_mid = null;
    this.u_kickEnv = null;
    this.uRadius = null;
    this.uSpikeAmp = null;
    this.uSpikeFreq = null;
    this.uSpikeSharp = null;
    this.uRotSpeed = null;
    this.uBrightness = null;
    this.uFresnelGain = null;
    this.uLayerOpacity = null;
  }
}
