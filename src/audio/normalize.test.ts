import { describe, it, expect } from "vitest";
import { RollingNormalizer } from "./normalize";

/** Push `value` totalling `durationSec` and return the last normalized output. */
function runFor(norm: RollingNormalizer, value: number, durationSec: number, dtSec: number): number {
  let out = 0;
  const steps = Math.round(durationSec / dtSec);
  for (let i = 0; i < steps; i++) out = norm.push(value, dtSec);
  return out;
}

describe("RollingNormalizer", () => {
  it("returns ~1 for a steady signal after the window fills", () => {
    const norm = new RollingNormalizer(4, 0.02);
    const after = runFor(norm, 0.6, 8, 0.01); // a full window of a steady signal
    expect(after).toBeCloseTo(1, 2);
  });

  it("a quiet signal after a loud one ramps back up over the window, not instantly", () => {
    const norm = new RollingNormalizer(4, 0.02);
    runFor(norm, 1, 8, 0.01); // loud music saturates the peak at 1

    const rightAfter = norm.push(0.2, 0.01); // music suddenly goes quiet
    expect(rightAfter).toBeLessThan(0.5); // quiet reads as quiet at first...

    const ramped = runFor(norm, 0.2, 6, 0.01); // ...but within 6 s (tau 4 s: peak ~0.22)
    expect(ramped).toBeGreaterThan(0.8); // it has ramped back up, still < instant
  });

  it("silence stays near 0 because the floor is not crossed", () => {
    const norm = new RollingNormalizer(4, 0.02);
    const after = runFor(norm, 0.001, 20, 0.01); // far longer than the window
    // peak itself decays to the tiny input value; the floor only applies to
    // the scaling denominator, so the output stays clamped near silence
    expect(after).toBeLessThan(0.1); // 0.001 / floor 0.02 = 0.05
    expect(norm.peak()).toBeLessThanOrEqual(0.02);
  });

  it("clamps the result to 0..1", () => {
    const norm = new RollingNormalizer(4, 0.02);
    expect(norm.push(2, 0.01)).toBe(1);
  });

  it("push with dt 0 does not advance the decay", () => {
    const norm = new RollingNormalizer(4, 0.02);
    norm.push(1, 0.01);
    const peakBefore = norm.peak();
    norm.push(0, 0);
    expect(norm.peak()).toBe(peakBefore);
  });

  it("reset clears the stored peak", () => {
    const norm = new RollingNormalizer(4, 0.02);
    runFor(norm, 1, 1, 0.01);
    norm.reset();
    expect(norm.peak()).toBe(0);
  });
});

describe("RollingNormalizer recovery is scale-free", () => {
  it("recovers from a 10x drop in the same time at any loudness", () => {
    const timeToRecover = (loud: number) => {
      const n = new RollingNormalizer(4, 0.0001);
      for (let i = 0; i < 400; i++) n.push(loud, 0.01);
      let t = 0;
      while (n.push(loud / 10, 0.01) < 0.9 && t < 60) t += 0.01;
      return t;
    };
    expect(Math.abs(timeToRecover(1) - timeToRecover(0.1))).toBeLessThan(0.05);
    expect(timeToRecover(1)).toBeGreaterThan(5);
    expect(timeToRecover(1)).toBeLessThan(12);
  });
});

describe("RollingNormalizer freeze", () => {
  it("does not pump a near-silent passage back up when freezeBelow is set", () => {
    const n = new RollingNormalizer(12, 0.001, 0.02);
    for (let i = 0; i < 400; i++) n.push(0.8, 0.01);
    let out = 0;
    for (let i = 0; i < 1000; i++) out = n.push(0.01, 0.01); // 10 s near-silence
    expect(n.peak()).toBeCloseTo(0.8, 5);
    expect(out).toBeLessThan(0.05);
  });
  it("defaults to a 12 s time constant", () => {
    const n = new RollingNormalizer();
    n.push(1, 0);
    n.push(0.1, 12); // below the decayed peak, so the peak is just the decay
    expect(n.peak()).toBeCloseTo(Math.exp(-1), 3);
  });
});
