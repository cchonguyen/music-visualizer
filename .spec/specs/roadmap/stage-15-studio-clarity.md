# Stage 15: Studio clarity and quick wins

Goal: a Studio where every visible slider does something, plus the small asks from `docs/ideas.md` that need no new systems.

Read `README.md` in this folder first. Needs Stage 14 merged (time-based motion, honest tests).

## Why
- Feedback shows 39 controls. 23 warp controls in `src/presets/schema.ts` (about lines 189 to 450) have no `showWhen`, so mode-only controls always show.
- In curl and Mobius modes Warp = 0 means full strength.
- Dependent controls give no hint: contour and colour spread need Solarize > 0, Bloom threshold needs Bloom > 0, Warp scale and speed need Warp > 0.
- Duplicates: two kaleidoscopes (Post `mirror`, Feedback `kaleidoN`), several hue controls, three persistence controls.
- No reset, no duplicate layer, no solo or mute.
- `directorProfile` is saved in presets and never applied on load.
- Shape reactivity is capped by the schema (3.0), by `shape.ts:322` (`min(2.0, …)`) and by shader constants.

## Slices

- [ ] **Slice 15.1: Mode-only and dependent Feedback and Post controls hide when they do not apply** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/schema.ts`, `src/presets/schema.test.ts`, `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 15.2: Feedback and Post regrouped into Motion, Warp, Trails, Colour with clearer labels** 🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/schema.ts`, `src/presets/layerSchemas.ts`, `src/studio/studio.ts`, `src/studio/studio.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 15.3: Warp amount reads the same in every warp mode (0 is none), with preset migration** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/shaders/feedback.frag.glsl`, `src/presets/format.ts`, `src/presets/format.test.ts`, `src/render/__tests__/feedbackWarp.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 15.4: Basic and Advanced views in the Studio** 🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/layerSchemas.ts`, `src/studio/studio.ts`, `src/studio/studio.test.ts`, `src/style.css` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 15.5: Reset to default on every control and a marker on changed controls** 🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/studio/studio.ts`, `src/studio/studio.test.ts`, `src/style.css` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 15.6: Duplicate, solo and mute layer** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/session.ts`, `src/presets/session.test.ts`, `src/studio/studio.ts`, `src/studio/studio.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 15.7: Per-preset director profile is applied on load, with a Studio toggle for global camera and colour** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/session.ts`, `src/presets/session.test.ts`, `src/render/compositor.ts`, `src/studio/studio.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 15.8: Shape reactivity ceiling raised about 5 times without changing existing presets** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/layerSchemas.ts`, `src/render/layers/shape.ts`, `src/render/shaders/shape.vert.glsl`, `src/render/__tests__/shapeLayer.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 15.9: Trail fade ceiling 5 times higher and warp speed ceiling 3 times higher** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts`, `src/render/shaders/feedback.frag.glsl` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 15.10: Retire ReactionDiffusion and move near-duplicate presets to a review folder** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/builtin/index.ts`, `src/presets/__tests__/presetTaxonomy.test.ts`, `src/main.ts`, `src/presets/loader.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint

## Slice notes
- **15.1** Reuse the `showWhen` mechanism the Shape layer already uses. No behaviour change, only visibility.
- **15.2** Merge the two kaleidoscope controls into one home and the hue controls into one Colour group. Keep old keys loading through a migration.
- **15.3** Today `warp = 0` in curl and Mobius is treated as 1.0. Migrate stored zeros in those modes to the value that gives the same picture.
- **15.4** Add a `tier: 'basic' | 'advanced'` field to control specs. Basic shows 6 to 8 controls per section. The choice persists in local storage.
- **15.6** The preset format already allows repeated layer types. Solo and mute are Studio state and are not saved in presets.
- **15.7** `directorProfile {cameraMode, colorMood, colorIntensity}` is parsed and exported today (`session.ts` near line 935). Add `useGlobalCamera` and `useGlobalColour` booleans, default true.
- **15.8** Raise the schema maximum, the `min(2.0, …)` clamp in `shape.ts`, and the fixed constants in `shape.vert.glsl` together. Values up to the old maximum must draw the same as before.
- **15.9** Fade per frame maximum is 0.02 and warp speed maximum is 5 today. Long trails will band on 8-bit buffers until Stage 16 adds half-float; note this in the PR.
- **15.10** ReactionDiffusion: remove the layer from the add-layer list and move preset 12 to the review folder; keep the code loading old user presets without crashing (skip the layer with a notice). Review folder candidates: 9 of the 10 `starter-*` presets, most `tex-*` presets, `flight`, `crown`. List the exact files in the PR for Charlie. Move, never delete. If the remote system presets table also holds these, say so and ask before changing remote data.

## Done when
- With warp mode Classic selected, no Mandala, Mobius or curl control is visible.
- Every listed quick-win idea is visible in the Studio.
- Loading every builtin preset before and after gives the same parameter values, apart from the documented migrations.

## Out of scope
Search box, new effects, triggers.
