import { describe, it, expect } from "vitest";
import {
  BLEND_SECONDS_SPEC,
  BLEND_SEC_MAX,
  BLEND_SEC_MIN,
  LINK_COOLDOWN_MAX,
  LINK_COOLDOWN_MIN,
  LINK_FLIP_SLEW_MAX,
  LINK_FLIP_SLEW_MIN,
  LINK_THRESHOLD_MAX,
  LINK_THRESHOLD_MIN,
  PRESET_BLEND_MAX_SEC,
  PRESET_BLEND_MIN_SEC,
  clampBlendSec,
  parseLink,
  parsePreset,
  presetBlendSec,
  presetDisplaySec,
  PresetFormatError,
  PRESET_VERSION,
  STYLE_SPEC,
  TRANSITION_STYLES,
  type SchemaRegistry,
} from "./format";
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

  it("keeps screen as a valid blend mode with no warning", () => {
    const { preset, warnings } = parsePreset(
      { ...minimal, layers: [{ type: "tunnel", blend: "screen" }] },
      registry,
    );
    expect(preset.layers[0]?.blend).toBe("screen");
    expect(warnings).toEqual([]);
  });

  it("clamps layer opacity and defaults a bad blend mode", () => {
    const { preset, warnings } = parsePreset(
      { ...minimal, layers: [{ type: "tunnel", opacity: 4, blend: "multiply" }] },
      registry,
    );
    expect(preset.layers[0]?.opacity).toBe(1);
    expect(preset.layers[0]?.blend).toBe("max");
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

  it("parses and clamps extended link fields and swaps inverted bounds", () => {
    const warnings: string[] = [];
    const parsed = parseLink(
      {
        source: "drop",
        amount: 0.5,
        smooth: 0.25,
        mode: "flipOnDrop",
        curve: "gate",
        threshold: 2.0,
        flipSlew: 0.01,
        cooldownSec: 120,
        minBound: 0.8,
        maxBound: 0.2,
        enumOptions: ["curl", "", 42, "mobius"],
      },
      "feedback.zoom.link",
      warnings,
    );
    expect(warnings).toEqual([]);
    expect(parsed).toEqual({
      source: "drop",
      amount: 0.5,
      smooth: 0.25,
      mode: "flipOnDrop",
      curve: "gate",
      threshold: LINK_THRESHOLD_MAX,
      flipSlew: LINK_FLIP_SLEW_MIN,
      cooldownSec: LINK_COOLDOWN_MAX,
      minBound: 0.2,
      maxBound: 0.8,
      enumOptions: ["curl", "mobius"],
    });

    const lowClampedWarnings: string[] = [];
    const lowClamped = parseLink(
      {
        source: "phrase16",
        amount: 0.3,
        smooth: 0.1,
        threshold: -1,
        flipSlew: 99,
        cooldownSec: 0,
        minBound: -0.5,
        maxBound: 1.5,
        enumOptions: ["", 123],
      },
      "feedback.zoom.link",
      lowClampedWarnings,
    );
    expect(lowClampedWarnings).toEqual([]);
    expect(lowClamped).toEqual({
      source: "phrase16",
      amount: 0.3,
      smooth: 0.1,
      threshold: LINK_THRESHOLD_MIN,
      flipSlew: LINK_FLIP_SLEW_MAX,
      cooldownSec: LINK_COOLDOWN_MIN,
      minBound: 0,
      maxBound: 1,
    });
  });

  it("warns and omits invalid mode, curve, and non-finite numeric optional fields", () => {
    const warnings: string[] = [];
    const parsed = parseLink(
      {
        source: "energySlow",
        amount: 0.4,
        smooth: 0.5,
        mode: "invalidMode",
        curve: "invalidCurve",
        threshold: "bad",
        flipSlew: Number.NaN,
        cooldownSec: Number.POSITIVE_INFINITY,
      },
      "feedback.zoom.link",
      warnings,
    );
    expect(parsed).toEqual({ source: "energySlow", amount: 0.4, smooth: 0.5 });
    expect(warnings.length).toBe(5);
    expect(warnings[0]).toMatch(/unknown link mode "invalidMode"/);
    expect(warnings[1]).toMatch(/unknown link curve "invalidCurve"/);
  });

  it("round-trips extended audio links via JSON.stringify + parsePreset", () => {
    const first = parsePreset(
      {
        ...minimal,
        feedback: {
          zoom: {
            value: 1.0,
            link: {
              source: "breakdown",
              amount: 0.4,
              smooth: 0.3,
              mode: "bipolar",
              curve: "punch",
              threshold: 0.45,
              flipSlew: 0.8,
              minBound: 0.1,
              maxBound: 0.9,
              cooldownSec: 12,
              enumOptions: ["a", "b"],
            },
          },
        },
      },
      registry,
    );
    expect(first.warnings).toEqual([]);
    const saved = JSON.parse(JSON.stringify(first.preset));
    const second = parsePreset(saved, registry);
    expect(second.warnings).toEqual([]);
    expect(second.preset).toEqual(first.preset);
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

  it("parses, warns on invalid, omits absent, and round-trips LayerEntry.opacityLink", () => {
    const plain = parsePreset(
      { ...minimal, layers: [{ type: "tunnel", opacity: 0.8 }] },
      registry,
    );
    expect(plain.warnings).toEqual([]);
    expect("opacityLink" in plain.preset.layers[0]!).toBe(false);

    const invalid = parsePreset(
      { ...minimal, layers: [{ type: "tunnel", opacity: 0.8, opacityLink: { source: "nope", amount: 0.5, smooth: 0.2 } }] },
      registry,
    );
    expect("opacityLink" in invalid.preset.layers[0]!).toBe(false);
    expect(invalid.warnings.some((w) => w.includes("layers[0] (tunnel).opacityLink"))).toBe(true);

    const valid = parsePreset(
      {
        ...minimal,
        layers: [
          {
            type: "tunnel",
            opacity: 0.5,
            opacityLink: { source: "bass", amount: 0.5, smooth: 0.2, curve: "swell" },
          },
        ],
      },
      registry,
    );
    expect(valid.warnings).toEqual([]);
    expect(valid.preset.layers[0]?.opacityLink).toEqual({
      source: "bass",
      amount: 0.5,
      smooth: 0.2,
      curve: "swell",
    });

    const roundTripped = parsePreset(JSON.parse(JSON.stringify(valid.preset)), registry);
    expect(roundTripped.warnings).toEqual([]);
    expect(roundTripped.preset).toEqual(valid.preset);
  });
});

describe("parsePreset: warp zero migration (Slice 15.3)", () => {
  const warpMode: ParamSpec = { type: "enum", name: "warpMode", label: "Mode", group: "Warp", default: "classic", options: ["classic", "curl", "polarFold", "mobius", "rgbSplit"] } as ParamSpec;
  const warp: ParamSpec = { type: "float", name: "warp", label: "Warp", group: "Warp", default: 0, min: 0, max: 1, step: 0.01 };
  const warpRegistry: SchemaRegistry = { feedback: [warpMode, warp], post: [], layers: {} };
  const load = (feedback: Record<string, unknown>) =>
    parsePreset({ ...minimal, feedback }, warpRegistry).preset.feedback;

  it("moves a stored zero to 1 in curl and mobius", () => {
    expect(load({ warpMode: "curl", warp: 0 }).warp?.value).toBe(1);
    expect(load({ warpMode: "mobius", warp: 0 }).warp?.value).toBe(1);
  });

  it("moves a missing warp (default 0) to 1 in curl and mobius", () => {
    expect(load({ warpMode: "curl" }).warp?.value).toBe(1);
    expect(load({ warpMode: "mobius" }).warp?.value).toBe(1);
  });

  it("keeps zero in classic, polarFold and rgbSplit", () => {
    for (const mode of ["classic", "polarFold", "rgbSplit"]) {
      expect(load({ warpMode: mode, warp: 0 }).warp?.value).toBe(0);
    }
  });

  it("keeps nonzero warp in every mode", () => {
    for (const mode of ["classic", "curl", "polarFold", "mobius", "rgbSplit"]) {
      expect(load({ warpMode: mode, warp: 0.35 }).warp?.value).toBe(0.35);
    }
  });
});

describe("parsePreset: director profile flags (Slice 15.7)", () => {
  it("keeps explicit useGlobalCamera and useGlobalColour booleans", () => {
    const { preset } = parsePreset(
      { ...minimal, directorProfile: { cameraMode: "dutchRoll", useGlobalCamera: false, useGlobalColour: true } },
      registry,
    );
    expect(preset.directorProfile?.useGlobalCamera).toBe(false);
    expect(preset.directorProfile?.useGlobalColour).toBe(true);
  });

  it("leaves the flags missing (meaning true) in old presets", () => {
    const { preset } = parsePreset({ ...minimal, directorProfile: { colorMood: "ember" } }, registry);
    expect(preset.directorProfile?.useGlobalCamera).toBeUndefined();
    expect(preset.directorProfile?.useGlobalColour).toBeUndefined();
  });

  it("ignores non-boolean flag values and round-trips through JSON", () => {
    const { preset } = parsePreset(
      { ...minimal, directorProfile: { colorMood: "ember", useGlobalCamera: "no", useGlobalColour: false } },
      registry,
    );
    expect(preset.directorProfile?.useGlobalCamera).toBeUndefined();
    const again = parsePreset(JSON.parse(JSON.stringify(preset)), registry).preset;
    expect(again.directorProfile).toEqual(preset.directorProfile);
  });
});

describe("parsePreset: reactions (Slice 17.3)", () => {
  const withReactions = {
    ...minimal,
    reactions: [
      { trigger: { type: "beat" }, response: "kick", target: { group: "feedback", name: "zoom" }, amount: 0.2, ease: 0.3 },
      { trigger: { type: "beat" }, response: "kick", target: { group: "feedback", name: "missing" }, amount: 0.2, ease: 0.3 },
    ],
  };

  it("keeps valid reactions and drops ones that point at a missing control", () => {
    const { preset, warnings } = parsePreset(withReactions, registry);
    expect(preset.reactions).toHaveLength(1);
    expect(preset.reactions![0]!.target.name).toBe("zoom");
    expect(warnings.some((w) => w.includes("reactions[1]"))).toBe(true);
  });

  it("leaves old presets with no reactions field at all", () => {
    const { preset } = parsePreset(minimal, registry);
    expect("reactions" in preset).toBe(false);
  });

  it("round-trips through JSON", () => {
    const first = parsePreset(withReactions, registry).preset;
    const second = parsePreset(JSON.parse(JSON.stringify(first)), registry).preset;
    expect(second.reactions).toEqual(first.reactions);
  });
});

describe("parsePreset: warp operator stack (Slice 18.1)", () => {
  it("a preset without warp has no warp key, so old presets parse the same", () => {
    const { preset, warnings } = parsePreset(minimal, registry);
    expect(preset).not.toHaveProperty("warp");
    expect(warnings).toEqual([]);
  });

  it("fills defaults for an operator and keeps its link and morph", () => {
    const { preset, warnings } = parsePreset({
      ...minimal,
      warp: [{ type: "swirl", params: { amount: { value: 0.5, link: { source: "bass", amount: 0.5, smooth: 0.2 }, morph: { to: 0.9, rate: 0.1 } } } }],
    }, registry);
    expect(warnings).toEqual([]);
    expect(preset.warp).toHaveLength(1);
    const op = preset.warp![0]!;
    expect(op.type).toBe("swirl");
    expect(op.enabled).toBe(true);
    expect(op.params.amount!.value).toBe(0.5);
    expect(op.params.amount!.link?.source).toBe("bass");
    expect(op.params.amount!.morph?.to).toBe(0.9);
    expect(op.params.scale!.value).toBe(1);
  });

  it("clamps operator values and skips unknown operator types", () => {
    const { preset, warnings } = parsePreset({
      ...minimal,
      warp: [{ type: "radial", params: { amount: 5 } }, { type: "nope" }, "junk"],
    }, registry);
    expect(preset.warp).toHaveLength(1);
    expect(preset.warp![0]!.params.amount!.value).toBe(1);
    expect(warnings.join("\n")).toMatch(/clamped/);
    expect(warnings.join("\n")).toMatch(/warp\[1\]: unknown operator type "nope"/);
    expect(warnings.join("\n")).toMatch(/warp\[2\]/);
  });

  it("keeps at most four operators", () => {
    const six = Array.from({ length: 6 }, () => ({ type: "ripple" }));
    const { preset, warnings } = parsePreset({ ...minimal, warp: six }, registry);
    expect(preset.warp).toHaveLength(4);
    expect(warnings.filter((w) => w.includes("only 4 operators"))).toHaveLength(1);
  });

  it("ignores a warp value that is not a list", () => {
    const { preset, warnings } = parsePreset({ ...minimal, warp: {} }, registry);
    expect(preset).not.toHaveProperty("warp");
    expect(warnings).toContain("warp: expected a list, ignored");
  });

  it("disabled operators stay disabled", () => {
    const { preset } = parsePreset({ ...minimal, warp: [{ type: "stripes", enabled: false }] }, registry);
    expect(preset.warp![0]!.enabled).toBe(false);
  });
});

describe("preset theme and mood (Slice 20.7)", () => {
  const registry = { feedback: [], post: [], layers: {} } as never;
  const base = { version: PRESET_VERSION, name: "t", tags: [], layers: [], feedback: {}, post: {}, transition: { style: "crossfade", seconds: 1 } };

  it("reads a known theme and mood", () => {
    const { preset, warnings } = parsePreset({ ...base, theme: "fractal", mood: "dreamy" }, registry);
    expect(preset.theme).toBe("fractal");
    expect(preset.mood).toBe("dreamy");
    expect(warnings).toEqual([]);
  });

  it("leaves older presets without them, with no warning", () => {
    const { preset, warnings } = parsePreset(base, registry);
    expect("theme" in preset).toBe(false);
    expect("mood" in preset).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("drops an unknown theme or mood with a warning and keeps the preset", () => {
    const { preset, warnings } = parsePreset({ ...base, theme: "vaporwave", mood: 7 }, registry);
    expect(preset.theme).toBeUndefined();
    expect(preset.mood).toBeUndefined();
    expect(warnings.length).toBe(2);
  });

  it("survives a save and load round trip", () => {
    const first = parsePreset({ ...base, theme: "orbit", mood: "calm" }, registry).preset;
    const again = parsePreset(JSON.parse(JSON.stringify(first)), registry).preset;
    expect(again.theme).toBe("orbit");
    expect(again.mood).toBe("calm");
  });
});

describe("parsePreset: per-preset display time (Slice 23.2)", () => {
  it("keeps a valid displaySec", () => {
    const { preset, warnings } = parsePreset({ ...minimal, displaySec: 42 }, registry);
    expect(preset.displaySec).toBe(42);
    expect(warnings).toEqual([]);
  });

  it("clamps displaySec to 5 and 300 and rounds to 0.1", () => {
    expect(parsePreset({ ...minimal, displaySec: 1 }, registry).preset.displaySec).toBe(5);
    expect(parsePreset({ ...minimal, displaySec: 9999 }, registry).preset.displaySec).toBe(300);
    expect(parsePreset({ ...minimal, displaySec: 12.34 }, registry).preset.displaySec).toBe(12.3);
  });

  it("drops a non-number or non-finite displaySec with a warning", () => {
    for (const bad of ["20", NaN, Infinity, null, true]) {
      const { preset, warnings } = parsePreset({ ...minimal, displaySec: bad }, registry);
      expect(preset).not.toHaveProperty("displaySec");
      expect(warnings).toContain("displaySec: not a number, ignored");
    }
  });

  it("keeps an absent displaySec absent", () => {
    const { preset } = parsePreset(minimal, registry);
    expect(preset).not.toHaveProperty("displaySec");
  });

  it("round-trips through JSON", () => {
    const first = parsePreset({ ...minimal, displaySec: 60 }, registry).preset;
    const second = parsePreset(JSON.parse(JSON.stringify(first)), registry).preset;
    expect(second).toEqual(first);
  });
});

describe("presetDisplaySec (Slice 23.2)", () => {
  it("returns the clamped value or undefined", () => {
    expect(presetDisplaySec({ displaySec: 2 })).toBe(5);
    expect(presetDisplaySec({ displaySec: 30 })).toBe(30);
    expect(presetDisplaySec({ displaySec: 1000 })).toBe(300);
    expect(presetDisplaySec({})).toBeUndefined();
    expect(presetDisplaySec({ displaySec: NaN })).toBeUndefined();
    expect(presetDisplaySec(undefined)).toBeUndefined();
  });
});

describe("parsePreset: morph transition style (Slice 25.3)", () => {
  it("includes 'morph' in TRANSITION_STYLES and STYLE_SPEC.options", () => {
    expect(TRANSITION_STYLES).toEqual(["crossfade", "wipe", "dissolve", "zoom", "morph"]);
    expect(STYLE_SPEC.options).toEqual(TRANSITION_STYLES);
  });

  it("parses and round-trips transition.style = 'morph' with zero warnings", () => {
    const first = parsePreset(
      { ...minimal, transition: { style: "morph", seconds: 1.5 } },
      registry,
    );
    expect(first.warnings).toEqual([]);
    expect(first.preset.transition).toEqual({ style: "morph", seconds: 1.5 });

    const second = parsePreset(JSON.parse(JSON.stringify(first.preset)), registry);
    expect(second.warnings).toEqual([]);
    expect(second.preset.transition).toEqual({ style: "morph", seconds: 1.5 });
  });
});

describe("parsePreset: per-preset blend time (Slice 26.3)", () => {
  it("exposes blendSec bounds and BLEND_SECONDS_SPEC", () => {
    expect(BLEND_SEC_MIN).toBe(0);
    expect(BLEND_SEC_MAX).toBe(10);
    expect(PRESET_BLEND_MIN_SEC).toBe(0);
    expect(PRESET_BLEND_MAX_SEC).toBe(10);
    expect(BLEND_SECONDS_SPEC.min).toBe(0);
    expect(BLEND_SECONDS_SPEC.max).toBe(10);
    expect(BLEND_SECONDS_SPEC.description?.length).toBeGreaterThan(0);
  });

  it("keeps a valid blendSec including 0 for instant cut", () => {
    const { preset, warnings } = parsePreset({ ...minimal, blendSec: 0 }, registry);
    expect(preset.blendSec).toBe(0);
    expect(warnings).toEqual([]);
    expect(parsePreset({ ...minimal, blendSec: 2.5 }, registry).preset.blendSec).toBe(2.5);
  });

  it("clamps blendSec to 0..10 and rounds to 0.01", () => {
    expect(clampBlendSec(-2)).toBe(0);
    expect(clampBlendSec(42)).toBe(10);
    expect(clampBlendSec(1.234)).toBe(1.23);
    expect(parsePreset({ ...minimal, blendSec: -1 }, registry).preset.blendSec).toBe(0);
    expect(parsePreset({ ...minimal, blendSec: 25 }, registry).preset.blendSec).toBe(10);
    expect(parsePreset({ ...minimal, blendSec: 1.236 }, registry).preset.blendSec).toBe(1.24);
  });

  it("drops a non-number or non-finite blendSec with a warning", () => {
    for (const bad of ["1.5", NaN, Infinity, -Infinity, null, true]) {
      const { preset, warnings } = parsePreset({ ...minimal, blendSec: bad }, registry);
      expect(preset).not.toHaveProperty("blendSec");
      expect(warnings).toContain("blendSec: not a number, ignored");
    }
  });

  it("omits blendSec when absent and round-trips when present", () => {
    const absent = parsePreset(minimal, registry).preset;
    expect(absent).not.toHaveProperty("blendSec");
    expect("blendSec" in JSON.parse(JSON.stringify(absent))).toBe(false);

    const present = parsePreset({ ...minimal, blendSec: 0.75 }, registry).preset;
    const roundTripped = parsePreset(JSON.parse(JSON.stringify(present)), registry).preset;
    expect(roundTripped).toEqual(present);
    expect(roundTripped.blendSec).toBe(0.75);
  });
});

describe("presetBlendSec (Slice 26.3)", () => {
  it("returns clamped blendSec when set, including 0", () => {
    expect(presetBlendSec({ blendSec: 0, transition: { seconds: 1.5 } })).toBe(0);
    expect(presetBlendSec({ blendSec: -3, transition: { seconds: 1.5 } })).toBe(0);
    expect(presetBlendSec({ blendSec: 3.5, transition: { seconds: 1.5 } })).toBe(3.5);
    expect(presetBlendSec({ blendSec: 99, transition: { seconds: 1.5 } })).toBe(10);
  });

  it("falls back to transition.seconds when blendSec is unset or invalid, or 1.2 when undefined", () => {
    expect(presetBlendSec({ transition: { seconds: 2.4 } })).toBe(2.4);
    expect(presetBlendSec({ blendSec: NaN, transition: { seconds: 2.4 } })).toBe(2.4);
    expect(presetBlendSec(undefined)).toBe(1.2);
  });
});
