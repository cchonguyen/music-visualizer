// Unified composable shape layer (Stage 9, Sector 485).
// 8 base geometries, 8 reactive effects, symmetry, center anti-inversion,
// 6 propagation modes, audio envelopes, and peak caps.
import type { AudioFrame } from '../../audio/types';
import { compileProgram } from '../../gl/shader';
import { createDataTexture, type DataTexture, updateDataTexture } from '../../gl/texture';
import { createVao } from '../../gl/vao';
import type { RenderClock } from '../clock';
import { bindTarget, type RenderLayer, type RenderTarget } from '../layer';
import { getPalette, type Palette } from '../palette';
import { getCurrentPalette } from '../paletteStore';
import { blendAccents } from '../colourSwap';
import { buildBarEdges, type BarEdge } from '../logScale';
import { barValues } from '../barsState';
import { kickGrant } from './shockwave';
import {
  SHAPE_DEFAULTS,
  type ShapeParams,
  type ShapeBaseType,
  type ShapeEdgeMode,
  type ShapeEffectType,
  type ShapeExtrudeDirection,
  type ShapeSymmetry,
  type ShapeNormalMode,
  type ShapeColorMode,
} from '../../presets/layerSchemas';
import vertSrc from '../shaders/shape.vert.glsl?raw';
import fragSrc from '../shaders/shape.frag.glsl?raw';

const BASE_SHAPE_MAP: Record<ShapeBaseType, number> = {
  centerLine: 0,
  edgeLine: 1,
  circle: 2,
  arc: 3,
  polygon: 4,
  star: 5,
  spiral: 6,
  figure8: 7,
};

const EDGE_MODE_MAP: Record<ShapeEdgeMode, number> = {
  bottom: 0,
  top: 1,
  dualHorizontal: 2,
  dualVertical: 3,
  frame: 4,
};

const EFFECT_TYPE_MAP: Record<ShapeEffectType, number> = {
  solidLine: 0,
  pulsingLine: 1,
  waveform: 2,
  harmonicWave: 3,
  bars: 4,
  segmentedBars: 5,
  dots: 6,
  auroraFill: 7,
};

const EXTRUDE_DIR_MAP: Record<ShapeExtrudeDirection, number> = {
  outward: 0,
  inward: 1,
  bilateral: 2,
  alternating: 3,
};

const SYMMETRY_MAP: Record<ShapeSymmetry, number> = {
  wrap: 0,
  mirror: 1,
  repeat2: 2,
  repeat4: 3,
};

const NORMAL_MODE_MAP: Record<ShapeNormalMode, number> = {
  radial: 0,
  perpendicular: 1,
};

const COLOR_MODE_MAP: Record<ShapeColorMode, number> = {
  solid: 0,
  palette: 1,
  frequencyGradient: 2,
  amplitudeHot: 3,
};

function parseHexColor(hex: string): [number, number, number] {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (match) {
    return [
      parseInt(match[1]!, 16) / 255,
      parseInt(match[2]!, 16) / 255,
      parseInt(match[3]!, 16) / 255,
    ];
  }
  return [0, 0.94, 1.0];
}

interface ShockwaveSlot {
  active: boolean;
  age: number;
}

/** Per-sample amplitude ceiling (old 2.0, raised 5x in Slice 15.8). Must match AMP_MAX in shape.vert.glsl. */
export const SHAPE_AMP_MAX = 10.0;
/** Reactivity schema maximum (old 3.0, raised 5x in Slice 15.8). */
export const SHAPE_REACTIVITY_MAX = 15.0;

export class ShapeLayer implements RenderLayer {
  /** Accent swap mix from ColourSwap (0 = normal, 1 = swapped). */
  accentSwap = 0;
  /** Settings. Read every frame. */
  private p: ShapeParams;

  constructor(params: Partial<ShapeParams> = {}) {
    this.p = { ...SHAPE_DEFAULTS, ...params };
  }

