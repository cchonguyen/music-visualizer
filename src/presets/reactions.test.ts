import { describe, it, expect } from "vitest";
import type { AudioFrame } from "../audio/types";
import { parseReactions, ReactionEngine, seededRandom, type Reaction } from "./reactions";
import { FlashGovernor, flashGovernor } from "../render/safety";
import { FEEDBACK_SPECS, POST_SPECS } from "./layerSchemas";

const SPECS = { feedback: FEEDBACK_SPECS, post: POST_SPECS };
const ZOOM = { min: 0.85, max: 1.15 };
const ROTATE = { min: -0.04, max: 0.04 };
const DT = 1 / 60;

function frame(over: Partial<AudioFrame> = {}): AudioFrame {
  return { onset: false, onsetStrength: 0, beat: false, beatStrength: 0, ...over } as AudioFrame;
}

function react(partial: Partial<Reaction> & Pick<Reaction, "response">): Reaction {
  return {
    trigger: { type: "beat" },
    target: { group: "feedback", name: "zoom" },
    amount: 0.2,
    ease: 0.3,
    ...partial,
  };
}

/** Runs the engine for `frames` frames; `beatAt` lists the frame numbers that carry a beat. */
function run(engine: ReactionEngine, frames: number, beatAt: number[] = [], extra: (i: number) => Partial<AudioFrame> = () => ({}), contrast: (i: number) => number = () => 0) {
  const out: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    const isBeat = beatAt.includes(i);
    engine.update(frame({ onset: isBeat, onsetStrength: isBeat ? 0.9 : 0, ...extra(i) }), i * DT, DT, contrast(i));
    out.push(engine.apply("feedback", "zoom", 1, ZOOM));
  }
  return out;
}

describe("seededRandom", () => {
  it("repeats for the same seed and differs for another", () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    const c = seededRandom(6);
    const sa = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(sa);
    expect([c(), c(), c()]).not.toEqual(sa);
  });
});

