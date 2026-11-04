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

export function setVisualGain(v: number): number {
  gain = clampGain(v);
  try {
    localStorage.setItem(KEY, String(gain));
  } catch {
    // not saved; applies for this session
  }
  return gain;
}
