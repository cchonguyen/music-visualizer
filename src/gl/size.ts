// NOTE(spec): dpr returned is the capped value min(devicePixelRatio, maxDpr), unchanged by pixel-budget scaling; output uses Math.round clamped to minimum 1; degenerate CSS sizes return 1x1 and non-finite/non-positive DPR falls back to 1, non-positive/non-finite maxDpr/maxPixels fall back to defaults (2 and 3_686_400).

export function canvasSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  opts?: { maxDpr?: number; maxPixels?: number },
): { width: number; height: number; dpr: number } {
  const maxDpr = opts?.maxDpr ?? 2;
  const maxPixels = opts?.maxPixels ?? 3_686_400;

  // Sanitize limits so uniform scaling stays finite.
  const cappedMaxDpr = maxDpr > 0 ? maxDpr : 2;
  const pixelBudget = maxPixels > 0 ? maxPixels : 3_686_400;

  // Cap DPR first; fall back to 1 for degenerate DPR values.
  let dpr = Math.min(devicePixelRatio, cappedMaxDpr);
  if (!Number.isFinite(dpr) || dpr <= 0) dpr = 1;

  // Browsers can report 0 before layout; keep a valid 1x1 target.
  if (
    !Number.isFinite(cssWidth) ||
    !Number.isFinite(cssHeight) ||
    cssWidth <= 0 ||
    cssHeight <= 0
  ) {
    return { width: 1, height: 1, dpr };
  }

  const aspect = cssHeight / cssWidth;
  let width = Math.max(1, Math.round(cssWidth * dpr));

  // Uniform scale-down to fit the budget. Height is derived from width so the
  // aspect ratio stays within 1 px, and the loop makes the budget a hard limit
  // even after rounding (Council review 2026-11-04).
  const pixels = cssWidth * dpr * cssHeight * dpr;
  if (pixels > pixelBudget) {
    width = Math.max(1, Math.floor(cssWidth * dpr * Math.sqrt(pixelBudget / pixels)));
  }
  let height = Math.max(1, Math.round(width * aspect));
  while (width > 1 && width * height > pixelBudget) {
    width -= 1;
    height = Math.max(1, Math.round(width * aspect));
  }

  return { width, height, dpr };
}

// Render quality (slice 5.2): the feedback buffer is drawn at a fraction of the canvas
// size. The owner picks 100, 75 or 50 percent; the choice is saved locally.
export const RENDER_SCALES = [1, 0.75, 0.5] as const;
export type RenderScale = (typeof RENDER_SCALES)[number];
export const RENDER_SCALE_DEFAULT: RenderScale = 1;
const RENDER_SCALE_KEY = 'mv.renderScale';

/** Returns the allowed scale closest to v, or the default for non-finite input. */
export function clampRenderScale(v: number): RenderScale {
  if (!Number.isFinite(v)) return RENDER_SCALE_DEFAULT;
  let best: RenderScale = RENDER_SCALE_DEFAULT;
  for (const s of RENDER_SCALES) {
    if (Math.abs(s - v) < Math.abs(best - v)) best = s;
  }
  return best;
}

function loadRenderScale(): RenderScale {
  try {
    const saved = localStorage.getItem(RENDER_SCALE_KEY);
    if (saved !== null) return clampRenderScale(Number(saved));
  } catch {
    // storage blocked: use the default
  }
  return RENDER_SCALE_DEFAULT;
}

let renderScale: RenderScale = loadRenderScale();

export function getRenderScale(): RenderScale {
  return renderScale;
}

export function setRenderScale(v: number): RenderScale {
  renderScale = clampRenderScale(v);
  try {
    localStorage.setItem(RENDER_SCALE_KEY, String(renderScale));
  } catch {
    // not saved; applies for this session
  }
  return renderScale;
}

// Automatic resolution scaling (slice 16.5 holds the value, 16.6 drives it). Unlike the owner's choice above it is not
// limited to three steps. The owner's choice is a ceiling: the scale in use is the smaller of the two.
export const MIN_RENDER_SCALE = 0.25;

/** Clamps any scale to MIN_RENDER_SCALE..1. Non-finite input gives 1. */
export function clampAutoScale(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(MIN_RENDER_SCALE, v));
}

let autoScale = 1;

export function getAutoScale(): number {
  return autoScale;
}

export function setAutoScale(v: number): number {
  autoScale = clampAutoScale(v);
  return autoScale;
}

/** The scale the whole render chain runs at: the automatic scale, never above the owner's choice. */
export function getEffectiveRenderScale(): number {
  return Math.min(renderScale, autoScale);
}

/** Buffer size at a render scale (any value from MIN_RENDER_SCALE to 1). Never smaller than 1x1. */
export function scaledBufferSize(
  width: number,
  height: number,
  scale: number,
): { width: number; height: number } {
  const s = clampAutoScale(scale);
  return {
    width: Math.max(1, Math.round(width * s)),
    height: Math.max(1, Math.round(height * s)),
  };
}
