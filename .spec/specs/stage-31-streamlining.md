# Stage 31: Streamlining and Consolidation (Sector 520)

**Status:** Approved by Charlie (2026-11-24, decision card "Which cleanup should I build?", option "Also the refactors"). The first part (preset counts and the double Export/Import Look) shipped in PR #439 as Slice 30.438.
**Coordinate:** `520` (`.spec/specs/stage-31-streamlining.md`)

## Goal
Remove code the app no longer runs and merge copies of the same thing, so the app does exactly what it does today with less code to read and load.

## Hard boundary
- No change to what the app shows or does, and no change to preset values, storage keys, ids, CSS classes or event names.
- Old saved presets keep loading. The Reaction-Diffusion schema, `RETIRED_LAYER_TYPES` and the once-per-session notice stay, so a saved preset with that layer still parses and the layer is skipped.
- The review presets stay in the repo as JSON for later tuning. They just stop being part of the app bundle.
- Public names that tests or other modules import from `src/studio/studio.ts` keep working (the new modules are re-exported).

## Facts checked against the code (2026-11-24)
- `src/presets/autoCycler.ts` is imported only by `src/render/__tests__/morphTransition.test.ts`. The live auto-cycle is `src/presets/autoCycle.ts`. The dead copy's 3-second beatless fallback and archive exclusion never shipped: the live Vortex preset is in Classics & Textures and is cycled.
- `src/render/layers/reactionDiffusion.ts` and `src/render/shaders/rdSim.frag.glsl` / `rdRender.frag.glsl` are imported only by `src/render/__tests__/reactionDiffusion.test.ts`. `LAYER_FACTORIES` has no Reaction-Diffusion entry.
- `src/presets/builtin/index.ts` imports and parses the 18 JSON files in `src/presets/review/` at app start for `REVIEW_PRESETS` / `FLAGSHIP_PRESETS_12`, which only tests read.
- `src/presets/builtin/index.ts` changes shared schemas when it loads: it pushes `alpha` and `screen` into `BLEND_MODES`, the feedback warp specs into `FEEDBACK_SPECS`, the rings and particles `mode` specs, two waveform mode options, and sets the feedback `decay` minimum to 0. `src/presets/loader.ts` adds the Reaction-Diffusion specs to `LAYER_SPECS` the same way.
- Built-in presets are split over eleven lists (`BUILTIN_PRESETS`, `FLAGSHIP_PRESETS`, `FLAGSHIP_PRESETS_07_08` … `SHOWCASE_PRESETS_32`), plus the alias `FLAGSHIP_PRESETS_13_20` and two `(BUILTIN_PRESETS as any)` assignments.
- `src/studio/studio.ts` (3,801 lines) has its own copy of the system folder names (`SYSTEM_OPTGROUP_LABELS`). The "… imported" toasts are written in both `src/main.ts` and `src/studio/studio.ts`.
- `.spec/stage7-slice-briefs.md` is an older, shorter copy of `.spec/specs/stage7-slice-briefs.md`.

## Slices
- **31.1 Remove the unused auto-cycle copy:** delete `autoCycler.ts`; the morph test keeps its group checks and uses the live `eligible`.
- **31.2 Remove the retired Reaction-Diffusion renderer:** delete the layer, its two shaders and its test. Keep the schema and the retired-layer handling.
- **31.3 Keep review presets out of the app:** move `REVIEW_PRESETS` to `src/presets/review/index.ts`, which only tests import. Drop `FLAGSHIP_PRESETS_12`.
- **31.4 Put schema options in the schema files:** write the blend modes, feedback warp specs, rings and particles modes, waveform options, decay minimum and Reaction-Diffusion registration where the schemas are defined, and delete the load-time patches.
- **31.5 One built-in preset list:** replace the eleven lists with one ordered list in the same order, and drop the aliases and `as any` assignments. Tests use `ALL_PRESETS` or `getPresetsByGroup`.
- **31.6 One copy of folder names and import messages; drop the old Stage 7 brief:** Studio uses `SYSTEM_SUBFOLDER_LABELS`; one shared helper writes the import toast; delete `.spec/stage7-slice-briefs.md`.
- **31.7 Split the Studio file:** move the label tables, the helper bar and reset controls, the preset picker, the reaction and warp helpers, and the control builders (`buildLayerControls`, `bindSection`, `bindSpec`, `buildGlobalDirectorControls`) into their own modules under `src/studio/`, and re-export them from `studio.ts`. The `Studio` class stays in `studio.ts`.

## Verify (each slice)
`npm run typecheck && npx vitest run --maxWorkers=4 && npm run build`
