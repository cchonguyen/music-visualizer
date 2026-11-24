import type { AudioLink, Morph } from "./format";
import type { NumberSpec } from "./schema";

export interface LinkRecipe {
  id: string;
  label: string;
  description: string;
  baseLink: AudioLink;
}

export const LINK_RECIPES: readonly LinkRecipe[] = [
  {
    id: "kickPunch",
    label: "Kick Punch",
    description: "Jumps on each kick, then snaps back",
    baseLink: { source: "kickEnv", amount: 0.35, smooth: 0.08, mode: "add", curve: "punch" },
  },
  {
    id: "bassSwell",
    label: "Bass Swell",
    description: "Rises and falls smoothly with the bass",
    baseLink: { source: "bass", amount: 0.35, smooth: 0.38, mode: "add", curve: "swell" },
  },
  {
    id: "dropSurge",
    label: "Drop Surge",
    description: "Surges only when the music drops",
    baseLink: { source: "drop", amount: 0.5, smooth: 0.22, mode: "add", curve: "gate", threshold: 0.25 },
  },
  {
    id: "flipOnDrop",
    label: "Flip on Drop",
    description: "Glides into the opposite direction on each drop",
    baseLink: { source: "energy", amount: 0.4, smooth: 0.25, mode: "flipOnDrop", curve: "linear", flipSlew: 0.55 },
  },
  {
    id: "flipOnBeat",
    label: "Flip on Beat",
    description: "Switches direction on the beat",
    baseLink: { source: "bass", amount: 0.32, smooth: 0.15, mode: "flipOnBeat", curve: "punch", flipSlew: 0.3 },
  },
  {
    id: "phraseDrift",
    label: "Phrase Drift",
    description: "Drifts up and back down over each 32-beat phrase",
    baseLink: { source: "phrase32", amount: 0.45, smooth: 0.6, mode: "bipolar", curve: "linear" },
  },
  {
    id: "breakdownBloom",
    label: "Breakdown",
    description: "Lifts the setting during breakdowns and quiet parts",
    baseLink: { source: "breakdown", amount: 0.4, smooth: 0.55, mode: "add", curve: "swell" },
  },
] as const;

function scaleForSpec(spec: Pick<NumberSpec, "name" | "intense">): number {
  let scale = 1.0;
  if (spec.name === "zoom") {
    scale = 0.25;
  } else if (spec.name === "rotate") {
    scale = 0.3;
  } else if (spec.name === "decay" || spec.name === "fade") {
    scale = 0.25;
  } else if (
    spec.name === "driftX" ||
    spec.name === "driftY" ||
    spec.name === "centreX" ||
    spec.name === "centreY"
  ) {
    scale = 0.35;
  }
  if (spec.intense) {
    scale = Math.min(scale, 0.45);
  }
  return scale;
}

/**
 * Builds an AudioLink from a curated recipe, automatically scaling modulation depth
 * for sensitive or intense parameters.
 */
export function buildRecipeLink(recipeId: string, spec: Pick<NumberSpec, "name" | "intense">): AudioLink {
  const recipe = LINK_RECIPES.find((entry) => entry.id === recipeId) ?? LINK_RECIPES[0]!;
  const scale = scaleForSpec(spec);
  const amount = Math.max(-1, Math.min(1, Math.round(recipe.baseLink.amount * scale * 100) / 100));
  return { ...recipe.baseLink, amount };
}

function formatModeTag(mode: AudioLink["mode"]): string | null {
  switch (mode) {
    case "flipOnDrop":
      return "⇄Drop";
    case "flipOnBeat":
      return "⇄Beat";
    case "flipOnSection":
      return "⇄Sec";
    case "bipolar":
      return "±";
    default:
      return null;
  }
}

/**
 * Produces a compact human-readable summary of an AudioLink and/or Morph configuration.
 */
export function summarizeAudioLink(link?: AudioLink, morph?: Morph): string {
  const morphText = morph ? `morph → ${morph.to.toFixed(2)}` : "";
  if (!link) return morphText;

  const pct = Math.round(link.amount * 100);
  const sign = pct >= 0 ? "+" : "";
  const parts = [`${link.source} ${sign}${pct}%`];

  const modeTag = formatModeTag(link.mode);
  if (modeTag) parts.push(modeTag);

  if (link.curve && link.curve !== "linear") {
    parts.push(link.curve);
  }

  const linkText = parts.join(" ");
  return morphText ? `${linkText} · ${morphText}` : linkText;
}

/**
 * Finds the first recipe matching the link's source, mode, and curve, or null if custom.
 */
export function matchingRecipeId(link?: AudioLink): string | null {
  if (!link) return null;
  const linkMode = link.mode ?? "add";
  const linkCurve = link.curve ?? "linear";
  const match = LINK_RECIPES.find(
    (recipe) =>
      recipe.baseLink.source === link.source &&
      (recipe.baseLink.mode ?? "add") === linkMode &&
      (recipe.baseLink.curve ?? "linear") === linkCurve,
  );
  return match ? match.id : null;
}
