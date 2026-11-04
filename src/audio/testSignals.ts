// NOTE(spec): Two details the slice leaves open, resolved as simply as possible:
// - scheduleTestSignal('kick') runs a 10-minute window (1200 kicks) on a single
//   oscillator. planKicks() itself stays fully parameterized.
// - 'tone' has no duration in the contract, so it starts at startSec and keeps
//   running until stop() is called.

/** Built-in test sounds, labelled so tests can describe them before any audio plays. */
export type TestSignal = 'kick' | 'tone' | 'sweep' | 'silence';

/** Seconds between two planned kicks. */
const KICK_INTERVAL_SEC = 0.5;
/** Window of kicks placed by scheduleTestSignal('kick'): 10 minutes. */
const KICK_WINDOW_SEC = 600;
/** Steady test tones at a quarter of full scale: loud enough to analyse, not harsh. */
const TONE_LEVEL = 0.25;
/** Fade-in for steady tones: an instant start is a click, which reads as a beat. */
const FADE_IN_SEC = 0.05;

/**
 * Plan a row of kicks: one every 0.5 s, each starting inside
 * [startSec, startSec + durationSec), expressed as absolute times.
 */
export function planKicks(
  startSec: number,
  durationSec: number,
): { time: number; freq: 60; lengthSec: 0.05 }[] {
  // Whole kicks only. The epsilon stops a 10 s window from rounding up to 21 hits.
  const count = Math.max(0, Math.ceil((durationSec - 1e-9) / KICK_INTERVAL_SEC));
  const kicks: { time: number; freq: 60; lengthSec: 0.05 }[] = [];
  for (let i = 0; i < count; i++) {
    kicks.push({ time: startSec + i * KICK_INTERVAL_SEC, freq: 60, lengthSec: 0.05 });
  }
  return kicks;
}

/** A plain 2 kHz reference tone. */
export function toneSpec(): { freq: 2000 } {
  return { freq: 2000 };
}

/** A slow log-sweep across the audible range. */
export function sweepSpec(): { fromHz: 40; toHz: 8000; durationSec: 10; curve: 'exponential' } {
  return { fromHz: 40, toHz: 8000, durationSec: 10, curve: 'exponential' };
}

/**
 * Build the nodes for one test signal from its plan and start them at startSec.
 * Nodes are plain data-driven Web Audio calls, so a fake context can record them.
 * kickTimes mirrors the planned kick times and is used later for latency measurement.
 */
export function scheduleTestSignal(
  ctx: BaseAudioContext,
  dest: AudioNode,
  signal: TestSignal,
  startSec: number,
): { stop(): void; kickTimes: number[] } {
  // Only oscillators can be stopped; gains go silent with their source.
  const sources: OscillatorNode[] = [];
  let kickTimes: number[] = [];

  if (signal === 'kick') {
    kickTimes = scheduleKicks(ctx, dest, startSec, sources);
  } else if (signal === 'tone') {
    scheduleTone(ctx, dest, startSec, sources);
  } else if (signal === 'sweep') {
    scheduleSweep(ctx, dest, startSec, sources);
  }
  // 'silence' deliberately creates no nodes at all.

  return {
    stop() {
      for (const source of sources) source.stop(ctx.currentTime);
    },
    kickTimes,
  };
}

/**
 * Schedule kicks for KICK_WINDOW_SEC on ONE oscillator whose gain is shaped per
 * kick (lead review: a 10 s window ended before anyone could watch it, and one
 * node per kick would mean thousands of nodes for a long run).
 */
function scheduleKicks(
  ctx: BaseAudioContext,
  dest: AudioNode,
  startSec: number,
  sources: OscillatorNode[],
): number[] {
  const kicks = planKicks(startSec, KICK_WINDOW_SEC);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(60, startSec);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, startSec);
  for (const kick of kicks) {
    // Full level on the onset, near-silent by the end of the hit, then silence.
    gain.gain.setValueAtTime(1, kick.time);
    gain.gain.exponentialRampToValueAtTime(0.001, kick.time + kick.lengthSec);
    gain.gain.setValueAtTime(0, kick.time + kick.lengthSec);
  }
  osc.connect(gain);
  gain.connect(dest);
  osc.start(startSec);
  osc.stop(startSec + KICK_WINDOW_SEC);
  sources.push(osc);
  return kicks.map((k) => k.time);
}

/** Schedule the reference tone, which runs until stop(). */
function scheduleTone(
  ctx: BaseAudioContext,
  dest: AudioNode,
  startSec: number,
  sources: OscillatorNode[],
): void {
  const spec = toneSpec();
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(spec.freq, startSec);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, startSec);
  gain.gain.exponentialRampToValueAtTime(TONE_LEVEL, startSec + FADE_IN_SEC);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(startSec); // no scheduled stop: stop() ends it
  sources.push(osc);
}

/** Schedule the exponential sweep across its full duration. */
function scheduleSweep(
  ctx: BaseAudioContext,
  dest: AudioNode,
  startSec: number,
  sources: OscillatorNode[],
): void {
  const spec = sweepSpec();
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  // Exponential ramp (not linear) so the pitch changes at a constant *relative* rate.
  osc.frequency.setValueAtTime(spec.fromHz, startSec);
  osc.frequency.exponentialRampToValueAtTime(spec.toHz, startSec + spec.durationSec);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, startSec);
  gain.gain.exponentialRampToValueAtTime(TONE_LEVEL, startSec + FADE_IN_SEC);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(startSec);
  osc.stop(startSec + spec.durationSec);
  sources.push(osc);
}
