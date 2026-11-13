import { describe, it, expect, beforeEach } from "vitest";
import { FrameBuilder } from "../audio/frameBuilder";
import { binForFrequency } from "../audio/bands";
import { LinkRunner, ReactionBank } from "./links";
import { applyLinkedPreset } from "./loader";
import { parsePreset, PRESET_VERSION, type Preset } from "./format";
import { FEEDBACK_SPECS, LAYER_SPECS, POST_SPECS } from "./layerSchemas";
import { parseReactions } from "./reactions";
import {
  DEFAULT_REACTION_STYLE,
  REACTION_STYLES,
  REACTION_STYLE_KEY,
  effectiveReactionStyle,
  getReactionStyle,
  parseReactionStyle,
  reactionsForStyle,
  setReactionStyle,
} from "./reactionStyles";

const SAMPLE_RATE = 48000;
const FFT = 4096;
const FAST = 2048;
const DT = 1 / 60;
const silent = new Float32Array(FFT);

function subBytes(fft: number, on: boolean): Uint8Array {
  const out = new Uint8Array(fft / 2);
  if (!on) return out;
  const lo = binForFrequency(20, SAMPLE_RATE, fft);
  const hi = Math.round((120 * fft) / SAMPLE_RATE);
  for (let i = lo; i < hi; i += 1) out[i] = 255;
  return out;
}

const basePreset = {
  version: PRESET_VERSION,
  name: "styles-test",
  tags: [],
  transition: { style: "crossfade", seconds: 1 },
  feedback: { zoom: { value: 1 }, rotate: { value: 0 }, warp: { value: 0 } },
  post: { hueShift: { value: 0 } },
  layers: [],
} as unknown as Preset;

/** Runs a steady 120 BPM kick signal through the real FrameBuilder, link runner and reaction bank. */
function playKicks(preset: Preset, style: Parameters<typeof reactionsForStyle>[0], seconds = 8) {
  const builder = new FrameBuilder(SAMPLE_RATE, FFT, FAST);
  const runner = new LinkRunner();
  const bank = new ReactionBank();
  const zooms: number[] = [];
  const kickFrames: number[] = [];
  let setFeedback: Record<string, unknown> = {};
  const scene = { setFeedback: (v: Record<string, unknown>) => { setFeedback = v; }, layers: [], setLayerConfig: () => {} } as never;
  for (let i = 0; i < seconds * 60; i += 1) {
    const kick = i > 0 && i % 30 === 0;
    if (kick) kickFrames.push(i);
    const frame = builder.build(i * DT, subBytes(FFT, kick), silent, subBytes(FAST, kick));
    const engine = bank.engineFor("t", preset.reactions, reactionsForStyle(style));
    if (engine) applyLinkedPreset(preset, scene, runner, "t", { frame, timeSec: i * DT, sectionContrast: 0 }, DT, engine);
    else setFeedback = { zoom: 1 };
    zooms.push(setFeedback.zoom as number);
  }
  return { zooms, kickFrames };
}

