// Band waveforms as one-row float textures (slice 6.2) and unified 512x2 audio data texture (slice 7.10).
// Row 0 (y = 0): 512 box-averaged time-domain waveform samples in [-1, 1].
// Row 1 (y = 1): 128 log-spaced frequency bins (20 Hz – 12 kHz) in [0, 1], zero-padded to 512.
// Read in shaders with texture(tex, vec2(u, y)).r on TEXTURE4.
import type { AudioFrame, BandWaveforms } from '../audio/types';
import { createDataTexture, type DataTexture, updateDataTexture } from '../gl/texture';

export const BAND_TEXELS = 256;
export const AUDIO_TEX_WIDTH = 512;
export const AUDIO_TEX_HEIGHT = 2;
export const AUDIO_TEX_UNIT = 4; // TEXTURE4
export const LOG_BINS_COUNT = 128;
export const LOG_FREQ_MIN = 20;
export const LOG_FREQ_MAX = 12000;

/**
 * Resamples a signed waveform into `n` texels in 0..1. Each output texel is the input
 * sample with the largest absolute magnitude in its bucket, remapped as v * 0.5 + 0.5.
 * Silence maps to 0.5. Pass `out` (length n) to reuse a buffer and avoid allocation.
 */
export function resampleToRow(src: Float32Array, n: number, out?: Float32Array): Float32Array {
  const row = out && out.length === n ? out : new Float32Array(n);
  const len = src.length;
  for (let i = 0; i < n; i++) {
    const start = Math.floor((i * len) / n);
    const end = Math.max(start + 1, Math.floor(((i + 1) * len) / n));
    let best = 0;
    for (let j = start; j < end && j < len; j++) {
      const v = src[j] ?? 0;
      if (Math.abs(v) > Math.abs(best)) best = v;
    }
    row[i] = Math.min(1, Math.max(0, best * 0.5 + 0.5));
  }
  return row;
}

/**
 * Downsamples a time-domain waveform to `n` samples via box averaging.
 * Values are clamped to [-1, 1]. Pass `out` (length n) to avoid allocation.
 */
export function downsampleWaveform(
  src: Float32Array,
  n: number = AUDIO_TEX_WIDTH,
  out?: Float32Array,
): Float32Array {
  const row = out && out.length === n ? out : new Float32Array(n);
  const len = src.length;
  if (len === 0) {
    row.fill(0);
    return row;
  }
  for (let i = 0; i < n; i++) {
    const start = Math.floor((i * len) / n);
    const end = Math.floor(((i + 1) * len) / n);
    const stop = Math.min(len, Math.max(start + 1, end));
    let sum = 0;
    for (let j = start; j < stop; j++) {
      sum += src[j] ?? 0;
    }
    const avg = sum / (stop - start);
    row[i] = Math.min(1, Math.max(-1, avg));
  }
  return row;
}

/**
 * Resamples linear FFT spectrum bins into `numBins` log-spaced frequency bins from `minHz` to `maxHz`.
 * Output values are in [0, 1]. Pass `out` (length numBins) to avoid allocation.
 */
export function computeLogSpectrum(
  spectrum: Float32Array,
  sampleRate: number,
  numBins: number = LOG_BINS_COUNT,
  minHz: number = LOG_FREQ_MIN,
  maxHz: number = LOG_FREQ_MAX,
  out?: Float32Array,
): Float32Array {
  const row = out && out.length === numBins ? out : new Float32Array(numBins);
  const len = spectrum.length;
  if (len === 0 || sampleRate <= 0) {
    row.fill(0);
    return row;
  }
  const binHz = sampleRate / (2 * len);
  const logRatio = Math.log(maxHz / minHz);

  for (let k = 0; k < numBins; k++) {
    const fLo = minHz * Math.exp((k * logRatio) / numBins);
    const fHi = minHz * Math.exp(((k + 1) * logRatio) / numBins);
    const startBin = Math.min(len - 1, Math.max(0, Math.floor(fLo / binHz)));
    const endBin = Math.min(len, Math.max(startBin + 1, Math.ceil(fHi / binHz)));

    let sum = 0;
    let count = 0;
    for (let b = startBin; b < endBin; b++) {
      sum += spectrum[b] ?? 0;
      count++;
    }
    const avg = count > 0 ? sum / count : (spectrum[startBin] ?? 0);
    row[k] = Math.min(1, Math.max(0, avg));
  }
  return row;
}

/**
 * Packs 512 waveform samples in [-1, 1] into Row 0, and 128 log-spectrum bins in [0, 1]
 * (zero-padded from 128 to 511) into Row 1 of a 512 x 2 buffer (length 1024).
 * Pass `out` (length 1024) to avoid allocation.
 */
