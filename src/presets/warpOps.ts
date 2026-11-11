// Warp field operators (Stage 18). A preset holds a stack of up to four operators.
// Each operator is a type plus a list of settings, so audio links, morphs and reactions
// can target them the same way they target Feedback and Post settings.
import type { NumberSpec, ParamSpec } from "./schema";

/** First batch of operators. Later slices add more names to this list. */
export const WARP_OP_TYPES = ["radial", "swirl", "ripple", "stripes"] as const;
export type WarpOpType = (typeof WARP_OP_TYPES)[number];

/** Most operators a preset can stack. */
export const WARP_OP_MAX = 4;

export const WARP_OP_LABELS: Readonly<Record<WarpOpType, string>> = {
  radial: "Radial",
  swirl: "Swirl",
  ripple: "Ripple",
  stripes: "Stripes",
};

function num(name: string, label: string, def: number, min: number, max: number, step: number): NumberSpec {
  return { type: "float", name, label, group: "Warp field", default: def, min, max, step };
}

/**
 * Settings every operator has. Amount is signed: for Radial a positive amount pulls the middle in
 * and pushes the edges out, a negative amount reverses that. 0 means the operator does nothing.
 */
function commonSpecs(): ParamSpec[] {
  return [
    num("amount", "Amount", 0.3, -1, 1, 0.01),
    num("scale", "Scale", 1, 0.1, 8, 0.01),
    num("speed", "Speed", 0.2, -4, 4, 0.01),
    num("centreX", "Centre X", 0, -1, 1, 0.01),
    num("centreY", "Centre Y", 0, -1, 1, 0.01),
  ];
}

/** The settings list for one operator type. Same list for every type in this batch. */
export function warpOpSpecs(type: WarpOpType): readonly ParamSpec[] {
  void type;
  return commonSpecs();
}

export function isWarpOpType(value: unknown): value is WarpOpType {
  return typeof value === "string" && (WARP_OP_TYPES as readonly string[]).includes(value);
}
