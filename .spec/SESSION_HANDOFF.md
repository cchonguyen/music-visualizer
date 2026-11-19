# Session Handoff: Stage 28 Organic Twisting Center Waveform (`twistWave`) & Preset

## Last Active State
- **Last Active Branch**: `stage-28-spec` (branched from `origin/main` at `8729b04`).
- **Active Task**: none. No `[IN_PROGRESS]` slice.
- **Status**: Stages 1 through 27 (Slices `27.1`–`27.2` ending at `8729b04`) are complete and archived in `.spec/HISTORY.md`. Stage 28 is planned, specified in `.spec/specs/stage-28-twist-wave-ribbon.md` (`[498]`), and queued in `.spec/PROGRESS.md` (`Slice 28.1` and `Slice 28.2`).

## What changed (recent)
- Completed Stage 27 (Slices `27.1`–`27.2`): untiered `bounceSpeed`/`bounceAngle`/`bounceAudioBoost`/`bounceFlipSpin` on `ShapeLayer` with persistent aspect-corrected wall-bounce physics, plus showcase preset `31-bouncing-ribbon-wave` (*Bouncing Ribbon Wave*).
- Archived Stage 27 (`27.1`–`27.2`) into `.spec/HISTORY.md` and authored Stage 28 spec (`[498]`), ADR, system spec summary, and atomic slices (`28.1`–`28.2`).

## Queued Stage 28 Scope
1. **Slice 28.1**: Add `'twistWave'` (`baseShape` index `9`) and untiered `twistSpeed`/`twistChaos` controls to `SHAPE_SPECS`/`SHAPE_DEFAULTS`/`ShapeParams` (preserving 8 `'basic'` controls and `normalMode.showWhen`); implement persistent `twistPhaseA`/`twistPhaseB` (`getTwistState()`), `twistWave` bounce extents (`1.15 * effSize`), contiguous `1024`-sample `scope` tail-window sampling for `wf.length > 1024`, and `shape.vert.glsl` `uBaseShape == 9` 3D quadrature oscilloscope displacement + displaced screen-space finite-difference tangents + depth-cued `halfWidth` & `vAlpha` (keeping `knot3d` `8` untouched).
2. **Slice 28.2**: Add built-in showcase preset `32-twisting-scope-wave` (*Twisting Scope Wave*) with dual `twistWave` layers (`frequencyGradient` ribbon + accent `dots`), curl trails (`warpReactivity: 0.30`), `radial` (`exponent: 1.5`) + `swirl` warp ops, `beat` `kick` zoom reaction, and bloom post; register `SHOWCASE_PRESETS_32` in `src/presets/builtin/index.ts` and update `src/presets/__tests__/presetTaxonomy.test.ts` (`20` showcase / `37` total).

## Next Steps
1. Execute `Slice 28.1` and `Slice 28.2` sequentially via Tier 3 workers from `.spec/PROGRESS.md`.
2. Verify `npm run typecheck && npm test && npm run build` and `node .harness/scripts/navigator.mjs --check` after each slice.
