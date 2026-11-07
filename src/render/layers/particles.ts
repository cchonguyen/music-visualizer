// Treble sparkle particles (Stage 2, slice 2.5). A fixed pool of quads streams
// outward from the vanishing point. Density rises with energy; the sparkle
// follows a CPU flash envelope on the high band, never the one-frame flag.
import type { AudioFrame } from '../../audio/types';
import { compileProgram } from '../../gl/shader';
import { createVao } from '../../gl/vao';
import { Phase, type RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import { getPalette, type Palette } from '../palette';
import { getCurrentPalette } from '../paletteStore';
import fragSrc from '../shaders/particles.frag.glsl?raw';
import vertSrc from '../shaders/particles.vert.glsl?raw';
import { highFlash, POOL_SIZE } from '../particleState';
import { getSway } from '../swayStore';
import { getCrownHeights } from '../crownStore';
import { blendAccents } from '../colourSwap';
import { getVisualGain } from '../gainStore';
import { BandTexture } from '../bandTexture';

import { PARTICLE_DEFAULTS, type ParticleParams } from '../../presets/layerSchemas';
import { getSceneTransform } from '../sceneTransformStore';

const PARTICLE_SHAPES = ['streak', 'dot', 'star', 'ring'];
/** First texture unit for the band textures (sub, mid, high take the next two). */
const BAND_UNIT = 1;

const CALM_PHASE_RATE = 0.2;
const BASE_PHASE_RATE = 0.2;
const ENERGY_PHASE_RATE = 0.8;

export class ParticleLayer implements RenderLayer {
  opacity = 1.0;
  /** Calm mode: no energy-driven density, dimmer sparkle. */
  calm = false;
  /** Section contrast (P4): negative slows the particle stream, positive speeds it up. Ignored in calm. */
  sectionContrast = 0;
  /** Accent swap mix from ColourSwap (P4): 0 = normal, 1 = A and B exchanged. */
  accentSwap = 0;
  /** Settings (slice 4.2). Read every frame. */
  private p: ParticleParams;

  constructor(params: Partial<ParticleParams> = {}) {
    this.p = { ...PARTICLE_DEFAULTS, ...params };
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity;
  }

  setParams(params: Partial<ParticleParams>): void {
    this.p = { ...this.p, ...params };
  }

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uPhase: WebGLUniformLocation | null = null;
  private uAspect: WebGLUniformLocation | null = null;
  private uAccent: WebGLUniformLocation | null = null;
  private uAccentA: WebGLUniformLocation | null = null;
  private uSwirl: WebGLUniformLocation | null = null;
  private uSway: WebGLUniformLocation | null = null;
  private uSparkle: WebGLUniformLocation | null = null;
  private uBrightness: WebGLUniformLocation | null = null;
  private uEnergy: WebGLUniformLocation | null = null;
  private uTwinkleTime: WebGLUniformLocation | null = null;
  private uCrown: WebGLUniformLocation | null = null;
  private uShape: WebGLUniformLocation | null = null;
  private uRotation: WebGLUniformLocation | null = null;
  private uZoom: WebGLUniformLocation | null = null;
  private uFar: WebGLUniformLocation | null = null;
  private uSize: WebGLUniformLocation | null = null;
  private uFollow: WebGLUniformLocation | null = null;
  private uCentre: WebGLUniformLocation | null = null;
  private uStretch: WebGLUniformLocation | null = null;
  private uWarp: WebGLUniformLocation | null = null;
  private uWarpScale: WebGLUniformLocation | null = null;
  private uWarpSpeed: WebGLUniformLocation | null = null;
  private uTime: WebGLUniformLocation | null = null;
  private uHue: WebGLUniformLocation | null = null;
  private uTexOn: WebGLUniformLocation | null = null;
  private uTexGain: WebGLUniformLocation | null = null;
  private uTexHigh: WebGLUniformLocation | null = null;
  private readonly band = new BandTexture();

  /** Hue drift clock (turns). Advances by hueDrift per second; wrapped to 0..1 when sent to the shader. */
  private hueTurns = 0;

  private paletteName: string = getCurrentPalette();
  private readonly phase = new Phase();
  // Twinkle clock: advances at 1 per second (real time), so twinkle rate is in rad/s.
  private readonly twinkle = new Phase();
  private flash = 0;

  setPalette(name: string): void {
    this.paletteName = name;
  }

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction: never reuse GL objects from before a context restore.
    this.gl = gl;
    this.program = compileProgram(gl, vertSrc, fragSrc, 'particles');
    this.uPhase = gl.getUniformLocation(this.program, 'uPhase');
    this.uAspect = gl.getUniformLocation(this.program, 'uAspect');
    this.uAccent = gl.getUniformLocation(this.program, 'uAccent');
    this.uAccentA = gl.getUniformLocation(this.program, 'uAccentA');
    this.uSwirl = gl.getUniformLocation(this.program, 'uSwirl');
    this.uSway = gl.getUniformLocation(this.program, 'uSway');
    this.uSparkle = gl.getUniformLocation(this.program, 'uSparkle');
    this.uBrightness = gl.getUniformLocation(this.program, 'uBrightness');
    this.uEnergy = gl.getUniformLocation(this.program, 'uEnergy');
    this.uTwinkleTime = gl.getUniformLocation(this.program, 'uTwinkleTime');
    this.uCrown = gl.getUniformLocation(this.program, 'uCrown[0]');
    this.uShape = gl.getUniformLocation(this.program, 'uShape');
    this.uRotation = gl.getUniformLocation(this.program, 'uRotation');
    this.uZoom = gl.getUniformLocation(this.program, 'uZoom');
    this.uFar = gl.getUniformLocation(this.program, 'uFar');
    this.uSize = gl.getUniformLocation(this.program, 'uSize');
    this.uFollow = gl.getUniformLocation(this.program, 'uFollow');
    this.uCentre = gl.getUniformLocation(this.program, 'uCentre');
    this.uStretch = gl.getUniformLocation(this.program, 'uStretch');
    this.uWarp = gl.getUniformLocation(this.program, 'uWarp');
    this.uWarpScale = gl.getUniformLocation(this.program, 'uWarpScale');
    this.uWarpSpeed = gl.getUniformLocation(this.program, 'uWarpSpeed');
    this.uTime = gl.getUniformLocation(this.program, 'uTime');
    this.uHue = gl.getUniformLocation(this.program, 'uHue');
    this.uTexOn = gl.getUniformLocation(this.program, 'uTexOn');
    this.uTexGain = gl.getUniformLocation(this.program, 'uTexGain');
    this.uTexHigh = gl.getUniformLocation(this.program, 'uTexHigh');
    this.band.init(gl);
    this.phase.reset();
    this.twinkle.reset();
    this.flash = 0;
    this.vao = createVao(gl);
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Draws at the host's target size; nothing to reallocate.
  }

  draw(frame: AudioFrame, clock: RenderClock, target: RenderTarget, options?: { opacity?: number; uLayerOpacity?: number }): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('ParticleLayer: draw before init');

    bindTarget(gl, target);

    // Flash envelope: instant attack on a high-band onset, 320 ms shared release (C2).
    // Not governed (patch 2026-11-04): a sparkle covers under 1% of the screen, so it
    // does not use the flash budget and cannot block a kick shockwave.
    this.flash = highFlash(this.flash, frame.beatByBand.high, clock.dtSec);

    // Density rises with energy only in loud sections; phase never decreases.
    const section = this.calm ? 1 : Math.max(0, 1 + this.sectionContrast);
    const rate = this.calm
      ? CALM_PHASE_RATE * getVisualGain()
      : (BASE_PHASE_RATE + ENERGY_PHASE_RATE * frame.energy) * section;
    const phase = this.phase.advance(clock.dtSec, rate);
    // Calm slows the motion, but the twinkle keeps real time (only its brightness is dimmed).
    const twinkleTime = this.twinkle.advance(clock.dtSec, 1);
    // Hue drift (4.8): the clock only moves forward; the shader gets shift + drift wrapped to 0..1.
    this.hueTurns += this.p.hueDrift * Math.max(0, clock.dtSec);

    // norm.high (track-relative): raw treble is often under 0.3 on real music, so env.high barely lit the particles.
    // Hi-hat flashes add only a little sparkle (flashSparkleScale), so the scene doesn't strobe on every hit.
    let sparkle = clamp01(frame.norm.high + this.flash * this.p.flashSparkleScale);
    if (this.calm) sparkle *= this.p.calmSparkleScale;

    const palette: Palette = getPalette(this.paletteName);
    const accents = blendAccents(palette.accentA, palette.accentB, this.accentSwap);

    // Follow scene transform (2026-11-06): read once per frame, used by the uniforms below.
    const follow = this.p.followScene;
    const scene = getSceneTransform();
    gl.useProgram(this.program);
    // Uniforms must follow useProgram, or the calls are an invalid operation.
    gl.uniform1f(this.uPhase, phase);
    gl.uniform1f(this.uAspect, target.width / target.height);
    gl.uniform3f(this.uAccent, accents.b[0], accents.b[1], accents.b[2]);
    gl.uniform3f(this.uAccentA, accents.a[0], accents.a[1], accents.a[2]);
    // Midrange drives a swirl, so the sparkles curve as they travel (2026-11-04).
    // Follow scene (2026-11-06): the scene's wave warp also curls the particles, so swirl follows it too.
    gl.uniform1f(this.uSwirl, (this.calm ? 0 : Math.min(1, frame.norm.mid)) * this.p.swirlGain * (follow ? 1 + scene.warp : 1));
    // Shared sway (uv units) doubled to clip units: the spawn origin follows the tunnel rim.
    const sway = getSway();
    gl.uniform2f(this.uSway, 2 * sway.x, 2 * sway.y);
    gl.uniform1f(this.uSparkle, sparkle);
    const opacity = options?.uLayerOpacity ?? options?.opacity ?? this.opacity;
    gl.uniform1f(this.uBrightness, this.p.brightness * opacity);
    gl.uniform1f(this.uEnergy, clamp01(frame.energy));
    gl.uniform1f(this.uTwinkleTime, twinkleTime);
    // Crown heights (P5): each particle launches from the tip of its crown bar (zero when the crown is off).
    gl.uniform1fv(this.uCrown, getCrownHeights());
    // Particle shape (4.6): 0 streak, 1 dot, 2 star, 3 ring. Unknown names fall back to streak.
    const shapeIndex = Math.max(0, PARTICLE_SHAPES.indexOf(this.p.shape));
    gl.uniform1i(this.uShape, shapeIndex);
    // Transforms (4.7): rotation in radians, zoom (1 = none). Identity at the defaults.
    // Follow scene transform (2026-11-06): add the scene's accumulated turn and current zoom when on.
    gl.uniform1f(this.uRotation, this.p.rotation + (follow ? scene.angle : 0));
    gl.uniform1f(this.uZoom, this.p.zoom * (follow ? scene.scale : 1));
    gl.uniform1f(this.uFollow, follow ? 1 : 0);
    gl.uniform2f(this.uCentre, follow ? scene.centreX : 0, follow ? scene.centreY : 0);
    gl.uniform2f(this.uStretch, follow ? scene.stretchX : 1, follow ? scene.stretchY : 1);
    gl.uniform1f(this.uWarp, follow ? scene.warp : 0);
    gl.uniform1f(this.uWarpScale, scene.warpScale);
    gl.uniform1f(this.uWarpSpeed, scene.warpSpeed);
    gl.uniform1f(this.uTime, scene.timeSec);
    // Reach: far enough that the corners (distance hypot(aspect, 1) in screen heights) are covered.
    gl.uniform1f(this.uFar, Math.hypot(target.width / target.height, 1) * 1.05);
    gl.uniform1f(this.uSize, this.p.size);
    // Colour shift (4.8): fixed offset plus drift, wrapped into 0..1 turns. Zero at the defaults.
    gl.uniform1f(this.uHue, ((this.p.hueShift + this.hueTurns) % 1 + 1) % 1);
    // Band texture (6.2): always bound so the sampler has a valid texture; updated only when on.
    gl.uniform1f(this.uTexOn, this.p.texture ? 1 : 0);
    gl.uniform1f(this.uTexGain, this.p.textureGain);
    if (this.p.texture) this.band.update(gl, frame.bandWaveforms);
    const unit = this.band.bind(gl, BAND_UNIT);
    gl.uniform1i(this.uTexHigh, unit + 2);

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, POOL_SIZE);
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
    this.uTexOn = null;
    this.uTexGain = null;
    this.uTexHigh = null;
    this.uPhase = null;
    this.uAspect = null;
    this.uAccent = null;
    this.uAccentA = null;
    this.uSwirl = null;
    this.uShape = null;
    this.uRotation = null;
    this.uZoom = null;
    this.uFar = null;
    this.uSize = null;
    this.uFollow = null;
    this.uCentre = null;
    this.uStretch = null;
    this.uWarp = null;
    this.uWarpScale = null;
    this.uWarpSpeed = null;
    this.uTime = null;
    this.uHue = null;
    this.hueTurns = 0;
    this.uSparkle = null;
    this.uBrightness = null;
    this.uEnergy = null;
    this.uTwinkleTime = null;
    this.uCrown = null;
    this.gl = null;
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
