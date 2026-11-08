import { describe, it, expect, vi } from 'vitest';
import {
  AUDIO_TEX_HEIGHT,
  AUDIO_TEX_UNIT,
  AUDIO_TEX_WIDTH,
  BAND_TEXELS,
  BandTexture,
  computeLogSpectrum,
  downsampleWaveform,
  LOG_BINS_COUNT,
  packAudioData,
  packAudioFrame,
  resampleToRow,
} from './bandTexture';
import type { AudioFrame } from '../audio/types';

describe('resampleToRow', () => {
  it('maps a known ramp to 0..1 when the output has as many texels as input', () => {
    expect(Array.from(resampleToRow(new Float32Array([-1, -0.5, 0.5, 1]), 4))).toEqual([0, 0.25, 0.75, 1]);
  });

  it('keeps the sample with the largest magnitude in each bucket', () => {
    // Buckets [-1, -0.5] and [0.5, 1]: the largest magnitudes are -1 and 1.
    expect(Array.from(resampleToRow(new Float32Array([-1, -0.5, 0.5, 1]), 2))).toEqual([0, 1]);
    // One bucket of [0.2, -0.9, 0.5, 0.1]: -0.9 wins, so 0.05.
    expect(resampleToRow(new Float32Array([0.2, -0.9, 0.5, 0.1]), 1)[0]).toBeCloseTo(0.05, 5);
  });

  it('maps silence to 0.5 everywhere', () => {
    const out = resampleToRow(new Float32Array(2048), BAND_TEXELS);
    expect(out.every((v) => v === 0.5)).toBe(true);
  });

  it('returns exactly n texels, and reuses a matching out buffer', () => {
    const src = new Float32Array(2048);
    const out = new Float32Array(BAND_TEXELS);
    const result = resampleToRow(src, BAND_TEXELS, out);
    expect(result.length).toBe(BAND_TEXELS);
    expect(result).toBe(out);
    expect(resampleToRow(src, 64).length).toBe(64);
  });
});

describe('downsampleWaveform (Slice 7.10)', () => {
  it('downsamples waveform to 512 box-averaged samples in [-1, 1]', () => {
    const src = new Float32Array(8192);
    // Fill with DC offset 0.4
    src.fill(0.4);
    const out = downsampleWaveform(src);
    expect(out.length).toBe(512);
    expect(out.every((v) => Math.abs(v - 0.4) < 1e-4)).toBe(true);
  });

  it('box averages multiple samples per bucket', () => {
    // 4 input samples downsampled to 2 output buckets: [0, 1] -> 0.5, [-1, -0.5] -> -0.75
    const src = new Float32Array([0, 1, -1, -0.5]);
    const out = downsampleWaveform(src, 2);
    expect(out[0]).toBeCloseTo(0.5, 4);
    expect(out[1]).toBeCloseTo(-0.75, 4);
  });

  it('clamps output to [-1, 1]', () => {
    const src = new Float32Array([2.5, -3.0]);
    const out = downsampleWaveform(src, 2);
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(-1);
  });

  it('reuses provided output buffer', () => {
    const src = new Float32Array(1024);
    const out = new Float32Array(512);
    const res = downsampleWaveform(src, 512, out);
    expect(res).toBe(out);
  });
});

describe('computeLogSpectrum (Slice 7.10)', () => {
  const SAMPLE_RATE = 48000;
  const FFT_SIZE = 8192;
  const BIN_COUNT = FFT_SIZE / 2; // 4096 bins, resolution = 48000 / 8192 = 5.859 Hz/bin

  it('computes 128 log-spaced bins in [0, 1]', () => {
    const spec = new Float32Array(BIN_COUNT);
    spec.fill(0.5);
    const out = computeLogSpectrum(spec, SAMPLE_RATE, 128, 20, 12000);
    expect(out.length).toBe(128);
    expect(out.every((v) => Math.abs(v - 0.5) < 1e-4)).toBe(true);
  });

  it('maps low-frequency peaks to low bins and high-frequency peaks to high bins', () => {
    const specLow = new Float32Array(BIN_COUNT);
    // Peak at ~60 Hz (bin ~10)
    specLow[10] = 1.0;
    const outLow = computeLogSpectrum(specLow, SAMPLE_RATE, 128, 20, 12000);
    const maxBinLow = outLow.indexOf(Math.max(...outLow));
    expect(maxBinLow).toBeLessThan(30);

    const specHigh = new Float32Array(BIN_COUNT);
    // Peak at ~10 kHz (bin ~1706)
    specHigh[Math.round((10000 * FFT_SIZE) / SAMPLE_RATE)] = 1.0;
    const outHigh = computeLogSpectrum(specHigh, SAMPLE_RATE, 128, 20, 12000);
    const maxBinHigh = outHigh.indexOf(Math.max(...outHigh));
    expect(maxBinHigh).toBeGreaterThan(100);
  });

  it('handles empty spectrum by returning all zeros', () => {
    const out = computeLogSpectrum(new Float32Array(0), SAMPLE_RATE);
    expect(out.length).toBe(LOG_BINS_COUNT);
    expect(out.every((v) => v === 0)).toBe(true);
  });
});

