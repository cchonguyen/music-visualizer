# Task Progress & Single-Slice Work Lock

> Rule: Mark only ONE task line at a time with `[IN_PROGRESS]`.
> Stage 1 detail (contracts, tests, worker tier, waves): `docs/stage1-slices.md`. Nothing started yet.

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
- [ ] **Slice 1.10: Debug panel and latency** [PENDING] `[YELLOW][UI / VISUAL]` worker: cheap, needs 1.6 and 1.7 | Target files: `src/ui/debugPanel.ts` [NEW], `src/audio/latency.ts` [NEW], `src/audio/latency.test.ts` [NEW] | Verify: npm test -- src/audio/latency.test.ts && npm run typecheck
- [x] **Slice 1.11: App shell and controls** [DONE] (test signals verified in browser; file/capture/mic in 1.13) `[RED][UI / VISUAL]` worker: lead | Target files: `index.html`, `src/main.ts`, `src/ui/controls.ts` [NEW], `src/ui/notices.ts` [NEW], `src/style.css` [NEW] | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 1.12: Deploy to Cloudflare** [PENDING] `[YELLOW][CORE / DATA]` worker: lead + owner login | Target files: `wrangler.jsonc` [NEW], `package.json` | Verify: npx wrangler deploy
- [ ] **Slice 1.13: Device test report** [PENDING] `[GREEN][UI / VISUAL]` worker: owner | Target files: `docs/stage1-test-report.md` [NEW] | Verify: owner sign-off
