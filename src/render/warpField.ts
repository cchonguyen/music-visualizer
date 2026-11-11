// Warp field pass (Slice 18.2). A small texture of screen displacement, drawn once per frame from the preset's
// operator stack and read by the feedback shader with a single lookup. With no active operator nothing is
// drawn, and the feedback shader skips the lookup, so presets without a stack render exactly as before.
import { PingPong, feedbackFormat } from '../gl/fbo';
import { FULLSCREEN_VERT } from '../gl/shader';
import { getProgramCache } from '../gl/programCache';
import { CURL_FLOW_STYLES, WARP_OP_MAX, WARP_OP_TYPES, type WarpOpType } from '../presets/warpOps';
import type { ParamValue } from '../presets/schema';
import { bindTarget, type RenderTarget } from './layer';
import warpFieldSrc from './shaders/warpField.frag.glsl?raw';

/** One operator with its settings resolved to plain values (links and reactions already applied). */
export interface ResolvedWarpOp {
  type: WarpOpType;
  enabled: boolean;
  values: Record<string, ParamValue>;
}

/** Base field size (Slice 18.2 design: 64 by 36). */
export const WARP_FIELD_WIDTH = 64;
export const WARP_FIELD_HEIGHT = 36;

/** The field gets smaller as the render scale drops, so slower devices pay less. */
export function warpFieldSize(renderScale: number): { width: number; height: number } {
  const factor = renderScale >= 0.9 ? 1 : renderScale >= 0.6 ? 0.75 : 0.5;
  return { width: Math.round(WARP_FIELD_WIDTH * factor), height: Math.round(WARP_FIELD_HEIGHT * factor) };
}

