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
import { getTerrainState } from '../terrainStore';

export interface ParticleLayerParams extends ParticleParams {
  terrainDisplace?: number;
  seedShape?: 'orb' | 'petal' | 'star';
  phylloPattern?: 'auto' | 'golden137.5' | 'lucas99.5' | 'fibonacci137.6' | 'rosette137.3' | 'starburst144';
  petalStretch?: number;
  flowSpeed?: number;
  subTwist?: number;
}

const PHYLLO_PATTERNS: Record<string, number> = {
  'golden137.5': 2.3999632,       // 137.508°
  'lucas99.5': 1.7366025,         // 99.5°
  'fibonacci137.6': 2.4016,       // 137.6°
  'rosette137.3': 2.3963,         // 137.3°
  'starburst144': 2.513274,       // 144.0°
};
const CURATED_AUTO_ANGLES = [2.3999632, 2.4016, 2.3963];

export const PARTICLE_DISPLACE_SPEC = {
  type: 'float' as const,
  name: 'terrainDisplace',
  label: 'Ride spectral terrain',
  group: 'Motion',
  default: 0.0,
  min: 0.0,
  max: 1.0,
  step: 0.05,
};

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
  private p: ParticleLayerParams;

  constructor(params: Partial<ParticleLayerParams> = {}) {
    this.p = {
      ...PARTICLE_DEFAULTS,
      terrainDisplace: 0.0,
      seedShape: 'petal',
      phylloPattern: 'auto',
      petalStretch: 1.65,
      flowSpeed: 1.0,
      subTwist: 1.0,
      ...params,
    };
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity;
  }

  setParams(params: Partial<ParticleLayerParams>): void {
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
  private uMode: WebGLUniformLocation | null = null;
  private uSubTwist: WebGLUniformLocation | null = null;
  private uFlowSpeed: WebGLUniformLocation | null = null;
  private uFlowPhase: WebGLUniformLocation | null = null;
  private uTwistPhase: WebGLUniformLocation | null = null;
  private uDivergenceAngle: WebGLUniformLocation | null = null;
  private uPetalStretch: WebGLUniformLocation | null = null;
  private uSeedShape: WebGLUniformLocation | null = null;
  private uKickEnv: WebGLUniformLocation | null = null;
  private uTerrainTex: WebGLUniformLocation | null = null;
  private uTerrainDisplace: WebGLUniformLocation | null = null;
  private uTerrainWriteRow: WebGLUniformLocation | null = null;
  private readonly band = new BandTexture();

  /** Monotonic phase accumulators and phrase-locked divergence angle state (Slice 7.29) */
  private flowPhase: number = 0;
  private twistPhase: number = 0;
  private phylloCooldownSec: number = 7.0;
  private phylloCurrentAngleIdx: number = 0;
  private phylloNextAngleIdx: number = 0;
  private phylloMorphProgress: number = 1.0;
  private divergenceAngle: number = 2.3999632;

  getFlowPhase(): number {
    return this.flowPhase;
  }

  getTwistPhase(): number {
    return this.twistPhase;
  }

  getDivergenceAngle(): number {
    return this.divergenceAngle;
  }

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
    this.uMode = gl.getUniformLocation(this.program, 'uMode');
    this.uSubTwist = gl.getUniformLocation(this.program, 'uSubTwist');
    this.uFlowSpeed = gl.getUniformLocation(this.program, 'uFlowSpeed');
    this.uFlowPhase = gl.getUniformLocation(this.program, 'uFlowPhase');
    this.uTwistPhase = gl.getUniformLocation(this.program, 'uTwistPhase');
    this.uDivergenceAngle = gl.getUniformLocation(this.program, 'uDivergenceAngle');
    this.uPetalStretch = gl.getUniformLocation(this.program, 'uPetalStretch');
    this.uSeedShape = gl.getUniformLocation(this.program, 'uSeedShape');
    this.uKickEnv = gl.getUniformLocation(this.program, 'uKickEnv');
    this.uTerrainTex = gl.getUniformLocation(this.program, 'uTerrainTex');
    this.uTerrainDisplace = gl.getUniformLocation(this.program, 'uTerrainDisplace');
    this.uTerrainWriteRow = gl.getUniformLocation(this.program, 'uTerrainWriteRow');
    this.band.init(gl);
    this.phase.reset();
    this.twinkle.reset();
    this.flash = 0;
    this.flowPhase = 0;
    this.twistPhase = 0;
    this.phylloCooldownSec = 7.0;
    this.phylloCurrentAngleIdx = 0;
    this.phylloNextAngleIdx = 0;
    this.phylloMorphProgress = 1.0;
    this.divergenceAngle = 2.3999632;
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

    const dt = clock.dtSec > 0 ? clock.dtSec : 0.016;

    // Maintain two monotonic phase accumulators:
    const flowSpeed = this.p.flowSpeed ?? 1.0;
    const subNorm = frame.norm?.sub ?? 0;
    const kickEnv = frame.kickEnv ?? 0;
    this.flowPhase += dt * flowSpeed * (0.45 + subNorm * 1.15 + kickEnv * 1.4);

    const midNorm = frame.norm?.mid ?? 0;
    const subTwist = this.p.subTwist ?? 1.0;
    this.twistPhase += dt * (0.12 + midNorm * 0.35 * subTwist);

    // Maintain phrase-locked divergence angle morphing (minimum 7.0s cooldown in 'auto' mode, morphing over 2.5s)
    const pattern = this.p.phylloPattern ?? 'auto';
    if (pattern === 'auto') {
      this.phylloCooldownSec += dt;
      const isPhraseBoundary =
        (frame as any).sectionContrast > 0.05 ||
        Boolean((frame as any).kickPulse) ||
        kickEnv > 0.6;

      if (this.phylloCooldownSec >= 7.0 && isPhraseBoundary) {
        this.phylloCooldownSec = 0.0;
        this.phylloCurrentAngleIdx = this.phylloNextAngleIdx;
        this.phylloNextAngleIdx = (this.phylloCurrentAngleIdx + 1) % CURATED_AUTO_ANGLES.length;
        this.phylloMorphProgress = 0.0;
      }

      if (this.phylloMorphProgress < 1.0) {
        this.phylloMorphProgress = Math.min(1.0, this.phylloMorphProgress + dt / 2.5);
      }
      const a1 = CURATED_AUTO_ANGLES[this.phylloCurrentAngleIdx]!;
      const a2 = CURATED_AUTO_ANGLES[this.phylloNextAngleIdx]!;
      const t = this.phylloMorphProgress * this.phylloMorphProgress * (3 - 2 * this.phylloMorphProgress);
      this.divergenceAngle = a1 + (a2 - a1) * t;
    } else {
      this.divergenceAngle = PHYLLO_PATTERNS[pattern] ?? 2.3999632;
      this.phylloCooldownSec = 7.0;
      this.phylloMorphProgress = 1.0;
    }

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

    const isPhyllotaxis = this.p.mode === 'phyllotaxis';
    gl.uniform1i(this.uMode, isPhyllotaxis ? 1 : 0);
    gl.uniform1f(this.uSubTwist, (this.calm ? 0 : (frame.norm?.sub ?? 0)) * 5.0);
    gl.uniform1f(this.uFlowSpeed, this.p.flowSpeed ?? 2.5);

    // Seed shape (0 = orb, 1 = petal, 2 = star)
    const seedShape = this.p.seedShape ?? 'petal';
    let seedShapeInt = 1;
    if (seedShape === 'orb') seedShapeInt = 0;
    else if (seedShape === 'star') seedShapeInt = 2;
    else if (seedShape === 'petal') seedShapeInt = 1;
    gl.uniform1i(this.uSeedShape, seedShapeInt);

    // Particle shape (4.6): 0 streak, 1 dot, 2 star, 3 ring. Unknown names fall back to streak.
    let shapeIndex = Math.max(0, PARTICLE_SHAPES.indexOf(this.p.shape));
    if (isPhyllotaxis) {
      if (seedShapeInt === 0) shapeIndex = 1; // dot (orb)
      else if (seedShapeInt === 1) shapeIndex = 0; // streak (petal)
      else if (seedShapeInt === 2) shapeIndex = 2; // star
    }
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
    const aspect = target.width / target.height;
    const far = Math.hypot(aspect, 1.0) * 1.05;
    gl.uniform1f(this.uFar, far);
    gl.uniform1f(this.uFlowPhase, this.flowPhase);
    gl.uniform1f(this.uTwistPhase, this.twistPhase);
    gl.uniform1f(this.uDivergenceAngle, this.divergenceAngle);
    gl.uniform1f(this.uPetalStretch, this.p.petalStretch ?? 1.65);
    gl.uniform1f(this.uKickEnv, kickEnv);
    gl.uniform1f(this.uSize, this.p.size);
    // Colour shift (4.8): fixed offset plus drift, wrapped into 0..1 turns. Zero at the defaults.
    gl.uniform1f(this.uHue, ((this.p.hueShift + this.hueTurns) % 1 + 1) % 1);
    // Band texture (6.2): always bound so the sampler has a valid texture; updated only when on.
    gl.uniform1f(this.uTexOn, this.p.texture ? 1 : 0);
    gl.uniform1f(this.uTexGain, this.p.textureGain);
    if (this.p.texture) this.band.update(gl, frame.bandWaveforms);
    const unit = this.band.bind(gl, BAND_UNIT);
    gl.uniform1i(this.uTexHigh, unit + 2);

    const terrain = getTerrainState(gl);
    const terrainDisplace = this.p.terrainDisplace ?? 0;
    if (terrain.active && terrainDisplace > 0 && terrain.historyTex) {
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, terrain.historyTex);
      gl.uniform1i(this.uTerrainTex, 5);
      gl.uniform1f(this.uTerrainDisplace, terrainDisplace);
      gl.uniform1f(this.uTerrainWriteRow, terrain.writeRow);
      gl.activeTexture(gl.TEXTURE0);
    } else {
      gl.uniform1f(this.uTerrainDisplace, 0.0);
    }

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
    this.uMode = null;
    this.uSubTwist = null;
    this.uFlowSpeed = null;
    this.uFlowPhase = null;
    this.uTwistPhase = null;
    this.uDivergenceAngle = null;
    this.uPetalStretch = null;
    this.uSeedShape = null;
    this.uKickEnv = null;
    this.uTerrainTex = null;
    this.uTerrainDisplace = null;
    this.uTerrainWriteRow = null;
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