describe('packAudioData and packAudioFrame (Slice 7.10)', () => {
  it('packs 512 waveform samples in Row 0 and 128 log bins in Row 1 zero-padded to 512', () => {
    const waveform = new Float32Array(8192);
    waveform.fill(0.6);
    const spectrum = new Float32Array(4096);
    spectrum.fill(0.8);

    const packed = packAudioData(waveform, spectrum, 48000);
    expect(packed.length).toBe(AUDIO_TEX_WIDTH * AUDIO_TEX_HEIGHT); // 1024

    // Row 0 (0..511): waveform samples in [-1, 1]
    for (let i = 0; i < 512; i++) {
      expect(packed[i]).toBeCloseTo(0.6, 4);
    }

    // Row 1 (512..1023):
    // First 128 bins (512..639): log-spectrum bins in [0, 1]
    for (let i = 512; i < 512 + 128; i++) {
      expect(packed[i]).toBeCloseTo(0.8, 4);
    }
    // Remaining 384 bins (640..1023): zero-padded
    for (let i = 512 + 128; i < 1024; i++) {
      expect(packed[i]).toBe(0);
    }
  });

  it('packAudioFrame delegates to packAudioData with frame properties', () => {
    const frame: AudioFrame = {
      frameIndex: 0,
      time: 0,
      dtSec: 0.016,
      raw: { sub: 0, mid: 0, high: 0 },
      env: { sub: 0, mid: 0, high: 0 },
      norm: { sub: 0, mid: 0, high: 0 },
      loudness: 0,
      energy: 0,
      flux: 0,
      fluxByBand: { sub: 0, mid: 0, high: 0 },
      beat: false,
      beatByBand: { sub: false, mid: false, high: false },
      beatStrength: 0,
      kickEnv: 0.5,
      kickPulse: false,
      waveform: new Float32Array(8192).fill(-0.3),
      bandWaveforms: {
        sub: new Float32Array(8192),
        mid: new Float32Array(8192),
        high: new Float32Array(8192),
      },
      spectrum: new Float32Array(4096).fill(0.7),
      smoothedSpectrum: new Float32Array(4096),
      sampleRate: 48000,
    };

    const out = new Float32Array(1024);
    const packed = packAudioFrame(frame, out);
    expect(packed).toBe(out);
    expect(packed[0]).toBeCloseTo(-0.3, 4);
    expect(packed[512]).toBeCloseTo(0.7, 4);
    expect(packed[1023]).toBe(0);
  });
});

describe('BandTexture WebGL lifecycle (Slice 7.10)', () => {
  function makeMockGl(): WebGL2RenderingContext {
    let nextTexId = 1;
    return {
      TEXTURE_2D: 0x0de1,
      TEXTURE0: 0x84c0,
      TEXTURE4: 0x84c4,
      R32F: 0x822e,
      RED: 0x1903,
      FLOAT: 0x1406,
      NEAREST: 0x2600,
      LINEAR: 0x2601,
      CLAMP_TO_EDGE: 0x812f,
      TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      createTexture: vi.fn(() => ({ id: nextTexId++ } as unknown as WebGLTexture)),
      bindTexture: vi.fn(),
      texImage2D: vi.fn(),
      texSubImage2D: vi.fn(),
      texParameteri: vi.fn(),
      activeTexture: vi.fn(),
      deleteTexture: vi.fn(),
      getExtension: vi.fn().mockReturnValue(null),
    } as unknown as WebGL2RenderingContext;
  }

  it('initializes shared 512x2 texture with NEAREST filtering and uploads single subImage on update', () => {
    const gl = makeMockGl();
    const band = new BandTexture();

    band.init(gl);
    expect(band.getSharedTexture()).not.toBeNull();
    // Verify texImage2D was called for the 512x2 texture
    expect(gl.texImage2D).toHaveBeenCalledWith(
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
    expect(gl.texParameteri).toHaveBeenCalledWith(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

    // Update with AudioFrame
    const frame: AudioFrame = {
      frameIndex: 1,
      time: 0.1,
      dtSec: 0.016,
      raw: { sub: 0, mid: 0, high: 0 },
      env: { sub: 0, mid: 0, high: 0 },
      norm: { sub: 0, mid: 0, high: 0 },
      loudness: 0.5,
      energy: 0.5,
      flux: 0,
      fluxByBand: { sub: 0, mid: 0, high: 0 },
      beat: false,
      beatByBand: { sub: false, mid: false, high: false },
      beatStrength: 0,
      kickEnv: 0.2,
      kickPulse: false,
      waveform: new Float32Array(512),
      bandWaveforms: {
        sub: new Float32Array(512),
        mid: new Float32Array(512),
        high: new Float32Array(512),
      },
      spectrum: new Float32Array(256),
      smoothedSpectrum: new Float32Array(256),
      sampleRate: 48000,
    };

    band.update(gl, frame);
    // Single 512x2 texSubImage2D upload for shared audio texture
    expect(gl.texSubImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      AUDIO_TEX_WIDTH,
      AUDIO_TEX_HEIGHT,
      gl.RED,
      gl.FLOAT,
      band.getStagingBuffer(),
      0,
    );

    // Bind shared texture on TEXTURE4
    const unit = band.bindShared(gl);
    expect(unit).toBe(AUDIO_TEX_UNIT);
    expect(gl.activeTexture).toHaveBeenCalledWith(gl.TEXTURE0 + AUDIO_TEX_UNIT);

    // Dispose deletes all textures
    band.dispose(gl);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(4); // 3 legacy + 1 shared
    expect(band.getSharedTexture()).toBeNull();
  });
});
