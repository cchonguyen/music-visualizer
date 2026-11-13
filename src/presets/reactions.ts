// Reactions (Slice 17.3). A reaction is a trigger (when), a response (what happens), a target control
// (Feedback or Post), an amount and an ease time. They move controls on beats, at intervals and at dynamic
// moments, so mood changes do not depend on preset changes.
//
// Pure logic, no GL. All randomness comes from a seeded generator, so a fixed seed always gives the same
// result. Evaluation order lives in links.ts (Slice 17.4): base value, audio link, reaction, clamp to range.
import type { AudioFrame } from '../audio/types';
import type { ParamSpec } from './schema';
import { flashGovernor as sharedFlashGovernor, type FlashGovernor } from '../render/safety';

export const TRIGGER_TYPES = ['beat', 'strongBeat', 'everyNBeats', 'everyNSeconds', 'section', 'loudJump'] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const RESPONSE_TYPES = ['kick', 'step', 'flip', 'drift', 'pick'] as const;
export type ResponseType = (typeof RESPONSE_TYPES)[number];

export const REACTION_GROUPS = ['feedback', 'post'] as const;
export type ReactionGroup = (typeof REACTION_GROUPS)[number];

export interface ReactionTrigger {
  type: TriggerType;
  /** everyNBeats: beats (1..64). everyNSeconds: seconds (0.25..120). Ignored by the others. */
  n?: number;
}

export interface Reaction {
  trigger: ReactionTrigger;
  /**
   * kick: jump by `amount`, then ease back to the base value.
   * step: alternate between the base value and base + `amount`, easing to each, and hold.
   * flip: reverse the sign of the value, including any kick or step offsets on the same control, easing through
   *       zero. Meant for centred controls such as rotation (a flip of a control that cannot go negative is clamped).
   * drift: slow seeded wander within +-`amount`, a new target every `ease` seconds. Ignores the trigger.
   * pick: on each trigger, ease to a seeded random offset within +-`amount`, and hold.
   */
  response: ResponseType;
  target: { group: ReactionGroup; name: string };
  /** Share of the control's full range, -1..1 (like an audio link). */
  amount: number;
  /** Seconds to ease. 0 jumps at once. */
  ease: number;
  /** Optional extra seed for this reaction's random choices. */
  seed?: number;
}

export const REACTION_AMOUNT_MAX = 1;
export const REACTION_EASE_MIN = 0;
export const REACTION_EASE_MAX = 30;
export const REACTION_EVERY_BEATS_MAX = 64;
export const REACTION_EVERY_SECONDS_MIN = 0.25;
export const REACTION_EVERY_SECONDS_MAX = 120;
export const DEFAULT_EASE_SEC = 0.35;
export const MAX_REACTIONS = 32;

/** A beat counts as strong at or above this onset strength. */
export const STRONG_BEAT = 0.5;
/** Section contrast (see sectionContrast.ts, limited to +-0.5) must pass this to count as a change. */
export const SECTION_THRESHOLD = 0.25;
/** The section trigger re-arms once contrast falls back under this. */
export const SECTION_REARM = 0.1;
export const SECTION_COOLDOWN_SEC = 4;
export const LOUD_JUMP_COOLDOWN_SEC = 1;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Small seeded generator (mulberry32). Returns numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reads a list of reactions from JSON. Bad entries are dropped with a warning; this never throws. */
export function parseReactions(
  raw: unknown,
  specs: Readonly<Record<ReactionGroup, readonly ParamSpec[]>>,
  warnings: string[],
): Reaction[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push('reactions: expected a list, ignored');
    return [];
  }
  const out: Reaction[] = [];
  raw.forEach((entry, index) => {
    const where = `reactions[${index}]`;
    if (index >= MAX_REACTIONS) {
      if (index === MAX_REACTIONS) warnings.push(`reactions: more than ${MAX_REACTIONS}, extra ones ignored`);
      return;
    }
    if (!isRecord(entry)) {
      warnings.push(`${where}: not an object, dropped`);
      return;
    }
    const trig = isRecord(entry.trigger) ? entry.trigger : {};
    const type = trig.type;
    if (typeof type !== 'string' || !(TRIGGER_TYPES as readonly string[]).includes(type)) {
      warnings.push(`${where}: unknown trigger "${String(type)}", dropped`);
      return;
    }
    const response = entry.response;
    if (typeof response !== 'string' || !(RESPONSE_TYPES as readonly string[]).includes(response)) {
      warnings.push(`${where}: unknown response "${String(response)}", dropped`);
      return;
    }
    const target = isRecord(entry.target) ? entry.target : {};
    const group = target.group;
    const name = target.name;
    if (typeof group !== 'string' || !(REACTION_GROUPS as readonly string[]).includes(group) || typeof name !== 'string') {
      warnings.push(`${where}: target must be a Feedback or Post control, dropped`);
      return;
    }
    const spec = specs[group as ReactionGroup].find((s) => s.name === name);
    if (!spec || (spec.type !== 'float' && spec.type !== 'int')) {
      warnings.push(`${where}: "${group}.${name}" is not a number control, dropped`);
      return;
    }
    const amount = typeof entry.amount === 'number' && Number.isFinite(entry.amount)
      ? clamp(entry.amount, -REACTION_AMOUNT_MAX, REACTION_AMOUNT_MAX)
      : 0;
    const ease = typeof entry.ease === 'number' && Number.isFinite(entry.ease)
      ? clamp(entry.ease, REACTION_EASE_MIN, REACTION_EASE_MAX)
      : DEFAULT_EASE_SEC;
    const trigger: ReactionTrigger = { type: type as TriggerType };
    if (type === 'everyNBeats') {
      const n = typeof trig.n === 'number' && Number.isFinite(trig.n) ? Math.round(trig.n) : 4;
      trigger.n = clamp(n, 1, REACTION_EVERY_BEATS_MAX);
    } else if (type === 'everyNSeconds') {
      const n = typeof trig.n === 'number' && Number.isFinite(trig.n) ? trig.n : 4;
      trigger.n = clamp(n, REACTION_EVERY_SECONDS_MIN, REACTION_EVERY_SECONDS_MAX);
    }
    const reaction: Reaction = { trigger, response: response as ResponseType, target: { group: group as ReactionGroup, name }, amount, ease };
    if (typeof entry.seed === 'number' && Number.isFinite(entry.seed)) reaction.seed = Math.trunc(entry.seed);
    out.push(reaction);
  });
  return out;
}