  setParams(params: Partial<ShapeParams>): void {
    this.p = { ...this.p, ...params };
  }

  getParams(): ShapeParams {
    return { ...this.p };
  }

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private audioTex: DataTexture | null = null;
  private peakTex: DataTexture | null = null;

  // Uniform locations
  private uRes: WebGLUniformLocation | null = null;
  private uAspect: WebGLUniformLocation | null = null;
  private uTime: WebGLUniformLocation | null = null;
  private uKickEnergy: WebGLUniformLocation | null = null;
  private uBaseShape: WebGLUniformLocation | null = null;
  private uEdgeMode: WebGLUniformLocation | null = null;
  private uSides: WebGLUniformLocation | null = null;
  private uStarInner: WebGLUniformLocation | null = null;
  private uCornerRadius: WebGLUniformLocation | null = null;
  private uArcSweep: WebGLUniformLocation | null = null;
  private uSpiralTurns: WebGLUniformLocation | null = null;
  private uSize: WebGLUniformLocation | null = null;
  private uBasePulse: WebGLUniformLocation | null = null;
  private uNormalMode: WebGLUniformLocation | null = null;
  private uSymmetry: WebGLUniformLocation | null = null;
  private uExtrudeDir: WebGLUniformLocation | null = null;
  private uEffectType: WebGLUniformLocation | null = null;
  private uSampleCount: WebGLUniformLocation | null = null;
  private uEffectLength: WebGLUniformLocation | null = null;
  private uThickness: WebGLUniformLocation | null = null;
  private uBarGap: WebGLUniformLocation | null = null;
  private uLedSegments: WebGLUniformLocation | null = null;
  private uPeakCaps: WebGLUniformLocation | null = null;
  private uGlow: WebGLUniformLocation | null = null;
  private uColorMode: WebGLUniformLocation | null = null;
  private uSolidColor: WebGLUniformLocation | null = null;
  private uBaseColor: WebGLUniformLocation | null = null;
  private uAccentA: WebGLUniformLocation | null = null;
  private uAccentB: WebGLUniformLocation | null = null;
  private uLayerOpacity: WebGLUniformLocation | null = null;
  private uIsRibbon: WebGLUniformLocation | null = null;
  private uAudioTex: WebGLUniformLocation | null = null;
  private uPeakTex: WebGLUniformLocation | null = null;
  private uInstOffset: WebGLUniformLocation | null = null;
  private uInstTransform: WebGLUniformLocation | null = null;

  // Audio envelope & peak hold buffers (256 samples)
  readonly smoothedSamples = new Float32Array(256);
  readonly peakHoldSamples = new Float32Array(256);
  readonly peakVelocities = new Float32Array(256);
  private raw256 = new Float32Array(256);

  // Frequency bar edge cache
  private edges: BarEdge[] = [];
  private edgeSampleRate = -1;
  private edgeFftSize = -1;

  // Propagation phases & instances
  private spinPhase = 0;
  private propPhase = 0;
  private propSelfSpinPhase = 0;
  private readonly shockwaveSlots: ShockwaveSlot[] = [
    { active: false, age: 0 },
    { active: false, age: 0 },
    { active: false, age: 0 },
    { active: false, age: 0 },
  ];
  private readonly instOffset = new Float32Array(16 * 2);
  private readonly instTransform = new Float32Array(16 * 4);

  init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.program = compileProgram(gl, vertSrc, fragSrc, 'shape');

