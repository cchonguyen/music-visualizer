# Spec: Fit the visualizer to any window size

Status: decided (D1 = Option A, chosen by Charlie 2026-11-06 03:04 UTC). Build waits for the `[IN_PROGRESS]` slot: slice 7.4 holds it on main as of fdedf54.

## Problem (verified in code, 2026-11-06)
- `#stage` is `position: fixed; inset: 0; 100vw x 100vh` (src/style.css:4). The buffer follows the CSS box through ResizeObserver (src/gl/context.ts:44-45, debounced 100 ms, applySize at :111-118). The canvas already fills any window shape without CSS distortion.
- Aspect correction is on by default (src/render/compositor.ts:37-45). When on, the drawable box is the largest 16:9 box (fit16x9 at :63-70, offsets at :214-234). On a 390x844 portrait phone that is about 780x439 with about 624 px of black above and below. Layers also see the 16:9 box aspect (compositor.ts:233, :258), so portrait geometry never reaches the shaders in the default mode.
- The control bar `.controls` is fixed to the bottom. Its groups are `display:flex` with no wrap (src/style.css:13-16). On a narrow portrait screen the groups are wider than the viewport, and body has `overflow: hidden`, so some buttons may be unreachable. This is inferred from CSS and not yet measured in a browser.
- No `@media` query exists in index.html or src/style.css.
- The waveform circle (src/render/shaders/waveform.vert.glsl:18, x = cos*r/aspect) can overflow the sides in portrait.
- A DPR change with no CSS size change (moving the window to another monitor) fires no ResizeObserver, so the buffer keeps the old DPR.
- Tests: src/gl/size.test.ts covers canvasSize only. Nothing covers context.ts, fit16x9, or the viewport offsets.

## Decision (D1): what aspect correction means in a portrait window
Chosen: **Option A**. The toggle stays and still holds 16:9 in landscape windows.
- **Option A (chosen):** keep the 16:9 letterbox in landscape windows. In portrait windows (aspect below 16:9) the box follows the window, so content fills the screen and layers get the portrait aspect. Portrait is never a thin strip.
- **Option B:** the toggle keeps the 16:9 letterbox in every window, including portrait. Portrait stays a strip by default, which does not meet the request.

The rest of the spec applies under both options.

## Requirements
1. The buffer, layers and controls work at any width and height from 280 px wide up to 4K, portrait included, with no clipped content and no stretched shapes. Checked in Chrome at 390x844 portrait, 1440x900 landscape, 1920x1080 and 2560x1440, at DPR 1 and 2.
2. Control bar: below 600 px wide the groups wrap or stack, and every control stays reachable. No horizontal scroll. Keep the existing 16 px gutter.
3. Waveform circle: in portrait, scale so the circle stays inside the frame.
4. DPR change re-sizes the buffer: listen for resolution changes (matchMedia), or re-check DPR on each ResizeObserver tick.
5. Particle and texture behaviour unchanged. Particle reach already uses hypot(aspect, 1) (particles.vert.glsl:83, :95-102). Texture shaders use uRes and aspect and are checked, not changed.
6. Aspect toggle: same storage key (`mv.aspectCorrect`), same default, same live toggle.
7. Out of scope: new layouts, mobile-only UI, changing the pixel budget or DPR cap.

## Target files (build slice)
- `src/style.css` (control bar wrap, portrait sizes)
- `src/render/compositor.ts` (Option A fit rule; keep fit16x9 for landscape)
- `src/render/compositor.test.ts` (fit and offsets for landscape, portrait, square)
- `src/gl/context.ts` (DPR change listener)
- `src/render/shaders/waveform.vert.glsl` and `src/render/layers/waveform.ts`, only if the circle check fails in portrait

Verify: `npm run typecheck && npm test && npm run build`. The slice is `[UI / VISUAL]`: typecheck is the required gate, plus unit tests for the new fit maths. The browser check at the sizes in requirement 1 goes in the PR description.

## Slice line (to add to PROGRESS.md when the slot frees)
- [ ] **Slice 8.1: Fit to any window size** `[UI / VISUAL]` worker: lead (Haiku) | Target files: as above | Verify: npm run typecheck && npm test && npm run build
