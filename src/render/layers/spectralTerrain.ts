// Spectral Ridge Terrain Layer (Slice 7.13): 64 horizontal ridges rendered back-to-front
// with dark occlusion skirts and glowing peak lines, fed by a private 128x64 history ring buffer on TEXTURE5.
import type { AudioFrame } from '../../audio/types';
import { compileProgram } from '../../gl/shader';
import type { RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import { getPalette, type Palette } from '../palette';
import { getCurrentPalette } from '../paletteStore';
import { computeLogSpectrum } from '../bandTexture';
import vertSrc from '../shaders/spectralTerrain.vert.glsl?raw';
import fragSrc from '../shaders/spectralTerrain.frag.glsl?raw';
import { SPECTRAL_TERRAIN_DEFAULTS, type SpectralTerrainParams } from '../../presets/schema';

export const TERRAIN_BINS = 128;
export const TERRAIN_RIDGES = 64;
export const TERRAIN_HISTORY_UNIT = 5; // TEXTURE5 (never collides with TEXTURE0–4)

export class SpectralTerrainLayer implements RenderLayer {
  private p: SpectralTerrainParams;

  constructor(params: Partial<SpectralTerrainParams> = {}) {
    this.p = { ...SPECTRAL_TERRAIN_DEFAULTS, ...params };
  }

  setParams(params: Partial<SpectralTerrainParams>): void {
    this.p = { ...this.p, ...params };
  }

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;

  private lineVao: WebGLVertexArrayObject | null = null;
  private lineVbo: WebGLBuffer | null = null;
  private skirtVao: WebGLVertexArrayObject | null = null;
  private skirtVbo: WebGLBuffer | null = null;

  private historyTex: WebGLTexture | null = null;
  private headRow = 0;
  private readonly currentBins = new Float32Array(TERRAIN_BINS);

  private uHistoryTex: WebGLUniformLocation | null = null;
  private uHeadRow: WebGLUniformLocation | null = null;
  private uRidgeIndex: WebGLUniformLocation | null = null;
  private uRidgeCount: WebGLUniformLocation | null = null;
  private uElevationScale: WebGLUniformLocation | null = null;
  private uTerrainWidth: WebGLUniformLocation | null = null;
  private uHorizonY: WebGLUniformLocation | null = null;
  private uForegroundY: WebGLUniformLocation | null = null;
  private uAccent: WebGLUniformLocation | null = null;
  private uBase: WebGLUniformLocation | null = null;
  private uBrightness: WebGLUniformLocation | null = null;
  private uIsSkirtPass: WebGLUniformLocation | null = null;

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.program = compileProgram(gl, vertSrc, fragSrc, 'spectralTerrain');

    this.uHistoryTex = gl.getUniformLocation(this.program, 'uHistoryTex');
    this.uHeadRow = gl.getUniformLocation(this.program, 'uHeadRow');
    this.uRidgeIndex = gl.getUniformLocation(this.program, 'uRidgeIndex');
    this.uRidgeCount = gl.getUniformLocation(this.program, 'uRidgeCount');
    this.uElevationScale = gl.getUniformLocation(this.program, 'uElevationScale');
    this.uTerrainWidth = gl.getUniformLocation(this.program, 'uTerrainWidth');
    this.uHorizonY = gl.getUniformLocation(this.program, 'uHorizonY');
    this.uForegroundY = gl.getUniformLocation(this.program, 'uForegroundY');
    this.uAccent = gl.getUniformLocation(this.program, 'uAccent');
    this.uBase = gl.getUniformLocation(this.program, 'uBase');
    this.uBrightness = gl.getUniformLocation(this.program, 'uBrightness');
    this.uIsSkirtPass = gl.getUniformLocation(this.program, 'uIsSkirtPass');

    // 1. Create Line VAO and VBO (128 vertices: vec2(binIndex, 0.0))
    const lineData = new Float32Array(TERRAIN_BINS * 2);
    for (let i = 0; i < TERRAIN_BINS; i++) {
      lineData[i * 2] = i;
      lineData[i * 2 + 1] = 0.0;
    }
    this.lineVao = gl.createVertexArray();
    this.lineVbo = gl.createBuffer();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.bufferData(gl.ARRAY_BUFFER, lineData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);

    // 2. Create Skirt VAO and VBO (256 vertices: pairs of top (binIndex, 0.0) and bottom (binIndex, 1.0))
    const skirtData = new Float32Array(TERRAIN_BINS * 4);
    for (let i = 0; i < TERRAIN_BINS; i++) {
      skirtData[i * 4] = i;
      skirtData[i * 4 + 1] = 0.0;
      skirtData[i * 4 + 2] = i;
      skirtData[i * 4 + 3] = 1.0;
    }
    this.skirtVao = gl.createVertexArray();
    this.skirtVbo = gl.createBuffer();
    gl.bindVertexArray(this.skirtVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skirtVbo);
    gl.bufferData(gl.ARRAY_BUFFER, skirtData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);

    gl.bindVertexArray(null);

    // 3. Create persistent 128x64 R32F ring-buffer texture
    const tex = gl.createTexture();
    if (!tex) throw new Error('SpectralTerrainLayer: failed to create history texture');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      TERRAIN_BINS,
      TERRAIN_RIDGES,
      0,
      gl.RED,
      gl.FLOAT,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.historyTex = tex;
    this.headRow = 0;
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Draws with fixed geometry in target coordinates; no reallocation needed.
  }

  draw(frame: AudioFrame, _clock: RenderClock, target: RenderTarget): void {
    const gl = this.gl;
    if (
      !gl ||
      !this.program ||
      !this.lineVao ||
      !this.skirtVao ||
      !this.historyTex
    ) {
      throw new Error('SpectralTerrainLayer: draw before init');
    }

    bindTarget(gl, target);

    // Compute log spectrum bins for current frame
    computeLogSpectrum(
      frame.spectrum,
      frame.sampleRate,
      TERRAIN_BINS,
      20,
      12000,
      this.currentBins,
    );

    // Update ring-buffer texture at headRow
    gl.bindTexture(gl.TEXTURE_2D, this.historyTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      this.headRow,
      TERRAIN_BINS,
      1,
      gl.RED,
      gl.FLOAT,
      this.currentBins,
      0,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);

    const activeHeadRow = this.headRow;
    this.headRow = (this.headRow + 1) % TERRAIN_RIDGES;

    gl.useProgram(this.program);

    // Bind private history texture strictly to TEXTURE5
    gl.activeTexture(gl.TEXTURE0 + TERRAIN_HISTORY_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.historyTex);
    gl.uniform1i(this.uHistoryTex, TERRAIN_HISTORY_UNIT);
    gl.activeTexture(gl.TEXTURE0);

    // Global uniforms
    gl.uniform1i(this.uHeadRow, activeHeadRow);
    gl.uniform1f(this.uRidgeCount, TERRAIN_RIDGES);
    gl.uniform1f(this.uElevationScale, this.p.elevation);
    gl.uniform1f(this.uTerrainWidth, this.p.width);
    gl.uniform1f(this.uHorizonY, this.p.horizonY);
    gl.uniform1f(this.uForegroundY, this.p.foregroundY);
    gl.uniform1f(this.uBrightness, this.p.brightness);

    const palette: Palette = getPalette(getCurrentPalette());
    gl.uniform3fv(this.uBase, palette.base);
    gl.uniform3fv(this.uAccent, palette.accentA);

    // Enable alpha blending for occlusion skirts and lines
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Draw 64 perspective ridges from back to front (z = 0..63)
    for (let z = 0; z < TERRAIN_RIDGES; z++) {
      gl.uniform1i(this.uRidgeIndex, z);

      // 1. Dark opaque occlusion skirt
      gl.uniform1i(this.uIsSkirtPass, 1);
      gl.bindVertexArray(this.skirtVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, TERRAIN_BINS * 2);

      // 2. Glowing ridge line
      gl.uniform1i(this.uIsSkirtPass, 0);
      gl.bindVertexArray(this.lineVao);
      gl.drawArrays(gl.LINE_STRIP, 0, TERRAIN_BINS);
    }

    gl.bindVertexArray(null);
  }

  getHistoryTexture(): WebGLTexture | null {
    return this.historyTex;
  }

  getHeadRow(): number {
    return this.headRow;
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.lineVao) gl.deleteVertexArray(this.lineVao);
      if (this.lineVbo) gl.deleteBuffer(this.lineVbo);
      if (this.skirtVao) gl.deleteVertexArray(this.skirtVao);
      if (this.skirtVbo) gl.deleteBuffer(this.skirtVbo);
      if (this.historyTex) gl.deleteTexture(this.historyTex);
    }
    this.gl = null;
    this.program = null;
    this.lineVao = null;
    this.lineVbo = null;
    this.skirtVao = null;
    this.skirtVbo = null;
    this.historyTex = null;
  }
}
