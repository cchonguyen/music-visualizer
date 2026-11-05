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
