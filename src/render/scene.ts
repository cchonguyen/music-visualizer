// A Scene is a group of layers with its own feedback history (slice 2.2).
// Per frame: decay last frame into `write`, add the layers on top (additive),
// then swap. After the swap, `outputTexture()` is the finished image.
import type { AudioFrame } from '../audio/types';
import { PingPong, clampSize, feedbackFormat, type PassTarget } from '../gl/fbo';
import { FULLSCREEN_VERT } from '../gl/shader';
import { getProgramCache } from '../gl/programCache';
import { MoireLayer } from './layers/moire';
import { SpectralTerrainLayer } from './layers/spectralTerrain';
import { createVao } from '../gl/vao';
import { WarpField, activeWarpOpCount, type ResolvedWarpOp } from './warpField';
import { clampDt, type RenderClock } from './clock';
import { bindTarget, type RenderLayer, type RenderTarget } from './layer';
import feedbackSrc from './shaders/feedback.frag.glsl?raw';
import { FEEDBACK_DEFAULTS } from '../presets/layerSchemas';
import { advanceSceneTransform } from './sceneTransformStore';
import { clearTerrainState, getTerrainState } from './terrainStore';
import type { ParamValue } from '../presets/schema';
import { getEffectiveRenderScale, scaledBufferSize } from '../gl/size';

