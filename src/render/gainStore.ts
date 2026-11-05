// Visual gain: a single multiplier the owner sets with the slider. It scales how
// strongly visuals respond to the music (not the audio volume). Saved locally.
const KEY = 'mv.visualGain';
export const GAIN_MIN = 0.5;
export const GAIN_MAX = 3;
export const GAIN_DEFAULT = 1;

function clampGain(v: number): number {
  return Number.isFinite(v) ? Math.min(GAIN_MAX, Math.max(GAIN_MIN, v)) : GAIN_DEFAULT;
}

function load(): number {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved !== null) return clampGain(Number(saved));
  } catch {
    // storage blocked: use the default
  }
  return GAIN_DEFAULT;
}

let gain = load();

export function getVisualGain(): number {
  return gain;
}

/**
 * Visual gain as a dynamics curve (owner, 2026-11-05). Bends a 0..1 reaction value
 * around its midpoint 0.5: gain 1 is unchanged; below 1 pulls reactions toward the calm
 * middle (less contrast); above 1 pushes them apart (more contrast, bigger reactions).
 * Output stays 0..1.
 */
export function shapeReaction(x: number, g: number): number {
  const v = Number.isFinite(x) ? x : 0;
  return Math.min(1, Math.max(0, 0.5 + (v - 0.5) * g));
}

export function setVisualGain(v: number): number {
  gain = clampGain(v);
  try {
    localStorage.setItem(KEY, String(gain));
  } catch {
    // not saved; applies for this session
  }
  return gain;
}