    this.uRes = gl.getUniformLocation(this.program, 'uRes');
    this.uAspect = gl.getUniformLocation(this.program, 'uAspect');
    this.uTime = gl.getUniformLocation(this.program, 'uTime');
    this.uKickEnergy = gl.getUniformLocation(this.program, 'uKickEnergy');
    this.uBaseShape = gl.getUniformLocation(this.program, 'uBaseShape');
    this.uEdgeMode = gl.getUniformLocation(this.program, 'uEdgeMode');
    this.uSides = gl.getUniformLocation(this.program, 'uSides');
    this.uStarInner = gl.getUniformLocation(this.program, 'uStarInner');
    this.uCornerRadius = gl.getUniformLocation(this.program, 'uCornerRadius');
    this.uArcSweep = gl.getUniformLocation(this.program, 'uArcSweep');
    this.uSpiralTurns = gl.getUniformLocation(this.program, 'uSpiralTurns');
    this.uSize = gl.getUniformLocation(this.program, 'uSize');
    this.uBasePulse = gl.getUniformLocation(this.program, 'uBasePulse');
    this.uNormalMode = gl.getUniformLocation(this.program, 'uNormalMode');
    this.uSymmetry = gl.getUniformLocation(this.program, 'uSymmetry');
    this.uExtrudeDir = gl.getUniformLocation(this.program, 'uExtrudeDir');
    this.uEffectType = gl.getUniformLocation(this.program, 'uEffectType');
    this.uSampleCount = gl.getUniformLocation(this.program, 'uSampleCount');
    this.uEffectLength = gl.getUniformLocation(this.program, 'uEffectLength');
    this.uThickness = gl.getUniformLocation(this.program, 'uThickness');
    this.uBarGap = gl.getUniformLocation(this.program, 'uBarGap');
    this.uLedSegments = gl.getUniformLocation(this.program, 'uLedSegments');
    this.uPeakCaps = gl.getUniformLocation(this.program, 'uPeakCaps');
    this.uGlow = gl.getUniformLocation(this.program, 'uGlow');
    this.uColorMode = gl.getUniformLocation(this.program, 'uColorMode');
    this.uSolidColor = gl.getUniformLocation(this.program, 'uSolidColor');
    this.uBaseColor = gl.getUniformLocation(this.program, 'uBaseColor');
    this.uAccentA = gl.getUniformLocation(this.program, 'uAccentA');
    this.uAccentB = gl.getUniformLocation(this.program, 'uAccentB');
    this.uLayerOpacity = gl.getUniformLocation(this.program, 'uLayerOpacity');
    this.uIsRibbon = gl.getUniformLocation(this.program, 'uIsRibbon');
    this.uAudioTex = gl.getUniformLocation(this.program, 'uAudioTex');
    this.uPeakTex = gl.getUniformLocation(this.program, 'uPeakTex');
    this.uInstOffset = gl.getUniformLocation(this.program, 'uInstOffset[0]');
    this.uInstTransform = gl.getUniformLocation(this.program, 'uInstTransform[0]');

    this.audioTex = createDataTexture(gl, 256);
    this.peakTex = createDataTexture(gl, 256);
    this.vao = createVao(gl);

