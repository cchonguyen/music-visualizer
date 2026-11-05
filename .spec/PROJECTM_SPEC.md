# projectM-inspired features: contracts (2026-11-05)

Source plan: `/mnt/project-files/plans/projectm-ideas-implementation.md` (approved by Charlie, 2026-11-05). `.milk` import and shared variables are parked and are not in this spec.

## A1 Beat sensitivity
- One global value `beatSensitivity` in 0..1. Default 0.5, which reproduces today's trigger ratio of 1.3 exactly.
- Mapping (piecewise linear, monotonic): 0 gives ratio 2.0 (least sensitive), 0.5 gives 1.3, 1 gives 1.05 (most sensitive).
- Lives in `src/audio/onset.ts` as a module-level store (`setBeatSensitivity`, `getBeatSensitivity`). Detectors read it on each `step()`, so a slider change applies live without rebuilding the frame builder. An explicit `triggerRatio` option still wins, so existing tests are unchanged.
- The slider lives in `src/ui/controls.ts`, created in code inside `#controls`. It is in memory only (persistence is A2's job).

## A2 Render quality (planned, not started)
- Buffer scale 100 / 75 / 50 percent, stored as a setting. Frame budget reads it.

## A3 Aspect correction toggle (planned, not started)
- Default on. Shapes stay round at non-16:9 sizes.

## B1 Display time vs blend time (planned, not started)
- Preset JSON gains optional `displaySec` and `blendSec`. Today's defaults apply when absent.

## B2 Hard-cut mode (planned, not started)
- Beat-triggered switch with a minimum gap, using A1's sensitivity.

## B3 Transition styles (planned, not started)
- Crossfade, zoom-through, wipe, luma dissolve, chosen per preset. Behind one flag until verified.

## C1 to C4 (planned, not started)
- C1 per-pixel warp curve. C2 polygon shape schema (up to 4 shapes, 3 to 12 sides). C3 shape renderer. C4 up to 4 extra wave layers.
- Phase C starts only after A and B are verified.

## Verify rule
Each slice runs `npm run typecheck && npm test && npm run build`, once after the final edit. Real output goes in the PR description.

Slice ids: 5.1 = A1, 5.2 = A2, 5.3 = A3, 5.4 = B1, 5.5 = B2, 5.6 = B3, 5.7 = C1, 5.8 = C2, 5.9 = C3, 5.10 = C4 (plan names in .spec/PROJECTM_SPEC.md).