/** Frame-rate independent approach: 1 at ease 0, about 95% of the way after `easeSec`. */
function approach(dtSec: number, easeSec: number): number {
  if (easeSec <= 0) return 1;
  return 1 - Math.exp((-3 * Math.max(0, dtSec)) / easeSec);
}

interface ReactionState {
  /** Current offset as a share of the control range. */
  add: number;
  addTarget: number;
  /** Current multiplier on the base value (flip). */
  mul: number;
  mulTarget: number;
  /** step alternates; this says which side it is on. */
  stepped: boolean;
  lastSeconds: number;
  nextDriftAt: number;
  rand: () => number;
}

export interface ReactionEngineOptions {
  /**
   * Gate for kick reactions that target Post bloom. Defaults to the shared screen-wide governor, the same one
   * the shockwave uses, so the whole screen stays within the flash limit.
   */
  flashGovernor?: FlashGovernor;
}

/** Runs a preset's reactions. One engine per preset; call update() once per frame, then apply() per control. */
export class ReactionEngine {
  private reactions: readonly Reaction[] = [];
  private states: ReactionState[] = [];
  private seed: number;
  private readonly governor: FlashGovernor;

  // Shared trigger state, advanced once per frame.
  private beatsSeen = 0;
  private lastBeatCount: number | null = null;
  private sectionArmed = true;
  private jumpArmed = true;
  private lastSectionFire = -Infinity;
  private lastJumpFire = -Infinity;

  constructor(reactions: readonly Reaction[] = [], seed = 1, options: ReactionEngineOptions = {}) {
    this.seed = seed;
    this.governor = options.flashGovernor ?? sharedFlashGovernor;
    this.setReactions(reactions);
  }

  /** Replaces the reactions and starts them from rest. */
  setReactions(reactions: readonly Reaction[]): void {
    this.reactions = reactions;
    this.reset();
  }

  setSeed(seed: number): void {
    this.seed = seed;
    this.reset();
  }

  get count(): number {
    return this.reactions.length;
  }

  reset(): void {
    this.states = this.reactions.map((r, i) => ({
      add: 0,
      addTarget: 0,
      mul: 1,
      mulTarget: 1,
      stepped: false,
      lastSeconds: 0,
      nextDriftAt: 0,
      rand: seededRandom((this.seed * 2654435761 + i * 40503 + (r.seed ?? 0) * 97 + 1) >>> 0),
    }));
    this.beatsSeen = 0;
    this.lastBeatCount = null;
    this.sectionArmed = true;
    this.jumpArmed = true;
    this.lastSectionFire = -Infinity;
    this.lastJumpFire = -Infinity;
  }

