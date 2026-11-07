# Task Progress & Single-Slice Work Lock

> Rule: Mark only ONE task line at a time as in progress (the IN_PROGRESS tag).
> Stage 1 detail (contracts, tests, worker tier, waves): `docs/stage1-slices.md`.

## Stage 4 — Presets, effects and Preset Studio (docs/stage4-presets-plan.md)
Status 2026-11-05: all slices built in code. Typecheck, 297 tests and build pass. Browser-checked: default look (Crown), key switching, Studio panel, feedback warp, post chain and bloom, starter Vortex / Soft smoke / Circle wave, auto-cycle key. Owner visual sign-off still open for the 🖐 slices (4.2, 4.4, S1, E1, E2, E4, V1–V5, T1).
- [x] **4.1** parameter schema + preset format (src/presets/schema.ts, format.ts)
- [~] **4.2** layers read settings — no-change check by owner side by side 🖐 (src/presets/layerSchemas.ts)
- [x] **4.3** loader + built-in JSON presets (src/presets/loader.ts, builtin/*.json)
- [~] **4.4** switching: keys 0–9, [ ], toast, per-preset crossfade, remembered last preset — owner check 🖐
- [~] **S1** live Studio panel (Tweakpane 4.0.5 + @tweakpane/core 2.0.5 for types) — every-setting check 🖐 (src/studio/studio.ts)
- [x] **S2** save / save as / duplicate / delete / export / import (src/presets/session.ts)
- [x] **S3** layer stack: enable, add, remove, reorder. Opacity and blend are stored but not drawn yet (no per-layer alpha).
- [x] **S4** undo / redo, randomise, mutate, per-layer lock, A/B compare (hold A)
- [~] **E1** feedback warp (src/render/shaders/feedback.frag.glsl) 🖐
- [x] **E2** audio links: 13 sources, smoothing, link editor with meter (src/presets/links.ts). "bass" = env.sub; LFOs fixed at 0.5 Hz
- [x] **E3** feedback colour (hue drift) and blur, inside the feedback pass
- [~] **E4** post chain: hue, saturation, contrast, gamma, brightness, kaleidoscope, vignette, red/blue split (src/render/shaders/post.frag.glsl) 🖐. Invert, solarize and echo not built.
- [x] **E5** bloom: half-size blur, threshold and amount
- [~] **V1** tunnel: wall pattern (rings/grid/spokes/checker/stripes), polygon sides, spiral twist 🖐
- [~] **V2** particles: swirl gain only (vortex when high). Outflow modes and shapes not built.
- [~] **V3** rings: polygon sides, outline or filled (filled fills the whole inside area) 🖐
- [~] **V4** kick style: ring or glow field (glow shares the kick's flash token) 🖐
- [~] **V5** waveform layer: line or circle. XY scope, mirror and dots not built.
- [~] **T1** transition styles: crossfade, wipe, dissolve, zoom-through (blend shader) 🖐
- [x] **T2** auto-cycle: timer (C), strong beat (B), shuffle (X); skip and favourite tags (src/presets/autoCycle.ts)
- [x] **T3** starter pack: 10 drafts (src/presets/builtin/starter-*.json), tagged draft. Keys 3–9 and [ ] reach them. Owner tunes and approves.
- [ ] **T4** Studio in a second window: not built (optional in the plan)

## projectM-inspired features (plan: /mnt/project-files/plans/projectm-ideas-implementation.md, approved 2026-11-05; contracts: .spec/PROJECTM_SPEC.md)
- [ ] **Slice 5.4: Display time vs blend time** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/presets/format.ts`, `src/presets/format.test.ts`, `src/presets/autoCycle.ts`, `src/presets/autoCycle.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 5.5: Hard-cut beat mode** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/presets/autoCycle.ts`, `src/presets/autoCycle.test.ts`, `src/ui/controls.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 5.6: Transition styles (T1)** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `src/render/compositor.ts`, `src/render/shaders/transition.frag.glsl` [NEW], `src/presets/format.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 5.7: Per-pixel warp field** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `src/render/shaders/feedback.frag.glsl`, `src/render/scene.ts`, `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 5.8: Custom shape schema and loader** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/presets/format.ts`, `src/presets/loader.ts`, `src/presets/loader.test.ts`, `src/presets/schema.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 5.9: Custom shape renderer** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `src/render/layers/shapes.ts` [NEW], `src/render/shaders/shapes.frag.glsl` [NEW], `src/main.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 5.10: Custom waves** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `src/render/layers/waveform.ts`, `src/presets/layerSchemas.ts` | Verify: npm run typecheck && npm test && npm run build

## Stage 7 — Slice briefs (.spec/specs/stage7-slice-briefs.md; renumbered 2026-11-07)
- [x] **Slice 7.8: Fix the 6 audited layer/blend bugs and centralize GL blend state** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/main.ts`, `src/render/scene.ts`, `src/presets/loader.ts`, `src/render/layers/waveform.ts`, `src/render/layers/particles.ts`, `src/render/shaders/particles.vert.glsl`, `src/render/shaders/rings.frag.glsl`, `src/render/shaders/bars.frag.glsl`, `src/studio/studio.ts`, `src/render/__tests__/scene.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.9: Calm safety switch, luminance slew and stripe damping** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/render/safety.ts`, `src/render/compositor.ts`, `src/render/shaders/composite.frag.glsl`, `src/audio/engine.ts`, `src/render/__tests__/safety.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.10: kickEnv, kickPulse, centroid freeze and 512x2 audio texture** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/audio/types.ts`, `src/audio/frameBuilder.ts`, `src/presets/format.ts`, `src/presets/links.ts`, `src/presets/schema.ts`, `src/render/bandTexture.ts`, `src/audio/frameBuilder.test.ts`, `src/presets/links.test.ts`, `src/render/bandTexture.test.ts`, `src/render/__tests__/safety.test.ts`, `src/render/__tests__/scene.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.11: Feedback warp modes (curl, polarFold, mobius, rgbSplit) with sobel and solarize** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/render/shaders/feedback.frag.glsl`, `src/render/scene.ts`, `src/presets/schema.ts`, `src/presets/loader.ts`, `src/render/__tests__/feedbackWarp.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.12: Rings orbit and polar grid, waveform star7 and lissajous, CRT post, Presets 01–06** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/render/layers/rings.ts`, `src/render/shaders/rings.frag.glsl`, `src/render/layers/waveform.ts`, `src/render/shaders/waveform.vert.glsl`, `src/render/shaders/post.frag.glsl`, `src/presets/schema.ts`, `src/presets/builtin/index.ts`, `src/presets/builtin/01-curl-fluid-warp.json`, `src/presets/builtin/02-kaleidoscopic-mandala.json`, `src/presets/builtin/03-solarized-contour-rings.json`, `src/presets/builtin/04-mobius-dual-vortex.json`, `src/presets/builtin/05-rgb-aberration-vortex.json`, `src/presets/builtin/06-lissajous-vector-crt.json`, `src/presets/__tests__/presets.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.13: MoireLayer, SpectralTerrainLayer, Presets 07–08** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/render/layers/moire.ts`, `src/render/shaders/moire.frag.glsl`, `src/render/layers/spectralTerrain.ts`, `src/render/shaders/spectralTerrain.vert.glsl`, `src/render/shaders/spectralTerrain.frag.glsl`, `src/presets/schema.ts`, `src/presets/loader.ts`, `src/presets/builtin/07-moire-interference-loom.json`, `src/presets/builtin/08-spectral-ridge-terrain.json`, `src/presets/builtin/index.ts`, `src/render/__tests__/generators.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.14: ChladniSandLayer, phyllotaxis particle mode, Presets 09–10** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/render/layers/chladniSand.ts`, `src/render/shaders/chladniSand.vert.glsl`, `src/render/shaders/chladniSand.frag.glsl`, `src/render/layers/particles.ts`, `src/render/shaders/particles.vert.glsl`, `src/presets/schema.ts`, `src/presets/loader.ts`, `src/presets/builtin/09-chladni-cymatic-sand.json`, `src/presets/builtin/10-phyllotaxis-spiral-bloom.json`, `src/presets/builtin/index.ts`, `src/render/__tests__/chladniPhyllo.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.15: FerrofluidLayer on a 4-subdivision icosahedron, Preset 11** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/render/layers/ferrofluid.ts`, `src/render/shaders/ferrofluid.vert.glsl`, `src/render/shaders/ferrofluid.frag.glsl`, `src/presets/schema.ts`, `src/presets/loader.ts`, `src/presets/builtin/11-ferrofluid-magnetic-crown.json`, `src/presets/builtin/index.ts`, `src/render/__tests__/ferrofluid.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.16: Seeded morph transition, autoCycler 3.0s fallback, preset groups** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/render/compositor.ts`, `src/render/scene.ts`, `src/presets/autoCycler.ts`, `src/presets/builtin/index.ts`, `src/ui/controls.ts`, `src/render/__tests__/morphTransition.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.17: ReactionDiffusionLayer on an isolated 256x256 FBO, Preset 12** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/render/layers/reactionDiffusion.ts`, `src/render/shaders/rdSim.frag.glsl`, `src/render/shaders/rdRender.frag.glsl`, `src/presets/schema.ts`, `src/presets/loader.ts`, `src/presets/builtin/12-reaction-diffusion-coral.json`, `src/presets/builtin/index.ts`, `src/render/__tests__/reactionDiffusion.test.ts` | Verify: npm run typecheck && npm test && npm run build
