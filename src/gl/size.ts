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
