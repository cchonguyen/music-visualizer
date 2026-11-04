// NOTE(spec): Two details the slice leaves open, resolved as simply as possible:
// - scheduleTestSignal('kick') gets no duration, so it places the same 10 s window
//   (20 kicks) that sweepSpec() uses. planKicks() itself stays fully parameterized
//   so callers can choose any window.
// - 'tone' has no duration in the contract, so it starts at startSec and keeps
//   running until stop() is called.

/** Built-in test sounds, labelled so tests can describe them before any audio plays. */
export type TestSignal = 'kick' | 'tone' | 'sweep' | 'silence';

/** Seconds between two planned kicks. */
const KICK_INTERVAL_SEC = 0.5;
/** Window of kicks placed by scheduleTestSignal('kick'). */
const KICK_WINDOW_SEC = 10;
/** Steady test tones at a quarter of full scale: loud enough to analyse, not harsh. */
const TONE_LEVEL = 0.25;

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

/** Schedule the 10 s kick window and return the absolute kick times. */
function scheduleKicks(
  ctx: BaseAudioContext,
  dest: AudioNode,
  startSec: number,
  sources: OscillatorNode[],
): number[] {
  const kickTimes: number[] = [];
  for (const kick of planKicks(startSec, KICK_WINDOW_SEC)) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    // Low sine burst: full level on the onset, near-silent by the end of the hit.
    osc.frequency.setValueAtTime(kick.freq, kick.time);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1, kick.time);
    gain.gain.exponentialRampToValueAtTime(0.001, kick.time + kick.lengthSec);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(kick.time);
    osc.stop(kick.time + kick.lengthSec);
    sources.push(osc);
    kickTimes.push(kick.time);
  }
  return kickTimes;
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
  gain.gain.setValueAtTime(TONE_LEVEL, startSec);
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
  gain.gain.setValueAtTime(TONE_LEVEL, startSec);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(startSec);
  osc.stop(startSec + spec.durationSec);
  sources.push(osc);
}
