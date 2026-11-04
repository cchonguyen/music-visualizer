import { describe, it, expect } from "vitest";
import { estimateLatencyMs } from "./latency";

// Fixed terms for every pair: one 16 ms display frame minus the 25 ms the
// speakers add to the sound (output 20 ms + base 5 ms) = -9 ms.
const FIXED_MS = 16 - (0.02 + 0.005) * 1000;

describe("estimateLatencyMs", () => {
  it("returns only the fixed latency terms for perfectly matched times", () => {
    // Zero detection gap: every pair latency collapses to the fixed terms.
    const { medianMs, samples } = estimateLatencyMs(
      [1.0, 2.5],
      [1.0, 2.5],
      0.02,
      0.005,
      16,
    );
    expect(samples).toBe(2);
    expect(medianMs).toBeCloseTo(FIXED_MS, 9);
  });

  it("ignores beats with no kick within 200 ms (and no earlier kick at all)", () => {
    // 1.0 pairs with its kick; 1.9 is 900 ms after the only earlier kick and
    // 5.0 has no earlier kick — both must be dropped.
    const { medianMs, samples } = estimateLatencyMs(
      [1.0],
      [1.0, 1.9, 5.0],
      0.02,
      0.005,
      16,
    );
    expect(samples).toBe(1);
    expect(medianMs).toBeCloseTo(FIXED_MS, 9);

    // Only candidate kick is 250 ms before the beat: outside the window.
    expect(estimateLatencyMs([0.0], [0.25], 0, 0, 0)).toEqual({
      medianMs: 0,
      samples: 0,
    });
  });

  it("reports the median across detection gaps of mixed sizes", () => {
    // Gaps of 10, 20, 50 and 180 ms; zero fixed terms so latency === gap.
    const { medianMs, samples } = estimateLatencyMs(
      [0, 1, 2, 3],
      [0.01, 1.02, 2.05, 3.18],
      0,
      0,
      0,
    );
    expect(samples).toBe(4);
    // Even count: median is the mean of the two middle values (20 and 50).
    expect(medianMs).toBeCloseTo(35, 9);
  });

  it("uses each kick at most once", () => {
    // Two beats, one kick: the first beat claims it, the second finds no
    // unused kick and is ignored.
    const { medianMs, samples } = estimateLatencyMs(
      [1.0],
      [1.01, 1.15],
      0,
      0,
      0,
    );
    expect(samples).toBe(1);
    expect(medianMs).toBeCloseTo(10, 9);
  });
});
