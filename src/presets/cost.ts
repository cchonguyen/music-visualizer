// Preset cost (Stage 16, Slice 16.11). Pure logic. Each preset gets a Light, Medium or Heavy level worked out
// from its settings, so slower devices can skip the heaviest presets in the auto-cycle and use a lighter
// crossfade. Nothing is saved in the preset file: the level is computed from the settings every time.
import type { Preset } from './format';

export type CostLevel = 'light' | 'medium' | 'heavy';

export const COST_LEVELS: readonly CostLevel[] = ['light', 'medium', 'heavy'];

/** A score at or below this is Light. */
export const LIGHT_MAX = 4;
/** A score at or below this (and above LIGHT_MAX) is Medium; anything higher is Heavy. */
export const MEDIUM_MAX = 8;

/** Extra cost of each feedback warp mode (only counted while the warp amount is above 0). */
const WARP_COST: Record<string, number> = { classic: 0, polarFold: 2, rgbSplit: 2, mobius: 4, curl: 9 };

/** Cost of each layer type. Unknown types count as 1. */
const LAYER_COST: Record<string, number> = {
  spectralTerrain: 4,
  ferrofluid: 4,
  reactionDiffusion: 4,
  chladniSand: 3,
  julia: 3,
  particles: 3,
  tunnel: 2,
  moire: 2,
  crown: 2,
  shockwave: 1,
  rings: 1,
  bars: 1,
  shape: 1,
  waveform: 1,
  bassPulse: 1,
};

export interface PresetCost {
  score: number;
  level: CostLevel;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The cost score of a preset: warp mode, sobel, solarize, bloom, mirror and the layers that are switched on. */
export function costScore(preset: Pick<Preset, 'feedback' | 'post' | 'layers'>): number {
  const fb = preset.feedback ?? {};
  const post = preset.post ?? {};
  let score = 0;
  if (num(fb.warp) > 0) score += WARP_COST[String(fb.warpMode ?? 'classic')] ?? 0;
  if (num(fb.sobel) > 0) score += 2;
  if (num(fb.solarize) > 0) score += 2;
  if (num(post.bloom) > 0) score += 2;
  if (num(post.mirror) >= 2) score += 1;
  for (const layer of preset.layers ?? []) {
    if (!layer.enabled) continue;
    score += LAYER_COST[layer.type] ?? 1;
  }
  return score;
}

export function costLevelOf(score: number): CostLevel {
  if (score <= LIGHT_MAX) return 'light';
  if (score <= MEDIUM_MAX) return 'medium';
  return 'heavy';
}

export function presetCost(preset: Pick<Preset, 'feedback' | 'post' | 'layers'>): PresetCost {
  const score = costScore(preset);
  return { score, level: costLevelOf(score) };
}

/** True if `level` is no heavier than `max`. */
export function withinCost(level: CostLevel, max: CostLevel): boolean {
  return COST_LEVELS.indexOf(level) <= COST_LEVELS.indexOf(max);
}

/**
 * The heaviest level a device tier should cycle through automatically. Phones and integrated-graphics laptops
 * skip Heavy presets; desktops run everything. (Presets can still be chosen by hand on any device.)
 */
export function maxCostForTier(tier: 'phone' | 'integrated' | 'desktop'): CostLevel {
  return tier === 'desktop' ? 'heavy' : 'medium';
}

/** Longest crossfade, in seconds, on the lighter-crossfade tiers. */
export const LIGHT_FADE_MAX_SEC = 0.6;
