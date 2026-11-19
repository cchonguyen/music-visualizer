# Session Handoff: Stage 27 True Wall-Bounce Physics & Bouncing Ribbon Wave Preset

## Last Active State
- **Last Active Branch**: `stage-27-spec` (branched from `origin/main` at `ba28d54`).
- **Active Task**: none. No `[IN_PROGRESS]` slice.
- **Status**: Stages 1 through 26 (Slices `26.1`–`26.13` ending at `ba28d54`) are complete and archived in `.spec/HISTORY.md`. Stage 27 is planned, specified in `.spec/specs/stage-27-wall-bounce-and-ribbon-preset.md` (`[497]`), and queued in `.spec/PROGRESS.md` (`Slice 27.1` and `Slice 27.2`).

## What changed (recent)
- Completed Stage 26 (Slices `26.1`–`26.13`): Studio inline SVGs, per-preset `blendSec` + `0s` hard-cut beat mode, 4 Global Director palettes + live tint pickers, persistent Low-Power Mode, `invert` post effect, and radial `exponent` (`zoomexp`) WarpField parameter.
- Archived Stage 26 (`26.1`–`26.13`) into `.spec/HISTORY.md` and authored Stage 27 spec (`[497]`), ADR, system spec summary, and atomic slices (`27.1`–`27.2`).

## Queued Stage 27 Scope
1. **Slice 27.1**: Add untiered `bounceSpeed`, `bounceAngle`, `bounceAudioBoost`, and `bounceFlipSpin` controls to `SHAPE_SPECS` / `SHAPE_DEFAULTS` / `ShapeParams` (preserving 8 `'basic'` controls and `posX`/`posY` `showWhen: undefined`), and implement persistent aspect-corrected wall-bounce physics (`computeShapeBounceExtents`, `stepBouncePhysics`, `getBounceState()`, `clampDt`) on `ShapeLayer` with unit tests.
2. **Slice 27.2**: Add built-in showcase preset `31-bouncing-ribbon-wave` (*Bouncing Ribbon Wave*) pairing wall-bounce `centerLine` `scope` waveform with MilkDrop-style curl trails (`warpAudioSource: 'kick'`), radial `exponent: 1.6` warp field, `beat` `kick` reaction on `feedback.zoom`, and bloom post; register in `src/presets/builtin/index.ts` and update `src/presets/__tests__/presetTaxonomy.test.ts` (`19` showcase / `36` total).

## Next Steps
1. Execute `Slice 27.1` and `Slice 27.2` sequentially via Tier 3 workers from `.spec/PROGRESS.md`.
2. Verify `npm run typecheck && npm test && npm run build` and `node .harness/scripts/navigator.mjs --check` after each slice.
