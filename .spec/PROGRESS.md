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
- [x] **Slice 5.11: Shockwave size on all presets (retroactive, PR #45)** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts`, `src/presets/builtin/crown.json`, `src/presets/builtin/flight.json`, `src/render/layers/shockwave.ts` | Verify: npm run typecheck && npm test && npm run build

## Stage 7 — Texture presets (Charlie, 2026-11-06: 10 new presets that use texture)
- [x] **Slice 7.2: Texture presets 1-3 (Glass Tunnel, Sub Bloom, Silk Rings)** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `src/presets/builtin/tex-glass-tunnel.json` [NEW], `src/presets/builtin/tex-sub-bloom.json` [NEW], `src/presets/builtin/tex-silk-rings.json` [NEW], `src/presets/builtin/index.ts`, `src/presets/loader.test.ts`, `src/presets/session.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.3: Texture presets 4-6 (Static Rain, Prism Bars, Pulse Skin)** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `src/presets/builtin/tex-static-rain.json` [NEW], `src/presets/builtin/tex-prism-bars.json` [NEW], `src/presets/builtin/tex-pulse-skin.json` [NEW], `src/presets/builtin/index.ts`, `src/presets/loader.test.ts`, `src/presets/session.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.4: Texture presets 7-9 (Grain Crown, Ripple Field, Neon Weave)** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `src/presets/builtin/tex-grain-crown.json` [NEW], `src/presets/builtin/tex-ripple-field.json` [NEW], `src/presets/builtin/tex-neon-weave.json` [NEW], `src/presets/builtin/index.ts`, `src/presets/loader.test.ts`, `src/presets/session.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.5: Texture preset 10 (Dust Wave)** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `src/presets/builtin/tex-dust-wave.json` [NEW], `src/presets/builtin/index.ts`, `src/presets/loader.test.ts`, `src/presets/session.test.ts` | Verify: npm run typecheck && npm test && npm run build
## Stage 11 — Settings pass (.spec/specs/settings-pass.md; decided 2026-11-06)
- [x] **Slice 11.1: Shared tokens for the controls bar, buttons, sliders and text** `[UI / VISUAL]` worker: gf-coder (Haiku) | Target files: `src/style.css`, `index.html` | Verify: npm run typecheck && npm run build
- [x] **Slice 11.2: One close pattern on all three surfaces** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `index.html`, `src/style.css`, `src/studio/studio.ts`, `src/ui/controls.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 11.3: Phone grid and grouped controls** `[UI / VISUAL]` worker: lead (Haiku) | Target files: `index.html`, `src/style.css` | Verify: npm run typecheck && npm run build
- [x] **Slice 11.4: Accessibility fixes** `[CORE / DATA]` worker: lead (Haiku) | Target files: `src/ui/controls.ts`, `src/ui/controls.test.ts`, `src/studio/studio.ts`, `src/studio/studio.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 11.5: CSS accessibility (44 px range and Calm checkbox under 600 px, WCAG AA contrast tokens)**  `[UI / VISUAL]` worker: gf-coder (Haiku) | Target files: `index.html`, `src/style.css` | Verify: npm run typecheck && npm run build
- [ ] **Slice 11.6: Mobile settings fit, shared slider and text, value buttons, sticky close, swipe down** [IN_PROGRESS] `[CORE / DATA]` worker: gf-coder (Haiku) | Target files: `index.html`, `src/style.css`, `src/ui/controls.ts`, `src/ui/controls.test.ts`, `src/studio/studio.ts` | Verify: npm run typecheck && npm test && npm run build
