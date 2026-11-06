// Forward-flight tunnel (Stage 2, slice 2.4). Concentric rings flying toward the
// viewer; flight speed is an integrated phase, never time * speed.
import type { AudioFrame } from '../../audio/types';
import { compileProgram, FULLSCREEN_VERT } from '../../gl/shader';
import { createVao } from '../../gl/vao';
import type { RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import { getPalette, type Palette } from '../palette';
import { getCurrentPalette } from '../paletteStore';
import { SlowFollower } from '../dynamics';
import fragSrc from '../shaders/tunnel.frag.glsl?raw';
import { FlightState, RollState } from '../tunnelState';
import { getSway } from '../swayStore';
import { blendAccents } from '../colourSwap';
import { getVisualGain } from '../gainStore';
import { RELEASE_TAU_SEC, releaseEnvelope } from '../releaseEnvelope';
import { TUNNEL_DEFAULTS, type TunnelParams } from '../../presets/layerSchemas';
import { BandTexture } from '../bandTexture';

/** First texture unit for the band textures (sub, mid, high take the next two). */
const BAND_UNIT = 1;

/** Wall pattern name to the shader's number (V1). Unknown names fall back to rings. */
const PATTERNS = ['rings', 'grid', 'spokes', 'checker', 'stripes'];
export function patternIndex(name: string): number {
  return Math.max(0, PATTERNS.indexOf(name));
}

/** GLSL-style smoothstep: 0 below a, 1 above b, smooth in between. */
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class TunnelLayer implements RenderLayer {
  /** Calm mode: gentle drift, no energy boost, softer ring contrast. */
  calm = false;
  /** Section contrast (P4): negative slows the flight, positive speeds it up. Ignored in calm. */
  sectionContrast = 0;
  /** Accent swap mix from ColourSwap (P4): 0 = normal, 1 = A and B exchanged. */
  accentSwap = 0;
  /** Settings (slice 4.2). Read every frame, so a change applies on the next frame. */
  private p: TunnelParams;

  constructor(params: Partial<TunnelParams> = {}) {
    this.p = { ...TUNNEL_DEFAULTS, ...params };
  }

  setParams(params: Partial<TunnelParams>): void {
    this.p = { ...this.p, ...params };
  }

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uPhase: WebGLUniformLocation | null = null;
  private uSub: WebGLUniformLocation | null = null;
  private uLevel: WebGLUniformLocation | null = null;
  private uRes: WebGLUniformLocation | null = null;
  private uBase: WebGLUniformLocation | null = null;
  private uAccentA: WebGLUniformLocation | null = null;
  private uAccentB: WebGLUniformLocation | null = null;
  private uRingContrast: WebGLUniformLocation | null = null;
  private uRingDensity: WebGLUniformLocation | null = null;
  private uPattern: WebGLUniformLocation | null = null;
  private uSides: WebGLUniformLocation | null = null;
  private uTwist: WebGLUniformLocation | null = null;
  private uTexOn: WebGLUniformLocation | null = null;
  private uTexGain: WebGLUniformLocation | null = null;
  private uTexSub: WebGLUniformLocation | null = null;
  private uTexMid: WebGLUniformLocation | null = null;
  private readonly band = new BandTexture();

  private readonly flight = new FlightState();
  private readonly roll = new RollState();
  private beatEnv = 0;
  private uBeat: WebGLUniformLocation | null = null;
  private uCenter: WebGLUniformLocation | null = null;
  private uRoll: WebGLUniformLocation | null = null;
  private uDensity: WebGLUniformLocation | null = null;
  private uHue: WebGLUniformLocation | null = null;
  private uQuiet: WebGLUniformLocation | null = null;
  /** Smoothed quiet amount, 0 (loud) to 1 (silent). Rises fast, falls on the shared 320 ms release. */
  private quietEnv = 0;
  private highAvg = new SlowFollower(3);

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction: never reuse GL objects from before a context restore.
    this.gl = gl;
    this.program = compileProgram(gl, FULLSCREEN_VERT, fragSrc, 'tunnel');
    this.uPhase = gl.getUniformLocation(this.program, 'uPhase');
    this.uSub = gl.getUniformLocation(this.program, 'uSub');
    this.uLevel = gl.getUniformLocation(this.program, 'uLevel');
    this.uRes = gl.getUniformLocation(this.program, 'uRes');
    this.uBase = gl.getUniformLocation(this.program, 'uBase');
    this.uAccentA = gl.getUniformLocation(this.program, 'uAccentA');
    this.uAccentB = gl.getUniformLocation(this.program, 'uAccentB');
    this.uRingContrast = gl.getUniformLocation(this.program, 'uRingContrast');
    this.uRingDensity = gl.getUniformLocation(this.program, 'uRingDensity');
    this.uPattern = gl.getUniformLocation(this.program, 'uPattern');
    this.uSides = gl.getUniformLocation(this.program, 'uSides');
    this.uTwist = gl.getUniformLocation(this.program, 'uTwist');
    this.uBeat = gl.getUniformLocation(this.program, 'uBeat');
    this.uCenter = gl.getUniformLocation(this.program, 'uCenter');
    this.uRoll = gl.getUniformLocation(this.program, 'uRoll');
    this.uDensity = gl.getUniformLocation(this.program, 'uDensity');
    this.uHue = gl.getUniformLocation(this.program, 'uHue');
    this.uQuiet = gl.getUniformLocation(this.program, 'uQuiet');
    this.uTexOn = gl.getUniformLocation(this.program, 'uTexOn');
    this.uTexGain = gl.getUniformLocation(this.program, 'uTexGain');
    this.uTexSub = gl.getUniformLocation(this.program, 'uTexSub');
    this.uTexMid = gl.getUniformLocation(this.program, 'uTexMid');
    this.band.init(gl);
    this.beatEnv = 0;
    this.quietEnv = 0;
    this.vao = createVao(gl);
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Draws at the host's target size; nothing to reallocate.
  }

  draw(frame: AudioFrame, clock: RenderClock, target: RenderTarget): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('TunnelLayer: draw before init');

    bindTarget(gl, target);

    // Visual gain also scales movement speed (higher gain = faster flight).
    const scale = (this.calm ? 1 : 1 + this.sectionContrast) * getVisualGain();
    const phase = this.flight.advance(clock.dtSec, frame.energy, this.calm, scale);
    // Beat response: the tunnel is the main beat-reactive layer. A kick swells the rings
    // (fast attack, shared 320 ms release). It is a swell, not a flash: the single strobe
    // in the scene is the kick shockwave, which is governed (P6). Calm turns this off.
    const dt = Math.max(0, clock.dtSec);
    const beatTarget = !this.calm && frame.beatByBand.sub ? 1 : 0;
    this.beatEnv = releaseEnvelope(this.beatEnv, beatTarget, dt, this.p.beatAttackSec, RELEASE_TAU_SEC);
    // Quiet amount: 1 at silence, 0 at normal loudness (absolute loudness, so any track counts).
    const quietTarget = 1 - smoothstep(0.05, 0.35, frame.loudness);
    this.quietEnv = releaseEnvelope(this.quietEnv, quietTarget, dt, 0.05, RELEASE_TAU_SEC);
    const palette: Palette = getPalette(getCurrentPalette());
    const accents = blendAccents(palette.accentA, palette.accentB, this.accentSwap);

    gl.useProgram(this.program);
    gl.uniform1f(this.uBeat, this.beatEnv); // must follow useProgram, or the call is an invalid operation
    gl.uniform1f(this.uQuiet, this.quietEnv);
    gl.uniform1f(this.uPhase, phase);
    gl.uniform1f(this.uSub, frame.norm.sub);
    gl.uniform1f(this.uLevel, frame.env.sub);
    gl.uniform2f(this.uRes, target.width, target.height);
    gl.uniform3f(this.uBase, palette.base[0], palette.base[1], palette.base[2]);
    gl.uniform3f(this.uAccentA, accents.a[0], accents.a[1], accents.a[2]);
    gl.uniform3f(this.uAccentB, accents.b[0], accents.b[1], accents.b[2]);
    gl.uniform1f(this.uRingContrast, this.calm ? this.p.ringContrastCalm : this.p.ringContrast);
    gl.uniform1f(this.uRingDensity, this.p.ringDensity);
    gl.uniform1f(this.uPattern, patternIndex(this.p.pattern));
    gl.uniform1f(this.uSides, this.p.sides);
    gl.uniform1f(this.uTwist, this.p.twist);
    // Band texture (6.2): always bound so the samplers have a valid texture; updated only when on.
    gl.uniform1f(this.uTexOn, this.p.texture ? 1 : 0);
    gl.uniform1f(this.uTexGain, this.p.textureGain);
    if (this.p.texture) this.band.update(gl, frame.bandWaveforms);
    const unit = this.band.bind(gl, BAND_UNIT);
    gl.uniform1i(this.uTexSub, unit);
    gl.uniform1i(this.uTexMid, unit + 1);
    // Motion and colour (2026-11-04): the rings must move and change, not sit still.
    // Sway and breathing are bounded so they never jolt the view.
    const t = clock.timeSec;
    const highSlow = this.highAvg.step(frame.norm.high, clock.dtSec);
    // Depth (P3): figure-eight bend of the vanishing point (off in calm), and a slow integrated roll.
    // Shared sway (swayStore): the same offset drives particles and the crown.
    const sway = getSway();
    gl.uniform2f(this.uCenter, sway.x, sway.y);
    gl.uniform1f(this.uRoll, this.roll.advance(clock.dtSec, frame.energy, this.calm));
    gl.uniform1f(this.uDensity, this.p.ringDensity * (1 + 0.3 * Math.max(0, frame.env.sub - 0.2)));
    gl.uniform1f(this.uHue, Math.min(1, Math.max(0, 0.5 + 0.35 * Math.sin(t * 0.11) + 0.4 * (frame.norm.high - highSlow))));
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
    this.uTexOn = null;
    this.uTexGain = null;
    this.uTexSub = null;
    this.uTexMid = null;
    this.uPhase = null;
    this.uSub = null;
    this.uLevel = null;
    this.uRes = null;
    this.uBase = null;
    this.uAccentA = null;
    this.uAccentB = null;
    this.uRingContrast = null;
    this.uRingDensity = null;
    this.uBeat = null;
    this.uCenter = null;
    this.uRoll = null;
    this.uDensity = null;
    this.uHue = null;
    this.gl = null;
  }
}
