// A Scene is a group of layers with its own feedback history (slice 2.2).
// Per frame: decay last frame into `write`, add the layers on top (additive),
// then swap. After the swap, `outputTexture()` is the finished image.
import type { AudioFrame } from '../audio/types';
import { PingPong, clampSize, type PassTarget } from '../gl/fbo';
import { compileProgram, FULLSCREEN_VERT } from '../gl/shader';
import { createVao } from '../gl/vao';
import type { RenderClock } from './clock';
import { bindTarget, type RenderLayer, type RenderTarget } from './layer';
import feedbackSrc from './shaders/feedback.frag.glsl?raw';
import { FEEDBACK_DEFAULTS } from '../presets/layerSchemas';
import { advanceSceneTransform } from './sceneTransformStore';
import { clearTerrainState, getTerrainState } from './terrainStore';
import type { ParamValue } from '../presets/schema';
import { getRenderScale, scaledBufferSize } from '../gl/size';

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
  'uTime', 'uAspect', 'uWrap', 'uHueDrift', 'uBlur', 'uTexel', 'uDecay', 'uFade',
  'uWarpMode', 'uKaleidoN', 'uPortalRadius', 'uRgbSplit', 'uDecayRgb', 'uSobel', 'uSolarize',
  'uSolarizePhase', 'uMobiusPoleOffset', 'uMobiusPolePolarity', 'uWarpAmp',
  'uCurlOctaves', 'uCurlTurbulence', 'uCurlFlowPattern',
  'uRadialFold', 'uMandalaTile', 'uMandalaCounterSpin', 'uMandalaKickFlare',
  'uContourFreq', 'uContourWidth', 'uColorSpread',
  'uMobiusPoleA', 'uMobiusPoleB', 'uMobiusFlow', 'uMobiusSwirl', 'uMobiusMode',
  'uKick', 'uSub', 'uHigh',
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
  private mobiusPolePolarity = 1.0;
  private poleOrbitPhase = 0.0;
  private screenDriftPhase = 0.0;
  private lastPoleA: [number, number] = [-0.48, 0.0];
  private lastPoleB: [number, number] = [0.48, 0.0];
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
  }

  setLayerConfigs(configs: SceneLayerConfig[]): void {
    this.layerConfigs = this.layers.map((_, i) => ({
      opacity: configs[i]?.opacity ?? 1.0,
      blend: configs[i]?.blend ?? 'max',
      trails: configs[i]?.trails ?? true,
    }));
  }

  setLayerConfig(index: number, config: Partial<SceneLayerConfig>): void {
    if (!this.layerConfigs[index]) {
      this.layerConfigs[index] = { opacity: 1.0, blend: 'max', trails: true };
    }
    if (config.opacity !== undefined) this.layerConfigs[index].opacity = config.opacity;
    if (config.blend !== undefined) this.layerConfigs[index].blend = config.blend;
    if (config.trails !== undefined) this.layerConfigs[index].trails = config.trails;
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
    if (!this.blitProg) {
      this.blitProg = compileProgram(gl, FULLSCREEN_VERT, BLIT_FRAG, `blit:${this.name}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, pp.read.framebuffer);
    gl.viewport(0, 0, pp.width, pp.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.blitProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex);
    const uSrc = gl.getUniformLocation(this.blitProg, 'uSrc');
    if (uSrc !== null) gl.uniform1i(uSrc, 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
    this.gl = gl;
    this.prog = compileProgram(gl, FULLSCREEN_VERT, feedbackSrc, `feedback:${this.name}`);
    this.blitProg = compileProgram(gl, FULLSCREEN_VERT, BLIT_FRAG, `blit:${this.name}`);
    this.uni.clear();
    for (const name of UNIFORMS) this.uni.set(name, gl.getUniformLocation(this.prog, name));
    this.vao = createVao(gl);
    const b = scaledBufferSize(this.w, this.h, getRenderScale());
    this.pp = new PingPong(gl, b.width, b.height);
    this.appliedScale = getRenderScale();
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
    const b = scaledBufferSize(this.w, this.h, getRenderScale());
    this.pp?.resize(b.width, b.height);
    if (this.gl) {
      this.freeSnapshot();
      this.snapshotTarget = this.allocateSnapshot(this.gl, b.width, b.height);
    }
    this.appliedScale = getRenderScale();
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
    if (gl && this.pp && getRenderScale() !== this.appliedScale) this.applyScale();
    const pp = this.pp;
    if (!gl || !pp || !this.prog || !this.vao) throw new Error(`Scene ${this.name}: draw before init`);

    const prevTerrain = getTerrainState(gl);
    clearTerrainState(gl);
    const terrainFlow = prevTerrain.active && prevTerrain.terrainFlow > 0 ? prevTerrain.terrainFlow : 0;
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
    const sep = poleOffset * (1.0 + 0.28 * mobiusWander * (Math.sin(this.poleOrbitPhase * 0.63) * 0.5 + (normSub - 0.3) * 0.6));
    const ang = this.poleOrbitPhase * 0.45 * mobiusWander;
    const cosAng = Math.cos(ang);
    const sinAng = Math.sin(ang);
    this.lastPoleA = [centerX - sep * cosAng, centerY - sep * sinAng];
    this.lastPoleB = [centerX + sep * cosAng, centerY + sep * sinAng];

    const target = {
      kind: 'fbo' as const,
      framebuffer: pp.write.framebuffer,
      texture: pp.write.texture,
      width: pp.width,
      height: pp.height,
    };

    // 1A) Decay last frame into the write target (blending off: this is a copy).
    bindTarget(gl, target);
    gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, pp.read.texture);
    this.setFeedbackUniforms(gl, clock.timeSec, pp.width, pp.height, frame, terrainBiasDriftY);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Particles that follow the scene read this frame's zoom and rotation (2026-11-06).
    advanceSceneTransform(
      {
        zoom: Number(this.fb.zoom),
        rotate: Number(this.fb.rotate),
        centreX: Number(this.fb.centreX),
        centreY: Number(this.fb.centreY),
        stretchX: Number(this.fb.stretchX),
        stretchY: Number(this.fb.stretchY),
        warp: Number(this.fb.warp),
        warpScale: Number(this.fb.warpScale),
        warpSpeed: Number(this.fb.warpSpeed),
      },
      clock.timeSec,
    );

    // 1B) Trailing Layers (trails !== false): draw into write target with energy-compensated opacity.
    const decay = this.feedback.decay;
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      if (!layer) continue;
      const cfg = this.layerConfigs[i] ?? { opacity: 1.0, blend: 'max', trails: true };
      if (cfg.trails === false) continue;

      let effectiveOpacity = cfg.opacity ?? 1.0;
      if (decay > 0.05 && (cfg.blend === 'add' || cfg.blend === 'screen')) {
        effectiveOpacity *= (1.0 - decay * 0.45);
      }
      effectiveOpacity *= this.foregroundOpacity;

      const isMoire = ('type' in layer && (layer as unknown as { type: string }).type === 'moire') || layer.constructor?.name === 'MoireLayer';
      let sceneTex: WebGLTexture | null = null;
      if (isMoire && this.snapshotTarget && this.blitProg && this.vao) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.snapshotTarget.framebuffer);
        gl.viewport(0, 0, pp.width, pp.height);
        gl.disable(gl.BLEND);
        gl.useProgram(this.blitProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, target.texture);
        const uSrc = gl.getUniformLocation(this.blitProg, 'uSrc');
        if (uSrc !== null) gl.uniform1i(uSrc, 0);
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

      const drawOpts: LayerDrawOptions = { opacity: effectiveOpacity, uLayerOpacity: effectiveOpacity };
      if (sceneTex) drawOpts.sceneTex = sceneTex;

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
    const hasOverlay = this.layers.some((_, i) => (this.layerConfigs[i]?.trails ?? true) === false);
    if (hasOverlay) {
      if (!this.blitProg) {
        this.blitProg = compileProgram(gl, FULLSCREEN_VERT, BLIT_FRAG, `blit:${this.name}`);
      }
      const writeTarget = {
        kind: 'fbo' as const,
        framebuffer: pp.write.framebuffer,
        texture: pp.write.texture,
        width: pp.width,
        height: pp.height,
      };
      bindTarget(gl, writeTarget);
      gl.viewport(0, 0, pp.width, pp.height);
      gl.disable(gl.BLEND);
      gl.useProgram(this.blitProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, pp.read.texture);
      const uSrc = gl.getUniformLocation(this.blitProg, 'uSrc');
      if (uSrc !== null) gl.uniform1i(uSrc, 0);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, null);

      for (let i = 0; i < this.layers.length; i++) {
        const layer = this.layers[i];
        if (!layer) continue;
        const cfg = this.layerConfigs[i] ?? { opacity: 1.0, blend: 'max', trails: true };
        if (cfg.trails !== false) continue;

        const overlayOpacity = (cfg.opacity ?? 1.0) * this.foregroundOpacity;
        const isMoire = ('type' in layer && (layer as unknown as { type: string }).type === 'moire') || layer.constructor?.name === 'MoireLayer';
        let sceneTex: WebGLTexture | null = null;
        if (isMoire && this.snapshotTarget && this.blitProg && this.vao) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.snapshotTarget.framebuffer);
          gl.viewport(0, 0, pp.width, pp.height);
          gl.disable(gl.BLEND);
          gl.useProgram(this.blitProg);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, writeTarget.texture);
          const uSrc = gl.getUniformLocation(this.blitProg, 'uSrc');
          if (uSrc !== null) gl.uniform1i(uSrc, 0);
          gl.bindVertexArray(this.vao);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindVertexArray(null);
          gl.bindTexture(gl.TEXTURE_2D, null);

          bindTarget(gl, writeTarget);
          sceneTex = this.snapshotTarget.texture;
        }

        applyLayerBlend(gl, cfg.blend);

        if ('opacity' in layer) {
          (layer as unknown as { opacity: number }).opacity = overlayOpacity;
        }
        if (typeof (layer as unknown as { setOpacity?: (o: number) => void }).setOpacity === 'function') {
          (layer as unknown as { setOpacity: (o: number) => void }).setOpacity(overlayOpacity);
        }

        const drawOpts: LayerDrawOptions = { opacity: overlayOpacity, uLayerOpacity: overlayOpacity };
        if (sceneTex) drawOpts.sceneTex = sceneTex;

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

  private setFeedbackUniforms(gl: WebGL2RenderingContext, timeSec: number, width: number, height: number, frame?: AudioFrame, terrainBiasDriftY = 0): void {
    const n = (key: string) => Number(this.fb[key]);
    const u = (name: string) => this.uni.get(name) ?? null;
    gl.uniform1i(u('uPrev'), 0);
    gl.uniform2f(u('uCentre'), n('centreX'), n('centreY'));
    gl.uniform2f(u('uDrift'), n('driftX'), n('driftY') + terrainBiasDriftY);
    gl.uniform2f(u('uStretch'), n('stretchX'), n('stretchY'));
    gl.uniform1f(u('uZoom'), n('zoom'));
    gl.uniform1f(u('uRot'), n('rotate'));
    gl.uniform1f(u('uWarp'), n('warp'));
    gl.uniform1f(u('uWarpScale'), n('warpScale'));
    gl.uniform1f(u('uWarpSpeed'), n('warpSpeed'));
    gl.uniform1f(u('uTime'), timeSec);
    gl.uniform1f(u('uAspect'), width / Math.max(height, 1));
    gl.uniform1f(u('uWrap'), this.fb.wrap === 'wrap' ? 1 : 0);
    gl.uniform1f(u('uHueDrift'), n('hueDrift'));
    gl.uniform1f(u('uBlur'), n('blur'));
    gl.uniform2f(u('uTexel'), 1 / Math.max(width, 1), 1 / Math.max(height, 1));
    gl.uniform1f(u('uDecay'), n('decay'));
    gl.uniform1f(u('uFade'), n('fade'));

    const WARP_MODES: Record<string, number> = {
      classic: 0,
      curl: 1,
      polarFold: 2,
      mobius: 3,
      rgbSplit: 4,
    };
    const modeKey = String(this.fb.warpMode ?? 'classic');
    const warpModeInt = WARP_MODES[modeKey] ?? 0;
    gl.uniform1i?.(u('uWarpMode')!, warpModeInt);

    let kaleidoFolds = n('kaleidoN') || 6;
    if (this.fb.mandalaPattern && this.fb.mandalaPattern !== 'auto') {
      const parsed = parseInt(String(this.fb.mandalaPattern), 10);
      if (!Number.isNaN(parsed) && parsed > 0) kaleidoFolds = parsed;
    }
    gl.uniform1f?.(u('uKaleidoN')!, kaleidoFolds);
    gl.uniform1f?.(u('uPortalRadius')!, n('portalRadius') || 0.0);
    gl.uniform1f?.(u('uRgbSplit')!, n('rgbSplit') || 0.0);

    const dRgb = this.fb.decayRgb;
    const decayRgb: [number, number, number] =
      Array.isArray(dRgb) && dRgb.length === 3
        ? [Number(dRgb[0]), Number(dRgb[1]), Number(dRgb[2])]
        : [1.0, 1.0, 1.0];
    gl.uniform3f?.(u('uDecayRgb')!, decayRgb[0], decayRgb[1], decayRgb[2]);

    gl.uniform1f?.(u('uSobel')!, n('sobel') || 0.0);
    gl.uniform1f?.(u('uSolarize')!, n('solarize') || 0.0);
    gl.uniform1f?.(u('uSolarizePhase')!, timeSec * 2.0);
    const poleOffset = n('mobiusPoleOffset');
    gl.uniform1f?.(u('uMobiusPoleOffset')!, !Number.isNaN(poleOffset) && poleOffset > 0 ? poleOffset : 0.48);
    gl.uniform1f?.(u('uMobiusPolePolarity')!, this.mobiusPolePolarity);
    gl.uniform1f?.(u('uWarpAmp')!, n('warp') || 0.0);

    // Slice 7.22 Curl uniforms:
    gl.uniform1i?.(u('uCurlOctaves')!, Math.max(1, Math.min(3, Math.round(n('curlOctaves') || 2))));
    gl.uniform1f?.(u('uCurlTurbulence')!, Number(this.fb.curlTurbulence ?? 0.45));
    const CURL_PATTERNS: Record<string, number> = {
      plumes: 0,
      eddies: 1,
      outflow: 2,
      inflow: 3,
    };
    const flowKey = String(this.fb.curlFlowPattern ?? 'plumes');
    gl.uniform1i?.(u('uCurlFlowPattern')!, CURL_PATTERNS[flowKey] ?? 0);

    // Slice 7.22 Mandala uniforms:
    gl.uniform1f?.(u('uRadialFold')!, Number(this.fb.radialFold ?? 0.0));
    gl.uniform1f?.(u('uMandalaTile')!, Number(this.fb.mandalaTile ?? 0.0));
    gl.uniform1f?.(u('uMandalaCounterSpin')!, Number(this.fb.mandalaCounterSpin ?? 0.25));
    gl.uniform1f?.(u('uMandalaKickFlare')!, Number(this.fb.mandalaKickFlare ?? 0.35));

    // Slice 7.22 Solarize uniforms:
    gl.uniform1f?.(u('uContourFreq')!, Number(this.fb.contourFreq ?? 7.85));
    gl.uniform1f?.(u('uContourWidth')!, Number(this.fb.contourWidth ?? 0.45));
    gl.uniform1f?.(u('uColorSpread')!, Number(this.fb.colorSpread ?? 0.65));

    // Slice 7.22 / 7.34 Möbius dipole uniforms:
    gl.uniform2f?.(u('uMobiusPoleA')!, this.lastPoleA[0], this.lastPoleA[1]);
    gl.uniform2f?.(u('uMobiusPoleB')!, this.lastPoleB[0], this.lastPoleB[1]);
    gl.uniform1f?.(u('uMobiusFlow')!, Number(this.fb.mobiusFlow ?? 0.85));
    gl.uniform1f?.(u('uMobiusSwirl')!, Number(this.fb.mobiusSwirl ?? 0.65));
    const MOBIUS_MODES: Record<string, number> = {
      auto: 0,
      dipoleFlow: 1,
      doubleVortex: 2,
      figureEight: 3,
      breathingOrbit: 4,
    };
    const mobiusModeKey = String(this.fb.mobiusMode ?? 'auto');
    const mobiusModeInt = MOBIUS_MODES[mobiusModeKey] ?? 0;
    gl.uniform1i?.(u('uMobiusMode')!, mobiusModeInt);

    // Audio modulations:
    gl.uniform1f?.(u('uKick')!, frame?.kickEnv ?? (frame?.raw?.sub ?? 0.0));
    gl.uniform1f?.(u('uSub')!, frame?.norm?.sub ?? (frame?.env?.sub ?? 0.5));
    gl.uniform1f?.(u('uHigh')!, frame?.norm?.high ?? (frame?.env?.high ?? 0.5));
  }

  dispose(): void {
    const gl = this.gl;
    for (const l of this.layers) l.dispose();
    this.pp?.dispose();
    this.freeSnapshot();
    if (gl) {
      if (this.prog) gl.deleteProgram(this.prog);
      if (this.blitProg) gl.deleteProgram(this.blitProg);
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
