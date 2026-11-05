# Task Progress & Single-Slice Work Lock

> Rule: Mark only ONE task line at a time with `[IN_PROGRESS]`.
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
- [x] P1 black floor and contrast · [x] P6 flash governor · [x] P2 particle streaks · [x] P3 tunnel depth/bend/roll · [x] P4 shockwave, section contrast, colour swap · [ ] P5 radial crown and keys (in progress) · Patch: shared sway, governor scope, quiet floor (done). Device check and deploy pending.

## Stage 2.5 — Quiet-passage fixes (docs/stage2.5-plan.md, 2026-11-04)
- [ ] Reproduce blackout from video_1.mov · [ ] C1 dim floor >= 0.12 alpha, no layer cut-outs · [ ] C2 250–400 ms release envelopes on all opacities and master brightness · [ ] C3 particles and waveforms start at crown tips (r 0.16)
