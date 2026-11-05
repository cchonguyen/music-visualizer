import { describe, it, expect } from "vitest";
import { assertValidSpec, coerceValue, defaultsFor, type ParamSpec } from "./schema";

const density: ParamSpec = { type: "float", name: "density", label: "Density", group: "Wall", default: 0.5, min: 0, max: 1, step: 0.01 };
const sides: ParamSpec = { type: "int", name: "sides", label: "Sides", group: "Shape", default: 4, min: 3, max: 12, step: 1 };
const invert: ParamSpec = { type: "bool", name: "invert", label: "Invert", group: "Post", default: false };
const pattern: ParamSpec = { type: "enum", name: "pattern", label: "Pattern", group: "Wall", default: "rings", options: ["rings", "grid"] };
const tint: ParamSpec = { type: "colour", name: "tint", label: "Tint", group: "Post", default: "#00ffff" };

describe("coerceValue", () => {
  it("keeps a value that is already in range", () => {
    expect(coerceValue(density, 0.25)).toEqual({ value: 0.25 });
  });

  it("clamps a float above max and reports it", () => {
    const result = coerceValue(density, 3);
    expect(result.value).toBe(1);
    expect(result.warning).toMatch(/clamped to 1/);
  });

  it("clamps a float below min", () => {
    expect(coerceValue(density, -2).value).toBe(0);
  });

  it("rounds an int and clamps it to its range", () => {
    expect(coerceValue(sides, 5.4)).toEqual({ value: 5 });
    expect(coerceValue(sides, 40).value).toBe(12);
  });

  it("uses the default when a number is not a finite number", () => {
    expect(coerceValue(density, "lots").value).toBe(0.5);
    expect(coerceValue(density, NaN).value).toBe(0.5);
  });

  it("accepts booleans and falls back for anything else", () => {
    expect(coerceValue(invert, true)).toEqual({ value: true });
    expect(coerceValue(invert, "yes").value).toBe(false);
  });

  it("accepts only listed enum options", () => {
    expect(coerceValue(pattern, "grid")).toEqual({ value: "grid" });
    expect(coerceValue(pattern, "spiral").value).toBe("rings");
  });

  it("accepts #rrggbb colours and lower-cases them", () => {
    expect(coerceValue(tint, "#FF00AA")).toEqual({ value: "#ff00aa" });
    expect(coerceValue(tint, "cyan").value).toBe("#00ffff");
  });
});

describe("assertValidSpec", () => {
  it("accepts a correct spec", () => {
    expect(() => [density, sides, invert, pattern, tint].forEach(assertValidSpec)).not.toThrow();
  });

  it("rejects min greater than max", () => {
    expect(() => assertValidSpec({ ...density, min: 2, max: 1 })).toThrow(/min is greater than max/);
  });

  it("rejects a default outside min..max", () => {
    expect(() => assertValidSpec({ ...density, default: 1.5 })).toThrow(/default is outside/);
  });

  it("rejects an enum default that is not an option", () => {
    expect(() => assertValidSpec({ ...pattern, default: "spiral" })).toThrow(/not one of the options/);
  });

  it("rejects a colour default that is not #rrggbb", () => {
    expect(() => assertValidSpec({ ...tint, default: "cyan" })).toThrow(/#rrggbb/);
  });
});

describe("defaultsFor", () => {
  it("returns every spec's default keyed by name", () => {
    expect(defaultsFor([density, sides, invert])).toEqual({ density: 0.5, sides: 4, invert: false });
  });
});
