// Shared audio contract for every slice that consumes analysis output.
// Keep these interfaces stable; downstream effects depend on the semantics
// documented here rather than on any particular analyzer implementation.

export interface BandLevels {
  sub: number; // < 120 Hz
  mid: number; // 120 Hz - 2.5 kHz
  high: number; // 2.5 kHz - 10 kHz
}

export interface AudioFrame {
  time: number; // AudioContext.currentTime, seconds
  raw: BandLevels; // band energy this frame, 0..1, no smoothing
  env: BandLevels; // after asymmetric envelope, 0..1
  norm: BandLevels; // env scaled by rolling normalizer, 0..1 (use for effect SIZE)
  energy: number; // overall loudness vs rolling window, 0..1 (use for COMPLEXITY)
  flux: number; // spectral flux (novelty), >= 0
  beat: boolean; // true on the frame an onset fires
  beatStrength: number; // 0..1, how far flux exceeded threshold
  waveform: Float32Array; // time-domain samples, -1..1, length = fftSize
  spectrum: Float32Array; // magnitude per bin, 0..1, length = fftSize/2
  sampleRate: number;
}
