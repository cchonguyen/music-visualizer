// Band-limited copies of a time-domain window: sub, mid and high.
//
// Edges match src/audio/bands.ts (SUB_HI_HZ, MID_LO_HZ, MID_HI_HZ, HIGH_LO_HZ).
// Keep them in sync by hand: bands.ts is the source of truth for the spectrum
// bands, and this file mirrors its numbers for the waveform split.
//
// Each edge is a 4th-order Butterworth made from two RBJ-cookbook biquads with
// Q = sqrt(1/2). Filter state resets on every call, so each window is
// independent and the output for a given input never depends on earlier frames.

import type { BandWaveforms } from "./types";

const SUB_HI_HZ = 120;
const MID_LO_HZ = 120;
const MID_HI_HZ = 2500;
const HIGH_LO_HZ = 2500;

const BUTTER_Q = Math.SQRT1_2;
// Keep cutoffs safely below Nyquist so the RBJ formulas stay well-behaved.
const MAX_CUTOFF_FRACTION = 0.45;

interface BiquadCoefs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function lowpassCoefs(hz: number, sampleRate: number): BiquadCoefs {
  const w0 = (2 * Math.PI * hz) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * BUTTER_Q);
  const a0 = 1 + alpha;
  const b1 = 1 - cos;
  return {
    b0: b1 / 2 / a0,
    b1: b1 / a0,
    b2: b1 / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function highpassCoefs(hz: number, sampleRate: number): BiquadCoefs {
  const w0 = (2 * Math.PI * hz) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * BUTTER_Q);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2;
  return {
    b0: b0 / a0,
    b1: (-(1 + cos)) / a0,
    b2: b0 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

/**
 * One biquad pass over buf[0..n), in place. Each sample is read before it is
 * written, so this is safe when the caller's input and output are the same array.
 */
function biquadInPlace(buf: Float32Array, n: number, c: BiquadCoefs): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i += 1) {
    const x = buf[i] ?? 0;
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    buf[i] = y;
  }
}

/** Copy src into out over the overlap and zero the rest. Returns the overlap length. */
function copyInto(src: Float32Array, out: Float32Array): number {
  const n = Math.min(src.length, out.length);
  out.set(src.subarray(0, n));
  if (n < out.length) out.fill(0, n);
  return n;
}

export class BandSplitter {
  // Each edge is applied twice (two biquads = 4th order).
  private readonly subLowpass: BiquadCoefs;
  private readonly midHighpass: BiquadCoefs;
  private readonly midLowpass: BiquadCoefs;
  private readonly highHighpass: BiquadCoefs;

  constructor(sampleRate: number) {
    const cap = MAX_CUTOFF_FRACTION * sampleRate;

    this.subLowpass = lowpassCoefs(Math.min(SUB_HI_HZ, cap), sampleRate);
    this.midHighpass = highpassCoefs(Math.min(MID_LO_HZ, cap), sampleRate);
    this.midLowpass = lowpassCoefs(Math.min(MID_HI_HZ, cap), sampleRate);
    this.highHighpass = highpassCoefs(Math.min(HIGH_LO_HZ, cap), sampleRate);
  }

  /** Write sub, mid and high bands of src into out. Zero input gives zero output. */
  split(src: Float32Array, out: BandWaveforms): void {
    const subN = copyInto(src, out.sub);
    biquadInPlace(out.sub, subN, this.subLowpass);
    biquadInPlace(out.sub, subN, this.subLowpass);

    const midN = copyInto(src, out.mid);
    biquadInPlace(out.mid, midN, this.midHighpass);
    biquadInPlace(out.mid, midN, this.midHighpass);
    biquadInPlace(out.mid, midN, this.midLowpass);
    biquadInPlace(out.mid, midN, this.midLowpass);

    const highN = copyInto(src, out.high);
    biquadInPlace(out.high, highN, this.highHighpass);
    biquadInPlace(out.high, highN, this.highHighpass);
  }
}
