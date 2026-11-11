// Spectral Ridge Terrain Layer (Slice 7.13, Slice 7.26): 64 horizontal ridges rendered back-to-front
// with dark occlusion skirts (gl.FUNC_ADD), glowing peak quad strip ribbons (lineThickness),
// 3D longitudinal perspective grid lines (gridCols), layout modes, ridge shapes, and cyan-to-magenta gradient,
// fed by a private 128x64 history ring buffer on TEXTURE5.
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
import { setTerrainState } from '../terrainStore';

export const TERRAIN_BINS = 128;
export const TERRAIN_RIDGES = 64;
export const TERRAIN_HISTORY_UNIT = 5; // TEXTURE5 (never collides with TEXTURE0–4)
const MAX_GRID_COLS = 32;

const RIDGE_SHAPES: Record<string, number> = {
  smooth: 0,
  rounded: 1,
  pointed: 2,
  stepped: 3,
};

const LAYOUT_MODES: Record<string, number> = {
  fullHorizon: 0,
  centerPeak: 1,
  canyon: 2,
};

/** Vertices in one skirt strip (a top and a bottom vertex per bin). */
const SKIRT_VERTS = TERRAIN_BINS * 2;
/** Vertices per ridge instance: skirt, two joining vertices, ribbon. */
export const RIDGE_VERTS = SKIRT_VERTS * 2 + 2;

export class SpectralTerrainLayer implements RenderLayer {
  private p: SpectralTerrainParams;

  constructor(params: Partial<SpectralTerrainParams> = {}) {
    this.p = { ...SPECTRAL_TERRAIN_DEFAULTS, skirtOpacity: 0.15, ...params };
  }

  setParams(params: Partial<SpectralTerrainParams>): void {
    this.p = { ...this.p, ...params };
  }

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;

  private lineVao: WebGLVertexArrayObject | null = null;
  private lineVbo: WebGLBuffer | null = null;
  // One instanced strip per ridge: skirt, two degenerate vertices, then the line ribbon (Slice 16.10).
  private ridgeVao: WebGLVertexArrayObject | null = null;
  private ridgeVbo: WebGLBuffer | null = null;

  private historyTex: WebGLTexture | null = null;
  private headRow = 0;
  private lastWriteRow = 0;

  get writeRow(): number {
    return this.lastWriteRow;
  }
  private readonly currentBins = new Float32Array(TERRAIN_BINS);

  private uHistoryTex: WebGLUniformLocation | null = null;
  private uHeadRow: WebGLUniformLocation | null = null;
  private uRidgeCount: WebGLUniformLocation | null = null;
  private uElevationScale: WebGLUniformLocation | null = null;
  private uTerrainWidth: WebGLUniformLocation | null = null;
  private uHorizonY: WebGLUniformLocation | null = null;
  private uForegroundY: WebGLUniformLocation | null = null;
  private uAccent: WebGLUniformLocation | null = null;
  private uBase: WebGLUniformLocation | null = null;
  private uBrightness: WebGLUniformLocation | null = null;
  private uIsSkirtPass: WebGLUniformLocation | null = null;
  private uLineThickness: WebGLUniformLocation | null = null;
  private uRidgeShape: WebGLUniformLocation | null = null;
  private uLayoutMode: WebGLUniformLocation | null = null;
  private uSkirtOpacity: WebGLUniformLocation | null = null;
  private uColorSpread: WebGLUniformLocation | null = null;
  private uInvertColors: WebGLUniformLocation | null = null;
  private uLayerOpacity: WebGLUniformLocation | null = null;
  private uColorA: WebGLUniformLocation | null = null;
  private uColorB: WebGLUniformLocation | null = null;

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.program = compileProgram(gl, vertSrc, fragSrc, 'spectralTerrain');

