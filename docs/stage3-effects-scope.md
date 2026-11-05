# Scope brief: Stage 3 and effects controls (triage, 2026-11-05)

Status: draft for owner decision. No slice is started. Build one slice at a time with `/spec`, then `/implement`.

## Stage 3 (SYSTEM_SPEC: parked, Stage 4 first)
- S3-a Keyboard shortcuts (fullscreen, hide controls, frame step). Small, UI only.
- S3-b Fullscreen toggle. Small, UI only.
- S3-c Performance budget: measure frame time on the owner's desktop, set a limit. Needs owner machine data.
- S3-d Hidden-tab and capture-ended handling. Core, needs a test.
- S3-e GPU-loss reset test. Core, needs a test (the reset path exists).
- S3-f Accessibility pass (focus order, contrast, reduced motion). UI, needs owner review.

## Effects controls (owner request 2026-11-05)
- E-a Shapes: new component styles (star, polygon, streak, ring variants). Touches shaders and format.
- E-b Transforms: translate, rotate, zoom per layer. Touches scene and format.
- E-c Morphs: blend between two shape or pattern settings over time. Needs format and state work.
- E-d Colour shifts: hue cycle per layer. Partly done through feedback hue drift.
- E-e Frame-by-frame shifting: step a frame or scrub a preset. Needs the render clock.
- E-f Sound responsiveness: more audio sources per setting (beyond the 13 today).
- More presets: starter pack extended after E-a to E-d land.

## Needed from you
1. Confirm the Stage 3 items to build (all six, or drop any).
2. Confirm the effects order. Suggested: E-a, E-b, E-d, E-c, E-e, E-f.
3. Confirm PR #8 option (retroactive slice or accept red gate).
4. Provide owner-desktop frame-time numbers for S3-c, or allow a default budget.

## Status check (2026-11-05, later)
Already in code, so Stage 3 scope is smaller than the list above:
- S3-a / S3-b: keyboard shortcuts (space, arrows, F for fullscreen, P palette) and a fullscreen button are in `src/ui/controls.ts`. Controls hide after 3 s idle.
- S3-d (partly): capture end shows a notice (`source-ended`). Hidden-tab pause is noted in `src/gl/context.ts`. No test yet.
- S3-e (partly): GPU-loss and restore handlers exist in `src/gl/context.ts`. No automated test yet.
- S3-f (partly): `aria-live` notices, `aria-pressed` on source buttons, reduced-motion default for calm mode. No full accessibility audit yet.
- S3-c: no measurement yet. Default budget proposed: 16.7 ms per frame at 60 fps, measured in the debug panel.
Not started: effects E-a to E-f. No slice has been opened for them yet.
