// Warp field operators (Stage 18). A preset holds a stack of up to four operators.
// Each operator is a type plus a list of settings, so audio links, morphs and reactions
// can target them the same way they target Feedback and Post settings.
import type { EnumSpec, NumberSpec, ParamSpec } from "./schema";

/**
 * Operators. The position in this list is the number the warp field shader switches on, so new names are
 * only ever added at the end.
 */
export const WARP_OP_TYPES = ["radial", "swirl", "ripple", "stripes", "stretch", "tile", "tunnel", "sphere", "curl", "flow", "fold"] as const;
export type WarpOpType = (typeof WARP_OP_TYPES)[number];

/** Most operators a preset can stack. */
export const WARP_OP_MAX = 4;

export const WARP_OP_LABELS: Readonly<Record<WarpOpType, string>> = {
  radial: "Radial",
  swirl: "Swirl",
  ripple: "Ripple",
  stripes: "Stripes",
  stretch: "Stretch and squish",
  tile: "Tile and mirror",
  tunnel: "Tunnel perspective",
  sphere: "Sphere bulge",
  curl: "Curl noise",
  flow: "Flow field (ink in water)",
  fold: "Fractal fold",
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

/** Tile and mirror reads Scale as the number of tiles across, so it starts at 2 rather than 1. */
const SCALE_DEFAULTS: Partial<Record<WarpOpType, number>> = { tile: 2 };

/** Curl noise has three settings of its own, the same ones the old Curl warp mode has. */
export const CURL_FLOW_STYLES = ["plumes", "eddies", "outflow", "inflow"] as const;

/** Fractal fold's own setting: how many fold-and-scale rounds. The render scale caps it (see `foldIterations`). */
export const FOLD_ITERATIONS_MIN = 3;
export const FOLD_ITERATIONS_MAX = 6;

function foldSpecs(): ParamSpec[] {
  return [{ type: "int", name: "iterations", label: "Iterations", group: "Warp field", default: 4, min: FOLD_ITERATIONS_MIN, max: FOLD_ITERATIONS_MAX, step: 1 }];
}

function curlSpecs(): ParamSpec[] {
  const flow: EnumSpec = { type: "enum", name: "flow", label: "Flow style", group: "Warp field", default: "plumes", options: CURL_FLOW_STYLES };
  return [
    { type: "int", name: "octaves", label: "Octaves", group: "Warp field", default: 2, min: 1, max: 3, step: 1 },
    num("turbulence", "Turbulence", 0.45, 0, 1, 0.01),
    flow,
  ];
}

/**
 * The settings list for one operator type. Every type has the common settings; Curl noise adds three more and Fractal fold adds one.
 * Code that changes an operator's type must fill in any setting the new type has and the old one lacked.
 */
export function warpOpSpecs(type: WarpOpType): readonly ParamSpec[] {
  const scaleDefault = SCALE_DEFAULTS[type];
  const common = scaleDefault === undefined
    ? commonSpecs()
    : commonSpecs().map((spec) => (spec.name === "scale" && spec.type === "float" ? { ...spec, default: scaleDefault } : spec));
  if (type === "curl") return [...common, ...curlSpecs()];
  if (type === "fold") return [...common, ...foldSpecs()];
  return common;
}

export function isWarpOpType(value: unknown): value is WarpOpType {
  return typeof value === "string" && (WARP_OP_TYPES as readonly string[]).includes(value);
}
