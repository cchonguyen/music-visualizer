// Radial crown (Stage 2, P5): the 48 frequency bars drawn around the tunnel's inner rim.
// Heights come from crownStore (set once per frame in main.ts). The centre is the shared
// sway, so the crown moves with the tunnel's vanishing point.
import type { AudioFrame } from '../../audio/types';
import { compileProgram, FULLSCREEN_VERT } from '../../gl/shader';
import { createVao } from '../../gl/vao';
import type { RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import { getCrownHeights } from '../crownStore';
import { getPalette, type Palette } from '../palette';
import { getCurrentPalette } from '../paletteStore';
import { blendAccents } from '../colourSwap';
import { getSway } from '../swayStore';
import fragSrc from '../shaders/crown.frag.glsl?raw';
import { CROWN_DEFAULTS, type CrownParams } from '../../presets/layerSchemas';
import { BandTexture } from '../bandTexture';

/** First texture unit for the band textures (sub, mid, high take the next two). */
const BAND_UNIT = 1;

export class CrownLayer implements RenderLayer {
  /** Accent swap mix from ColourSwap (0 = normal, 1 = A and B exchanged). */
  accentSwap = 0;
  /** Settings (slice 4.2). Read every frame. */
  private p: CrownParams;

  constructor(params: Partial<CrownParams> = {}) {
    this.p = { ...CROWN_DEFAULTS, ...params };
  }

  setParams(params: Partial<CrownParams>): void {
    this.p = { ...this.p, ...params };
  }

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uRes: WebGLUniformLocation | null = null;
  private uCentre: WebGLUniformLocation | null = null;
  private uHeights: WebGLUniformLocation | null = null;
  private uAccent: WebGLUniformLocation | null = null;
  private uTexOn: WebGLUniformLocation | null = null;
  private uTexGain: WebGLUniformLocation | null = null;
  private uTexMid: WebGLUniformLocation | null = null;
  private uLayerOpacity: WebGLUniformLocation | null = null;
  private readonly band = new BandTexture();

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction: never reuse GL objects from before a context restore.
    this.gl = gl;
    this.program = compileProgram(gl, FULLSCREEN_VERT, fragSrc, 'crown');
    this.uRes = gl.getUniformLocation(this.program, 'uRes');
    this.uCentre = gl.getUniformLocation(this.program, 'uCentre');
    this.uHeights = gl.getUniformLocation(this.program, 'uHeights[0]');
    this.uAccent = gl.getUniformLocation(this.program, 'uAccent');
    this.uTexOn = gl.getUniformLocation(this.program, 'uTexOn');
    this.uTexGain = gl.getUniformLocation(this.program, 'uTexGain');
    this.uTexMid = gl.getUniformLocation(this.program, 'uTexMid');
    this.uLayerOpacity = gl.getUniformLocation(this.program, 'uLayerOpacity');
    this.band.init(gl);
    this.vao = createVao(gl);
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Draws at the host's target size; nothing to reallocate.
  }

  draw(
    frame: AudioFrame,
    _clock: RenderClock,
    target: RenderTarget,
    options?: { opacity?: number; uLayerOpacity?: number },
  ): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('CrownLayer: draw before init');

    bindTarget(gl, target);

    const palette: Palette = getPalette(getCurrentPalette());
    const accent = blendAccents(palette.accentA, palette.accentB, this.accentSwap).a;
    // Sway (uv units) to aspect-corrected clip units: x times 2 times aspect, y times 2.
    const aspect = target.width / target.height;
    const sway = getSway();

    gl.useProgram(this.program);
    // Uniforms must follow useProgram, or the calls are an invalid operation.
    gl.uniform2f(this.uRes, target.width, target.height);
    gl.uniform2f(this.uCentre, 2 * sway.x * aspect * this.p.rimFactor, 2 * sway.y * this.p.rimFactor);
    gl.uniform1fv(this.uHeights, getCrownHeights());
    gl.uniform3f(this.uAccent, accent[0], accent[1], accent[2]);
    const layerOpacity = options?.uLayerOpacity ?? options?.opacity ?? 1.0;
    gl.uniform1f(this.uLayerOpacity, layerOpacity);
    // Band texture (6.4): always bound so the sampler has a valid texture; updated only when on.
    gl.uniform1f(this.uTexOn, this.p.texture ? 1 : 0);
    gl.uniform1f(this.uTexGain, this.p.textureGain);
    if (this.p.texture) this.band.update(gl, frame.bandWaveforms);
    const texUnit = this.band.bind(gl, BAND_UNIT);
    gl.uniform1i(this.uTexMid, texUnit + 1);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.vao) gl.deleteVertexArray(this.vao);
      this.band.dispose(gl);
    }
    this.program = null;
    this.vao = null;
    this.uRes = null;
    this.uCentre = null;
    this.uHeights = null;
    this.uAccent = null;
    this.uTexOn = null;
    this.uTexGain = null;
    this.uTexMid = null;
    this.uLayerOpacity = null;
    this.gl = null;
  }
}
