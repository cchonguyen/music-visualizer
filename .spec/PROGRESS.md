# Task Progress & Single-Slice Work Lock

> Rule: Mark only ONE task line at a time as in progress (the IN_PROGRESS tag).
> Stage 1 detail (contracts, tests, worker tier, waves): `docs/stage1-slices.md`.

## Stage 1 — Audio core and GPU proof

- [x] **Slice 1.0: Project scaffold** [DONE] `[GREEN][CORE / DATA]` worker: lead | Target files: `package.json` [NEW], `tsconfig.json` [NEW], `vite.config.ts` [NEW], `index.html` [NEW], `src/main.ts` [NEW], `.gitignore` [NEW] | Verify: npm run typecheck && npm test -- --passWithNoTests && npm run build
- [x] **Slice 1.1: Band math and AudioFrame types** [DONE] `[GREEN][CORE / DATA]` worker: free | Target files: `src/audio/types.ts` [NEW], `src/audio/bands.ts` [NEW], `src/audio/bands.test.ts` [NEW] | Verify: npm test -- src/audio/bands.test.ts && npm run typecheck
- [x] **Slice 1.2: Envelope follower and rolling normalizer** [DONE] `[GREEN][CORE / DATA]` worker: free | Target files: `src/audio/envelope.ts` [NEW], `src/audio/normalize.ts` [NEW], `src/audio/envelope.test.ts` [NEW], `src/audio/normalize.test.ts` [NEW] | Verify: npm test -- src/audio/envelope.test.ts src/audio/normalize.test.ts && npm run typecheck
- [x] **Slice 1.3: Spectral flux and onset detector** [DONE] `[GREEN][CORE / DATA]` worker: free | Target files: `src/audio/onset.ts` [NEW], `src/audio/onset.test.ts` [NEW] | Verify: npm test -- src/audio/onset.test.ts && npm run typecheck
- [x] **Slice 1.4: Test-signal plans** [DONE] `[GREEN][CORE / DATA]` worker: free | Target files: `src/audio/testSignals.ts` [NEW], `src/audio/testSignals.test.ts` [NEW] | Verify: npm test -- src/audio/testSignals.test.ts && npm run typecheck
- [x] **Slice 1.5: Canvas size math** [DONE] `[GREEN][CORE / DATA]` worker: free | Target files: `src/gl/size.ts` [NEW], `src/gl/size.test.ts` [NEW] | Verify: npm test -- src/gl/size.test.ts && npm run typecheck
- [x] **Slice 1.6: Frame builder** [DONE] `[YELLOW][CORE / DATA]` worker: free, needs 1.1–1.3 | Target files: `src/audio/frameBuilder.ts` [NEW], `src/audio/frameBuilder.test.ts` [NEW] | Verify: npm test -- src/audio/frameBuilder.test.ts && npm run typecheck
- [x] **Slice 1.7: Audio engine and sources** [DONE] (browser check in 1.11) `[RED][CORE / DATA]` worker: lead | Target files: `src/audio/engine.ts` [NEW], `src/audio/sources.ts` [NEW] | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 1.8: WebGL2 core** [DONE] `[RED][UI / VISUAL]` worker: lead | Target files: `src/gl/context.ts` [NEW], `src/gl/shader.ts` [NEW], `src/gl/texture.ts` [NEW], `src/render/layer.ts` [NEW] | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 1.9: Tracer visuals (bass pulse, waveform)** [DONE] `[YELLOW][UI / VISUAL]` worker: cheap, needs 1.6 and 1.8 | Target files: `src/render/layers/bassPulse.ts` [NEW], `src/render/layers/waveform.ts` [NEW], `src/render/shaders/bassPulse.frag.glsl` [NEW], `src/render/shaders/waveform.vert.glsl` [NEW], `src/render/shaders/waveform.frag.glsl` [NEW] | Verify: npm run typecheck && npm run build
- [x] **Slice 1.10: Debug panel and latency** [DONE] `[YELLOW][UI / VISUAL]` worker: cheap, needs 1.6 and 1.7 | Target files: `src/ui/debugPanel.ts` [NEW], `src/audio/latency.ts` [NEW], `src/audio/latency.test.ts` [NEW] | Verify: npm test -- src/audio/latency.test.ts && npm run typecheck
- [x] **Slice 1.11: App shell and controls** [DONE] (test signals verified in browser; file/capture/mic in 1.13) `[RED][UI / VISUAL]` worker: lead | Target files: `index.html`, `src/main.ts`, `src/ui/controls.ts` [NEW], `src/ui/notices.ts` [NEW], `src/style.css` [NEW] | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 1.12: Deploy to Cloudflare** [DONE] (https://music-visualizer.charliechonguyen.com, backup https://music-visualizer.charliechonguyen.workers.dev) `[YELLOW][CORE / DATA]` worker: lead + owner login | Target files: `wrangler.jsonc` [NEW], `package.json` | Verify: npx wrangler deploy
- [x] **Slice 1.14: Council round 2 fixes** [DONE] `[YELLOW][CORE / DATA]` worker: lead | Target files: `src/audio/types.ts`, `src/audio/frameBuilder.ts`, `src/audio/normalize.ts`, `src/audio/sources.ts`, `src/audio/engine.ts`, `src/render/clock.ts` [NEW], `src/render/layer.ts`, `src/gl/context.ts`, `src/render/layers/bassPulse.ts`, `src/render/layers/waveform.ts`, `src/ui/debugPanel.ts`, `src/main.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 1.13: Device test report** [DONE] (owner reports pass on Mac and Windows, 2026-11-04) `[GREEN][UI / VISUAL]` worker: owner | Target files: `docs/stage1-test-report.md` [NEW] | Verify: owner sign-off

## Stage 2 — Visuals on WebGL2 (specs in docs/stage2-slices.md)

- [x] **Slice 2.0: Palette module (neon default, switchable)** [DONE] `[GREEN][CORE / DATA]` worker: free | Target files: `src/render/palette.ts` [NEW], `src/render/palette.test.ts` [NEW] | Verify: npm test -- src/render/palette.test.ts && npm run typecheck

- [x] **Slice 2.1: Typed GL helpers + ping-pong framebuffers + trail test** [DONE] (browser: fading trail, forced GPU loss ok) `[RED][UI / VISUAL]` worker: lead | Target files: `src/gl/fbo.ts` [NEW], `src/gl/vao.ts` [NEW], `src/render/layers/trailTest.ts` [NEW] | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 2.2: Scene, Compositor and safety pass** [DONE] (browser: crossfade ok; max-blend fix) `[RED][UI / VISUAL]` worker: lead | Target files: `src/render/scene.ts` [NEW], `src/render/compositor.ts` [NEW], `src/render/shaders/composite.frag.glsl` [NEW], `src/gl/context.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 2.3: Sub-bass resolution (FFT 8192 chosen, measured)** [DONE] `[YELLOW][CORE / DATA]` worker: lead | Target files: `src/audio/engine.ts`, `src/audio/frameBuilder.ts` | Verify: npm test
- [x] **Slice 2.4: Forward-flight tunnel** [DONE] (browser: rings render, no GL errors; beat flash added) `[YELLOW][UI / VISUAL]` worker: cheap | Target files: `src/render/layers/tunnel.ts` [NEW], `src/render/shaders/tunnel.frag.glsl` [NEW] | Verify: npm run typecheck && npm run build
- [x] **Slice 2.5: Treble particles (instanced quads)** [DONE] (browser: streaming dots; twinkle added; ?particles) `[YELLOW][UI / VISUAL]` worker: cheap | Target files: `src/render/layers/particles.ts` [NEW], `src/render/shaders/particles.vert.glsl` [NEW], `src/render/shaders/particles.frag.glsl` [NEW] | Verify: npm run typecheck && npm run build
- [~] **Slice 2.6: Bars, waveform and rings** [PARTIAL] (rings verified in browser; bars built but not yet verified on screen; waveform move and basic scene not done) `[GREEN][UI / VISUAL]` worker: cheap | Target files: `src/render/layers/bars.ts` [NEW], `src/render/layers/rings.ts` [NEW] | Verify: npm run typecheck && npm run build

## Stage 2 polish — docs/stage2-polish-plan.md (2026-11-04)
- [x] P1 black floor and contrast · [x] P6 flash governor · [x] P2 particle streaks · [x] P3 tunnel depth/bend/roll · [x] P4 shockwave, section contrast, colour swap · [x] P5 radial crown and keys · Patch: shared sway, governor scope, quiet floor (done). Owner visual check done 2026-11-05; deployed.

## Stage 2.5 — Quiet-passage fixes (docs/stage2.5-plan.md, 2026-11-04)
- [~] Reproduce blackout: code trace done (no audio gate, no zero-brightness path found); live per-frame repro not captured with the video. Fix shipped as a floor, not a root-cause fix.
- [x] C1 quiet-aware floor: gaps between rings keep 12% tint when quiet (uQuiet, shared 320 ms release); crest floor kept.
- [x] C2 320 ms release: particle highFlash, brightness limiter fall, tunnel beat flash, scene-switch fade (compositor eases weights).
- [x] C3 particles spawn at crown radius 0.16 and flow outward on the tunnel depth curve (P5 bar-tip launch removed).
- [x] Browser check: quiet section (silence) shows dimmed tunnel, not black. Scene fade and particle flow not yet checked on screen.
- Deployed 2026-11-04: https://music-visualizer.charliechonguyen.com · branch stage-2.5-quiet-passage pushed.

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

## Parked after Stage 4 (2026-11-05)
See `docs/stage4-parked.md`: safety check for random and linked presets, layer opacity and blend, filled rings fix, E4 invert/solarize/echo, V2 and V5 variants, T4 second window, cleanup.

## Stage 3 remaining and effects (scope: docs/stage3-effects-scope.md, 2026-11-05)
Order set by the owner: morphs, frame stepping, sound responsiveness, then Stage 3 gaps. One slice at a time.
- [x] **Slice 4.9: Morph a number setting between two values (E-c)** [DONE] (typecheck, 308 tests, build) `[GREEN][CORE / DATA]` worker: lead (Haiku) | Target files: `src/presets/format.ts`, `src/presets/loader.ts`, `src/presets/links.ts`, `src/presets/morph.ts` [NEW], `src/presets/morph.test.ts` [NEW], `src/presets/links.test.ts` | Verify: npm run typecheck && npx vitest run && npm run build
- [ ] **Slice 4.10: Freeze picture and step one frame (E-e, S3-a)** [IN_PROGRESS] `[YELLOW][CORE / DATA]` worker: lead | Target files: `src/render/frameStep.ts` [NEW], `src/render/frameStep.test.ts` [NEW], `src/gl/context.ts`, `src/main.ts` | Verify: npm run typecheck && npx vitest run && npm run build
- [ ] **Slice 4.11: More audio sources for links (E-f)** `[GREEN][CORE / DATA]` worker: lead | Target files: `src/presets/format.ts`, `src/presets/links.ts`, `src/presets/links.test.ts` | Verify: npm run typecheck && npx vitest run && npm run build
- [ ] **Slice S3-c: Frame-time budget (16.7 ms at 60 fps)** `[GREEN][CORE / DATA]` worker: lead | Target files: `src/render/frameBudget.ts` [NEW], `src/render/frameBudget.test.ts` [NEW], `src/main.ts`, `src/ui/debugPanel.ts` | Verify: npm run typecheck && npx vitest run && npm run build
- [ ] **Slice S3-d/e: GPU-loss and hidden-tab state tests** `[YELLOW][CORE / DATA]` worker: lead | Target files: `src/gl/lossState.ts` [NEW], `src/gl/lossState.test.ts` [NEW], `src/gl/context.ts` | Verify: npm run typecheck && npx vitest run && npm run build
- [ ] **Slice S3-f: Accessibility audit (static, then notes)** `[GREEN][UI / VISUAL]` worker: lead | Target files: `docs/stage3-accessibility-audit.md` [NEW] | Verify: npm run typecheck && npm run build
