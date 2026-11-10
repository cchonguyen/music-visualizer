# Stage 16: Performance

Goal: smooth on laptops and basic phones. Measure first, then remove structural waste, then add automatic quality control.

Read `README.md` in this folder first. Needs Stage 14 merged. Can run beside Stage 15 only if no slice shares a target file with a Stage 15 slice in progress.

## Why
- `frameBudget.ts` only reports to the debug panel. Nothing scales quality.
- Default presets run blend, post and safety as three full-resolution passes (`compositor.ts` near lines 447 to 466). Render scale applies to scene buffers only.
- Each scene compiles its shaders on init (`scene.ts:240`), scenes are disposed at weight 0, and compile status is read immediately (`gl/shader.ts`).
- All buffers are RGBA8 (`gl/fbo.ts:91`), though the spec says float when available.
- Canvas requests antialiasing (`gl/context.ts:39`) with no benefit.
- Per-frame allocations in `safety.ts`, `frameBudget.ts`, `compositor.ts`, `globalDirector.ts`, `scene.ts`, `main.ts`.
- Curl warp costs 16 to 24 noise evaluations per pixel. That is replaced in Stage 18, not here.

## Slices

- [ ] **Slice 16.1: Benchmark mode that runs each preset and records frame times** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/benchmark.ts` [NEW], `src/render/benchmark.test.ts` [NEW], `src/main.ts`, `src/ui/debugPanel.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 16.2: Shader program cache shared across scenes, with deferred status checks** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/gl/shader.ts`, `src/gl/shader.test.ts`, `src/gl/programCache.ts` [NEW], `src/render/scene.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 16.3: Next preset is compiled in the background before its transition starts** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/compositor.ts`, `src/render/compositor.test.ts`, `src/presets/autoCycler.ts`, `src/gl/programCache.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 16.4: Blend, post and safety merged into one final pass; canvas antialiasing off** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/compositor.ts`, `src/render/shaders/post.frag.glsl`, `src/render/shaders/composite.frag.glsl`, `src/gl/context.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 16.5: Render scale applies to the whole chain with one upscale at the end** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/compositor.ts`, `src/gl/size.ts`, `src/gl/size.test.ts`, `src/render/compositor.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 16.6: Automatic resolution scaling driven by frame time, with device tiers** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/frameBudget.ts`, `src/render/frameBudget.test.ts`, `src/render/qualityGovernor.ts` [NEW], `src/main.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 16.7: Half-float feedback buffers where supported, with an 8-bit fallback** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/gl/fbo.ts`, `src/gl/fbo.test.ts`, `src/render/scene.ts`, `src/render/compositor.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 16.8: Remove per-frame allocations in the render loop** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/scene.ts`, `src/render/compositor.ts`, `src/render/globalDirector.ts`, `src/render/safety.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 16.9: Debug stats and band waveforms computed only on demand** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/main.ts`, `src/render/frameBudget.ts`, `src/audio/frameBuilder.ts`, `src/audio/frameBuilder.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 16.10: Spectral terrain drawn in one instanced call; moire reads the existing snapshot** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/spectralTerrain.ts`, `src/render/shaders/spectralTerrain.vert.glsl`, `src/render/scene.ts`, `src/render/__tests__/generators.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 16.11: Presets tagged Light, Medium or Heavy; lighter crossfade and heavy-preset skipping on low tiers** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/cost.ts` [NEW], `src/presets/cost.test.ts` [NEW], `src/presets/autoCycle.ts`, `src/render/compositor.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint

## Slice notes
- **16.1** Reached by a URL flag. Runs each preset for a few seconds on the built-in test signal, records p50 and p95 frame time and, where `EXT_disjoint_timer_query_webgl2` exists, GPU time. Shows a table and a copy-as-JSON button. After merge, ask Charlie to run it on the four target devices and paste the results; record them in `.spec/specs/roadmap/benchmarks.md`.
- **16.2** Key the cache by shader source. Use `KHR_parallel_shader_compile` when present and poll completion; check compile and link status only when linking fails. Remove the `layer.constructor.name` checks in `scene.ts` while there (they break under minification).
- **16.3** A transition must not start until the incoming programs are ready. Keep the last few scenes alive instead of disposing at weight 0, within a memory cap.
- **16.4** The safety limiter must still be the last thing applied. Keep its tests (`safety.test.ts`, `flashGovernor.test.ts`) passing unchanged.
- **16.6** Step down after about 1 to 2 seconds of long frames, step up after sustained headroom, with hysteresis so it does not oscillate. Starting tier: phone (pixel ratio cap 1 to 1.5), integrated laptop, desktop. The manual Render quality setting becomes a ceiling.
- **16.7** Use `RGBA16F` with `EXT_color_buffer_float` or `EXT_color_buffer_half_float`. Check framebuffer completeness once at creation. On phones use half-float at reduced resolution.
- **16.8** Also remove `getElementById('calm')` per draw (`compositor.ts` near 427) and per-frame `getUniformLocation` in the moire and overlay blits.
- **16.11** Cost is computed from settings: warp mode, sobel, solarize, bloom, layer types. On the phone tier the outgoing scene renders at half resolution during a crossfade.

## Done when
- Benchmark results exist for the four target devices before and after the stage.
- Switching between already-seen presets compiles nothing.
- A default preset runs one full-screen pass after the scene, not three.
- Resolution drops and recovers automatically under load.

## Out of scope
Replacing curl warp (Stage 18). Touch controls and wake lock (Stage 21).
