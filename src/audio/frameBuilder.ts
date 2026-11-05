// NOTE(spec): frameIndex is 0 on the first build and increments by one per
// build after that (reset() puts it back to 0). Frames with dtSec 0 still feed
// the normalizers so a peak can register, but envelopes do not move because no
// time has elapsed.
//
// NOTE(spec): the spec asks for computeBands, which returns a fresh BandLevels
// object. That small object is copied into the reused frame immediately; the
// large arrays (waveform, spectrum, smoothedSpectrum) are allocated once and
// reused, which is the allocation that matters for frame-rate stability.

import { byteSpectrumToUnit, binForFrequency, computeBands } from "./bands";
import { BandSplitter } from "./bandWaveforms";
import { Envelope } from "./envelope";
import { RollingNormalizer } from "./normalize";
import { OnsetDetector, spectralFlux } from "./onset";
import type { AudioFrame, BandFlags, BandLevels, BandWaveforms } from "./types";

export const SIGNAL_EPS = 0.02;

const ATTACK_MS = 10;
const RELEASE_MS = 250;

// Rolling normalizer settings from the slice contract.
const BAND_NORM_TAU_SEC = 12;
const BAND_NORM_FLOOR = 0.02;
const ENERGY_NORM_TAU_SEC = 20;
// Perceptual loudness window for RMS (Council round 2).
const LOUDNESS_MIN_DB = -50;
const LOUDNESS_MAX_DB = -6;
const ENERGY_NORM_FLOOR = 0.02;

// Same ranges as bands.ts. End bins are exclusive so each bin belongs to one band.
const SUB_LO_HZ = 20;
const SUB_HI_HZ = 120;
const MID_LO_HZ = 120;
const MID_HI_HZ = 2500;
const HIGH_LO_HZ = 2500;
const HIGH_HI_HZ = 10000;

function endBinExclusive(hz: number, sampleRate: number, fftSize: number): number {
  // Mirrors bandLevel's exclusive end: round to a bin, clamp to the half-spectrum.
  return Math.min(
    fftSize / 2,
    Math.max(0, Math.round((hz * fftSize) / sampleRate)),
  );
}