    this.uHistoryTex = gl.getUniformLocation(this.program, 'uHistoryTex');
    this.uHeadRow = gl.getUniformLocation(this.program, 'uHeadRow');
    this.uRidgeCount = gl.getUniformLocation(this.program, 'uRidgeCount');
    this.uElevationScale = gl.getUniformLocation(this.program, 'uElevationScale');
    this.uTerrainWidth = gl.getUniformLocation(this.program, 'uTerrainWidth');
    this.uHorizonY = gl.getUniformLocation(this.program, 'uHorizonY');
    this.uForegroundY = gl.getUniformLocation(this.program, 'uForegroundY');
    this.uAccent = gl.getUniformLocation(this.program, 'uAccent');
    this.uBase = gl.getUniformLocation(this.program, 'uBase');
    this.uBrightness = gl.getUniformLocation(this.program, 'uBrightness');
    this.uIsSkirtPass = gl.getUniformLocation(this.program, 'uIsSkirtPass');
    this.uLineThickness = gl.getUniformLocation(this.program, 'uLineThickness');
    this.uRidgeShape = gl.getUniformLocation(this.program, 'uRidgeShape');
    this.uLayoutMode = gl.getUniformLocation(this.program, 'uLayoutMode');
    this.uSkirtOpacity = gl.getUniformLocation(this.program, 'uSkirtOpacity');
    this.uColorSpread = gl.getUniformLocation(this.program, 'uColorSpread');
    this.uInvertColors = gl.getUniformLocation(this.program, 'uInvertColors');
    this.uLayerOpacity = gl.getUniformLocation(this.program, 'uLayerOpacity');
    this.uColorA = gl.getUniformLocation(this.program, 'uColorA');
    this.uColorB = gl.getUniformLocation(this.program, 'uColorB');

    // 1. Create Line VAO and VBO:
    // Vertices 0..127: horizontal line vec2(binIndex, 0.0)
    // Vertices 128..2175: 32 longitudinal grid lines connecting 64 rows vec2(colBin, rowIdx)
    const lineData = new Float32Array((TERRAIN_BINS + MAX_GRID_COLS * TERRAIN_RIDGES) * 2);
    for (let i = 0; i < TERRAIN_BINS; i++) {
      lineData[i * 2] = i;
      lineData[i * 2 + 1] = 0.0;
    }
    let offset = TERRAIN_BINS * 2;
    for (let c = 0; c < MAX_GRID_COLS; c++) {
      const colBin = Math.round((c * (TERRAIN_BINS - 1)) / (MAX_GRID_COLS - 1));
      for (let r = 0; r < TERRAIN_RIDGES; r++) {
        lineData[offset++] = colBin;
        lineData[offset++] = r;
      }
    }

    this.lineVao = gl.createVertexArray();
    this.lineVbo = gl.createBuffer();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.bufferData(gl.ARRAY_BUFFER, lineData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);

    // 2. Create the ridge VAO and VBO. Per instance (one ridge): vertices 0..255 are the occlusion skirt strip
    // (pairs of top (binIndex, 0.0) and bottom (binIndex, 1.0)); vertex 256 repeats the last skirt vertex and
    // vertex 257 repeats the first ribbon vertex, so the two strips join through zero-area triangles; vertices
    // 258..513 are the line ribbon (same pairs, offset up and down by the line thickness in the shader).
    const pairs = new Float32Array(TERRAIN_BINS * 4);
    for (let i = 0; i < TERRAIN_BINS; i++) {
      pairs[i * 4] = i;
      pairs[i * 4 + 1] = 0.0;
      pairs[i * 4 + 2] = i;
      pairs[i * 4 + 3] = 1.0;
    }
    const ridgeData = new Float32Array((RIDGE_VERTS) * 2);
    ridgeData.set(pairs, 0);
    ridgeData.set([TERRAIN_BINS - 1, 1.0], SKIRT_VERTS * 2); // vertex 256: repeat last skirt vertex
    ridgeData.set([0, 0.0], (SKIRT_VERTS + 1) * 2); // vertex 257: repeat first ribbon vertex
    ridgeData.set(pairs, (SKIRT_VERTS + 2) * 2);
    this.ridgeVao = gl.createVertexArray();
    this.ridgeVbo = gl.createBuffer();
    gl.bindVertexArray(this.ridgeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ridgeVbo);
    gl.bufferData(gl.ARRAY_BUFFER, ridgeData, gl.STATIC_DRAW);
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

  private updateHistoryTexture(gl: WebGL2RenderingContext): void {
    gl.activeTexture(gl.TEXTURE0 + TERRAIN_HISTORY_UNIT);
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
    gl.activeTexture(gl.TEXTURE0);
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Draws with fixed geometry in target coordinates; no reallocation needed.
  }

