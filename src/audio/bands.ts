// Lead review (Council 2026-11-04): bands are half-open bin ranges [lo, hi), so
// each bin belongs to exactly one band (an inclusive end double-counted the
// 120 Hz bin into both sub and mid).
// NOTE(spec): `byteSpectrumToUnit` writes only over the overlapping prefix of
// `src` and `out`, since the spec does not define behavior for length mismatches.

import type { BandLevels } from "./types";

const SUB_LO_HZ = 20; // skip bin 0 (DC offset), which is not sound
const SUB_HI_HZ = 120;
const MID_LO_HZ = 120;
const MID_HI_HZ = 2500;
const HIGH_LO_HZ = 2500;
const HIGH_HI_HZ = 10000;

/**
 * Map a frequency to its FFT bin, clamped to the usable half-spectrum.
 * Keeping the clamp here means callers can pass nominal ranges above Nyquist
 * (for example 10 kHz at low sample rates) without extra guards.
 */
export function binForFrequency(hz: number, sampleRate: number, fftSize: number): number {
  const maxBin = Math.max(0, fftSize / 2 - 1);
  const raw = Math.round((hz * fftSize) / sampleRate);
  return Math.min(maxBin, Math.max(0, raw));
}

/**
 * Mean of the spectrum bins in the half-open range [bin(loHz), bin(hiHz)).
 * Returns 0 when the range is empty or the spectrum has no bins.
 */
export function bandLevel(
  spectrum: Float32Array,
  loHz: number,
  hiHz: number,
  sampleRate: number,
  fftSize: number,
): number {
  // Start bin is clamped like binForFrequency; the exclusive end is clamped to
  // the spectrum length, so a range reaching Nyquist still includes the top bin.
  const start = binForFrequency(loHz, sampleRate, fftSize);
  const endExclusive = Math.min(
    spectrum.length,
    Math.max(0, Math.round((hiHz * fftSize) / sampleRate)),
  );
  const end = endExclusive - 1;

  if (end < start) return 0;

  let sum = 0;
  for (let i = start; i <= end; i++) {
    sum += spectrum[i] ?? 0;
  }

  // Input magnitudes are already 0..1; clamp so oversized test/edge inputs
  // cannot leak out of the contract.
  const mean = sum / (end - start + 1);
  return Math.min(1, Math.max(0, mean));
}

export function computeBands(
  spectrum: Float32Array,
  sampleRate: number,
  fftSize: number,
): BandLevels {
  return {
    sub: bandLevel(spectrum, SUB_LO_HZ, SUB_HI_HZ, sampleRate, fftSize),
    mid: bandLevel(spectrum, MID_LO_HZ, MID_HI_HZ, sampleRate, fftSize),
    high: bandLevel(spectrum, HIGH_LO_HZ, HIGH_HI_HZ, sampleRate, fftSize),
  };
}

/** Convert analyzer byte magnitudes (0..255) into normalized 0..1 values. */
export function byteSpectrumToUnit(src: Uint8Array, out: Float32Array): void {
  const length = Math.min(src.length, out.length);
  for (let i = 0; i < length; i++) {
    out[i] = (src[i] ?? 0) / 255;
  }
}
