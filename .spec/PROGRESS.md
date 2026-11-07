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
- [x] **S3** layer stack: enable, add, remove, reorder. Opacity and blend are stored and drawn per-layer.
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

## Stage 9 — Unified Composable `shape` Layer Architecture (.spec/specs/shape-layer-spec.md; decided 2026-11-07)
- [x] **Slice 9.1: Declarative `showWhen` schema contract, `ShapeParams` & `SHAPE_SPECS` (first in `LAYER_SPECS`)** `[CORE / DATA]` worker: gf-coder (Haiku) | Coords: `[400, 410, 485]` | Target files: `src/presets/schema.ts`, `src/presets/schema.test.ts`, `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 9.2: Core `ShapeLayer` WebGL2 renderer & GLSL shaders (8 base geometries, 8 effects, symmetry, anti-inversion, 6 propagation modes, audio envelopes & peak caps)** `[IN_PROGRESS][UI / VISUAL]` worker: gf-coder (Haiku) | Coords: `[400, 410, 485]` | Target files: `src/render/layers/shape.ts` [NEW], `src/render/shaders/shape.vert.glsl` [NEW], `src/render/shaders/shape.frag.glsl` [NEW], `src/render/__tests__/shapeLayer.test.ts` [NEW] | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 9.3: Loader registration (`shape` first in `LAYER_FACTORIES`), legacy layer migration shim, and Global Director `shape` motion analyzer** `[CORE / DATA]` worker: gf-coder (Haiku) | Coords: `[400, 410, 485]` | Target files: `src/presets/loader.ts`, `src/presets/loader.test.ts`, `src/presets/legacyShapeMigration.ts` [NEW], `src/render/globalDirector.ts`, `src/render/__tests__/globalDirector.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 9.4: Studio conditional `showWhen` blade visibility, `'shape'` default add-layer type, and descriptive multi-layer `shape` labels** `[UI / VISUAL]` worker: gf-coder (Haiku) | Coords: `[400, 410, 485]` | Target files: `src/studio/studio.ts`, `src/studio/studio.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 9.5: Built-in preset migration to `shape` and Stage 9 Showcase Preset Reel (`13`–`20`)** `[UI / VISUAL]` worker: gf-coder (Haiku) | Coords: `[400, 410, 485]` | Target files: `src/presets/builtin/index.ts`, `src/presets/builtin/crown.json`, `src/presets/builtin/flight.json`, `src/presets/builtin/bars.json`, `src/presets/builtin/01-curl-fluid-warp.json`, `src/presets/builtin/02-kaleidoscopic-mandala.json`, `src/presets/builtin/03-solarized-contour-rings.json`, `src/presets/builtin/04-mobius-dual-vortex.json`, `src/presets/builtin/05-rgb-aberration-vortex.json`, `src/presets/builtin/06-lissajous-vector-crt.json`, `src/presets/builtin/10-phyllotaxis-spiral-bloom.json`, `src/presets/builtin/13-solar-crown-eclipse.json` [NEW], `src/presets/builtin/14-sacred-orbit-mandala.json` [NEW], `src/presets/builtin/15-polar-spirograph-bloom.json` [NEW], `src/presets/builtin/16-hexagon-inward-portal.json` [NEW], `src/presets/builtin/17-corridor-led-equalizer.json` [NEW], `src/presets/builtin/18-star-burst-stream.json` [NEW], `src/presets/builtin/19-spiral-pearl-beads.json` [NEW], `src/presets/builtin/20-dual-rail-aurora-ark.json` [NEW], `src/presets/__tests__/presets.test.ts` | Verify: npm run typecheck && npm test && npm run build


## Stage 7B (Continuation) — Kick Detection & Beat Stability (.spec/specs/stage7-slice-briefs.md; decided 2026-11-07)
- [x] **Slice 7.43: Overhaul Tunnel Flight Mechanics — Rock-solid geometric depth, smooth flight velocity inertia, and zero-stutter continuous soaring** `[UI / VISUAL]` worker: gf-coder (Haiku) | Coords: `[400, 410, 481]` | Target files: `src/render/shaders/tunnel.frag.glsl`, `src/render/tunnelState.ts`, `src/render/layers/tunnel.ts`, `src/presets/layerSchemas.ts`, `src/render/__tests__/tunnelOverhaul.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 7.44: Rock-Solid Kick & Beat Detection — Absolute energy & prominence gating, 220ms refractory cooldown, strict hysteresis re-arming, and clean zero floor** `[CORE / DATA]` worker: gf-coder (Haiku) | Coords: `[400, 410, 481]` | Target files: `src/audio/onset.ts`, `src/audio/frameBuilder.ts`, `src/audio/onset.test.ts`, `src/audio/frameBuilder.test.ts` | Verify: npm run typecheck && npm test && npm run build