describe("ReactionEngine triggers and responses", () => {
  it("does nothing without reactions, and leaves untargeted controls alone", () => {
    const empty = new ReactionEngine([]);
    empty.update(frame({ onset: true }), 0, DT, 0);
    expect(empty.apply("feedback", "zoom", 1.02, ZOOM)).toBe(1.02);
    const kick = new ReactionEngine([react({ response: "kick" })]);
    kick.update(frame({ onset: true }), 0, DT, 0);
    expect(kick.apply("feedback", "rotate", 0.01, ROTATE)).toBe(0.01);
    expect(kick.apply("post", "zoom", 1, ZOOM)).toBe(1);
  });

  it("kick jumps on the beat frame and eases back to the base value", () => {
    const out = run(new ReactionEngine([react({ response: "kick", amount: 0.2, ease: 0.3 })]), 60, [10]);
    expect(out[9]).toBe(1);
    expect(out[10]).toBeCloseTo(1 + 0.2 * 0.3, 6); // jumps by amount x range
    expect(out[11]!).toBeLessThan(out[10]!);
    expect(out[10 + 18]!).toBeLessThan(1.004); // about 0.3 s later it is nearly back
    expect(out[59]!).toBeCloseTo(1, 3);
  });

  it("kick with ease 0 shows for one frame", () => {
    const out = run(new ReactionEngine([react({ response: "kick", ease: 0 })]), 6, [2]);
    expect(out[2]!).toBeGreaterThan(1);
    expect(out[3]).toBe(1);
  });

  it("kick is frame-rate independent", () => {
    function at(fps: number): number {
      const e = new ReactionEngine([react({ response: "kick", amount: 0.5, ease: 0.5 })]);
      const dt = 1 / fps;
      e.update(frame({ onset: true }), 0, dt, 0);
      for (let i = 1; i <= fps * 0.5; i += 1) e.update(frame(), i * dt, dt, 0);
      return e.apply("feedback", "zoom", 1, ZOOM);
    }
    expect(at(60)).toBeCloseTo(at(30), 3);
  });

  it("step alternates between base and base + amount, and holds", () => {
    const out = run(new ReactionEngine([react({ response: "step", amount: 0.5, ease: 0.1 })]), 120, [10, 70]);
    expect(out[5]).toBe(1);
    expect(out[40]!).toBeCloseTo(1 + 0.5 * 0.3, 3); // held after the first beat
    expect(out[65]!).toBeCloseTo(1 + 0.5 * 0.3, 3); // still held, no drift
    expect(out[119]!).toBeCloseTo(1, 3); // the second beat steps back
  });

  it("flip reverses the sign of the value", () => {
    const e = new ReactionEngine([react({ response: "flip", target: { group: "feedback", name: "rotate" }, ease: 0.1 })]);
    for (let i = 0; i < 60; i += 1) e.update(frame({ onset: i === 5 }), i * DT, DT, 0);
    expect(e.apply("feedback", "rotate", 0.02, ROTATE)).toBeCloseTo(-0.02, 3);
    for (let i = 60; i < 120; i += 1) e.update(frame({ onset: i === 65 }), i * DT, DT, 0);
    expect(e.apply("feedback", "rotate", 0.02, ROTATE)).toBeCloseTo(0.02, 3);
  });

  it("flip also reverses a kick on the same control, so a centred control swings the other way", () => {
    const e = new ReactionEngine([
      react({ response: "kick", target: { group: "feedback", name: "rotate" }, amount: 0.25, ease: 0.2 }),
      react({ response: "flip", trigger: { type: "everyNBeats", n: 2 }, target: { group: "feedback", name: "rotate" }, ease: 0 }),
    ]);
    e.update(frame({ onset: true, beatCount: 0 }), 0, DT, 0);
    const first = e.apply("feedback", "rotate", 0, ROTATE);
    expect(first).toBeGreaterThan(0);
    for (let i = 1; i < 60; i += 1) e.update(frame({ beatCount: i >= 30 ? 1 : 0 }), i * DT, DT, 0); // the first tick
    e.update(frame({ onset: true, beatCount: 2 }), 1, DT, 0); // the second tick flips, and the kick lands on the flipped side
    expect(e.apply("feedback", "rotate", 0, ROTATE)).toBeCloseTo(-first, 6);
  });

  it("pick moves to a seeded random offset and holds; the same seed gives the same picks", () => {
    const make = (seed: number) => new ReactionEngine([react({ response: "pick", amount: 0.8, ease: 0.1 })], seed);
    const a = run(make(3), 200, [10, 60, 110]);
    const b = run(make(3), 200, [10, 60, 110]);
    const c = run(make(4), 200, [10, 60, 110]);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a[40]).not.toBe(1);
    expect(a[40]!).toBeCloseTo(a[55]!, 3); // held between beats
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(ZOOM.min);
      expect(v).toBeLessThanOrEqual(ZOOM.max);
    }
  });

  it("drift wanders slowly without any trigger, and is repeatable under a seed", () => {
    const make = () => new ReactionEngine([react({ response: "drift", trigger: { type: "everyNSeconds", n: 99 }, amount: 0.6, ease: 2 })], 9);
    const a = run(make(), 600);
    expect(a).toEqual(run(make(), 600));
    expect(Math.max(...a) - Math.min(...a)).toBeGreaterThan(0.02);
    for (let i = 1; i < a.length; i += 1) expect(Math.abs(a[i]! - a[i - 1]!)).toBeLessThan(0.01); // smooth
  });

  it("strongBeat ignores weak beats", () => {
    const e = new ReactionEngine([react({ trigger: { type: "strongBeat" }, response: "kick" })]);
    e.update(frame({ onset: true, onsetStrength: 0.2 }), 0, DT, 0);
    expect(e.apply("feedback", "zoom", 1, ZOOM)).toBe(1);
    e.update(frame({ onset: true, onsetStrength: 0.8 }), 0.5, DT, 0);
    expect(e.apply("feedback", "zoom", 1, ZOOM)).toBeGreaterThan(1);
  });

  it("everyNBeats fires on every Nth tempo tick, and counts detected beats when there is no tempo count", () => {
    const withTempo = new ReactionEngine([react({ trigger: { type: "everyNBeats", n: 4 }, response: "kick", ease: 0.05 })]);
    const fires: number[] = [];
    let count = 0;
    for (let i = 0; i < 400; i += 1) {
      const tick = i > 0 && i % 30 === 0;
      if (tick) count += 1;
      withTempo.update(frame({ onset: tick, beatCount: count, beatTick: tick }), i * DT, DT, 0);
      if (withTempo.apply("feedback", "zoom", 1, ZOOM) > 1.01) fires.push(i);
    }
    expect(fires.filter((f, k) => k === 0 || f - fires[k - 1]! > 3)).toEqual([120, 240, 360]);

    const fallback = new ReactionEngine([react({ trigger: { type: "everyNBeats", n: 2 }, response: "kick", ease: 0.05 })]);
    const f2: number[] = [];
    for (let i = 0; i < 130; i += 1) {
      fallback.update(frame({ onset: i > 0 && i % 30 === 0 }), i * DT, DT, 0);
      if (fallback.apply("feedback", "zoom", 1, ZOOM) > 1.01) f2.push(i);
    }
    expect(f2.filter((f, k) => k === 0 || f - f2[k - 1]! > 3)).toEqual([60, 120]);
  });

  it("everyNSeconds fires on the render clock", () => {
    const e = new ReactionEngine([react({ trigger: { type: "everyNSeconds", n: 1 }, response: "kick", ease: 0.05 })]);
    const fires: number[] = [];
    for (let i = 0; i < 190; i += 1) {
      e.update(frame(), i * DT, DT, 0);
      if (e.apply("feedback", "zoom", 1, ZOOM) > 1.01) fires.push(i);
    }
    expect(fires.filter((f, k) => k === 0 || f - fires[k - 1]! > 3)).toEqual([60, 120, 180]);
  });

  it("section fires once per big change in either direction; loudJump only on a rise", () => {
    const section = new ReactionEngine([react({ trigger: { type: "section" }, response: "kick", ease: 0.05 })]);
    const jump = new ReactionEngine([react({ trigger: { type: "loudJump" }, response: "kick", ease: 0.05 })]);
    const contrast = (i: number) => (i >= 60 && i < 180 ? 0.4 : i >= 600 && i < 700 ? -0.4 : 0);
    const count = (out: number[]) => out.filter((v, k) => v > 1.01 && (k === 0 || out[k - 1]! <= 1.01)).length;
    expect(count(run(section, 800, [], () => ({}), contrast))).toBe(2);
    expect(count(run(jump, 800, [], () => ({}), contrast))).toBe(1);
  });

  it("stacks reactions on the same control and clamps to the range", () => {
    const e = new ReactionEngine([react({ response: "kick", amount: 1 }), react({ response: "kick", amount: 1 })]);
    e.update(frame({ onset: true }), 0, DT, 0);
    expect(e.apply("feedback", "zoom", 1.1, ZOOM)).toBe(ZOOM.max);
  });

  it("reset and setReactions return to rest", () => {
    const e = new ReactionEngine([react({ response: "kick" })]);
    e.update(frame({ onset: true }), 0, DT, 0);
    e.reset();
    expect(e.apply("feedback", "zoom", 1, ZOOM)).toBe(1);
    e.update(frame({ onset: true }), 1, DT, 0);
    e.setReactions([]);
    expect(e.apply("feedback", "zoom", 1, ZOOM)).toBe(1);
    expect(e.count).toBe(0);
  });
});

