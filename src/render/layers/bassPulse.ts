// Tracer visual: full-screen gray level driven by the absolute sub-bass envelope.
// Band texture (6.4): sub by angle sets the pulse brightness.
import type { AudioFrame } from '../../audio/types';
import { compileProgram, FULLSCREEN_VERT } from '../../gl/shader';
import type { RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import { BASS_PULSE_DEFAULTS, type BassPulseParams } from '../../presets/layerSchemas';
import { BandTexture } from '../bandTexture';

/** First texture unit for the band textures (sub, mid, high take the next two). */
const BAND_UNIT = 1;

const fragSrc = `#version 300 es
precision highp float;

uniform float uSub;   // env.sub, 0..1 (absolute level, not normalized)
uniform float uAlpha; // crossfade alpha from GlHost
uniform float uLayerOpacity;
uniform float uAspect; // target width / height (6.4: angle for the texture)
uniform float uTexOn;      // 1 = band texture on (6.4), 0 = off: output identical to before
uniform float uTexGain;    // 0..2: how strongly the band texture modulates
uniform sampler2D uTexSub; // sub-band row, sampled by angle (pulse brightness)

in vec2 vUv;
out vec4 outColor;

const float TAU = 6.2831853;

void main() {
  // 0.06 floor keeps the tracer dim, never black; the 0.25 span keeps the
  // brightness change well under the WCAG flash limit.
  float g = 0.06 + 0.25 * clamp(uSub, 0.0, 1.0);
  // Band texture (6.4): sub by angle scales the pulse brightness (1.0 when off).
  if (uTexOn > 0.5) {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    float subS = texture(uTexSub, vec2(atan(p.y, p.x) / TAU + 0.5, 0.5)).r;
    g *= max(0.0, 1.0 + uTexGain * (subS - 0.5));
  }
  g = min(g, 1.0);
  vec3 col = vec3(g);
  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0) * uLayerOpacity;
  col *= uLayerOpacity;
  outColor = vec4(col, a);
}
`;

export class BassPulseLayer implements RenderLayer {
  /** Settings (6.4). Read every frame. */
  private p: BassPulseParams;

  constructor(params: Partial<BassPulseParams> = {}) {
    this.p = { ...BASS_PULSE_DEFAULTS, ...params };
  }

  setParams(params: Partial<BassPulseParams>): void {
    this.p = { ...this.p, ...params };
  }

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uSub: WebGLUniformLocation | null = null;
  private uAlpha: WebGLUniformLocation | null = null;
  private uLayerOpacity: WebGLUniformLocation | null = null;
  private uAspect: WebGLUniformLocation | null = null;
  private uTexOn: WebGLUniformLocation | null = null;
  private uTexGain: WebGLUniformLocation | null = null;
  private uTexSub: WebGLUniformLocation | null = null;
  private readonly band = new BandTexture();

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction: never reuse GL objects from before a context restore.
    this.gl = gl;
    this.program = compileProgram(gl, FULLSCREEN_VERT, fragSrc, 'bassPulse');
    this.uSub = gl.getUniformLocation(this.program, 'uSub');
    this.uAlpha = gl.getUniformLocation(this.program, 'uAlpha');
    this.uLayerOpacity = gl.getUniformLocation(this.program, 'uLayerOpacity');
    this.uAspect = gl.getUniformLocation(this.program, 'uAspect');
    this.uTexOn = gl.getUniformLocation(this.program, 'uTexOn');
    this.uTexGain = gl.getUniformLocation(this.program, 'uTexGain');
    this.uTexSub = gl.getUniformLocation(this.program, 'uTexSub');
    this.band.init(gl);
    // Empty VAO: the full-screen triangle comes from gl_VertexID, no buffers.
    this.vao = gl.createVertexArray();
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
    if (!gl || !this.program || !this.vao) throw new Error('BassPulseLayer: draw before init');

    bindTarget(gl, target);

    const layerOpacity = options?.uLayerOpacity ?? options?.opacity ?? 1.0;
    gl.useProgram(this.program);
    gl.uniform1f(this.uSub, frame.env.sub);
    gl.uniform1f(this.uAlpha, layerOpacity); // layer opacity (crossfades happen in the compositor)
    gl.uniform1f(this.uLayerOpacity, layerOpacity);
    gl.uniform1f(this.uAspect, target.width / Math.max(target.height, 1));
    // Band texture (6.4): always bound so the sampler has a valid texture; updated only when on.
    gl.uniform1f(this.uTexOn, this.p.texture ? 1 : 0);
    gl.uniform1f(this.uTexGain, this.p.textureGain);
    if (this.p.texture) this.band.update(gl, frame.bandWaveforms);
    const texUnit = this.band.bind(gl, BAND_UNIT);
    gl.uniform1i(this.uTexSub, texUnit);
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
    this.uSub = null;
    this.uAlpha = null;
    this.uLayerOpacity = null;
    this.uAspect = null;
    this.uTexOn = null;
    this.uTexGain = null;
    this.uTexSub = null;
    this.gl = null;
  }
}
