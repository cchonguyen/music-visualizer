# Stage 20: New generators and preset overhaul

Goal: more variety (fluid, fractals, orbiting, simple 3D architecture) and a smaller, stronger preset set.

Read `README.md` in this folder first. Needs Stages 18 and 19 merged.

## Why
- Requested in `docs/ideas.md`: fluid-like effects, fractal patterns, pseudo-3D orbiting, simple 3D architecture.
- Research: well-loved preset collections group into themes (Fractal, Geometric, Hypnotic, Particles, Sparkle, Waveform and so on) and are valued for consistent quality.
- Of 43 builtin presets, many are near-duplicates. Stage 15 moved them to a review folder.

## Design rules
- Prefer warp operators and single-pass layers. No ray marching and no multi-step simulations: they are what make visualizers stutter on phones.
- Each new generator ships with a cost tag (Stage 16) and is benchmarked on the phone tier before merge.

## Slices

- [ ] **Slice 20.1: Flow-field fluid warp operator** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/shaders/warpField.frag.glsl`, `src/presets/warpOps.ts`, `src/presets/warpOps.test.ts`, `src/render/warpField.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 20.2: Fractal folding warp operator** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/shaders/warpField.frag.glsl`, `src/presets/warpOps.ts`, `src/presets/warpOps.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 20.3: Julia set layer with audio-driven constants** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/julia.ts` [NEW], `src/render/shaders/julia.frag.glsl` [NEW], `src/presets/layerSchemas.ts`, `src/render/__tests__/generators.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 20.4: Orbit layer: shapes on tilted orbits with depth sizing** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/orbit.ts` [NEW], `src/render/shaders/orbit.vert.glsl` [NEW], `src/presets/layerSchemas.ts`, `src/render/__tests__/generators.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 20.5: Architecture layer: perspective grid floor and ceiling, pillars, corridor** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/architecture.ts` [NEW], `src/render/shaders/architecture.frag.glsl` [NEW], `src/presets/layerSchemas.ts`, `src/render/__tests__/generators.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 20.6: Register the new layers in the Studio and the scene** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/main.ts`, `src/studio/studio.ts`, `src/presets/builtin/index.ts`, `src/presets/cost.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 20.7: Preset themes and mood tags in the preset format and taxonomy** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/format.ts`, `src/presets/format.test.ts`, `src/presets/builtin/index.ts`, `src/presets/__tests__/presetTaxonomy.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 20.8: Preset overhaul batch 1: tune flagships 01 to 10 with reactions, warp field and colour map** 🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/builtin/01-curl-fluid-warp.json`, `src/presets/builtin/02-kaleidoscopic-mandala.json`, `src/presets/builtin/03-solarized-contour-rings.json`, `src/presets/builtin/04-mobius-dual-vortex.json` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 20.9: Preset overhaul batch 2: new presets for fluid, fractal, orbit and architecture** 🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/builtin/index.ts`, `src/presets/builtin/26-ink-flow.json` [NEW], `src/presets/builtin/27-julia-drift.json` [NEW], `src/presets/builtin/28-orbit-hall.json` [NEW] | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 20.10: Mashup: combine one preset's layers with another's Feedback and Post** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/variation.ts`, `src/presets/variation.test.ts`, `src/studio/studio.ts`, `src/ui/controls.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint

## Slice notes
- **20.1** The operator carries the image along a slowly changing flow field with a little self-advection. It should read as ink in water. Not a pressure solver.
- **20.2** Repeated fold and scale of the lookup coordinates (kaleidoscopic iterated folding), 3 to 6 iterations, tier-limited.
- **20.3** Fixed iteration cap by tier (for example 24, 48, 96). Constants driven by mid and bass with slow smoothing so the set breathes and does not flash.
- **20.5** One fragment shader using analytic perspective for planes and repeated columns. Measure on the phone tier; if it misses the frame budget, ship it tagged Heavy and excluded from phone auto-cycle.
- **20.8** Batch 1 is split across several slices of at most 4 preset files each as it proceeds (20.8a, 20.8b, 20.8c). Add those lines to PROGRESS when starting each. Charlie reviews each batch on the live site.
- **20.8, 20.9** Target after the overhaul: about 25 to 30 tuned presets across themes, each with a cost tag and a mood tag. Presets in the review folder stay there until Charlie decides.
- **20.10** Layers and Feedback and Post are already separate in the preset format, so this is a data operation plus one button.

## Done when
- Each new generator has a preset and a benchmark row.
- Every active builtin preset has theme, mood and cost tags.
- Charlie has reviewed the tuned set on the live site.

## Out of scope
Importing MilkDrop `.milk` presets (parked). ReactionDiffusion (retired).
