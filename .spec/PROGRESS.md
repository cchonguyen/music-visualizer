# Task Progress & Single-Slice Work Lock

> Rule: Mark only ONE task line at a time as in progress (the IN_PROGRESS tag).
> Stage 1 detail (contracts, tests, worker tier, waves): `docs/stage1-slices.md`.

## Stage 4 — Presets, effects and Preset Studio (archived summary)
Status 2026-11-05: all slices built in code. Full details archived in `.spec/HISTORY.md`.

## projectM-inspired features (plan: /mnt/project-files/plans/projectm-ideas-implementation.md, approved 2026-11-05; contracts: .spec/PROJECTM_SPEC.md)
Slices 5.4 to 5.10 were removed on 2026-11-08 because the work was superseded (owner decision, Charlie).

## Stage 19 — Shapes and particles (.spec/specs/roadmap/stage-19-shapes-particles.md)
Slice 19.4 (per-Shape glow) was removed on 2026-11-11. Post Bloom (Slice 18.7) already supplies the glow. Owner decision, Charlie.
- [x] **Slice 19.9a: Bar punch, height range and global gain in Shape** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/shape.ts`, `src/render/dynamics.ts`, `src/presets/layerSchemas.ts`, `src/render/__tests__/shapeLayer.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 19.9b: Band texture along the Shape path** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/shape.ts`, `src/render/shaders/shape.vert.glsl`, `src/presets/layerSchemas.ts`, `src/render/__tests__/shapeLayer.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 19.9c: Rotating 3D curve base in Shape** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/shape.ts`, `src/render/shaders/shape.vert.glsl`, `src/presets/layerSchemas.ts`, `src/render/__tests__/shapeLayer.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 19.9d: Loudness-driven copy count and stroke width for concentric mode in Shape** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/shape.ts`, `src/presets/layerSchemas.ts`, `src/render/__tests__/shapeLayer.test.ts` | Verify: npm run typecheck && npm test && npm run build
Audit decisions (Charlie, 2026-11-11): audit accepted. Items 1 to 4 go into Shape. orbitTriangles and polarGrid stay on Rings and are not ported.
- [x] **Slice 19.10: Fold legacy layers into Shape with preset migration** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/legacyShapeMigration.ts`, `src/presets/loader.ts`, `src/presets/loader.test.ts`, `src/presets/builtin/index.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 19.11: Migrate Waveform layers in remote system presets** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/session.ts`, `src/presets/session.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 19.12: Sharper Shape response and waveform migration tuning** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/layerSchemas.ts`, `src/presets/legacyShapeMigration.ts`, `src/presets/loader.test.ts`, `src/presets/layerSchemas.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 19.13: Peak-preserving audio sampling in Shape** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/shape.ts`, `src/render/__tests__/shapeLayer.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 19.14: Raise the Shape sample cap from 256 to 1024** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/shape.ts`, `src/render/shaders/shape.vert.glsl`, `src/presets/layerSchemas.ts`, `src/render/__tests__/shapeLayer.test.ts`, `src/presets/layerSchemas.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 19.15: Remove the legacy Waveform layer** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/waveform.ts`, `src/render/shaders/waveform.vert.glsl`, `src/render/shaders/waveform.frag.glsl`, `src/presets/loader.ts`, `src/presets/session.ts`, `src/presets/legacyShapeMigration.ts`, `src/main.ts`, `src/presets/loader.test.ts`, `src/presets/session.test.ts` | Verify: npm run typecheck && npm test && npm run build