describe("parseReactions", () => {
  it("accepts a valid list and clamps numbers", () => {
    const warnings: string[] = [];
    const out = parseReactions(
      [{ trigger: { type: "everyNBeats", n: 500 }, response: "kick", target: { group: "feedback", name: "zoom" }, amount: 4, ease: -1, seed: 3.7 }],
      SPECS,
      warnings,
    );
    expect(warnings).toEqual([]);
    expect(out).toEqual([{ trigger: { type: "everyNBeats", n: 64 }, response: "kick", target: { group: "feedback", name: "zoom" }, amount: 1, ease: 0, seed: 3 }]);
  });

  it("drops bad entries with a warning and never throws", () => {
    const warnings: string[] = [];
    const out = parseReactions(
      [
        null,
        { trigger: { type: "nope" }, response: "kick", target: { group: "feedback", name: "zoom" } },
        { trigger: { type: "beat" }, response: "nope", target: { group: "feedback", name: "zoom" } },
        { trigger: { type: "beat" }, response: "kick", target: { group: "layer", name: "zoom" } },
        { trigger: { type: "beat" }, response: "kick", target: { group: "feedback", name: "wrap" } },
        { trigger: { type: "beat" }, response: "kick", target: { group: "post", name: "bloom" }, amount: 0.1 },
      ],
      SPECS,
      warnings,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.target).toEqual({ group: "post", name: "bloom" });
    expect(warnings).toHaveLength(5);
    expect(parseReactions("x", SPECS, [])).toEqual([]);
    expect(parseReactions(undefined, SPECS, [])).toEqual([]);
  });
});

