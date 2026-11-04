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
import { FlightState } from '../tunnelState';
import { flashGovernor } from '../safety';

const RING_DENSITY = 0.5;
/** Beat flash on the rings: instant attack, 150 ms release (owner reference notes: beats thicken rings, never move the camera). */
const BEAT_RELEASE_SEC = 0.15;
const RING_CONTRAST_NORMAL = 0.5;
const RING_CONTRAST_CALM = 0.25;

export class TunnelLayer implements RenderLayer {
  /** Calm mode: gentle drift, no energy boost, softer ring contrast. */
  calm = false;

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

  private readonly flight = new FlightState();
  private beatEnv = 0;
  private uBeat: WebGLUniformLocation | null = null;
  private uCenter: WebGLUniformLocation | null = null;
  private uDensity: WebGLUniformLocation | null = null;
  private uHue: WebGLUniformLocation | null = null;
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
    this.uBeat = gl.getUniformLocation(this.program, 'uBeat');
    this.uCenter = gl.getUniformLocation(this.program, 'uCenter');
    this.uDensity = gl.getUniformLocation(this.program, 'uDensity');
    this.uHue = gl.getUniformLocation(this.program, 'uHue');
    this.beatEnv = 0;
    this.vao = createVao(gl);
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Draws at the host's target size; nothing to reallocate.
  }

  draw(frame: AudioFrame, clock: RenderClock, target: RenderTarget): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) throw new Error('TunnelLayer: draw before init');

    bindTarget(gl, target);

    const phase = this.flight.advance(clock.dtSec, frame.energy, this.calm);
    // Beat flash: jumps to 1 on a beat, then decays over BEAT_RELEASE_SEC.
    // Calm mode turns beat-triggered visuals off entirely.
    const dt = Math.max(0, clock.dtSec);
    this.beatEnv = Math.exp(-dt / BEAT_RELEASE_SEC) * this.beatEnv;
    // Governed (P6): a beat only flashes if the global flash limit allows it.
    if (frame.beatByBand.sub && !this.calm && flashGovernor.tryFlash(clock.timeSec)) this.beatEnv = 1;
    const palette: Palette = getPalette(getCurrentPalette());

    gl.useProgram(this.program);
    gl.uniform1f(this.uBeat, this.beatEnv); // must follow useProgram, or the call is an invalid operation
    gl.uniform1f(this.uPhase, phase);
    gl.uniform1f(this.uSub, frame.norm.sub);
    gl.uniform1f(this.uLevel, frame.env.sub);
    gl.uniform2f(this.uRes, target.width, target.height);
    gl.uniform3f(this.uBase, palette.base[0], palette.base[1], palette.base[2]);
    gl.uniform3f(this.uAccentA, palette.accentA[0], palette.accentA[1], palette.accentA[2]);
    gl.uniform3f(this.uAccentB, palette.accentB[0], palette.accentB[1], palette.accentB[2]);
    gl.uniform1f(this.uRingContrast, this.calm ? RING_CONTRAST_CALM : RING_CONTRAST_NORMAL);
    gl.uniform1f(this.uRingDensity, RING_DENSITY);
    // Motion and colour (2026-11-04): the rings must move and change, not sit still.
    // Sway and breathing are bounded so they never jolt the view.
    const t = clock.timeSec;
    const mid = frame.norm.mid;
    const highSlow = this.highAvg.step(frame.norm.high, clock.dtSec);
    const sway = this.calm ? 0 : 1;
    gl.uniform2f(this.uCenter, sway * 0.05 * Math.sin(t * 0.31) * mid, sway * 0.04 * Math.cos(t * 0.23) * mid);
    gl.uniform1f(this.uDensity, RING_DENSITY * (1 + 0.3 * Math.max(0, frame.env.sub - 0.2)));
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
    }
    this.program = null;
    this.vao = null;
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
    this.uDensity = null;
    this.uHue = null;
    this.gl = null;
  }
}
