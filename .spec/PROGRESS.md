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

## Stage 7 — Visual & Reactivity Overhaul Slices (.spec/specs/stage7-slice-briefs.md; decided 2026-11-07)
- [x] **Slice 7.18: Restore max blend default, per-layer trails pass split, and dark-floor safety fix** `[CORE / DATA]` worker: gf-coder (Haiku) | Coords: `[400, 410, 481]` | Target files: `src/presets/format.ts`, `src/render/scene.ts`, `src/render/safety.ts`, `src/render/shaders/composite.frag.glsl`, `src/render/__tests__/scene.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.19: Live Studio Opacity, Blend, Trails, and vec3 (decayRgb) controls + loader trails** `[UI / VISUAL]` worker: gf-coder (Haiku) | Coords: `[400, 410, 481]` | Target files: `src/presets/loader.ts`, `src/studio/studio.ts`, `src/studio/studio.test.ts`, `src/render/__tests__/safety.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.20: Wire uLayerOpacity and stencil alpha across Crown, Shockwave, and BassPulse** `[UI / VISUAL]` worker: gf-coder (Haiku) | Coords: `[400, 410, 481]` | Target files: `src/render/layers/crown.ts`, `src/render/shaders/crown.frag.glsl`, `src/render/layers/shockwave.ts`, `src/render/shaders/shockwave.frag.glsl`, `src/render/layers/bassPulse.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.21: Tunnel overhaul (stencil alpha, round rings rainbow, cosmic star-streaks, 4 flight controls + 18s reversal)** `[UI / VISUAL]` worker: gf-coder (Haiku) | Coords: `[400, 410, 481]` | Target files: `src/render/tunnelState.ts`, `src/render/layers/tunnel.ts`, `src/render/shaders/tunnel.frag.glsl`, `src/presets/layerSchemas.ts`, `src/render/__tests__/tunnelOverhaul.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.22: Feedback warp overhaul (4-style curl + hueDrift, topographic solarize, tiled mandala, wandering dipole mobius)** `[UI / VISUAL]` worker: gf-coder (Haiku) | Coords: `[400, 410, 481]` | Target files: `src/render/shaders/feedback.frag.glsl`, `src/render/scene.ts`, `src/presets/schema.ts`, `src/presets/loader.ts`, `src/render/__tests__/feedbackWarp.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.23: Multi-color ink Waveform (colorMode) and 3-tier stained-glass Mandala seed lattice in Rings** `[UI / VISUAL]` worker: gf-coder (Haiku) | Coords: `[400, 410, 481]` | Target files: `src/render/layers/waveform.ts`, `src/render/shaders/waveform.frag.glsl`, `src/render/layers/rings.ts`, `src/render/shaders/rings.frag.glsl`, `src/presets/layerSchemas.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.24: Retune Flagship Presets 01–04 (Curl, Mandala, Solarize, Mobius) to match Mockups** `[UI / VISUAL]` worker: gf-coder (Haiku) | Coords: `[400, 410, 481]` | Target files: `src/presets/builtin/01-curl-fluid-warp.json`, `src/presets/builtin/02-kaleidoscopic-mandala.json`, `src/presets/builtin/03-solarized-contour-rings.json`, `src/presets/builtin/04-mobius-dual-vortex.json`, `src/presets/__tests__/presets.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.25: MoireLayer overhaul (stencil alpha, contrast, waveShape, 4 loom styles, bass sweep, Preset 07)** `[UI / VISUAL]` worker: gf-coder (Haiku) | Coords: `[400, 410, 481]` | Target files: `src/render/layers/moire.ts`, `src/render/shaders/moire.frag.glsl`, `src/presets/schema.ts`, `src/presets/builtin/07-moire-interference-loom.json`, `src/render/__tests__/generators.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.26: SpectralTerrainLayer overhaul (gl.FUNC_ADD skirt fix, lineThickness, 3D gridCols, ridgeShape, layoutMode, Preset 08)** `[UI / VISUAL]` worker: gf-coder (Haiku) | Coords: `[400, 410, 481]` | Target files: `src/render/layers/spectralTerrain.ts`, `src/render/shaders/spectralTerrain.vert.glsl`, `src/render/shaders/spectralTerrain.frag.glsl`, `src/presets/schema.ts`, `src/presets/builtin/08-spectral-ridge-terrain.json` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.27: Spectral Terrain Option A (downhill trail drift) & Option B (terrainStore + TEXTURE5 heightfield displacement)** `[UI / VISUAL]` worker: gf-coder (Haiku) | Coords: `[400, 410, 481]` | Target files: `src/render/terrainStore.ts`, `src/render/scene.ts`, `src/render/layers/particles.ts`, `src/render/shaders/particles.vert.glsl`, `src/render/__tests__/generators.test.ts`, `src/render/layers/spectralTerrain.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 7.28: ChladniSandLayer overhaul (fullscreen/isometric/mandala plateMode, uScale, 3-step Newton, Preset 09)** [IN_PROGRESS] `[UI / VISUAL]` worker: gf-coder (Haiku) | Coords: `[400, 410, 481]` | Target files: `src/render/layers/chladniSand.ts`, `src/render/shaders/chladniSand.vert.glsl`, `src/render/shaders/chladniSand.frag.glsl`, `src/presets/schema.ts`, `src/presets/builtin/09-chladni-cymatic-sand.json` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 7.29: Phyllotaxis overhaul (continuous seed bloom, integrated spin, full-16:9 uFar, kick ripples, seedShape, Preset 10)** `[UI / VISUAL]` worker: gf-coder (Haiku) | Coords: `[400, 410, 481]` | Target files: `src/render/layers/particles.ts`, `src/render/shaders/particles.vert.glsl`, `src/presets/schema.ts`, `src/presets/builtin/10-phyllotaxis-spiral-bloom.json`, `src/render/__tests__/chladniPhyllo.test.ts` | Verify: npm run typecheck && npm test && npm run build

