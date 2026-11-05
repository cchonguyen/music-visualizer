import { describe, it, expect } from "vitest";
import { parsePreset, PresetFormatError, PRESET_VERSION, type SchemaRegistry } from "./format";
import type { ParamSpec } from "./schema";

const zoom: ParamSpec = { type: "float", name: "zoom", label: "Zoom", group: "Feedback", default: 1, min: 0.5, max: 2, step: 0.01 };
const density: ParamSpec = { type: "float", name: "density", label: "Density", group: "Wall", default: 0.5, min: 0, max: 1, step: 0.01 };
const bloom: ParamSpec = { type: "bool", name: "bloom", label: "Bloom", group: "Post", default: false };

const registry: SchemaRegistry = {
  feedback: [zoom],
  post: [bloom],
  layers: { tunnel: [density] },
};

const minimal = { version: PRESET_VERSION, name: "  Calm tunnel  " };

describe("parsePreset: structure", () => {
  it("fills every default for a minimal preset, with no warnings", () => {
    const { preset, warnings } = parsePreset(minimal, registry);
    expect(preset.name).toBe("Calm tunnel");
    expect(preset.feedback).toEqual({ zoom: { value: 1 } });
    expect(preset.post).toEqual({ bloom: { value: false } });
    expect(preset.layers).toEqual([]);
    expect(preset.transition).toEqual({ style: "crossfade", seconds: 0.32 });
    expect(warnings).toEqual([]);
  });

  it("rejects a non-object", () => {
    expect(() => parsePreset("hello", registry)).toThrow(PresetFormatError);
    expect(() => parsePreset(null, registry)).toThrow(PresetFormatError);
  });

  it("rejects a missing or unknown version", () => {
    expect(() => parsePreset({ name: "x", layers: [] }, registry)).toThrow(/unsupported version/);
    expect(() => parsePreset({ version: 99, name: "x", layers: [] }, registry)).toThrow(/unsupported version/);
  });

  it("rejects an empty name", () => {
    expect(() => parsePreset({ version: PRESET_VERSION, name: "  ", layers: [] }, registry)).toThrow(/name is missing/);
  });

  it("rejects layers that are not a list", () => {
    expect(() => parsePreset({ version: PRESET_VERSION, name: "x", layers: {} }, registry)).toThrow(/must be a list/);
  });
});

describe("parsePreset: repairs with warnings", () => {
  it("clamps an out-of-range setting and says so", () => {
    const { preset, warnings } = parsePreset({ ...minimal, feedback: { zoom: 9 } }, registry);
    expect(preset.feedback.zoom).toEqual({ value: 2 });
    expect(warnings.join("\n")).toMatch(/feedback\.zoom: .*clamped to 2/);
  });

  it("drops unknown settings with a warning", () => {
    const { preset, warnings } = parsePreset({ ...minimal, feedback: { spin: 1 } }, registry);
    expect(preset.feedback).not.toHaveProperty("spin");
    expect(warnings).toContain("feedback.spin: unknown setting, ignored");
  });

  it("skips an unknown layer type and keeps the rest", () => {
    const { preset, warnings } = parsePreset(
      { ...minimal, layers: [{ type: "spiral" }, { type: "tunnel", params: { density: 0.9 } }] },
      registry,
    );
    expect(preset.layers.map((layer) => layer.type)).toEqual(["tunnel"]);
    expect(preset.layers[0]?.params.density).toEqual({ value: 0.9 });
    expect(warnings.some((w) => w.includes('unknown layer type "spiral"'))).toBe(true);
  });

  it("clamps layer opacity and defaults a bad blend mode", () => {
    const { preset, warnings } = parsePreset(
      { ...minimal, layers: [{ type: "tunnel", opacity: 4, blend: "screen" }] },
      registry,
    );
    expect(preset.layers[0]?.opacity).toBe(1);
    expect(preset.layers[0]?.blend).toBe("add");
    expect(warnings.length).toBe(2);
  });
});

describe("parsePreset: audio links", () => {
  it("accepts the {value, link} form and keeps the link", () => {
    const { preset, warnings } = parsePreset(
      { ...minimal, feedback: { zoom: { value: 1, link: { source: "bass", amount: 0.3, smooth: 0.2 } } } },
      registry,
    );
    expect(preset.feedback.zoom).toEqual({ value: 1, link: { source: "bass", amount: 0.3, smooth: 0.2 } });
    expect(warnings).toEqual([]);
  });

  it("drops a link with an unknown source, keeps the value", () => {
    const { preset, warnings } = parsePreset(
      { ...minimal, feedback: { zoom: { value: 1.5, link: { source: "vibes", amount: 1, smooth: 0 } } } },
      registry,
    );
    expect(preset.feedback.zoom).toEqual({ value: 1.5 });
    expect(warnings[0]).toMatch(/unknown audio source "vibes"/);
  });

  it("clamps link amount to -1..1", () => {
    const { preset } = parsePreset(
      { ...minimal, feedback: { zoom: { value: 1, link: { source: "beat", amount: 7, smooth: -1 } } } },
      registry,
    );
    expect(preset.feedback.zoom?.link).toEqual({ source: "beat", amount: 1, smooth: 0 });
  });
});

describe("parsePreset: round trip", () => {
  it("a saved preset loads back to the same preset", () => {
    const first = parsePreset(
      {
        ...minimal,
        tags: ["calm", 3],
        transition: { style: "crossfade", seconds: 2 },
        feedback: { zoom: { value: 1.2, link: { source: "bass", amount: 0.4, smooth: 0.3 } } },
        layers: [{ type: "tunnel", enabled: false, opacity: 0.6, blend: "max", params: { density: 0.7 } }],
        post: { bloom: true },
      },
      registry,
    ).preset;

    const saved = JSON.parse(JSON.stringify(first));
    const second = parsePreset(saved, registry);
    expect(second.preset).toEqual(first);
    expect(second.warnings).toEqual([]);
    expect(first.tags).toEqual(["calm"]);
  });
});