const BLIT_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
out vec4 fragColor;
void main() {
  fragColor = texture(uSrc, vUv);
}
`;

export const FEEDBACK_WARP_DEFAULTS = {
  warpMode: 'classic',
  kaleidoN: 6,
  portalRadius: 0.0,
  rgbSplit: 0.0,
  decayRgb: [1.0, 1.0, 1.0] as [number, number, number],
  sobel: 0.0,
  solarize: 0.0,
  mobiusPoleOffset: 0.48,
  curlOctaves: 2,
  curlTurbulence: 0.45,
  curlFlowPattern: 'plumes',
  radialFold: 0.0,
  mandalaTile: 0.0,
  mandalaCounterSpin: 0.25,
  mandalaKickFlare: 0.35,
  mandalaPattern: 'auto',
  contourFreq: 7.85,
  contourWidth: 0.45,
  colorSpread: 0.65,
  mobiusFlow: 0.85,
  mobiusSwirl: 0.65,
  mobiusWander: 0.55,
  mobiusMode: 'auto',
};

const UNIFORMS = [
  'uPrev', 'uCentre', 'uDrift', 'uStretch', 'uZoom', 'uRot', 'uWarp', 'uWarpScale', 'uWarpSpeed',
  'uTime', 'uDt', 'uAspect', 'uWrap', 'uHueDrift', 'uBlur', 'uTexel', 'uDecay', 'uFade',
  'uWarpMode', 'uKaleidoN', 'uPortalRadius', 'uRgbSplit', 'uDecayRgb', 'uSobel', 'uSolarize',
  'uSolarizePhase', 'uMobiusPoleOffset', 'uWarpAmp',
  'uCurlOctaves', 'uCurlTurbulence', 'uCurlFlowPattern',
  'uRadialFold', 'uMandalaTile', 'uMandalaCounterSpin', 'uMandalaKickFlare',
  'uContourFreq', 'uContourWidth', 'uColorSpread',
  'uMobiusPoleA', 'uMobiusPoleB', 'uMobiusFlow', 'uMobiusSwirl', 'uMobiusMode',
  'uHigh', 'uField', 'uWarpFieldOn',
] as const;

export type BlendMode = 'max' | 'alpha' | 'add' | 'screen';

export interface LayerEntry {
  opacity?: number;
  blend?: BlendMode;
  trails?: boolean;
}

export type SceneLayerConfig = LayerEntry;

export interface LayerDrawOptions {
  opacity?: number;
  uLayerOpacity?: number;
  sceneTex?: WebGLTexture | null;
}

const DEFAULT_LAYER_CONFIG: { opacity: number; blend: BlendMode; trails: boolean } = { opacity: 1.0, blend: 'max', trails: true };
type FboTarget = Extract<RenderTarget, { kind: 'fbo' }>;

const WARP_MODES: Record<string, number> = { classic: 0, curl: 1, polarFold: 2, mobius: 3, rgbSplit: 4 };
const CURL_PATTERNS: Record<string, number> = { plumes: 0, eddies: 1, outflow: 2, inflow: 3 };
const MOBIUS_MODES: Record<string, number> = { auto: 0, dipoleFlow: 1, doubleVortex: 2, figureEight: 3, breathingOrbit: 4 };

export function applyLayerBlend(gl: WebGL2RenderingContext, blend: BlendMode): void {
  gl.enable(gl.BLEND);
  switch (blend) {
    case 'alpha':
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      break;
    case 'add':
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE);
      break;
    case 'screen':
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
      break;
    case 'max':
    default:
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
      break;
  }
}

export class Scene {
  readonly name: string;
  readonly layers: RenderLayer[];
  private layerConfigs: { opacity: number; blend: BlendMode; trails: boolean }[] = [];
  private gl: WebGL2RenderingContext | null = null;
  private pp: PingPong | null = null;
  private prog: WebGLProgram | null = null;
  private blitProg: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private w = 1;
  private h = 1;
  /** Render scale the feedback buffer was last sized for (slice 5.2). */
  private appliedScale: number | null = null;
  /** Feedback settings (slice E1/E3). Set from the preset; defaults keep the old look. */
  private fb: Record<string, ParamValue> = { ...FEEDBACK_DEFAULTS, ...FEEDBACK_WARP_DEFAULTS };
  /** Warp field operators (Slice 18.2). Empty means no field pass and no lookup in the feedback shader. */
  private warpOps: readonly ResolvedWarpOp[] = [];
  private warpField: WarpField | null = null;
  private poleOrbitPhase = 0.0;
  private screenDriftPhase = 0.0;
  private lastPoleA: [number, number] = [-0.48, 0.0];
  private lastPoleB: [number, number] = [0.48, 0.0];
  // Reused every frame so the draw loop builds no objects (Slice 16.8).
  private readonly fboTarget: FboTarget = { kind: 'fbo', framebuffer: null as unknown as WebGLFramebuffer, texture: null as unknown as WebGLTexture, width: 1, height: 1 };
  private readonly overlayTarget: FboTarget = { kind: 'fbo', framebuffer: null as unknown as WebGLFramebuffer, texture: null as unknown as WebGLTexture, width: 1, height: 1 };
  // One options object per layer, reused every frame.
  private readonly layerOpts: LayerDrawOptions[];
  private readonly transformInput = { zoom: 1, rotate: 0, centreX: 0, centreY: 0, stretchX: 1, stretchY: 1, warp: 0, warpScale: 1, warpSpeed: 1 };
  private readonly hasTerrain: boolean;
  private hasOverlay = false;
  private blitSrcLoc: WebGLUniformLocation | null = null;
  private uni = new Map<string, WebGLUniformLocation | null>();
  private foregroundOpacity = 1.0;
  private outputTex: WebGLTexture | null = null;
  private snapshotTarget: PassTarget | null = null;

  constructor(name: string, layers: RenderLayer[], configs: SceneLayerConfig[] = []) {
    this.name = name;
    this.layers = layers;
    this.layerConfigs = layers.map((_, i) => ({
      opacity: configs[i]?.opacity ?? 1.0,
      blend: configs[i]?.blend ?? 'max',
      trails: configs[i]?.trails ?? true,
    }));
    this.layerOpts = layers.map(() => ({}));
    this.hasTerrain = layers.some((layer) => layer instanceof SpectralTerrainLayer);
    this.refreshOverlay();
  }

  /** Whether any layer draws on top of the trails (trails off). Recomputed when the layer settings change. */
  private refreshOverlay(): void {
    this.hasOverlay = this.layerConfigs.some((c, i) => i < this.layers.length && c.trails === false);
  }

  setLayerConfigs(configs: SceneLayerConfig[]): void {
    this.layerConfigs = this.layers.map((_, i) => ({
      opacity: configs[i]?.opacity ?? 1.0,
      blend: configs[i]?.blend ?? 'max',
      trails: configs[i]?.trails ?? true,
    }));
    this.refreshOverlay();
  }

  setLayerConfig(index: number, config: Partial<SceneLayerConfig>): void {
    if (!this.layerConfigs[index]) {
      this.layerConfigs[index] = { opacity: 1.0, blend: 'max', trails: true };
    }
    if (config.opacity !== undefined) this.layerConfigs[index].opacity = config.opacity;
    if (config.blend !== undefined) this.layerConfigs[index].blend = config.blend;
    if (config.trails !== undefined) this.layerConfigs[index].trails = config.trails;
    this.refreshOverlay();
  }

  getLayerConfigs(): readonly { opacity: number; blend: BlendMode; trails: boolean }[] {
    return this.layerConfigs;
  }

  get feedback(): Record<string, ParamValue> & { decay: number } {
    return {
      ...this.fb,
      decay: Number(this.fb.decay ?? FEEDBACK_DEFAULTS.decay),
    };
  }

  /** Sets the trail motion and colour settings. Read on the next frame. */
  setFeedback(values: Record<string, ParamValue>): void {
    this.fb = { ...FEEDBACK_DEFAULTS, ...FEEDBACK_WARP_DEFAULTS, ...values };
  }

  /** Sets the warp field operator stack (Slice 18.2), settings already resolved to values. Read on the next frame. */
  setWarpOps(ops: readonly ResolvedWarpOp[]): void {
    this.warpOps = ops;
  }

  getWarpOps(): readonly ResolvedWarpOp[] {
    return this.warpOps;
  }

  /** Sets foreground layer opacity multiplier (0..1) for morph transitions. */
  setForegroundOpacity(opacity: number): void {
    this.foregroundOpacity = Math.max(0, Math.min(1, opacity));
  }

  getForegroundOpacity(): number {
    return this.foregroundOpacity;
  }

  /**
   * Seeds the feedback loop by blitting sourceTex directly into this scene's read FBO (Slice 7.16).
   * Allows incoming scene's feedback warp to immediately inherit and advect outgoing trails.
   */
  seedFromTexture(sourceTex: WebGLTexture): void {
    const gl = this.gl;
    const pp = this.pp;
    if (!gl || !pp || !this.vao) return;
    this.ensureBlit(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, pp.read.framebuffer);
    gl.viewport(0, 0, pp.width, pp.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.blitProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex);
    if (this.blitSrcLoc !== null) gl.uniform1i(this.blitSrcLoc, 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Gets the shared copy program if this scene has none, and remembers where its texture uniform is. */
  private ensureBlit(gl: WebGL2RenderingContext): void {
    if (this.blitProg) return;
    this.blitProg = getProgramCache(gl).acquire(FULLSCREEN_VERT, BLIT_FRAG, 'blit');
    this.blitSrcLoc = gl.getUniformLocation(this.blitProg, 'uSrc');
  }

  private allocateSnapshot(gl: WebGL2RenderingContext, width: number, height: number): PassTarget {
    const size = clampSize(width, height);
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('could not create snapshot target');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size.width, size.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`snapshot framebuffer incomplete (status ${status})`);
    }
    return { framebuffer, texture };
  }

  private freeSnapshot(): void {
    const gl = this.gl;
    if (gl && this.snapshotTarget) {
      gl.deleteTexture(this.snapshotTarget.texture);
      gl.deleteFramebuffer(this.snapshotTarget.framebuffer);
      this.snapshotTarget = null;
    }
  }

  init(gl: WebGL2RenderingContext): void {
    // Programs are shared between scenes through the cache. A second init without a dispose in
    // between (context restore) holds dead programs, which the cache drops on its own.
    if (this.gl && !this.gl.isContextLost()) this.releasePrograms();
    this.gl = gl;
    const cache = getProgramCache(gl);
    this.prog = cache.acquire(FULLSCREEN_VERT, feedbackSrc, 'feedback');
    this.blitProg = cache.acquire(FULLSCREEN_VERT, BLIT_FRAG, 'blit');
    this.blitSrcLoc = gl.getUniformLocation(this.blitProg, 'uSrc');
    this.warpField = null; // belonged to the old context, rebuilt on demand
    this.uni.clear();
    for (const name of UNIFORMS) this.uni.set(name, gl.getUniformLocation(this.prog, name));
    this.vao = createVao(gl);
    const b = scaledBufferSize(this.w, this.h, getEffectiveRenderScale());
    // Half-float where the context supports it (Slice 16.7). The snapshot below stays 8-bit, which also clamps it to 0..1.
    this.pp = new PingPong(gl, b.width, b.height, feedbackFormat(gl));
    this.appliedScale = getEffectiveRenderScale();
    this.snapshotTarget = this.allocateSnapshot(gl, b.width, b.height);
    for (const l of this.layers) l.init(gl);
  }

  resize(width: number, height: number, dpr: number): void {
    this.w = width;
    this.h = height;
    this.applyScale();
    for (const l of this.layers) l.resize(width, height, dpr);
  }

  /** Sizes the feedback buffer for the current render scale (slice 5.2). */
  private applyScale(): void {
    const b = scaledBufferSize(this.w, this.h, getEffectiveRenderScale());
    this.pp?.resize(b.width, b.height);
    if (this.gl) {
      this.freeSnapshot();
      this.snapshotTarget = this.allocateSnapshot(this.gl, b.width, b.height);
    }
    this.appliedScale = getEffectiveRenderScale();
  }

  /** The finished image of the last draw (valid after draw()). */
  get texture(): WebGLTexture {
    if (!this.pp) throw new Error(`Scene ${this.name}: texture before init`);
    return this.outputTex ?? this.pp.read.texture;
  }

  outputTexture(): WebGLTexture {
    return this.texture;
  }

  draw(frame: AudioFrame, clock: RenderClock): void {
    const gl = this.gl;
    if (gl && this.pp && getEffectiveRenderScale() !== this.appliedScale) this.applyScale();
    const pp = this.pp;
    if (!gl || !pp || !this.prog || !this.vao) throw new Error(`Scene ${this.name}: draw before init`);

    const hasTerrain = this.hasTerrain;
    const prevTerrain = hasTerrain ? getTerrainState(gl) : null;
    if (hasTerrain) {
      clearTerrainState(gl);
    }
    const terrainFlow = prevTerrain && prevTerrain.active && prevTerrain.terrainFlow > 0 ? prevTerrain.terrainFlow : 0;
    const terrainBiasDriftY = terrainFlow > 0 ? -0.012 * terrainFlow : 0;

    const dt = typeof frame?.dtSec === 'number' && Number.isFinite(frame.dtSec) && frame.dtSec > 0 ? frame.dtSec : 1 / 60;
    const normMid = frame?.norm?.mid ?? (frame?.env?.mid ?? 0.5);
    const normSub = frame?.norm?.sub ?? (frame?.env?.sub ?? 0.5);
    this.poleOrbitPhase += dt * (0.28 + normMid * 0.45);
    this.screenDriftPhase += dt * (0.19 + normSub * 0.35);

    const mobiusWander = Number(this.fb.mobiusWander ?? FEEDBACK_WARP_DEFAULTS.mobiusWander);
    const centerX = Math.sin(this.screenDriftPhase) * 0.24 * mobiusWander;
    const centerY = Math.cos(this.screenDriftPhase * 0.77) * 0.16 * mobiusWander;
    const poleOffset = Number(this.fb.mobiusPoleOffset ?? FEEDBACK_WARP_DEFAULTS.mobiusPoleOffset);
    const sep = poleOffset * (1.0 + 0.18 * mobiusWander * Math.sin(this.poleOrbitPhase * 0.63));
    const ang = this.poleOrbitPhase * 0.45 * mobiusWander;
    const cosAng = Math.cos(ang);
    const sinAng = Math.sin(ang);
    this.lastPoleA[0] = centerX - sep * cosAng;
    this.lastPoleA[1] = centerY - sep * sinAng;
    this.lastPoleB[0] = centerX + sep * cosAng;
    this.lastPoleB[1] = centerY + sep * sinAng;

    const target = this.fboTarget;
    target.framebuffer = pp.write.framebuffer;
    target.texture = pp.write.texture;
    target.width = pp.width;
    target.height = pp.height;

    // 0) Warp field: drawn first, only when an operator is active (Slice 18.2).
    let fieldOn = false;
    if (this.warpOps.length > 0 && activeWarpOpCount(this.warpOps) > 0 && this.vao) {
      if (!this.warpField) this.warpField = new WarpField(gl, this.vao, getEffectiveRenderScale());
      this.warpField.setRenderScale(getEffectiveRenderScale());
      const fieldDt = clampDt(clock.dtSec) > 0 ? clampDt(clock.dtSec) : 1 / 60;
      fieldOn = this.warpField.update(this.warpOps, clock.timeSec, fieldDt, pp.width / Math.max(pp.height, 1));
    }

    // 1A) Decay last frame into the write target (blending off: this is a copy).
    bindTarget(gl, target);
    gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, pp.read.texture);
    if (fieldOn && this.warpField) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.warpField.texture);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.uniform1i(this.loc('uField'), 1);
    gl.uniform1f(this.loc('uWarpFieldOn'), fieldOn ? 1 : 0);
    // Feedback rates are per 1/60 s; the shader scales them by uDt so refresh rate does not change the look (Slice 14.6).
    const stepDt = clampDt(clock.dtSec) > 0 ? clampDt(clock.dtSec) : 1 / 60;
    this.setFeedbackUniforms(gl, clock.timeSec, pp.width, pp.height, frame, terrainBiasDriftY, stepDt);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Particles that follow the scene read this frame's zoom and rotation (2026-11-06).
    const ti = this.transformInput;
    ti.zoom = Number(this.fb.zoom);
    ti.rotate = Number(this.fb.rotate);
    ti.centreX = Number(this.fb.centreX);
    ti.centreY = Number(this.fb.centreY);
    ti.stretchX = Number(this.fb.stretchX);
    ti.stretchY = Number(this.fb.stretchY);
    ti.warp = Number(this.fb.warp);
    ti.warpScale = Number(this.fb.warpScale);
    ti.warpSpeed = Number(this.fb.warpSpeed);
    advanceSceneTransform(ti, clock.timeSec);

    // 1B) Trailing Layers (trails !== false): draw into write target with energy-compensated opacity.
    const decay = Number(this.fb.decay ?? FEEDBACK_DEFAULTS.decay);
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      if (!layer) continue;
      const cfg = this.layerConfigs[i] ?? DEFAULT_LAYER_CONFIG;
      if (cfg.trails === false) continue;

      let effectiveOpacity = cfg.opacity ?? 1.0;
      if (decay > 0.05 && (cfg.blend === 'add' || cfg.blend === 'screen')) {
        effectiveOpacity *= (1.0 - decay * 0.45);
      }
      effectiveOpacity *= this.foregroundOpacity;

      const isMoire = layer instanceof MoireLayer;
      let sceneTex: WebGLTexture | null = null;
      if (isMoire && this.snapshotTarget && this.blitProg && this.vao) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.snapshotTarget.framebuffer);
        gl.viewport(0, 0, pp.width, pp.height);
        gl.disable(gl.BLEND);
        gl.useProgram(this.blitProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, target.texture);
        if (this.blitSrcLoc !== null) gl.uniform1i(this.blitSrcLoc, 0);
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
        gl.bindTexture(gl.TEXTURE_2D, null);

        bindTarget(gl, target);
        sceneTex = this.snapshotTarget.texture;
      }

      applyLayerBlend(gl, cfg.blend);

      if ('opacity' in layer) {
        (layer as unknown as { opacity: number }).opacity = effectiveOpacity;
      }
      if (typeof (layer as unknown as { setOpacity?: (o: number) => void }).setOpacity === 'function') {
        (layer as unknown as { setOpacity: (o: number) => void }).setOpacity(effectiveOpacity);
      }

      const drawOpts = this.layerOpts[i]!;
      drawOpts.opacity = effectiveOpacity;
      drawOpts.uLayerOpacity = effectiveOpacity;
      if (sceneTex) drawOpts.sceneTex = sceneTex;
      else if (drawOpts.sceneTex) drawOpts.sceneTex = undefined;

      (layer.draw as (f: AudioFrame, c: RenderClock, t: RenderTarget, opt?: LayerDrawOptions) => void)(
        frame,
        clock,
        target,
        drawOpts,
      );

      // Restore default GL blend state immediately after each layer draw
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
    }
    gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.bindVertexArray(null);

    // Swap: pp.read now holds the pure feedback loop state for the next frame.
    pp.swap();

    // 1C) Sharp Overlay Layers: if any enabled layer has trails === false,
    // copy pp.read.texture into pp.write.fbo, draw trails: false layers on top, and point outputTex to pp.write.texture.
    const hasOverlay = this.hasOverlay;
    if (hasOverlay) {
      this.ensureBlit(gl);
      const writeTarget = this.overlayTarget;
      writeTarget.framebuffer = pp.write.framebuffer;
      writeTarget.texture = pp.write.texture;
      writeTarget.width = pp.width;
      writeTarget.height = pp.height;
      bindTarget(gl, writeTarget);
      gl.viewport(0, 0, pp.width, pp.height);
      gl.disable(gl.BLEND);
      gl.useProgram(this.blitProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, pp.read.texture);
      if (this.blitSrcLoc !== null) gl.uniform1i(this.blitSrcLoc, 0);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, null);

      for (let i = 0; i < this.layers.length; i++) {
        const layer = this.layers[i];
        if (!layer) continue;
        const cfg = this.layerConfigs[i] ?? DEFAULT_LAYER_CONFIG;
        if (cfg.trails !== false) continue;

        const overlayOpacity = (cfg.opacity ?? 1.0) * this.foregroundOpacity;
        const isMoire = layer instanceof MoireLayer;
        // The overlay buffer began as a copy of the finished trail image, which is exactly what pp.read holds and
        // is not being drawn into, so the moire layer reads it directly. No extra full-size copy (Slice 16.10).
        const sceneTex: WebGLTexture | null = isMoire ? pp.read.texture : null;

        applyLayerBlend(gl, cfg.blend);

        if ('opacity' in layer) {
          (layer as unknown as { opacity: number }).opacity = overlayOpacity;
        }
        if (typeof (layer as unknown as { setOpacity?: (o: number) => void }).setOpacity === 'function') {
          (layer as unknown as { setOpacity: (o: number) => void }).setOpacity(overlayOpacity);
        }

        const drawOpts = this.layerOpts[i]!;
        drawOpts.opacity = overlayOpacity;
        drawOpts.uLayerOpacity = overlayOpacity;
        if (sceneTex) drawOpts.sceneTex = sceneTex;
        else if (drawOpts.sceneTex) drawOpts.sceneTex = undefined;

        (layer.draw as (f: AudioFrame, c: RenderClock, t: RenderTarget, opt?: LayerDrawOptions) => void)(
          frame,
          clock,
          writeTarget,
          drawOpts,
        );

        // Restore default GL blend state immediately after each layer draw
        gl.blendEquation(gl.MAX);
        gl.blendFunc(gl.ONE, gl.ONE);
      }
      gl.disable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.bindVertexArray(null);

      this.outputTex = pp.write.texture;
    } else {
      this.outputTex = null;
    }
  }

  private num(key: string): number {
    return Number(this.fb[key]);
  }

  private loc(name: string): WebGLUniformLocation | null {
    return this.uni.get(name) ?? null;
  }

  private setFeedbackUniforms(gl: WebGL2RenderingContext, timeSec: number, width: number, height: number, frame?: AudioFrame, terrainBiasDriftY = 0, stepDt = 1 / 60): void {
    gl.uniform1i(this.loc('uPrev'), 0);
    gl.uniform2f(this.loc('uCentre'), this.num('centreX'), this.num('centreY'));
    gl.uniform2f(this.loc('uDrift'), this.num('driftX'), this.num('driftY') + terrainBiasDriftY);
    gl.uniform2f(this.loc('uStretch'), this.num('stretchX'), this.num('stretchY'));
    gl.uniform1f(this.loc('uZoom'), this.num('zoom'));
    gl.uniform1f(this.loc('uRot'), this.num('rotate'));
    gl.uniform1f(this.loc('uWarp'), this.num('warp'));
    gl.uniform1f(this.loc('uWarpScale'), this.num('warpScale'));
    gl.uniform1f(this.loc('uWarpSpeed'), this.num('warpSpeed'));
    gl.uniform1f(this.loc('uTime'), timeSec);
    gl.uniform1f(this.loc('uDt'), stepDt);
    gl.uniform1f(this.loc('uAspect'), width / Math.max(height, 1));
    gl.uniform1f(this.loc('uWrap'), this.fb.wrap === 'wrap' ? 1 : 0);
    gl.uniform1f(this.loc('uHueDrift'), this.num('hueDrift'));
    gl.uniform1f(this.loc('uBlur'), this.num('blur'));
    gl.uniform2f(this.loc('uTexel'), 1 / Math.max(width, 1), 1 / Math.max(height, 1));
    gl.uniform1f(this.loc('uDecay'), this.num('decay'));
    gl.uniform1f(this.loc('uFade'), this.num('fade'));

    const modeKey = String(this.fb.warpMode ?? 'classic');
    const warpModeInt = WARP_MODES[modeKey] ?? 0;
    gl.uniform1i?.(this.loc('uWarpMode')!, warpModeInt);

    let kaleidoFolds = this.num('kaleidoN') || 6;
    if (this.fb.mandalaPattern && this.fb.mandalaPattern !== 'auto') {
      const parsed = parseInt(String(this.fb.mandalaPattern), 10);
      if (!Number.isNaN(parsed) && parsed > 0) kaleidoFolds = parsed;
    }
    gl.uniform1f?.(this.loc('uKaleidoN')!, kaleidoFolds);
    gl.uniform1f?.(this.loc('uPortalRadius')!, this.num('portalRadius') || 0.0);
    gl.uniform1f?.(this.loc('uRgbSplit')!, this.num('rgbSplit') || 0.0);

    const dRgb = this.fb.decayRgb;
    if (Array.isArray(dRgb) && dRgb.length === 3) {
      gl.uniform3f?.(this.loc('uDecayRgb')!, Number(dRgb[0]), Number(dRgb[1]), Number(dRgb[2]));
    } else {
      gl.uniform3f?.(this.loc('uDecayRgb')!, 1.0, 1.0, 1.0);
    }

    gl.uniform1f?.(this.loc('uSobel')!, this.num('sobel') || 0.0);
    gl.uniform1f?.(this.loc('uSolarize')!, this.num('solarize') || 0.0);
    gl.uniform1f?.(this.loc('uSolarizePhase')!, timeSec * 2.0);
    const poleOffset = this.num('mobiusPoleOffset');
    gl.uniform1f?.(this.loc('uMobiusPoleOffset')!, !Number.isNaN(poleOffset) && poleOffset > 0 ? poleOffset : 0.48);
    gl.uniform1f?.(this.loc('uWarpAmp')!, this.num('warp') || 0.0);

    // Slice 7.22 Curl uniforms:
    gl.uniform1i?.(this.loc('uCurlOctaves')!, Math.max(1, Math.min(3, Math.round(this.num('curlOctaves') || 2))));
    gl.uniform1f?.(this.loc('uCurlTurbulence')!, Number(this.fb.curlTurbulence ?? 0.45));
    const flowKey = String(this.fb.curlFlowPattern ?? 'plumes');
    gl.uniform1i?.(this.loc('uCurlFlowPattern')!, CURL_PATTERNS[flowKey] ?? 0);

    // Slice 7.22 Mandala uniforms:
    gl.uniform1f?.(this.loc('uRadialFold')!, Number(this.fb.radialFold ?? 0.0));
    gl.uniform1f?.(this.loc('uMandalaTile')!, Number(this.fb.mandalaTile ?? 0.0));
    gl.uniform1f?.(this.loc('uMandalaCounterSpin')!, Number(this.fb.mandalaCounterSpin ?? 0.25));
    gl.uniform1f?.(this.loc('uMandalaKickFlare')!, Number(this.fb.mandalaKickFlare ?? 0.35));

    // Slice 7.22 Solarize uniforms:
    gl.uniform1f?.(this.loc('uContourFreq')!, Number(this.fb.contourFreq ?? 7.85));
    gl.uniform1f?.(this.loc('uContourWidth')!, Number(this.fb.contourWidth ?? 0.45));
    gl.uniform1f?.(this.loc('uColorSpread')!, Number(this.fb.colorSpread ?? 0.65));

    // Slice 7.22 / 7.34 Möbius dipole uniforms:
    gl.uniform2f?.(this.loc('uMobiusPoleA')!, this.lastPoleA[0], this.lastPoleA[1]);
    gl.uniform2f?.(this.loc('uMobiusPoleB')!, this.lastPoleB[0], this.lastPoleB[1]);
    gl.uniform1f?.(this.loc('uMobiusFlow')!, Number(this.fb.mobiusFlow ?? 0.85));
    gl.uniform1f?.(this.loc('uMobiusSwirl')!, Number(this.fb.mobiusSwirl ?? 0.65));
    const mobiusModeKey = String(this.fb.mobiusMode ?? 'auto');
    const mobiusModeInt = MOBIUS_MODES[mobiusModeKey] ?? 0;
    gl.uniform1i?.(this.loc('uMobiusMode')!, mobiusModeInt);

    // Audio modulations:
    gl.uniform1f?.(this.loc('uHigh')!, frame?.norm?.high ?? (frame?.env?.high ?? 0.5));
  }

  /**
   * Clears the trail history to transparent black, the state a freshly made scene starts in. Used when
   * a kept scene comes back on screen (Slice 16.3), so it does not show the last frame it drew.
   */
  clearBuffers(): void {
    const gl = this.gl;
    const pp = this.pp;
    if (!gl || !pp) return;
    gl.clearColor(0, 0, 0, 0);
    for (const t of [pp.read, pp.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Lets go of this scene's shared programs. The cache keeps them for the next scene. */
  private releasePrograms(): void {
    const gl = this.gl;
    if (!gl) return;
    this.warpField?.dispose();
    this.warpField = null;
    const cache = getProgramCache(gl);
    if (this.prog) cache.release(this.prog);
    if (this.blitProg) cache.release(this.blitProg);
    this.prog = null;
    this.blitProg = null;
    this.blitSrcLoc = null;
  }

  dispose(): void {
    const gl = this.gl;
    for (const l of this.layers) l.dispose();
    this.pp?.dispose();
    this.freeSnapshot();
    if (gl) {
      this.releasePrograms();
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.pp = null;
    this.prog = null;
    this.blitProg = null;
    this.vao = null;
    this.gl = null;
    this.outputTex = null;
    this.foregroundOpacity = 1.0;
  }
}