function numberOf(values: Record<string, ParamValue>, key: string, fallback: number): number {
  const v = values[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** True when the operator changes the picture: on, and amount is not 0. */
export function isActiveWarpOp(op: ResolvedWarpOp): boolean {
  return op.enabled && numberOf(op.values, 'amount', 0) !== 0;
}

/** Number of operators that will be drawn (at most WARP_OP_MAX). */
export function activeWarpOpCount(ops: readonly ResolvedWarpOp[]): number {
  let n = 0;
  for (const op of ops) {
    if (n >= WARP_OP_MAX) break;
    if (isActiveWarpOp(op)) n++;
  }
  return n;
}

/** Curl noise's three own settings as the shader reads them: octaves, turbulence, flow style number. */
export function curlExtras(values: Record<string, ParamValue>): [number, number, number] {
  const octaves = Math.max(1, Math.min(3, Math.round(numberOf(values, 'octaves', 2))));
  const turbulence = Math.max(0, Math.min(1, numberOf(values, 'turbulence', 0.45)));
  const flow = Math.max(0, (CURL_FLOW_STYLES as readonly string[]).indexOf(String(values.flow ?? 'plumes')));
  return [octaves, turbulence, flow];
}

export class WarpField {
  private readonly gl: WebGL2RenderingContext;
  private pp: PingPong;
  private prog: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly uni = new Map<string, WebGLUniformLocation | null>();
  // Reused every frame so the draw loop allocates nothing (Slice 16.8).
  private readonly types = new Int32Array(WARP_OP_MAX);
  private readonly amounts = new Float32Array(WARP_OP_MAX);
  private readonly scales = new Float32Array(WARP_OP_MAX);
  private readonly speeds = new Float32Array(WARP_OP_MAX);
  private readonly centres = new Float32Array(WARP_OP_MAX * 2);
  private readonly extras = new Float32Array(WARP_OP_MAX * 3);
  private readonly target: { kind: 'fbo'; framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number };
  private fieldReady = false;

  constructor(gl: WebGL2RenderingContext, vao: WebGLVertexArrayObject, renderScale: number) {
    this.gl = gl;
    this.vao = vao;
    const size = warpFieldSize(renderScale);
    this.pp = new PingPong(gl, size.width, size.height, feedbackFormat(gl));
    this.prog = getProgramCache(gl).acquire(FULLSCREEN_VERT, warpFieldSrc, 'warpField');
    for (const name of ['uOpCount', 'uOpType', 'uOpAmount', 'uOpScale', 'uOpSpeed', 'uOpCentre', 'uOpExtra', 'uHigh', 'uTime', 'uDt', 'uAspect']) {
      this.uni.set(name, gl.getUniformLocation(this.prog, name));
    }
    this.target = { kind: 'fbo', framebuffer: this.pp.write.framebuffer, texture: this.pp.write.texture, width: size.width, height: size.height };
  }

  /** The finished field. Valid after `update` returned true this frame. */
  get texture(): WebGLTexture {
    return this.pp.read.texture;
  }

  /** Resizes the field for the render scale. Same size is a no-op. */
  setRenderScale(renderScale: number): void {
    const size = warpFieldSize(renderScale);
    this.pp.resize(size.width, size.height);
  }

  /**
   * Draws the field for this frame. Returns false, and touches no GPU state, when no operator is active.
   * The caller binds its own target afterwards.
   */
  update(ops: readonly ResolvedWarpOp[], timeSec: number, dtSec: number, aspect: number, high = 0.5): boolean {
    let n = 0;
    for (const op of ops) {
      if (n >= WARP_OP_MAX) break;
      if (!isActiveWarpOp(op)) continue;
      this.types[n] = WARP_OP_TYPES.indexOf(op.type);
      this.amounts[n] = numberOf(op.values, 'amount', 0);
      this.scales[n] = numberOf(op.values, 'scale', 1);
      this.speeds[n] = numberOf(op.values, 'speed', 0);
      this.centres[n * 2] = numberOf(op.values, 'centreX', 0);
      this.centres[n * 2 + 1] = numberOf(op.values, 'centreY', 0);
      if (op.type === 'curl') {
        const [octaves, turbulence, flow] = curlExtras(op.values);
        this.extras[n * 3] = octaves;
        this.extras[n * 3 + 1] = turbulence;
        this.extras[n * 3 + 2] = flow;
      } else {
        this.extras[n * 3] = 0;
        this.extras[n * 3 + 1] = 0;
        this.extras[n * 3 + 2] = 0;
      }
      n++;
    }
    if (n === 0) {
      this.fieldReady = false;
      return false;
    }
    const gl = this.gl;
    const w = this.pp.write;
    const t = this.target;
    t.framebuffer = w.framebuffer;
    t.texture = w.texture;
    t.width = this.pp.width;
    t.height = this.pp.height;
    bindTarget(gl, t as RenderTarget);
    gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    gl.uniform1i(this.uni.get('uOpCount') ?? null, n);
    gl.uniform1iv(this.uni.get('uOpType') ?? null, this.types);
    gl.uniform1fv(this.uni.get('uOpAmount') ?? null, this.amounts);
    gl.uniform1fv(this.uni.get('uOpScale') ?? null, this.scales);
    gl.uniform1fv(this.uni.get('uOpSpeed') ?? null, this.speeds);
    gl.uniform2fv(this.uni.get('uOpCentre') ?? null, this.centres);
    gl.uniform3fv(this.uni.get('uOpExtra') ?? null, this.extras);
    gl.uniform1f(this.uni.get('uHigh') ?? null, high);
    gl.uniform1f(this.uni.get('uTime') ?? null, timeSec);
    gl.uniform1f(this.uni.get('uDt') ?? null, dtSec);
    gl.uniform1f(this.uni.get('uAspect') ?? null, aspect);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.pp.swap();
    this.fieldReady = true;
    return true;
  }

  get ready(): boolean {
    return this.fieldReady;
  }

  dispose(): void {
    getProgramCache(this.gl).release(this.prog);
    this.pp.dispose();
    this.fieldReady = false;
  }
}
