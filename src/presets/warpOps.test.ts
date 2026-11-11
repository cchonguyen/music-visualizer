import { describe, it, expect } from "vitest";
import { WARP_OP_MAX, WARP_OP_TYPES, WARP_OP_LABELS, isWarpOpType, warpOpSpecs } from "./warpOps";
import { assertValidSpec, defaultsFor } from "./schema";

describe("warp operator schema", () => {
  it("allows a stack of four", () => {
    expect(WARP_OP_MAX).toBe(4);
  });

  it("every type has a label and valid specs", () => {
    for (const type of WARP_OP_TYPES) {
      expect(WARP_OP_LABELS[type]).toBeTruthy();
      for (const spec of warpOpSpecs(type)) expect(() => assertValidSpec(spec)).not.toThrow();
    }
  });

  it("recognises operator names", () => {
    expect(isWarpOpType("swirl")).toBe(true);
    expect(isWarpOpType("polarFold")).toBe(false);
    expect(isWarpOpType(3)).toBe(false);
  });

  it("defaults centre the operator and give a gentle amount", () => {
    const d = defaultsFor(warpOpSpecs("radial"));
    expect(d.centreX).toBe(0);
    expect(d.centreY).toBe(0);
    expect(Math.abs(d.amount as number)).toBeLessThanOrEqual(1);
  });

  it("amount is signed so Radial can be reversed", () => {
    const amount = warpOpSpecs("radial").find((s) => s.name === "amount");
    expect(amount && amount.type === "float" && amount.min).toBeLessThan(0);
  });

  it("lists the ten operators, with the first four in their original positions", () => {
    expect([...WARP_OP_TYPES]).toEqual(["radial", "swirl", "ripple", "stripes", "stretch", "tile", "tunnel", "sphere", "curl", "flow"]);
  });

  it("every type has the common settings, and only Curl noise has more", () => {
    const names = (t: (typeof WARP_OP_TYPES)[number]) => warpOpSpecs(t).map((s) => s.name);
    const common = names("radial");
    for (const type of WARP_OP_TYPES) {
      expect(names(type).slice(0, common.length)).toEqual(common);
      if (type !== "curl") expect(names(type)).toEqual(common);
    }
    expect(names("curl").slice(common.length)).toEqual(["octaves", "turbulence", "flow"]);
  });

  it("flow field has the common settings and a label", () => {
    expect(WARP_OP_TYPES).toContain("flow");
    expect(WARP_OP_LABELS.flow).toMatch(/flow/i);
    expect(isWarpOpType("flow")).toBe(true);
    const d = defaultsFor(warpOpSpecs("flow"));
    expect(Math.abs(d.amount as number)).toBeGreaterThan(0);
    expect(d.scale).toBe(1);
  });

  it("curl noise starts with the old Curl mode's settings", () => {
    const d = defaultsFor(warpOpSpecs("curl"));
    expect(d.octaves).toBe(2);
    expect(d.turbulence).toBe(0.45);
    expect(d.flow).toBe("plumes");
  });

  it("tile and mirror starts at 2 tiles, the others at 1", () => {
    const scaleDefault = (t: (typeof WARP_OP_TYPES)[number]) => defaultsFor(warpOpSpecs(t)).scale;
    expect(scaleDefault("tile")).toBe(2);
    expect(scaleDefault("sphere")).toBe(1);
    expect(scaleDefault("radial")).toBe(1);
  });

  it("recognises the new operator names", () => {
    for (const name of ["stretch", "tile", "tunnel", "sphere", "curl"]) expect(isWarpOpType(name)).toBe(true);
  });
});
