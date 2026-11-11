import { describe, it, expect } from "vitest";
import {
  canvasSize,
  clampRenderScale,
  scaledBufferSize,
  setRenderScale,
  getRenderScale,
  clampAutoScale,
  getAutoScale,
  setAutoScale,
  getEffectiveRenderScale,
  MIN_RENDER_SCALE,
} from "./size";

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

describe("render scale", () => {
  it("snaps to the nearest allowed scale", () => {
    expect(clampRenderScale(1)).toBe(1);
    expect(clampRenderScale(0.8)).toBe(0.75);
    expect(clampRenderScale(0.6)).toBe(0.5);
    expect(clampRenderScale(0.1)).toBe(0.5);
    expect(clampRenderScale(5)).toBe(1);
  });

  it("falls back to 100% for non-finite input", () => {
    expect(clampRenderScale(Number.NaN)).toBe(1);
    expect(clampRenderScale(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("sets and reads the session value (no storage in node)", () => {
    expect(setRenderScale(0.5)).toBe(0.5);
    expect(getRenderScale()).toBe(0.5);
    setRenderScale(1);
    expect(getRenderScale()).toBe(1);
  });

  it("scales a buffer size and keeps at least 1x1", () => {
    expect(scaledBufferSize(1920, 1080, 1)).toEqual({ width: 1920, height: 1080 });
    expect(scaledBufferSize(1920, 1080, 0.75)).toEqual({ width: 1440, height: 810 });
    expect(scaledBufferSize(1920, 1080, 0.5)).toEqual({ width: 960, height: 540 });
    expect(scaledBufferSize(1, 1, 0.5)).toEqual({ width: 1, height: 1 });
  });
});

describe("scaled buffer size at any scale (Slice 16.5)", () => {
  it("is not limited to the three owner steps", () => {
    expect(scaledBufferSize(1000, 500, 0.6)).toEqual({ width: 600, height: 300 });
    expect(scaledBufferSize(1000, 500, 0.4)).toEqual({ width: 400, height: 200 });
  });

  it("clamps to the minimum scale and to 1, and treats non-finite as 1", () => {
    expect(scaledBufferSize(1000, 500, 0.01)).toEqual({ width: 250, height: 125 });
    expect(scaledBufferSize(1000, 500, 4)).toEqual({ width: 1000, height: 500 });
    expect(scaledBufferSize(1000, 500, Number.NaN)).toEqual({ width: 1000, height: 500 });
    expect(MIN_RENDER_SCALE).toBe(0.25);
  });
});

describe("automatic scale and the effective scale (Slice 16.5)", () => {
  it("clamps the automatic scale", () => {
    expect(clampAutoScale(0.1)).toBe(MIN_RENDER_SCALE);
    expect(clampAutoScale(2)).toBe(1);
    expect(clampAutoScale(0.6)).toBe(0.6);
    expect(clampAutoScale(Number.NaN)).toBe(1);
  });

  it("uses the smaller of the owner's choice and the automatic scale", () => {
    try {
      setRenderScale(1);
      setAutoScale(0.6);
      expect(getAutoScale()).toBe(0.6);
      expect(getEffectiveRenderScale()).toBe(0.6);
      setRenderScale(0.5);
      expect(getEffectiveRenderScale()).toBe(0.5);
      setAutoScale(1);
      expect(getEffectiveRenderScale()).toBe(0.5);
    } finally {
      setRenderScale(1);
      setAutoScale(1);
    }
  });

  it("is 1 by default", () => {
    expect(getEffectiveRenderScale()).toBe(1);
  });
});
