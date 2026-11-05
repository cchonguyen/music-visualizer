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

- [x] **Slice 4.5: Adjustable LFO rate (retroactive slice for PR #8)** `[GREEN][CORE / DATA]` worker: lead | Target files: `src/presets/format.ts`, `src/presets/links.ts`, `src/presets/links.test.ts`, `src/studio/studio.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 4.6: Particle shapes (streak, dot, star, ring)** `[YELLOW][UI / VISUAL]` worker: lead | Target files: `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts`, `src/render/layers/particles.ts`, `src/render/shaders/particles.frag.glsl` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 4.7: Particle transforms (rotation, zoom)** `[YELLOW][UI / VISUAL]` worker: lead | Target files: `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts`, `src/render/layers/particles.ts`, `src/render/shaders/particles.vert.glsl` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 4.8: Particle colour shift (hue offset and drift)** `[YELLOW][UI / VISUAL]` worker: lead | Target files: `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts`, `src/render/layers/particles.ts`, `src/render/shaders/particles.frag.glsl` | Verify: npm run typecheck && npm test && npm run build

## projectM-inspired features (plan: /mnt/project-files/plans/projectm-ideas-implementation.md, approved 2026-11-05; contracts: .spec/PROJECTM_SPEC.md)
- [x] **Slice 5.1: Beat sensitivity slider** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/audio/onset.ts`, `src/audio/onset.test.ts`, `src/ui/controls.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 5.2: Render quality (buffer scale, persisted)** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/render/scene.ts`, `src/gl/size.ts`, `src/gl/size.test.ts`, `src/ui/controls.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 5.3: Aspect correction toggle** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `src/render/compositor.ts`, `src/ui/controls.ts` | Verify: npm run typecheck && npm run build
- [ ] **Slice 5.4: Display time vs blend time** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/presets/format.ts`, `src/presets/format.test.ts`, `src/presets/autoCycle.ts`, `src/presets/autoCycle.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 5.5: Hard-cut beat mode** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/presets/autoCycle.ts`, `src/presets/autoCycle.test.ts`, `src/ui/controls.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 5.6: Transition styles (T1)** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `src/render/compositor.ts`, `src/render/shaders/transition.frag.glsl` [NEW], `src/presets/format.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 5.7: Per-pixel warp field** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `src/render/shaders/feedback.frag.glsl`, `src/render/scene.ts`, `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 5.8: Custom shape schema and loader** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/presets/format.ts`, `src/presets/loader.ts`, `src/presets/loader.test.ts`, `src/presets/schema.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 5.9: Custom shape renderer** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `src/render/layers/shapes.ts` [NEW], `src/render/shaders/shapes.frag.glsl` [NEW], `src/main.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 5.10: Custom waves** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `src/render/layers/waveform.ts`, `src/presets/layerSchemas.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 6.1: Keyboard shortcuts button** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `index.html`, `src/style.css`, `src/ui/controls.ts` | Verify: npm run typecheck && npm run build
- [ ] **Slice 5.11: Shockwave size on all presets (retroactive, PR #45)** [IN_PROGRESS] `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts`, `src/presets/builtin/crown.json`, `src/presets/builtin/flight.json`, `src/render/layers/shockwave.ts` | Verify: npm run typecheck && npm test && npm run build

## Stage 6 — Texture from band waveforms (Charlie, 2026-11-05: all bands, all effects, toggle per preset; default off)
- [x] **Slice 6.1: Band-limited waveforms (sub, mid, high)** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/audio/bandWaveforms.ts` [NEW], `src/audio/bandWaveforms.test.ts` [NEW], `src/audio/types.ts`, `src/audio/frameBuilder.ts`, `src/audio/frameBuilder.test.ts`, `src/presets/links.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 6.2: Texture toggle + tunnel and particles** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts`, `src/render/layers/tunnel.ts`, `src/render/layers/particles.ts`, `src/render/shaders/tunnel.frag.glsl`, `src/render/shaders/particles.frag.glsl` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 6.3: Texture for rings, bars and shockwave** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `src/render/layers/rings.ts`, `src/render/layers/bars.ts`, `src/render/layers/shockwave.ts`, `src/render/shaders/rings.frag.glsl`, `src/render/shaders/bars.frag.glsl`, `src/render/shaders/shockwave.frag.glsl`, `src/presets/layerSchemas.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 6.4: Texture for bass pulse, crown and waveform** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `src/render/layers/bassPulse.ts`, `src/render/layers/crown.ts`, `src/render/layers/waveform.ts`, `src/render/shaders/bassPulse.frag.glsl`, `src/render/shaders/crown.frag.glsl`, `src/render/shaders/waveform.frag.glsl`, `src/presets/layerSchemas.ts` | Verify: npm run typecheck && npm test && npm run build