export function packAudioData(
  waveform: Float32Array,
  spectrum: Float32Array,
  sampleRate: number,
  out?: Float32Array,
): Float32Array {
  const buf =
    out && out.length === AUDIO_TEX_WIDTH * AUDIO_TEX_HEIGHT
      ? out
      : new Float32Array(AUDIO_TEX_WIDTH * AUDIO_TEX_HEIGHT);

  // Row 0 (y = 0): 512 box-averaged waveform samples in [-1, 1]
  downsampleWaveform(waveform, AUDIO_TEX_WIDTH, buf.subarray(0, AUDIO_TEX_WIDTH));

  // Row 1 (y = 1): 128 log-spaced bins in [0, 1] zero-padded from 128 to 511
  const row1 = buf.subarray(AUDIO_TEX_WIDTH, AUDIO_TEX_WIDTH * 2);
  row1.fill(0);
  computeLogSpectrum(
    spectrum,
    sampleRate,
    LOG_BINS_COUNT,
    LOG_FREQ_MIN,
    LOG_FREQ_MAX,
    row1.subarray(0, LOG_BINS_COUNT),
  );

  return buf;
}

export function packAudioFrame(frame: AudioFrame, out?: Float32Array): Float32Array {
  return packAudioData(frame.waveform, frame.spectrum, frame.sampleRate, out);
}

interface BandTextures {
  sub: DataTexture;
  mid: DataTexture;
  high: DataTexture;
}

export class BandTexture {
  private tex: BandTextures | null = null;
  private sharedTex: WebGLTexture | null = null;
  private readonly scratch = new Float32Array(BAND_TEXELS);
  private readonly staging = new Float32Array(AUDIO_TEX_WIDTH * AUDIO_TEX_HEIGHT);

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction: drop any references from before a context restore (no delete: the old context is gone).
    this.tex = {
      sub: createDataTexture(gl, BAND_TEXELS),
      mid: createDataTexture(gl, BAND_TEXELS),
      high: createDataTexture(gl, BAND_TEXELS),
    };

    // Shared 512x2 R32F audio texture with gl.NEAREST filtering
    const shared = gl.createTexture();
    if (!shared) throw new Error('BandTexture: could not create shared audio texture');
    gl.bindTexture(gl.TEXTURE_2D, shared);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      AUDIO_TEX_WIDTH,
      AUDIO_TEX_HEIGHT,
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
    this.sharedTex = shared;
  }

  update(gl: WebGL2RenderingContext, input: BandWaveforms | AudioFrame): void {
    if (!this.tex) throw new Error('BandTexture: update before init');
    if ('bandWaveforms' in input) {
      this.upload(gl, this.tex.sub, input.bandWaveforms.sub);
      this.upload(gl, this.tex.mid, input.bandWaveforms.mid);
      this.upload(gl, this.tex.high, input.bandWaveforms.high);
      this.updateShared(gl, input);
    } else {
      this.upload(gl, this.tex.sub, input.sub);
      this.upload(gl, this.tex.mid, input.mid);
      this.upload(gl, this.tex.high, input.high);
    }
  }

  updateShared(gl: WebGL2RenderingContext, frame: AudioFrame): void {
    if (!this.sharedTex) throw new Error('BandTexture: updateShared before init');
    packAudioData(frame.waveform, frame.spectrum, frame.sampleRate, this.staging);
    gl.bindTexture(gl.TEXTURE_2D, this.sharedTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      AUDIO_TEX_WIDTH,
      AUDIO_TEX_HEIGHT,
      gl.RED,
      gl.FLOAT,
      this.staging,
      0,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Binds sub, mid and high to units firstUnit, firstUnit + 1, firstUnit + 2.
   * Leaves the active unit at TEXTURE0. Returns firstUnit.
   */
  bind(gl: WebGL2RenderingContext, firstUnit: number): number {
    if (!this.tex) throw new Error('BandTexture: bind before init');
    const units = [this.tex.sub, this.tex.mid, this.tex.high];
    units.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + firstUnit + i);
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
    });
    gl.activeTexture(gl.TEXTURE0);
    return firstUnit;
  }

  /**
   * Binds the shared 512x2 audio data texture to unit (default TEXTURE4).
   * Leaves the active unit at TEXTURE0. Returns unit.
   */
  bindShared(gl: WebGL2RenderingContext, unit: number = AUDIO_TEX_UNIT): number {
    if (!this.sharedTex) throw new Error('BandTexture: bindShared before init');
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.sharedTex);
    gl.activeTexture(gl.TEXTURE0);
    return unit;
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.tex) {
      gl.deleteTexture(this.tex.sub.texture);
      gl.deleteTexture(this.tex.mid.texture);
      gl.deleteTexture(this.tex.high.texture);
    }
    this.tex = null;
    if (this.sharedTex) {
      gl.deleteTexture(this.sharedTex);
      this.sharedTex = null;
    }
  }

  getSharedTexture(): WebGLTexture | null {
    return this.sharedTex;
  }

  getStagingBuffer(): Float32Array {
    return this.staging;
  }

  private upload(gl: WebGL2RenderingContext, tex: DataTexture, src: Float32Array): void {
    updateDataTexture(gl, tex, resampleToRow(src, BAND_TEXELS, this.scratch));
  }
}
