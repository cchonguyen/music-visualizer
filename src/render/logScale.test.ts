import { describe, it, expect } from "vitest";
import { binForFrequency } from "../audio/bands";
import { BAR_MAX_HZ, BAR_MIN_HZ, barEdgeHz, buildBarEdges } from "./logScale";

describe("barEdgeHz", () => {
  it("spans BAR_MIN_HZ to BAR_MAX_HZ", () => {
    expect(barEdgeHz(0, 32).loHz).toBeCloseTo(BAR_MIN_HZ, 6);
    expect(barEdgeHz(31, 32).hiHz).toBeCloseTo(BAR_MAX_HZ, 6);
  });

  it("makes each bar's loHz equal the previous bar's hiHz", () => {
    for (let i = 1; i < 32; i++) {
      expect(barEdgeHz(i, 32).loHz).toBeCloseTo(barEdgeHz(i - 1, 32).hiHz, 9);
    }
  });

  it("throws RangeError for count 0", () => {
    expect(() => barEdgeHz(0, 0)).toThrow(RangeError);
  });
});

describe("buildBarEdges", () => {
  it("has non-decreasing loBin and hiBin > loBin for every bar", () => {
    const edges = buildBarEdges(32, 48000, 4096);
    expect(edges).toHaveLength(32);
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]!;
      expect(e.hiBin).toBeGreaterThan(e.loBin);
      if (i > 0) {
        expect(e.loBin).toBeGreaterThanOrEqual(edges[i - 1]!.loBin);
      }
    }
  });

  it("places a 1000 Hz tone in a bar between index 12 and 24 inclusive", () => {
    const edges = buildBarEdges(32, 48000, 4096);
    const bin = binForFrequency(1000, 48000, 4096);
    const idx = edges.findIndex((e) => bin >= e.loBin && bin < e.hiBin);
    expect(idx).toBeGreaterThanOrEqual(12);
    expect(idx).toBeLessThanOrEqual(24);
  });

  it("throws RangeError for count 0", () => {
    expect(() => buildBarEdges(0, 48000, 4096)).toThrow(RangeError);
  });
});
