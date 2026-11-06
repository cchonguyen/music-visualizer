// Band waveforms as one-row float textures (slice 6.2). Each of sub, mid and high is
// resampled to BAND_TEXELS texels, mapped from -1..1 to 0..1 (silence = 0.5), and read in
// shaders with texture(tex, vec2(u, 0.5)).r. Built on the shared helpers in gl/texture.ts.
import type { BandWaveforms } from '../audio/types';
import { createDataTexture, type DataTexture, updateDataTexture } from '../gl/texture';

export const BAND_TEXELS = 256;

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

interface BandTextures {
  sub: DataTexture;
  mid: DataTexture;
  high: DataTexture;
}

export class BandTexture {
  private tex: BandTextures | null = null;
  private readonly scratch = new Float32Array(BAND_TEXELS);

  init(gl: WebGL2RenderingContext): void {
    // Fresh construction: drop any references from before a context restore (no delete: the old context is gone).
    this.tex = {
      sub: createDataTexture(gl, BAND_TEXELS),
      mid: createDataTexture(gl, BAND_TEXELS),
      high: createDataTexture(gl, BAND_TEXELS),
    };
  }

  update(gl: WebGL2RenderingContext, bands: BandWaveforms): void {
    if (!this.tex) throw new Error('BandTexture: update before init');
    this.upload(gl, this.tex.sub, bands.sub);
    this.upload(gl, this.tex.mid, bands.mid);
    this.upload(gl, this.tex.high, bands.high);
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

  dispose(gl: WebGL2RenderingContext): void {
    if (this.tex) {
      gl.deleteTexture(this.tex.sub.texture);
      gl.deleteTexture(this.tex.mid.texture);
      gl.deleteTexture(this.tex.high.texture);
    }
    this.tex = null;
  }

  private upload(gl: WebGL2RenderingContext, tex: DataTexture, src: Float32Array): void {
    updateDataTexture(gl, tex, resampleToRow(src, BAND_TEXELS, this.scratch));
  }
}