  draw(
    frame: AudioFrame,
    _clock: RenderClock,
    target: RenderTarget,
    options?: { opacity?: number; uLayerOpacity?: number },
  ): void {
    const gl = this.gl;
    if (
      !gl ||
      !this.program ||
      !this.lineVao ||
      !this.ridgeVao ||
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

    // Update ring-buffer texture at headRow on TEXTURE5 (never unbind unit 0)
    this.updateHistoryTexture(gl);

    const activeHeadRow = this.headRow;
    this.lastWriteRow = activeHeadRow;
    this.headRow = (this.headRow + 1) % TERRAIN_RIDGES;

    setTerrainState(gl, {
      active: true,
      historyTex: this.historyTex,
      writeRow: this.writeRow,
      rows: 64,
      terrainFlow: this.p.terrainFlow ?? 0.35,
    });

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

    const lineThickness = this.p.lineThickness ?? SPECTRAL_TERRAIN_DEFAULTS.lineThickness;
    gl.uniform1f(this.uLineThickness, lineThickness);

    const ridgeShapeInt = RIDGE_SHAPES[this.p.ridgeShape ?? 'smooth'] ?? 0;
    gl.uniform1i(this.uRidgeShape, ridgeShapeInt);

    const layoutModeInt = LAYOUT_MODES[this.p.layoutMode ?? 'fullHorizon'] ?? 0;
    gl.uniform1i(this.uLayoutMode, layoutModeInt);

    const skirtOpacity = this.p.skirtOpacity ?? 0.15;
    gl.uniform1f(this.uSkirtOpacity, skirtOpacity);

    const colorSpread = this.p.colorSpread ?? SPECTRAL_TERRAIN_DEFAULTS.colorSpread;
    gl.uniform1f(this.uColorSpread, colorSpread);

    const invertColors = this.p.invertColors ? 1 : 0;
    gl.uniform1i(this.uInvertColors, invertColors);

    const layerOpacity = options?.uLayerOpacity ?? options?.opacity ?? 1.0;
    gl.uniform1f(this.uLayerOpacity, layerOpacity);

    const palette: Palette = getPalette(getCurrentPalette());
    gl.uniform3fv(this.uBase, palette.base);
    gl.uniform3fv(this.uAccent, palette.accentA);
    gl.uniform3fv(this.uColorA, palette.accentA);
    gl.uniform3fv(this.uColorB, palette.accentB);

    // One blend function for everything: the skirt outputs its colour with its alpha, and lines output colour times
    // alpha with alpha 0, which makes ONE, ONE_MINUS_SRC_ALPHA add the line colour exactly as SRC_ALPHA, ONE did.
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // All 64 ridges in one instanced call, drawn in instance order (0 = back ... 63 = front), each ridge as
    // its skirt and then its line, so a front skirt still hides the lines behind it.
    gl.uniform1i(this.uIsSkirtPass, 0);
    gl.bindVertexArray(this.ridgeVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, RIDGE_VERTS, TERRAIN_RIDGES);

    // 3. Draw 3D front-to-back longitudinal perspective lines connecting the 64 rows
    const gridCols = Math.min(MAX_GRID_COLS, Math.max(0, this.p.gridCols ?? SPECTRAL_TERRAIN_DEFAULTS.gridCols));
    if (gridCols > 0) {
      gl.uniform1i(this.uIsSkirtPass, 2);
      gl.bindVertexArray(this.lineVao);
      for (let c = 0; c < gridCols; c++) {
        gl.drawArrays(gl.LINE_STRIP, TERRAIN_BINS + c * TERRAIN_RIDGES, TERRAIN_RIDGES);
      }
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
      if (this.ridgeVao) gl.deleteVertexArray(this.ridgeVao);
      if (this.ridgeVbo) gl.deleteBuffer(this.ridgeVbo);
      if (this.historyTex) gl.deleteTexture(this.historyTex);
    }
    this.gl = null;
    this.program = null;
    this.lineVao = null;
    this.lineVbo = null;
    this.ridgeVao = null;
    this.ridgeVbo = null;
    this.historyTex = null;
  }
}
