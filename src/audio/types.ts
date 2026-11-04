// Shared audio contract for every slice that consumes analysis output.
// Revised 2026-11-04 after Council review. All fields are required: there is one
// producer (FrameBuilder), and optional fields get forgotten by test mocks.
// Visuals read ONLY this object; they never touch Web Audio nodes.

export interface BandLevels {
  sub: number; // 20–120 Hz, half-open bin range
  mid: number; // 120 Hz – 2.5 kHz
  high: number; // 2.5 kHz – 10 kHz
}

export interface BandFlags {
  sub: boolean;
  mid: boolean;
  high: boolean;
}

export interface AudioFrame {
  frameIndex: number; // increments every build(); 0 after reset()
  time: number; // AudioContext.currentTime, seconds
  dtSec: number; // min(0.1, max(0, time - previous time))
  raw: BandLevels; // band energy this frame, 0..1, no smoothing
  env: BandLevels; // after asymmetric envelope, 0..1
  norm: BandLevels; // env / rolling peak, 0..1 (use for effect SIZE)
  energy: number; // 0 when silent, else 0.08 + 0.92 * slowNorm (use for COMPLEXITY)
  flux: number; // sub-band spectral flux (per-bin mean), >= 0
  fluxByBand: BandLevels; // per-band flux (per-bin mean), >= 0
  beat: boolean; // sub-band onset fired this frame (same as beatByBand.sub)
  beatByBand: BandFlags; // per-band onsets (treble particles use .high)
  beatStrength: number; // 0..1 for the sub-band onset
  waveform: Float32Array; // time-domain samples, -1..1, length = fftSize
  spectrum: Float32Array; // raw magnitude per bin, 0..1, length = fftSize/2
  smoothedSpectrum: Float32Array; // per-bin envelope, 0..1, length = fftSize/2
  sampleRate: number;
}
