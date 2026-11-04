import { describe, it, expect } from "vitest";
import { canvasSize } from "./size";

describe("canvasSize", () => {
  it("caps DPR 3 to 2", () => {
    expect(canvasSize(800, 600, 3)).toEqual({ width: 1600, height: 1200, dpr: 2 });
  });

  it("scales a 2560x1440 CSS window at DPR 2 down to fit maxPixels", () => {
    const result = canvasSize(2560, 1440, 2);
    expect(result.width * result.height).toBeLessThanOrEqual(3_686_400);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.dpr).toBe(2);
  });

  it("returns 1x1 for zero size", () => {
    expect(canvasSize(0, 0, 2)).toEqual({ width: 1, height: 1, dpr: 2 });
    expect(canvasSize(0, 500, 2)).toEqual({ width: 1, height: 1, dpr: 2 });
    expect(canvasSize(500, 0, 2)).toEqual({ width: 1, height: 1, dpr: 2 });
  });

  it("keeps aspect ratio within 1 px", () => {
    const cssW = 1920;
    const cssH = 1080;
    const result = canvasSize(cssW, cssH, 2);
    const expected = cssW / cssH;
    const actual = result.width / result.height;
    // Aspect ratios match within tolerance accounting for rounding.
    expect(Math.abs(actual - expected)).toBeLessThan(0.01);
    expect(result.width * result.height).toBeLessThanOrEqual(3_686_400);
  });
});

describe("canvasSize budget sweep", () => {
  it("never exceeds the pixel budget and keeps aspect within 1 px", () => {
    for (let w = 300; w <= 4000; w += 37) {
      for (let h = 200; h <= 2400; h += 53) {
        for (const dpr of [1, 1.25, 1.5, 2, 3]) {
          const r = canvasSize(w, h, dpr);
          expect(r.width * r.height).toBeLessThanOrEqual(3_686_400);
          expect(Math.abs(r.height - r.width * (h / w))).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
