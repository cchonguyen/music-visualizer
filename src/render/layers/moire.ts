// Moiré Layer (Slice 7.13, Slice 7.25): Procedural moiré interference shader generating
// dual concentric/wave grids with analytical fwidth() anti-aliasing and smoothed XOR,
// 4 Loom pattern modes, bass center sweep, kick ripple, contrast, waveShape, two-tone color,
// and stencil alpha transparency.
import type { AudioFrame } from '../../audio/types';
import { compileProgram, FULLSCREEN_VERT } from '../../gl/shader';
import { createVao } from '../../gl/vao';
import type { RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import { getPalette, type Palette } from '../palette';
import { getCurrentPalette } from '../paletteStore';
import fragSrc from '../shaders/moire.frag.glsl?raw';
import { MOIRE_DEFAULTS, type MoireParams } from '../../presets/schema';

const PATTERN_MODES: Record<string, number> = {
  starburstLoom: 0,
  twinCircles: 1,
  doubleSpirals: 2,
  warpedCrossGrid: 3,
};

export class MoireLayer implements RenderLayer {
  private p: MoireParams;

  constructor(params: Partial<MoireParams> = {}) {
    this.p = { ...MOIRE_DEFAULTS, ...params };
  }

  setParams(params: Partial<MoireParams>): void {
    this.p = { ...this.p, ...params };
  }

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  private uRes: WebGLUniformLocation | null = null;
  private uTime: WebGLUniformLocation | null = null;
  private u_mid: WebGLUniformLocation | null = null;
  private u_sub: WebGLUniformLocation | null = null;
  private u_kickEnv: WebGLUniformLocation | null = null;
  private uKickEnv: WebGLUniformLocation | null = null;
  private uScale: WebGLUniformLocation | null = null;
  private uSpeed: WebGLUniformLocation | null = null;
  private uLineWidth: WebGLUniformLocation | null = null;
  private uBrightness: WebGLUniformLocation | null = null;
  private uBase: WebGLUniformLocation | null = null;
  private uAccent: WebGLUniformLocation | null = null;
  private uColorA: WebGLUniformLocation | null = null;
  private uColorB: WebGLUniformLocation | null = null;
  private uContrast: WebGLUniformLocation | null = null;
  private uWaveShape: WebGLUniformLocation | null = null;
  private uColorSpread: WebGLUniformLocation | null = null;
  private uPatternMode: WebGLUniformLocation | null = null;
  private uAudioWarp: WebGLUniformLocation | null = null;
  private uLayerOpacity: WebGLUniformLocation | null = null;

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.program = compileProgram(gl, FULLSCREEN_VERT, fragSrc, 'moire');
    this.uRes = gl.getUniformLocation(this.program, 'uRes');
    this.uTime = gl.getUniformLocation(this.program, 'uTime');
    this.u_mid = gl.getUniformLocation(this.program, 'u_mid');
    this.u_sub = gl.getUniformLocation(this.program, 'u_sub');
    this.u_kickEnv = gl.getUniformLocation(this.program, 'u_kickEnv');
    this.uKickEnv = gl.getUniformLocation(this.program, 'uKickEnv');
    this.uScale = gl.getUniformLocation(this.program, 'uScale');
    this.uSpeed = gl.getUniformLocation(this.program, 'uSpeed');
    this.uLineWidth = gl.getUniformLocation(this.program, 'uLineWidth');
    this.uBrightness = gl.getUniformLocation(this.program, 'uBrightness');
    this.uBase = gl.getUniformLocation(this.program, 'uBase');
    this.uAccent = gl.getUniformLocation(this.program, 'uAccent');
    this.uColorA = gl.getUniformLocation(this.program, 'uColorA');
    this.uColorB = gl.getUniformLocation(this.program, 'uColorB');
    this.uContrast = gl.getUniformLocation(this.program, 'uContrast');
    this.uWaveShape = gl.getUniformLocation(this.program, 'uWaveShape');
    this.uColorSpread = gl.getUniformLocation(this.program, 'uColorSpread');
    this.uPatternMode = gl.getUniformLocation(this.program, 'uPatternMode');
    this.uAudioWarp = gl.getUniformLocation(this.program, 'uAudioWarp');
    this.uLayerOpacity = gl.getUniformLocation(this.program, 'uLayerOpacity');
    this.vao = createVao(gl);
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Fullscreen procedural pass; uses target dimensions directly.
  }

  draw(
    frame: AudioFrame,
    clock: RenderClock,
    target: RenderTarget,
    options?: { opacity?: number; uLayerOpacity?: number },
  ): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('MoireLayer: draw before init');

    bindTarget(gl, target);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.uniform2f(this.uRes, target.width, target.height);
    gl.uniform1f(this.uTime, clock.timeSec);

    const midVal = frame.norm?.mid ?? 0.0;
    const subVal = frame.norm?.sub ?? 0.0;
    const kickEnvVal = frame.kickEnv ?? 0.0;

    gl.uniform1f(this.u_mid, midVal);
    gl.uniform1f(this.u_sub, subVal);
    gl.uniform1f(this.u_kickEnv, kickEnvVal);
    gl.uniform1f(this.uKickEnv, kickEnvVal);

    gl.uniform1f(this.uScale, this.p.scale);
    gl.uniform1f(this.uSpeed, this.p.speed);
    gl.uniform1f(this.uLineWidth, this.p.lineWidth);
    gl.uniform1f(this.uBrightness, this.p.brightness);

    const palette: Palette = getPalette(getCurrentPalette());
    gl.uniform3fv(this.uBase, palette.base);
    gl.uniform3fv(this.uAccent, palette.accentA);
    gl.uniform3fv(this.uColorA, palette.accentA);
    gl.uniform3fv(this.uColorB, palette.accentB);

    gl.uniform1f(this.uContrast, this.p.contrast ?? MOIRE_DEFAULTS.contrast);
    gl.uniform1f(this.uWaveShape, this.p.waveShape ?? MOIRE_DEFAULTS.waveShape);
    gl.uniform1f(this.uColorSpread, this.p.colorSpread ?? MOIRE_DEFAULTS.colorSpread);
    gl.uniform1f(this.uAudioWarp, this.p.audioWarp ?? MOIRE_DEFAULTS.audioWarp);

    const modeInt = PATTERN_MODES[this.p.patternMode ?? 'starburstLoom'] ?? 0;
    gl.uniform1i(this.uPatternMode, modeInt);

    const layerOpacity = options?.uLayerOpacity ?? options?.opacity ?? 1.0;
    gl.uniform1f(this.uLayerOpacity, layerOpacity);

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
  }
}