## Stage 20 — Generators and preset overhaul (.spec/specs/roadmap/stage-20-generators-presets.md)
No lint script exists in this repo, so Verify omits it. Slice 20.9 preset numbers moved to 27, 28, 29 (25 and 26 are taken).
- [x] **Slice 20.1: Flow-field fluid warp operator** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/shaders/warpField.frag.glsl`, `src/presets/warpOps.ts`, `src/presets/warpOps.test.ts`, `src/studio/studio.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 20.2: Fractal folding warp operator** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/shaders/warpField.frag.glsl`, `src/presets/warpOps.ts`, `src/presets/warpOps.test.ts`, `src/render/warpField.ts`, `src/render/warpField.test.ts`, `src/studio/studio.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 20.3: Julia set layer with audio-driven constants** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/julia.ts` [NEW], `src/render/shaders/julia.frag.glsl` [NEW], `src/presets/layerSchemas.ts`, `src/render/__tests__/generators.test.ts`, `src/presets/loader.ts`, `src/presets/cost.ts`, `src/presets/layerSchemas.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 20.4: Orbit layer: shapes on tilted orbits with depth sizing** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/orbit.ts` [NEW], `src/render/shaders/orbit.vert.glsl` [NEW], `src/render/shaders/orbit.frag.glsl` [NEW], `src/presets/layerSchemas.ts`, `src/render/__tests__/generators.test.ts`, `src/presets/loader.ts`, `src/presets/cost.ts`, `src/presets/layerSchemas.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 20.5: Architecture layer: perspective grid floor and ceiling, pillars, corridor** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/architecture.ts` [NEW], `src/render/shaders/architecture.frag.glsl` [NEW], `src/presets/layerSchemas.ts`, `src/render/__tests__/generators.test.ts`, `src/presets/loader.ts`, `src/presets/cost.ts`, `src/presets/layerSchemas.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 20.6: Check the new layers are registered in the Studio and the scene (registration landed in 20.3 to 20.5 through the loader and layer tables, so this adds the end-to-end test)** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/studio/newLayers.test.ts` [NEW] | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 20.7: Preset themes and mood tags in the preset format and taxonomy** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/format.ts`, `src/presets/format.test.ts`, `src/presets/builtin/index.ts`, `src/presets/__tests__/presetTaxonomy.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 20.8: Preset overhaul batch 1: tune flagships 01 to 04 with reactions, warp field and colour map**  🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/builtin/01-curl-fluid-warp.json`, `src/presets/builtin/02-kaleidoscopic-mandala.json`, `src/presets/builtin/03-solarized-contour-rings.json`, `src/presets/builtin/04-mobius-dual-vortex.json`, `src/presets/__tests__/presetTaxonomy.test.ts` | Verify: npm run typecheck && npm test && npm run build
Held 20.8: tuning flagships 01 to 04 changes how existing presets look by default, and it needs eyes on the live site. Not started; needs Charlie's decision on which looks may change (default is leave them as they are). Decision 2026-11-11: update flagships
- [x]  **Slice 20.9: Preset overhaul batch 2: new presets for fluid, fractal, orbit and architecture** 🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/builtin/index.ts`, `src/presets/builtin/27-ink-flow.json` [NEW], `src/presets/builtin/28-julia-drift.json` [NEW], `src/presets/builtin/29-orbit-hall.json` [NEW], `src/presets/builtin/30-corridor-glide.json` [NEW], `src/presets/__tests__/presetTaxonomy.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x]  **Slice 20.10: Mashup: combine one preset's layers with another's Feedback and Post** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/variation.ts`, `src/presets/variation.test.ts`, `src/studio/studio.ts`, `src/ui/controls.ts` | Verify: npm run typecheck && npm test && npm run build
- [x]  **Slice 20.11: Keep dashboard variables on deploy** \[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `wrangler.jsonc` | Verify: npm run typecheck && npm test && npm run build

## Stage 21 — Public release (archived summary)
Status 2026-11-12: closed by Charlie. Slices 21.1 to 21.15 built and merged. Details archived in `.spec/HISTORY.md`.

## Stage 22 — Director signals and pop-out Studio (archived summary)
Status 2026-11-13: slices 22.1 to 22.7 built and merged (PRs #324 to #330). Details archived in `.spec/HISTORY.md`.

## Stage 24 — Harness UI adoption (.spec/specs/roadmap/stage-24-harness-ui-adoption.md)
Confirmed by Charlie, 2026-11-13. Slice lines (hub slices H24.2 to H24.4 (H24.1 dropped), spoke slices 24.1 to 24.10) are in that file. Slice lines are added here one at a time when started.
Done: 24.1 (PR #340), 24.2 (PR #343), 24.3 (PR #345). Hub slices H24.2 to H24.4 dropped 2026-11-13: the profile path was already consistent, and the unused tokens are reference values.
- [x] **Slice 24.4: Kit 2px focus ring and kit azure accent (drop the app's own accent, on-accent and focus tokens)** Issue: #346 `[UI / VISUAL]` worker: engineer (Haiku) Target files: `src/style.css` | Verify: npm run typecheck && npm test && npm run build

## Stage 23 — Polish after Stage 22 (.spec/specs/roadmap/stage-23-polish.md)
Order (Charlie, 2026-11-13): 23.1, 23.2, 23.3, then 23.4 (a throwaway browser run, no repo change). Issues: #331 to #333.
- [x] **Slice 23.1: Pop-out refreshes when the preset list changes** Issue: #331 `[CORE / DATA]` worker: engineer (Haiku) Target files: `src/studio/popoutHost.ts`, `src/studio/popoutHost.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 23.2: Per-preset display time (displaySec, Timer mode only)** Issue: #332 🖐 `[CORE / DATA]` worker: engineer (Haiku) Target files: `src/presets/format.ts`, `src/presets/format.test.ts`, `src/presets/autoCycle.ts`, `src/presets/autoCycle.test.ts`, `src/main.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 23.3: Studio Display time slider** Issue: #333 🖐 `[UI / VISUAL]` worker: engineer (Haiku) Target files: `src/studio/studio.ts`, `src/studio/studio.test.ts` | Verify: npm run typecheck && npm test && npm run build