  /**
   * Advance every reaction to this frame. `timeSec` is the render clock, `sectionContrast` is -0.5..0.5.
   * Does nothing (and allocates nothing) when there are no reactions.
   */
  update(frame: AudioFrame, timeSec: number, dtSec: number, sectionContrast: number): void {
    const n = this.reactions.length;
    if (n === 0) return;

    const beat = frame.onset ?? frame.beat;
    const strength = frame.onsetStrength ?? frame.beatStrength;
    // Beat ticks: the tempo tracker's count when present, otherwise count detected beats ourselves.
    let tick = false;
    if (frame.beatCount !== undefined) {
      if (this.lastBeatCount !== null && frame.beatCount > this.lastBeatCount) tick = true;
      this.lastBeatCount = frame.beatCount;
    } else if (beat) {
      tick = true;
    }
    if (tick) this.beatsSeen += 1;

    // Dynamic moments, with hysteresis so one sustained change fires once.
    const contrast = Number.isFinite(sectionContrast) ? sectionContrast : 0;
    let section = false;
    if (this.sectionArmed && Math.abs(contrast) >= SECTION_THRESHOLD && timeSec - this.lastSectionFire >= SECTION_COOLDOWN_SEC) {
      section = true;
      this.sectionArmed = false;
      this.lastSectionFire = timeSec;
    } else if (!this.sectionArmed && Math.abs(contrast) < SECTION_REARM) {
      this.sectionArmed = true;
    }
    let jump = false;
    if (this.jumpArmed && contrast >= SECTION_THRESHOLD && timeSec - this.lastJumpFire >= LOUD_JUMP_COOLDOWN_SEC) {
      jump = true;
      this.jumpArmed = false;
      this.lastJumpFire = timeSec;
    } else if (!this.jumpArmed && contrast < SECTION_REARM) {
      this.jumpArmed = true;
    }

    // One flash decision per frame, shared by every bloom kick that fires on it.
    let bloomGrant: boolean | undefined;
    for (let i = 0; i < n; i += 1) {
      const r = this.reactions[i]!;
      const s = this.states[i]!;
      let fired = false;
      switch (r.trigger.type) {
        case 'beat':
          fired = beat;
          break;
        case 'strongBeat':
          fired = beat && strength >= STRONG_BEAT;
          break;
        case 'everyNBeats': {
          const every = Math.max(1, Math.round(r.trigger.n ?? 4));
          fired = tick && this.beatsSeen % every === 0;
          break;
        }
        case 'everyNSeconds': {
          const every = Math.max(REACTION_EVERY_SECONDS_MIN, r.trigger.n ?? 4);
          if (timeSec < s.lastSeconds) s.lastSeconds = timeSec; // clock went back (new source)
          if (timeSec - s.lastSeconds >= every) {
            fired = true;
            s.lastSeconds = timeSec;
          }
          break;
        }
        case 'section':
          fired = section;
          break;
        case 'loudJump':
          fired = jump;
          break;
      }

      // A bloom kick is a flash, so it must be granted by the flash limiter. A refused pulse is skipped, not delayed.
      if (fired && r.response === 'kick' && r.target.group === 'post' && r.target.name === 'bloom') {
        if (bloomGrant === undefined) bloomGrant = this.governor.tryFlash(timeSec);
        fired = bloomGrant;
      }

      let k = approach(dtSec, r.ease);
      switch (r.response) {
        case 'kick':
          // Fall back first, then jump, so even an ease of 0 shows the kick for one frame.
          s.add += (0 - s.add) * k;
          if (fired) s.add = r.amount;
          k = 0;
          break;
        case 'step':
          if (fired) {
            s.stepped = !s.stepped;
            s.addTarget = s.stepped ? r.amount : 0;
          }
          break;
        case 'flip':
          if (fired) s.mulTarget = -s.mulTarget;
          break;
        case 'pick':
          if (fired) s.addTarget = (s.rand() * 2 - 1) * r.amount;
          break;
        case 'drift': {
          const every = Math.max(0.5, r.ease);
          if (timeSec < s.nextDriftAt - every) s.nextDriftAt = timeSec; // clock went back
          if (timeSec >= s.nextDriftAt) {
            s.addTarget = (s.rand() * 2 - 1) * r.amount;
            s.nextDriftAt = timeSec + every;
          }
          // The wander is slower than the pick: it takes the whole interval to arrive.
          k = approach(dtSec, every);
          break;
        }
      }
      // Step, pick and drift ease toward their target (a kick has already fallen back above, so its k is 0).
      s.add += (s.addTarget - s.add) * k;
      s.mul += (s.mulTarget - s.mul) * approach(dtSec, r.ease);
    }
  }

  /**
   * The value of one control after reactions: (base + offset × (max − min)) × flip, clamped to the range.
   * Returns `value` untouched when nothing targets that control.
   */
  apply(group: ReactionGroup, name: string, value: number, spec: { min: number; max: number }): number {
    let mul = 1;
    let add = 0;
    let hit = false;
    for (let i = 0; i < this.reactions.length; i += 1) {
      const r = this.reactions[i]!;
      if (r.target.group !== group || r.target.name !== name) continue;
      const s = this.states[i]!;
      mul *= s.mul;
      add += s.add;
      hit = true;
    }
    if (!hit) return value;
    return clamp((value + add * (spec.max - spec.min)) * mul, spec.min, spec.max);
  }

  /** True when at least one reaction targets this control (lets callers skip work for the rest). */
  targets(group: ReactionGroup, name: string): boolean {
    for (let i = 0; i < this.reactions.length; i += 1) {
      const t = this.reactions[i]!.target;
      if (t.group === group && t.name === name) return true;
    }
    return false;
  }
}
