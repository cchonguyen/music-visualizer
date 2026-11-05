import { describe, it, expect } from "vitest";
import { assertValidSpec, defaultsFor } from "./schema";
import {
  CROWN_DEFAULTS, CROWN_SPECS, LAYER_SPECS, PARTICLE_DEFAULTS, PARTICLE_SPECS,
  RINGS_DEFAULTS, RINGS_SPECS, SHOCKWAVE_DEFAULTS, SHOCKWAVE_SPECS, TUNNEL_DEFAULTS, TUNNEL_SPECS,
} from "./layerSchemas";

describe("layer schemas", () => {
  it("every built-in spec is internally valid", () => {
    for (const specs of Object.values(LAYER_SPECS)) {
      specs.forEach(assertValidSpec);
    }
  });

  // Each schema default must equal the value the layer used before slice 4.2.
  // If one of these changes, the look changes too, so this test must be updated on purpose.
  it("keeps the pre-4.2 values as defaults (no visible change)", () => {
    expect(TUNNEL_DEFAULTS).toEqual({ ringDensity: 0.5, beatAttackSec: 0.08, ringContrast: 0.5, ringContrastCalm: 0.25, pattern: 'rings', sides: 0, twist: 0 });
    expect(PARTICLE_DEFAULTS).toEqual({ brightness: 1.0, calmSparkleScale: 0.3, flashSparkleScale: 0.2, swirlGain: 1, shape: 'streak' });
    expect(CROWN_DEFAULTS.rimFactor).toBe(1 - 0.16);
    expect(RINGS_DEFAULTS).toEqual({ maxRings: 6, maxRingsCalm: 3, strokeBase: 0.004, strokeNormGain: 0.01, sides: 0, style: 'outline' });
    expect(SHOCKWAVE_DEFAULTS).toEqual({ ringStart: 0.16, ringEnd: 0.85, ringSec: 0.35, style: 'ring' });
  });

  it.each([
    ["tunnel", TUNNEL_SPECS, TUNNEL_DEFAULTS],
    ["particles", PARTICLE_SPECS, PARTICLE_DEFAULTS],
    ["crown", CROWN_SPECS, CROWN_DEFAULTS],
    ["rings", RINGS_SPECS, RINGS_DEFAULTS],
    ["shockwave", SHOCKWAVE_SPECS, SHOCKWAVE_DEFAULTS],
  ])("%s: schema defaults match the layer's typed defaults", (_name, specs, defaults) => {
    expect(defaultsFor(specs)).toEqual(defaults);
  });

  it("every layer type is registered", () => {
    expect(Object.keys(LAYER_SPECS).sort()).toEqual(["bars", "crown", "particles", "rings", "shockwave", "tunnel", "waveform"]);
  });
});
