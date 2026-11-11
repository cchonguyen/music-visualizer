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
    expect(isWarpOpType("curl")).toBe(false);
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
});
