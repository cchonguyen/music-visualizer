import { describe, it, expect } from "vitest";
import { TempoTracker, LOCK_CONFIDENCE, BEATS_PER_BAR } from "./tempo";

const STEP = 1 / 60;

/** Deterministic pseudo-random numbers (mulberry32), so jitter tests never flake. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Feeds onsets at the given times through 60 fps frames; returns the last state and tick frame times. */
function run(onsetTimes: number[], seconds: number, tracker = new TempoTracker()) {
  const queue = [...onsetTimes];
  const ticks: number[] = [];
  let last = tracker.step(0, false);
  for (let i = 1; i <= Math.round(seconds * 60); i += 1) {
    const t = i * STEP;
    let onset = false;
    while (queue.length > 0 && queue[0]! <= t + 1e-9) {
      queue.shift();
      onset = true;
    }
    last = tracker.step(t, onset);
    if (last.beatTick) ticks.push(t);
  }
  return { tracker, last, ticks };
}

function metronome(bpm: number, seconds: number, start = 0.5, jitter = 0, seed = 1): number[] {
  const rand = seeded(seed);
  const out: number[] = [];
  const period = 60 / bpm;
  for (let t = start; t < seconds; t += period) out.push(t + (rand() - 0.5) * 2 * jitter);
  return out;
}

describe("TempoTracker", () => {
  for (const bpm of [70, 100, 120, 140, 172]) {
    it(`finds ${bpm} BPM from a steady kick`, () => {
      const { last } = run(metronome(bpm, 12), 12);
      expect(last.bpm).toBeGreaterThan(bpm * 0.97);
      expect(last.bpm).toBeLessThan(bpm * 1.03);
      expect(last.confidence).toBeGreaterThanOrEqual(LOCK_CONFIDENCE);
    });
  }

  it("still finds the tempo with 25 ms of timing jitter", () => {
    const { last } = run(metronome(120, 14, 0.5, 0.025, 7), 14);
    expect(last.bpm).toBeGreaterThan(114);
    expect(last.bpm).toBeLessThan(126);
    expect(last.confidence).toBeGreaterThanOrEqual(LOCK_CONFIDENCE);
  });

  it("reports low confidence for random onsets", () => {
    const rand = seeded(42);
    const times: number[] = [];
    let t = 0.3;
    while (t < 14) {
      times.push(t);
      t += 0.15 + rand() * 0.9;
    }
    const { last } = run(times, 14);
    expect(last.confidence).toBeLessThan(LOCK_CONFIDENCE);
  });

  it("is deterministic: the same onsets give the same result", () => {
    const onsets = metronome(128, 10, 0.4, 0.02, 3);
    const a = run(onsets, 10).last;
    const b = run(onsets, 10).last;
    expect({ ...a }).toEqual({ ...b });
  });

  it("falls back to counting detected onsets when confidence is low", () => {
    const times = [0.4, 0.9, 2.1, 2.3, 4.0];
    const { last, ticks } = run(times, 4.5);
    expect(last.confidence).toBeLessThan(LOCK_CONFIDENCE);
    expect(last.beatCount).toBe(times.length);
    expect(ticks.length).toBe(times.length);
  });

  it("counts one beat per kick once locked, and counts a dropped kick", () => {
    const onsets = metronome(120, 14).filter((t) => !(t > 9.4 && t < 9.6)); // one kick missing near 9.5 s
    const { last } = run(onsets, 14);
    // 120 BPM from 0.5 s to 14 s: beats at 0.5, 1.0, ... 13.5 = 28 beats, the grid keeps time over the gap.
    expect(last.beatCount).toBeGreaterThanOrEqual(27);
    expect(last.beatCount).toBeLessThanOrEqual(28);
  });

  it("bar phase cycles through 0..1 once every four beats and beat phase rises between ticks", () => {
    const { tracker } = run(metronome(120, 12), 12);
    let sawWrap = false;
    let prevBar = -1;
    let ticksSeen = 0;
    for (let i = 0; i < 240; i += 1) {
      const t = 12 + i * STEP;
      const onset = i % 30 === 0 && i > 0;
      const s = tracker.step(t, onset);
      expect(s.barPhase).toBeGreaterThanOrEqual(0);
      expect(s.barPhase).toBeLessThanOrEqual(1);
      expect(s.beatPhase).toBeGreaterThanOrEqual(0);
      expect(s.beatPhase).toBeLessThanOrEqual(1);
      if (s.beatTick) ticksSeen += 1;
      if (prevBar > 0.7 && s.barPhase < 0.3) sawWrap = true;
      prevBar = s.barPhase;
    }
    expect(ticksSeen).toBeGreaterThanOrEqual(7);
    expect(sawWrap).toBe(true);
    expect(BEATS_PER_BAR).toBe(4);
  });

  it("loses the lock after the music stops", () => {
    const { tracker, last } = run(metronome(120, 10), 10);
    expect(last.confidence).toBeGreaterThanOrEqual(LOCK_CONFIDENCE);
    let s = last;
    for (let i = 1; i <= 300; i += 1) s = tracker.step(10 + i * STEP, false);
    expect(s.confidence).toBe(0);
    expect(s.bpm).toBe(0);
  });

  it("restarts after a seek back or a long gap instead of mixing old and new onsets", () => {
    const { tracker } = run(metronome(100, 10), 10);
    const s = tracker.step(2, false);
    expect(s.confidence).toBe(0);
    const t = new TempoTracker();
    run(metronome(100, 10), 10, t);
    expect(t.step(20, false).bpm).toBe(0);
  });

  it("reset clears the count", () => {
    const { tracker } = run(metronome(120, 6), 6);
    tracker.reset();
    const s = tracker.step(0, false);
    expect(s.beatCount).toBe(0);
    expect(s.bpm).toBe(0);
  });
});