describe("reaction styles", () => {
  it("lists Off, Gentle, Punchy, Wild, and Off adds nothing", () => {
    expect([...REACTION_STYLES]).toEqual(["off", "gentle", "punchy", "wild"]);
    expect(reactionsForStyle("off")).toHaveLength(0);
    expect(DEFAULT_REACTION_STYLE).toBe("off");
  });

  it("every style reaction is valid for the real Feedback and Post controls", () => {
    for (const style of REACTION_STYLES) {
      const warnings: string[] = [];
      const parsed = parseReactions(JSON.parse(JSON.stringify(reactionsForStyle(style))), { feedback: FEEDBACK_SPECS, post: POST_SPECS }, warnings);
      expect(warnings).toEqual([]);
      expect(parsed).toHaveLength(reactionsForStyle(style).length);
    }
  });

  it("builds up: Gentle zoom and hue, Punchy adds rotation kicks and a flip every 8 beats, Wild adds warp and colour picks", () => {
    const names = (s: Parameters<typeof reactionsForStyle>[0]) => reactionsForStyle(s).map((r) => `${r.trigger.type}:${r.response}:${r.target.name}`);
    expect(names("gentle")).toEqual(["beat:kick:zoom", "everyNSeconds:drift:hueShift"]);
    expect(names("punchy")).toEqual(["beat:kick:zoom", "beat:kick:rotate", "everyNBeats:flip:rotate", "strongBeat:kick:bloom"]);
    expect(reactionsForStyle("punchy").find((r) => r.response === "flip")!.trigger.n).toBe(8);
    expect(names("wild")).toEqual([...names("punchy"), "section:step:warp", "strongBeat:pick:hueShift"]);
  });

  it("Punchy and Wild swell Post bloom on strong beats (0.2 of range, ease 0.3); Gentle and Off do not", () => {
    const bloomKick = (s: Parameters<typeof reactionsForStyle>[0]) =>
      reactionsForStyle(s).filter((r) => r.target.group === "post" && r.target.name === "bloom");
    for (const style of ["punchy", "wild"] as const) {
      expect(bloomKick(style)).toEqual([{ trigger: { type: "strongBeat" }, response: "kick", target: { group: "post", name: "bloom" }, amount: 0.2, ease: 0.3 }]);
    }
    expect(bloomKick("gentle")).toHaveLength(0);
    expect(bloomKick("off")).toHaveLength(0);
  });

  it("with a steady kick signal, Punchy kicks the zoom on each beat and Off does nothing", () => {
    const punchy = playKicks(basePreset, "punchy");
    const off = playKicks(basePreset, "off");
    expect(off.zooms.every((z) => z === 1)).toBe(true);
    // After the tempo and onsets settle, every kick lifts the zoom clearly above its resting value.
    for (const f of punchy.kickFrames.filter((k) => k >= 120)) {
      const peak = Math.max(punchy.zooms[f]!, punchy.zooms[f + 1]!, punchy.zooms[f + 2]!);
      expect(peak).toBeGreaterThan(1.03);
    }
    // And it settles between beats.
    expect(Math.min(...punchy.zooms.slice(90, 120))).toBeLessThan(1.01);
  });

  it("is repeatable: the same signal gives the same zoom values", () => {
    expect(playKicks(basePreset, "wild", 6).zooms).toEqual(playKicks(basePreset, "wild", 6).zooms);
  });

  it("a preset's own style wins over the global one", () => {
    expect(effectiveReactionStyle(undefined, "gentle")).toBe("gentle");
    expect(effectiveReactionStyle("off", "wild")).toBe("off");
    expect(effectiveReactionStyle("punchy", "off")).toBe("punchy");
  });

  it("a preset's own reactions run in addition to a style", () => {
    const own = { ...basePreset, reactions: [{ trigger: { type: "beat" }, response: "kick", target: { group: "post", name: "hueShift" }, amount: 0.1, ease: 0.3 }] } as Preset;
    const bank = new ReactionBank();
    expect(bank.engineFor("x", own.reactions, reactionsForStyle("off"))!.count).toBe(1);
    expect(bank.engineFor("x", own.reactions, reactionsForStyle("punchy"))!.count).toBe(1 + reactionsForStyle("punchy").length);
    expect(bank.engineFor("y", undefined, reactionsForStyle("off"))).toBeNull();
  });
});

describe("reactionStyle in presets", () => {
  const registry = { feedback: FEEDBACK_SPECS, post: POST_SPECS, layers: LAYER_SPECS };
  it("reads a valid style and ignores an unknown one with a warning", () => {
    expect(parsePreset({ version: PRESET_VERSION, name: "a", reactionStyle: "punchy" }, registry).preset.reactionStyle).toBe("punchy");
    const bad = parsePreset({ version: PRESET_VERSION, name: "a", reactionStyle: "loud" }, registry);
    expect(bad.preset.reactionStyle).toBeUndefined();
    expect(bad.warnings.some((w) => w.includes("reactionStyle"))).toBe(true);
  });

  it("old presets carry no style field, so they use the global setting (Off)", () => {
    const { preset } = parsePreset({ version: PRESET_VERSION, name: "old" }, registry);
    expect("reactionStyle" in preset).toBe(false);
  });
});

describe("global style setting", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  });

  it("parses known styles only", () => {
    expect(parseReactionStyle("wild")).toBe("wild");
    expect(parseReactionStyle("loud")).toBeUndefined();
    expect(parseReactionStyle(3)).toBeUndefined();
  });

  it("sets, saves and resets to Off for unknown input", () => {
    expect(setReactionStyle("gentle")).toBe("gentle");
    expect(getReactionStyle()).toBe("gentle");
    expect(store.get(REACTION_STYLE_KEY)).toBe("gentle");
    expect(setReactionStyle("nope")).toBe("off");
    expect(getReactionStyle()).toBe("off");
  });
});
