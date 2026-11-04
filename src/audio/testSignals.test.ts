import { describe, it, expect } from "vitest";
import type { TestSignal } from './testSignals';
import { planKicks, toneSpec, sweepSpec, scheduleTestSignal } from './testSignals';

// --- Fake Web Audio: record every call instead of playing anything ---

interface RecordedParamCall {
  value: number;
  time: number;
}

interface FakeParam {
  setValueAtTimeCalls: RecordedParamCall[];
  rampCalls: RecordedParamCall[];
  setValueAtTime(value: number, time: number): void;
  exponentialRampToValueAtTime(value: number, time: number): void;
}

interface FakeOscillator {
  type: OscillatorType;
  frequency: FakeParam;
  startTimes: number[];
  stopTimes: number[];
  connections: unknown[];
  connect(target: unknown): unknown;
  start(time: number): void;
  stop(time: number): void;
}

interface FakeGain {
  gain: FakeParam;
  connections: unknown[];
  connect(target: unknown): unknown;
}

function makeParam(): FakeParam {
  const param: FakeParam = {
    setValueAtTimeCalls: [],
    rampCalls: [],
    setValueAtTime(value, time) {
      param.setValueAtTimeCalls.push({ value, time });
    },
    exponentialRampToValueAtTime(value, time) {
      param.rampCalls.push({ value, time });
    },
  };
  return param;
}

function createFakeContext() {
  const oscillators: FakeOscillator[] = [];
  const gains: FakeGain[] = [];

  const ctx = {
    currentTime: 0,
    createOscillator(): FakeOscillator {
      const startTimes: number[] = [];
      const stopTimes: number[] = [];
      const connections: unknown[] = [];
      const osc: FakeOscillator = {
        type: 'sine',
        frequency: makeParam(),
        startTimes,
        stopTimes,
        connections,
        connect(target) {
          connections.push(target);
          return osc;
        },
        start(time) {
          startTimes.push(time);
        },
        stop(time) {
          stopTimes.push(time);
        },
      };
      oscillators.push(osc);
      return osc;
    },
    createGain(): FakeGain {
      const connections: unknown[] = [];
      const gain: FakeGain = {
        gain: makeParam(),
        connections,
        connect(target) {
          connections.push(target);
          return gain;
        },
      };
      gains.push(gain);
      return gain;
    },
  };

  // Wire-up targets only: scheduleTestSignal never calls methods on them.
  const dest = {} as AudioNode;
  return { ctx, oscillators, gains, dest };
}

function schedule(signal: TestSignal, startSec = 0) {
  const fake = createFakeContext();
  const result = scheduleTestSignal(
    fake.ctx as unknown as BaseAudioContext,
    fake.dest,
    signal,
    startSec,
  );
  return { ...fake, result };
}

describe('planKicks', () => {
  it('plans 10 s of kicks as 20 hits every 0.5 s', () => {
    const kicks = planKicks(0, 10);
    expect(kicks).toHaveLength(20);
    expect(kicks.map((k) => k.time)).toEqual([
      0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5,
      5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5,
    ]);
  });

  it('gives every kick the fixed 60 Hz / 50 ms shape', () => {
    for (const kick of planKicks(0, 10)) {
      expect(kick.freq).toBe(60);
      expect(kick.lengthSec).toBe(0.05);
    }
  });

  it('offsets kick times from the requested start', () => {
    expect(planKicks(3, 1).map((k) => k.time)).toEqual([3, 3.5]);
  });

  it('plans nothing for a non-positive duration', () => {
    expect(planKicks(0, 0)).toEqual([]);
    expect(planKicks(0, -1)).toEqual([]);
  });
});

describe('toneSpec / sweepSpec', () => {
  it('describes the reference tone', () => {
    expect(toneSpec()).toEqual({ freq: 2000 });
  });

  it('describes the exponential sweep', () => {
    expect(sweepSpec()).toEqual({
      fromHz: 40,
      toHz: 8000,
      durationSec: 10,
      curve: 'exponential',
    });
  });
});

describe('scheduleTestSignal', () => {
  it('schedules 10 minutes of kicks on one oscillator, shaped by its gain', () => {
    const { oscillators, gains, result } = schedule('kick', 1);

    // 600 s window starting at 1 s: 1200 kicks every 0.5 s.
    expect(result.kickTimes).toEqual(planKicks(1, 600).map((k) => k.time));
    expect(result.kickTimes).toHaveLength(1200);
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0]?.startTimes).toEqual([1]);
    expect(oscillators[0]?.stopTimes).toEqual([601]);
    expect(oscillators[0]?.frequency.setValueAtTimeCalls[0]).toEqual({ value: 60, time: 1 });

    // Each kick: full level at its time, ramp down to near-silent 50 ms later.
    const g = gains[0]!.gain;
    expect(g.setValueAtTimeCalls).toContainEqual({ value: 1, time: 1.5 });
    expect(g.rampCalls[0]).toEqual({ value: 0.001, time: 1.05 });
    expect(g.rampCalls).toHaveLength(1200);
  });

  it('wires the kick oscillator through a gain to the destination', () => {
    const { oscillators, gains, dest } = schedule('kick', 0);
    expect(gains).toHaveLength(1);
    expect(oscillators[0]?.connections[0]).toBe(gains[0]);
    expect(gains[0]?.connections[0]).toBe(dest);
  });

  it('starts the tone without a scheduled stop', () => {
    const { oscillators, result } = schedule('tone', 2);
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0]?.startTimes).toEqual([2]);
    expect(oscillators[0]?.stopTimes).toEqual([]); // runs until stop()
    expect(oscillators[0]?.frequency.setValueAtTimeCalls[0]).toEqual({
      value: 2000,
      time: 2,
    });
    expect(result.kickTimes).toEqual([]);
  });

  it('ramps the sweep exponentially over its duration', () => {
    const { oscillators, result } = schedule('sweep', 0);
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0]?.startTimes).toEqual([0]);
    expect(oscillators[0]?.stopTimes).toEqual([10]);
    expect(oscillators[0]?.frequency.setValueAtTimeCalls[0]).toEqual({ value: 40, time: 0 });
    expect(oscillators[0]?.frequency.rampCalls[0]).toEqual({ value: 8000, time: 10 });
    expect(result.kickTimes).toEqual([]);
  });

  it('creates no nodes for silence', () => {
    const { oscillators, gains, result } = schedule('silence', 0);
    expect(oscillators).toEqual([]);
    expect(gains).toEqual([]);
    expect(result.kickTimes).toEqual([]);
    expect(() => result.stop()).not.toThrow();
  });

  it('stop() stops the kick oscillator now', () => {
    const { ctx, oscillators, result } = schedule('kick', 0);
    ctx.currentTime = 99;
    result.stop();
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0]?.stopTimes.at(-1)).toBe(99);
  });

  it('stop() also ends a tone that had no scheduled stop', () => {
    const { ctx, oscillators, result } = schedule('tone', 5);
    expect(oscillators[0]?.stopTimes).toEqual([]);

    ctx.currentTime = 42;
    result.stop();
    expect(oscillators[0]?.stopTimes).toEqual([42]);
    expect(result.kickTimes).toEqual([]);
  });
});
