// Reaction styles (Slice 17.5): ready-made sets of reactions (Slice 17.3) the viewer can pick without editing
// anything. A style is added to whatever reactions a preset already has.
//
// Default: Off. Existing presets keep their exact look until someone chooses a style (decision for Charlie:
// the stage note suggested Gentle as the default, but that would change how every preset looks).
import type { Reaction } from './reactions';

export const REACTION_STYLES = ['off', 'gentle', 'punchy', 'wild'] as const;
export type ReactionStyle = (typeof REACTION_STYLES)[number];
export const DEFAULT_REACTION_STYLE: ReactionStyle = 'off';

export const REACTION_STYLE_LABELS: Readonly<Record<ReactionStyle, string>> = {
  off: 'Off',
  gentle: 'Gentle',
  punchy: 'Punchy',
  wild: 'Wild',
};

export function parseReactionStyle(value: unknown): ReactionStyle | undefined {
  return typeof value === 'string' && (REACTION_STYLES as readonly string[]).includes(value) ? (value as ReactionStyle) : undefined;
}

const fb = (name: string) => ({ group: 'feedback', name }) as const;
const post = (name: string) => ({ group: 'post', name }) as const;

// Amounts are shares of each control's full range: zoom runs 0.85..1.15 (0.3 wide), rotate -0.04..0.04, hue -3.14..3.14.
const GENTLE: readonly Reaction[] = Object.freeze([
  // A small zoom pulse on every beat.
  { trigger: { type: 'beat' }, response: 'kick', target: fb('zoom'), amount: 0.08, ease: 0.4 },
  // A slow colour wander: a new hue target every 6 seconds.
  { trigger: { type: 'everyNSeconds', n: 8 }, response: 'drift', target: post('hueShift'), amount: 0.1, ease: 6 },
]);

const PUNCHY: readonly Reaction[] = Object.freeze([
  { trigger: { type: 'beat' }, response: 'kick', target: fb('zoom'), amount: 0.2, ease: 0.25 },
  { trigger: { type: 'beat' }, response: 'kick', target: fb('rotate'), amount: 0.3, ease: 0.35 },
  // The spin kicks reverse direction every 8 beats.
  { trigger: { type: 'everyNBeats', n: 8 }, response: 'flip', target: fb('rotate'), amount: 0, ease: 0.4 },
  // A bloom swell on strong beats. The engine gates it to at most 3 pulses per second (flash limiter).
  { trigger: { type: 'strongBeat' }, response: 'kick', target: post('bloom'), amount: 0.2, ease: 0.3 },
]);

const WILD: readonly Reaction[] = Object.freeze([
  ...PUNCHY,
  // Warp steps up and back on each section change, and the colour jumps to a new pick on strong beats.
  { trigger: { type: 'section' }, response: 'step', target: fb('warp'), amount: 0.6, ease: 1.2 },
  { trigger: { type: 'strongBeat' }, response: 'pick', target: post('hueShift'), amount: 0.5, ease: 0.3 },
]);

const NONE: readonly Reaction[] = Object.freeze([]);

/** The reactions a style adds. Always the same array for the same style, so callers can compare by identity. */
export function reactionsForStyle(style: ReactionStyle): readonly Reaction[] {
  switch (style) {
    case 'gentle':
      return GENTLE;
    case 'punchy':
      return PUNCHY;
    case 'wild':
      return WILD;
    default:
      return NONE;
  }
}

/** A preset's own style wins; without one the global style applies. */
export function effectiveReactionStyle(presetStyle: ReactionStyle | undefined, globalStyle: ReactionStyle): ReactionStyle {
  return presetStyle ?? globalStyle;
}

// The global style is saved on this device, like the render quality.
export const REACTION_STYLE_KEY = 'mv-reaction-style';

function loadStyle(): ReactionStyle {
  try {
    return parseReactionStyle(localStorage.getItem(REACTION_STYLE_KEY)) ?? DEFAULT_REACTION_STYLE;
  } catch {
    return DEFAULT_REACTION_STYLE;
  }
}

let globalStyle: ReactionStyle = loadStyle();

export function getReactionStyle(): ReactionStyle {
  return globalStyle;
}

/** Sets and saves the global style. Unknown input resets to the default. */
export function setReactionStyle(value: unknown): ReactionStyle {
  globalStyle = parseReactionStyle(value) ?? DEFAULT_REACTION_STYLE;
  try {
    localStorage.setItem(REACTION_STYLE_KEY, globalStyle);
  } catch {
    // not saved; applies for this session
  }
  return globalStyle;
}