    this.smoothedSamples.fill(0);
    this.peakHoldSamples.fill(0);
    this.peakVelocities.fill(0);
    this.raw256.fill(0);
    this.edges = [];
    this.edgeSampleRate = -1;
    this.edgeFftSize = -1;
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // Draws to bound target; nothing to reallocate.
  }

  draw(
    frame: AudioFrame,
    clock: RenderClock,
    target: RenderTarget,
    options?: { opacity?: number; uLayerOpacity?: number },
  ): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao || !this.audioTex || !this.peakTex) {
      throw new Error('ShapeLayer: draw before init');
    }

    bindTarget(gl, target);

    const dt = Math.max(0, clock.dtSec);
    const sampleCount = Math.min(256, Math.max(16, Math.round(this.p.sampleCount)));

    // 1. Advance motion phases
    this.spinPhase += this.p.spinSpeed * dt;
    this.propPhase += 0.35 * this.p.propSpeed * (1.0 + 0.4 * frame.env.sub) * dt;
    this.propSelfSpinPhase += this.p.propSelfSpin * dt;

    // 2. Extract audio samples based on audioSource
    const rawBins = new Float32Array(sampleCount);
    if (this.p.audioSource === 'spectrum') {
      const fftSize = frame.spectrum.length * 2;
      if (frame.sampleRate !== this.edgeSampleRate || fftSize !== this.edgeFftSize || sampleCount !== this.edges.length) {
        this.edges = buildBarEdges(sampleCount, frame.sampleRate, fftSize);
        this.edgeSampleRate = frame.sampleRate;
        this.edgeFftSize = fftSize;
      }
      const vals = barValues(frame.smoothedSpectrum, this.edges);
      for (let i = 0; i < sampleCount; i++) {
        rawBins[i] = vals[i] ?? 0;
      }
    } else if (this.p.audioSource === 'waveform') {
      const wf = frame.waveform;
      const step = wf.length / sampleCount;
      for (let i = 0; i < sampleCount; i++) {
        const idx = Math.min(wf.length - 1, Math.floor(i * step));
        rawBins[i] = (wf[idx]! + 1.0) * 0.5;
      }
    } else if (this.p.audioSource === 'sub' || this.p.audioSource === 'bass') {
      const wf = frame.bandWaveforms.sub;
      const step = wf.length / sampleCount;
      const env = frame.env.sub;
      for (let i = 0; i < sampleCount; i++) {
        const idx = Math.min(wf.length - 1, Math.floor(i * step));
        rawBins[i] = Math.abs(wf[idx]!) * env * 2.0;
      }
    } else if (this.p.audioSource === 'mid') {
      const wf = frame.bandWaveforms.mid;
      const step = wf.length / sampleCount;
      const env = frame.env.mid;
      for (let i = 0; i < sampleCount; i++) {
        const idx = Math.min(wf.length - 1, Math.floor(i * step));
        rawBins[i] = Math.abs(wf[idx]!) * env * 2.0;
      }
    } else if (this.p.audioSource === 'treble') {
      const wf = frame.bandWaveforms.high;
      const step = wf.length / sampleCount;
      const env = frame.env.high;
      for (let i = 0; i < sampleCount; i++) {
        const idx = Math.min(wf.length - 1, Math.floor(i * step));
        rawBins[i] = Math.abs(wf[idx]!) * env * 2.0;
      }
    } else {
      // energy
      const e = frame.energy;
      for (let i = 0; i < sampleCount; i++) {
        rawBins[i] = e;
      }
    }

    // Apply reactivity & map to 256 texel buffer
    const reactivity = this.p.reactivity;
    for (let j = 0; j < 256; j++) {
      const binIdx = Math.min(sampleCount - 1, Math.floor((j / 256) * sampleCount));
      this.raw256[j] = Math.min(SHAPE_AMP_MAX, (rawBins[binIdx] ?? 0) * reactivity);
    }

    // 3. Asymmetric envelope smoothing & gravity peak caps
    const attackSec = Math.max(0.001, this.p.attackMs / 1000);
    const releaseSec = Math.max(0.001, this.p.releaseMs / 1000);
    const alphaAtt = 1 - Math.exp(-dt / attackSec);
    const alphaRel = 1 - Math.exp(-dt / releaseSec);
    const gravity = 1.25;

    for (let j = 0; j < 256; j++) {
      const targetVal = this.raw256[j]!;
      const prevVal = this.smoothedSamples[j]!;
      if (targetVal >= prevVal) {
        this.smoothedSamples[j] = prevVal + alphaAtt * (targetVal - prevVal);
      } else {
        this.smoothedSamples[j] = prevVal + alphaRel * (targetVal - prevVal);
      }

      if (this.p.peakCaps) {
        const cur = this.smoothedSamples[j]!;
        if (cur >= this.peakHoldSamples[j]!) {
          this.peakHoldSamples[j] = cur;
          this.peakVelocities[j] = 0;
        } else {
          this.peakVelocities[j]! += gravity * dt;
          this.peakHoldSamples[j]! -= this.peakVelocities[j]! * dt;
          if (this.peakHoldSamples[j]! < cur) {
            this.peakHoldSamples[j] = cur;
            this.peakVelocities[j] = 0;
          }
        }
      } else {
        this.peakHoldSamples[j] = 0;
        this.peakVelocities[j] = 0;
      }
    }

    // Upload audio & peak textures
    updateDataTexture(gl, this.audioTex, this.smoothedSamples);
    updateDataTexture(gl, this.peakTex, this.peakHoldSamples);

    // 4. Propagation engine: compute instance transforms
    const rotRad = (this.p.rotation * Math.PI) / 180;
    const mode = this.p.propMode;
    let activePropCount = 1;

    this.instOffset.fill(0);
    this.instTransform.fill(0);

    if (mode === 'single') {
      activePropCount = 1;
      this.instOffset[0] = this.p.posX;
      this.instOffset[1] = this.p.posY;
      this.instTransform[0] = 1.0;
      this.instTransform[1] = rotRad + this.spinPhase;
      this.instTransform[2] = 1.0;
      this.instTransform[3] = 1.0;
    } else if (mode === 'concentric') {
      const count = Math.min(16, Math.max(1, Math.round(this.p.propCount)));
      activePropCount = count;
      const deltaS = this.p.propSpacing * 0.45;
      for (let m = 0; m < count; m++) {
        const idx2 = m * 2;
        const idx4 = m * 4;
        this.instOffset[idx2] = this.p.posX;
        this.instOffset[idx2 + 1] = this.p.posY;

        let s = (this.p.propDirection === 'inward')
          ? Math.max(0.08, 1.0 - m * deltaS)
          : (1.0 + m * deltaS);

        let spin = this.spinPhase;
        if (this.p.propDirection === 'alternating' && m % 2 === 1) {
          spin = -this.spinPhase;
        }

        const a = 1.0 - 0.35 * (m / Math.max(1, count - 1));
        const d = 1.0 - this.p.propDelay * (m / Math.max(1, count - 1));

        this.instTransform[idx4] = s;
        this.instTransform[idx4 + 1] = rotRad + spin;
        this.instTransform[idx4 + 2] = a;
        this.instTransform[idx4 + 3] = d;
      }
    } else if (mode === 'shockwave') {
      const speed = Math.abs(this.p.propSpeed) > 0.01 ? Math.abs(this.p.propSpeed) : 0.65;
      for (const slot of this.shockwaveSlots) {
        if (slot.active) {
          slot.age += dt * (speed / 0.55);
          if (slot.age >= 1.0) {
            slot.active = false;
          }
        }
      }

      if (kickGrant(frame, clock, false)) {
        const inactive = this.shockwaveSlots.find(s => !s.active);
        if (inactive) {
          inactive.active = true;
          inactive.age = 0;
        } else {
          let oldest = this.shockwaveSlots[0]!;
          for (const s of this.shockwaveSlots) {
            if (s.age > oldest.age) oldest = s;
          }
          oldest.active = true;
          oldest.age = 0;
        }
      }

      const active = this.shockwaveSlots.filter(s => s.active);
      if (active.length === 0) {
        activePropCount = 1;
        this.instOffset[0] = this.p.posX;
        this.instOffset[1] = this.p.posY;
        this.instTransform[0] = 1.0;
        this.instTransform[1] = rotRad + this.spinPhase;
        this.instTransform[2] = 0.0; // fully transparent
        this.instTransform[3] = 1.0;
      } else {
        activePropCount = active.length;
        for (let m = 0; m < active.length; m++) {
          const slot = active[m]!;
          const idx2 = m * 2;
          const idx4 = m * 4;
          const k = slot.age;
          const s = (this.p.propDirection === 'inward')
            ? 2.2 + (0.25 - 2.2) * k
            : 0.25 + (2.2 - 0.25) * k;
          const a = (1.0 - k) * (1.0 - k);
          const d = 1.0 - this.p.propDelay * k;

          this.instOffset[idx2] = this.p.posX;
          this.instOffset[idx2 + 1] = this.p.posY;
          this.instTransform[idx4] = s;
          this.instTransform[idx4 + 1] = rotRad + this.spinPhase;
          this.instTransform[idx4 + 2] = a;
          this.instTransform[idx4 + 3] = d;
        }
      }
    } else if (mode === 'stream') {
      const count = Math.min(16, Math.max(1, Math.round(this.p.propCount)));
      activePropCount = count;
      for (let m = 0; m < count; m++) {
        const idx2 = m * 2;
        const idx4 = m * 4;
        let pm = (this.propPhase + m / count) % 1.0;
        if (pm < 0) pm += 1.0;
        if (this.p.propDirection === 'inward') pm = 1.0 - pm;

        const s = 0.15 + (2.0 - 0.15) * pm;
        const a = Math.sin(Math.PI * pm);
        const d = 1.0 - this.p.propDelay * pm;

        this.instOffset[idx2] = this.p.posX;
        this.instOffset[idx2 + 1] = this.p.posY;
        this.instTransform[idx4] = s;
        this.instTransform[idx4 + 1] = rotRad + this.spinPhase;
        this.instTransform[idx4 + 2] = a;
        this.instTransform[idx4 + 3] = d;
      }
    } else if (mode === 'orbit') {
      const count = Math.min(16, Math.max(1, Math.round(this.p.propCount)));
      activePropCount = count;
      const rOrbit = this.p.propSpacing * 0.75;
      const sigma = (this.p.propDirection === 'ccw') ? -1.0 : 1.0;
      for (let m = 0; m < count; m++) {
        const idx2 = m * 2;
        const idx4 = m * 4;
        const beta = (2.0 * Math.PI * m) / count + sigma * this.propPhase;
        const ox = this.p.posX + rOrbit * Math.cos(beta);
        const oy = this.p.posY + rOrbit * Math.sin(beta);
        const r = beta + rotRad + this.propSelfSpinPhase;
        const d = 1.0 - this.p.propDelay * (m / Math.max(1, count - 1));

        this.instOffset[idx2] = ox;
        this.instOffset[idx2 + 1] = oy;
        this.instTransform[idx4] = 1.0;
        this.instTransform[idx4 + 1] = r;
        this.instTransform[idx4 + 2] = 1.0;
        this.instTransform[idx4 + 3] = d;
      }
    } else {
      // polar
      const count = Math.min(16, Math.max(1, Math.round(this.p.propCount)));
      activePropCount = count;
      const offsetDist = this.p.propSpacing * 0.35;
      for (let m = 0; m < count; m++) {
        const idx2 = m * 2;
        const idx4 = m * 4;
        const beta = (2.0 * Math.PI * m) / count + this.propPhase;
        const ox = this.p.posX + offsetDist * Math.cos(beta);
        const oy = this.p.posY + offsetDist * Math.sin(beta);
        const r = beta + rotRad + this.propSelfSpinPhase;
        const d = 1.0 - this.p.propDelay * (m / Math.max(1, count - 1));

        this.instOffset[idx2] = ox;
        this.instOffset[idx2 + 1] = oy;
        this.instTransform[idx4] = 1.0;
        this.instTransform[idx4 + 1] = r;
        this.instTransform[idx4 + 2] = 1.0;
        this.instTransform[idx4 + 3] = d;
      }
    }

    // 5. Palette and color configuration
    const palette: Palette = getPalette(getCurrentPalette());
    const blendedAccent = blendAccents(palette.accentA, palette.accentB, this.accentSwap);
    const solidRgb = parseHexColor(this.p.solidColor);
    const aspect = target.width / Math.max(1, target.height);
    const layerOpacity = options?.uLayerOpacity ?? options?.opacity ?? 1.0;

    // 6. Bind program and set uniforms
    gl.useProgram(this.program);

    gl.uniform2f(this.uRes, target.width, target.height);
    gl.uniform1f(this.uAspect, aspect);
    gl.uniform1f(this.uTime, clock.timeSec);
    gl.uniform1f(this.uKickEnergy, frame.kickEnv ?? 0);

    gl.uniform1i(this.uBaseShape, BASE_SHAPE_MAP[this.p.baseShape] ?? 2);
    gl.uniform1i(this.uEdgeMode, EDGE_MODE_MAP[this.p.edgeMode] ?? 0);
    gl.uniform1i(this.uSides, Math.round(this.p.sides));
    gl.uniform1f(this.uStarInner, this.p.starInner);
    gl.uniform1f(this.uCornerRadius, this.p.cornerRadius);
    gl.uniform1f(this.uArcSweep, this.p.arcSweep);
    gl.uniform1f(this.uSpiralTurns, this.p.spiralTurns);
    gl.uniform1f(this.uSize, this.p.size);
    gl.uniform1f(this.uBasePulse, this.p.basePulse);
    gl.uniform1i(this.uNormalMode, NORMAL_MODE_MAP[this.p.normalMode] ?? 0);
    gl.uniform1i(this.uSymmetry, SYMMETRY_MAP[this.p.symmetry] ?? 1);
    gl.uniform1i(this.uExtrudeDir, EXTRUDE_DIR_MAP[this.p.extrudeDirection] ?? 0);
    gl.uniform1i(this.uEffectType, EFFECT_TYPE_MAP[this.p.effectType] ?? 4);
    gl.uniform1i(this.uSampleCount, sampleCount);
    gl.uniform1f(this.uEffectLength, this.p.effectLength);
    gl.uniform1f(this.uThickness, this.p.thickness);
    gl.uniform1f(this.uBarGap, this.p.barGap);
    gl.uniform1i(this.uLedSegments, Math.round(this.p.ledSegments));
    gl.uniform1i(this.uPeakCaps, this.p.peakCaps ? 1 : 0);
    gl.uniform1f(this.uGlow, this.p.glow);
    gl.uniform1i(this.uColorMode, COLOR_MODE_MAP[this.p.colorMode] ?? 1);

    gl.uniform3f(this.uSolidColor, solidRgb[0], solidRgb[1], solidRgb[2]);
    gl.uniform3f(this.uBaseColor, palette.base[0], palette.base[1], palette.base[2]);
    gl.uniform3f(this.uAccentA, blendedAccent.a[0], blendedAccent.a[1], blendedAccent.a[2]);
    gl.uniform3f(this.uAccentB, blendedAccent.b[0], blendedAccent.b[1], blendedAccent.b[2]);
    gl.uniform1f(this.uLayerOpacity, layerOpacity);

    gl.uniform2fv(this.uInstOffset, this.instOffset);
    gl.uniform4fv(this.uInstTransform, this.instTransform);

    // Bind data textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.audioTex.texture);
    gl.uniform1i(this.uAudioTex, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.peakTex.texture);
    gl.uniform1i(this.uPeakTex, 1);

    // 7. Dispatch draw call
    gl.bindVertexArray(this.vao);

    const isRibbon = (
      this.p.effectType === 'solidLine' ||
      this.p.effectType === 'pulsingLine' ||
      this.p.effectType === 'waveform' ||
      this.p.effectType === 'harmonicWave' ||
      this.p.effectType === 'auroraFill'
    );

    if (isRibbon) {
      gl.uniform1i(this.uIsRibbon, 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (sampleCount + 1) * 2, activePropCount);
    } else {
      gl.uniform1i(this.uIsRibbon, 0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sampleCount * activePropCount);
    }

    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.vao) gl.deleteVertexArray(this.vao);
      if (this.audioTex) gl.deleteTexture(this.audioTex.texture);
      if (this.peakTex) gl.deleteTexture(this.peakTex.texture);
    }
    this.program = null;
    this.vao = null;
    this.audioTex = null;
    this.peakTex = null;
    this.gl = null;
  }
}