/** RMS of a waveform, mapped from LOUDNESS_MIN_DB..LOUDNESS_MAX_DB dBFS to 0..1. */
export function loudnessFromWaveform(wave: Float32Array): number {
  if (wave.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < wave.length; i += 1) {
    const v = wave[i] ?? 0;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / wave.length);
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  const t = (db - LOUDNESS_MIN_DB) / (LOUDNESS_MAX_DB - LOUDNESS_MIN_DB);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function makeLevels(): BandLevels {
  return { sub: 0, mid: 0, high: 0 };
}

function makeFlags(): BandFlags {
  return { sub: false, mid: false, high: false };
}

export class FrameBuilder {
  private readonly sampleRate: number;
  private readonly fftSize: number;

  // Band bin ranges, all as [startBin, endBin) in the half-spectrum.
  private readonly subStartBin: number;
  private readonly subEndBin: number;
  private readonly midStartBin: number;
  private readonly midEndBin: number;
  private readonly highStartBin: number;
  private readonly highEndBin: number;

  // One follower and one normalizer per band.
  private readonly subEnvelope: Envelope;
  private readonly midEnvelope: Envelope;
  private readonly highEnvelope: Envelope;
  private readonly subNormalizer: RollingNormalizer;
  private readonly midNormalizer: RollingNormalizer;
  private readonly highNormalizer: RollingNormalizer;

  // Energy gets its own envelope and a slower normalizer so swells read as swells.
  private readonly energyEnvelope: Envelope;
  private readonly energyNormalizer: RollingNormalizer;

  // One onset detector per band; the sub detector also supplies beatStrength.
  private readonly subDetector: OnsetDetector;
  private readonly midDetector: OnsetDetector;
  private readonly highDetector: OnsetDetector;

  // Reused input/output arrays. Never reallocated after construction.
  private readonly spectrum: Float32Array;
  private readonly prevSpectrum: Float32Array;
  private readonly smoothedSpectrum: Float32Array;
  private readonly waveform: Float32Array;
  // Sub / mid / high copies of the waveform, same length as waveform.
  private readonly bandWaveforms: BandWaveforms;
  private readonly splitter: BandSplitter;

  // The frame and its nested objects are reused too; callers must not keep a
  // frame past the next build().
  private readonly frame: AudioFrame;

  private hasPrevSpectrum = false;
  private frameIndex = 0;
  private prevTime: number | null = null;

  constructor(sampleRate: number, fftSize: number) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;

    this.subStartBin = binForFrequency(SUB_LO_HZ, sampleRate, fftSize);
    this.subEndBin = endBinExclusive(SUB_HI_HZ, sampleRate, fftSize);
    this.midStartBin = binForFrequency(MID_LO_HZ, sampleRate, fftSize);
    this.midEndBin = endBinExclusive(MID_HI_HZ, sampleRate, fftSize);
    this.highStartBin = binForFrequency(HIGH_LO_HZ, sampleRate, fftSize);
    this.highEndBin = endBinExclusive(HIGH_HI_HZ, sampleRate, fftSize);

    this.subEnvelope = new Envelope(ATTACK_MS, RELEASE_MS);
    this.midEnvelope = new Envelope(ATTACK_MS, RELEASE_MS);
    this.highEnvelope = new Envelope(ATTACK_MS, RELEASE_MS);
    this.subNormalizer = new RollingNormalizer(BAND_NORM_TAU_SEC, BAND_NORM_FLOOR, SIGNAL_EPS);
    this.midNormalizer = new RollingNormalizer(BAND_NORM_TAU_SEC, BAND_NORM_FLOOR, SIGNAL_EPS);
    this.highNormalizer = new RollingNormalizer(BAND_NORM_TAU_SEC, BAND_NORM_FLOOR, SIGNAL_EPS);

    this.energyEnvelope = new Envelope(ATTACK_MS, RELEASE_MS);
    this.energyNormalizer = new RollingNormalizer(
      ENERGY_NORM_TAU_SEC,
      ENERGY_NORM_FLOOR,
      SIGNAL_EPS,
    );

    this.subDetector = new OnsetDetector();
    this.midDetector = new OnsetDetector();
    this.highDetector = new OnsetDetector();

    const binCount = Math.max(0, Math.floor(fftSize / 2));
    this.spectrum = new Float32Array(binCount);
    this.prevSpectrum = new Float32Array(binCount);
    this.smoothedSpectrum = new Float32Array(binCount);
    this.waveform = new Float32Array(Math.max(0, Math.floor(fftSize)));
    this.bandWaveforms = {
      sub: new Float32Array(this.waveform.length),
      mid: new Float32Array(this.waveform.length),
      high: new Float32Array(this.waveform.length),
    };
    this.splitter = new BandSplitter(sampleRate);

    this.frame = {
      frameIndex: 0,
      time: 0,
      dtSec: 0,
      raw: makeLevels(),
      env: makeLevels(),
      norm: makeLevels(),
      loudness: 0,
      energy: 0,
      flux: 0,
      fluxByBand: makeLevels(),
      beat: false,
      beatByBand: makeFlags(),
      beatStrength: 0,
      waveform: this.waveform,
      bandWaveforms: this.bandWaveforms,
      spectrum: this.spectrum,
      smoothedSpectrum: this.smoothedSpectrum,
      sampleRate: this.sampleRate,
    };
  }

  /**
   * Build the frame for this animation tick. Arrays are reused, so the result
   * is only valid until the next call.
   */
  build(
    timeSec: number,
    byteSpectrum: Uint8Array,
    floatWaveform: Float32Array,
  ): AudioFrame {
    // Clamp dt so a hidden tab (huge gap) or a seek-back (negative gap) cannot
    // fling the envelope followers.
    const dtSec =
      this.prevTime === null
        ? 0
        : Math.min(0.1, Math.max(0, timeSec - this.prevTime));

    this.copyWaveform(floatWaveform);
    this.splitter.split(this.waveform, this.bandWaveforms);
    this.copySpectrum(byteSpectrum);

    const bands = computeBands(this.spectrum, this.sampleRate, this.fftSize);
    const frame = this.frame;

    frame.frameIndex = this.frameIndex;
    this.frameIndex += 1;

    frame.time = timeSec;
    frame.dtSec = dtSec;

    frame.raw.sub = bands.sub;
    frame.raw.mid = bands.mid;
    frame.raw.high = bands.high;

    frame.env.sub = this.subEnvelope.step(bands.sub, dtSec);
    frame.env.mid = this.midEnvelope.step(bands.mid, dtSec);
    frame.env.high = this.highEnvelope.step(bands.high, dtSec);

    frame.norm.sub = this.subNormalizer.push(frame.env.sub, dtSec);
    frame.norm.mid = this.midNormalizer.push(frame.env.mid, dtSec);
    frame.norm.high = this.highNormalizer.push(frame.env.high, dtSec);

    // Energy: silent frames are exactly 0; otherwise a dim floor plus the slow
    // normalizer, so quiet passages stay visible but never fully normalize away.
    // Loudness from time-domain RMS, not a mean over bands: a narrow sound (a
    // solo flute) would otherwise be diluted by hundreds of silent bins
    // (Council round 2). Mapped to a perceptual dB scale.
    const loud = loudnessFromWaveform(this.waveform);
    const envLoud = this.energyEnvelope.step(loud, dtSec);
    frame.loudness = envLoud;
    // Gate on the smoothed level, not the raw frame, so energy doesn't flicker
    // to 0 between kicks.
    const isSignal = envLoud > SIGNAL_EPS;
    const slowNorm = this.energyNormalizer.push(envLoud, dtSec);
    frame.energy = isSignal ? 0.08 + 0.92 * slowNorm : 0;

    // Flux compares this raw spectrum with the previous frame's. The first
    // frame has no history, so every band reports 0 flux and no onset.
    const subFlux = this.hasPrevSpectrum
      ? spectralFlux(
          this.prevSpectrum,
          this.spectrum,
          this.subStartBin,
          this.subEndBin - 1,
        )
      : 0;
    const midFlux = this.hasPrevSpectrum
      ? spectralFlux(
          this.prevSpectrum,
          this.spectrum,
          this.midStartBin,
          this.midEndBin - 1,
        )
      : 0;
    const highFlux = this.hasPrevSpectrum
      ? spectralFlux(
          this.prevSpectrum,
          this.spectrum,
          this.highStartBin,
          this.highEndBin - 1,
        )
      : 0;

    // Step even on the first frame: this seeds the detector baseline at 0.
    const subOnset = this.subDetector.step(subFlux, timeSec);
    const midOnset = this.midDetector.step(midFlux, timeSec);
    const highOnset = this.highDetector.step(highFlux, timeSec);

    frame.fluxByBand.sub = subFlux;
    frame.fluxByBand.mid = midFlux;
    frame.fluxByBand.high = highFlux;
    frame.flux = subFlux;

    frame.beatByBand.sub = subOnset.beat;
    frame.beatByBand.mid = midOnset.beat;
    frame.beatByBand.high = highOnset.beat;
    frame.beat = subOnset.beat;
    frame.beatStrength = subOnset.strength;

    this.smoothSpectrum(dtSec);

    // Save this spectrum for the next frame's flux calculation.
    this.prevSpectrum.set(this.spectrum);
    this.hasPrevSpectrum = true;
    this.prevTime = timeSec;

    return frame;
  }

  /** Clear all history so a source switch cannot produce a fake beat. */
  reset(): void {
    this.subEnvelope.reset();
    this.midEnvelope.reset();
    this.highEnvelope.reset();
    this.subNormalizer.reset();
    this.midNormalizer.reset();
    this.highNormalizer.reset();

    this.energyEnvelope.reset();
    this.energyNormalizer.reset();

    this.subDetector.reset();
    this.midDetector.reset();
    this.highDetector.reset();

    this.spectrum.fill(0);
    this.prevSpectrum.fill(0);
    this.smoothedSpectrum.fill(0);
    this.hasPrevSpectrum = false;

    this.frameIndex = 0;
    this.prevTime = null;
  }

  private copyWaveform(input: Float32Array): void {
    const length = Math.min(this.waveform.length, input.length);
    this.waveform.set(input.subarray(0, length));
    if (length < this.waveform.length) {
      this.waveform.fill(0, length);
    }
  }

  private copySpectrum(input: Uint8Array): void {
    // byteSpectrumToUnit only writes the overlap, so clear first to make sure a
    // short input does not leave stale bins behind.
    this.spectrum.fill(0);
    byteSpectrumToUnit(input, this.spectrum);
  }

  /**
   * Per-bin envelope with the same attack/release as the band envelopes,
   * written in place to avoid allocating one Envelope per bin.
   */
  private smoothSpectrum(dtSec: number): void {
    if (dtSec <= 0) return;

    // Only two coefficients exist per frame, so compute them once (not per bin).
    const attackCoef = 1 - Math.exp(-dtSec / (ATTACK_MS / 1000));
    const releaseCoef = 1 - Math.exp(-dtSec / (RELEASE_MS / 1000));

    for (let i = 0; i < this.smoothedSpectrum.length; i += 1) {
      const input = this.spectrum[i] ?? 0;
      const current = this.smoothedSpectrum[i] ?? 0;
      const coef = input > current ? attackCoef : releaseCoef;
      this.smoothedSpectrum[i] = current + coef * (input - current);
    }
  }
}