describe("bloom kicks and the flash limiter", () => {
  const BLOOM = { min: 0, max: 2 };
  const bloomKick = (over: Partial<Reaction> = {}) =>
    react({ trigger: { type: "strongBeat" }, response: "kick", target: { group: "post", name: "bloom" }, amount: 0.2, ease: 0.3, ...over });
  /** Strong beats every `gapSec` for `seconds`; returns the bloom value after each frame. */
  function beatTrain(engine: ReactionEngine, gapSec: number, seconds: number, base = 0): number[] {
    const out: number[] = [];
    const frames = Math.round(seconds / DT);
    const every = Math.round(gapSec / DT);
    for (let i = 0; i < frames; i += 1) {
      const isBeat = i % every === 0;
      engine.update(frame({ onset: isBeat, onsetStrength: isBeat ? 0.9 : 0 }), i * DT, DT, 0);
      out.push(engine.apply("post", "bloom", base, BLOOM));
    }
    return out;
  }
  /** Counts visible pulses: frames where the value jumps up. */
  const pulses = (values: number[]) => values.filter((v, i) => v > (i === 0 ? 0 : values[i - 1]!) + 1e-9).length;

  it("a fast beat train (strong beat every 0.1 s) shows at most 3 bloom pulses in one second", () => {
    const e = new ReactionEngine([bloomKick()], 1, { flashGovernor: new FlashGovernor() });
    expect(pulses(beatTrain(e, 0.1, 1))).toBe(3);
  });

  it("a refused pulse leaves the bloom value unchanged", () => {
    const g = new FlashGovernor();
    g.tryFlash(0);
    const e = new ReactionEngine([bloomKick()], 1, { flashGovernor: g });
    e.update(frame({ onset: true, onsetStrength: 0.9 }), 0.1, DT, 0);
    expect(e.apply("post", "bloom", 0, BLOOM)).toBe(0);
    e.update(frame({ onset: true, onsetStrength: 0.9 }), 0.2, DT, 0);
    expect(e.apply("post", "bloom", 0.5, BLOOM)).toBe(0.5);
  });

  it("a granted pulse swells bloom from base 0 by 0.2 of the range (0.4)", () => {
    const e = new ReactionEngine([bloomKick()], 1, { flashGovernor: new FlashGovernor() });
    e.update(frame({ onset: true, onsetStrength: 0.9 }), 0, DT, 0);
    expect(e.apply("post", "bloom", 0, BLOOM)).toBeCloseTo(0.4, 6);
  });

  it("non-bloom kick reactions are not gated by the flash limiter", () => {
    const g = new FlashGovernor();
    g.tryFlash(0);
    const e = new ReactionEngine([react({ trigger: { type: "strongBeat" }, response: "kick", ease: 0.05 })], 1, { flashGovernor: g });
    const zoomRises: number[] = [];
    let prev = 1;
    for (const t of [0, 0.1, 0.2]) {
      e.update(frame({ onset: true, onsetStrength: 0.9 }), t, DT, 0);
      const z = e.apply("feedback", "zoom", 1, ZOOM);
      if (z > prev + 1e-9) zoomRises.push(t);
      prev = z;
      for (let k = 0; k < 5; k += 1) {
        e.update(frame(), t + (k + 1) * DT, DT, 0);
        prev = e.apply("feedback", "zoom", 1, ZOOM);
      }
    }
    expect(zoomRises).toEqual([0, 0.1, 0.2]);
  });

  it("by default bloom kicks use the shared screen-wide governor", () => {
    flashGovernor.reset();
    const e = new ReactionEngine([bloomKick()], 1);
    e.update(frame({ onset: true, onsetStrength: 0.9 }), 0, DT, 0);
    expect(e.apply("post", "bloom", 0, BLOOM)).toBeCloseTo(0.4, 6);
    expect(flashGovernor.tryFlash(0.1)).toBe(false);
    flashGovernor.reset();
  });

  it("the sum of a preset's bloom and a bloom kick is clamped to the control maximum", () => {
    const e = new ReactionEngine([bloomKick({ amount: 1 })], 1, { flashGovernor: new FlashGovernor() });
    e.update(frame({ onset: true, onsetStrength: 0.9 }), 0, DT, 0);
    expect(e.apply("post", "bloom", 1.9, BLOOM)).toBe(2);
    expect(e.apply("post", "bloom", 0, BLOOM)).toBe(2);
  });

  it("leaves the preset's own bloomPulse control alone", () => {
    const e = new ReactionEngine([bloomKick()], 1, { flashGovernor: new FlashGovernor() });
    e.update(frame({ onset: true, onsetStrength: 0.9 }), 0, DT, 0);
    expect(e.targets("post", "bloomPulse")).toBe(false);
    expect(e.apply("post", "bloomPulse", 0.5, BLOOM)).toBe(0.5);
  });
});
