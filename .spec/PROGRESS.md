# Task Progress & Single-Slice Work Lock

> Rule: Mark only ONE task line at a time as in progress (the IN_PROGRESS tag).
> Stage 1 detail (contracts, tests, worker tier, waves): `docs/stage1-slices.md`.

## Stage 4 — Presets, effects and Preset Studio (archived summary)
Status 2026-11-05: all slices built in code. Full details archived in `.spec/HISTORY.md`.

## projectM-inspired features (plan: /mnt/project-files/plans/projectm-ideas-implementation.md, approved 2026-11-05; contracts: .spec/PROJECTM_SPEC.md)
Slices 5.4 to 5.10 were removed on 2026-11-08 because the work was superseded (owner decision, Charlie).

## Stage 19 — Shapes and particles (.spec/specs/roadmap/stage-19-shapes-particles.md)
- [x] **Slice 19.1: Signed MilkDrop-style waveform effect in Shape, with line, dots and additive blend** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/shape.ts`, `src/render/shaders/shape.vert.glsl`, `src/presets/layerSchemas.ts`, `src/render/__tests__/shapeLayer.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [x] **Slice 19.2: Per-element reactivity: each bar or dot follows its own frequency slice with its own delay** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/shape.ts`, `src/render/shaders/shape.vert.glsl`, `src/presets/layerSchemas.ts`, `src/render/__tests__/shapeLayer.test.ts`, `src/presets/layerSchemas.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 19.3: Shape motion over time: travel along the path, scale wobble, per-copy rotation** [IN_PROGRESS] 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/shape.ts`, `src/render/shaders/shape.vert.glsl`, `src/presets/layerSchemas.ts`, `src/render/__tests__/shapeLayer.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 19.4: Real Shape glow from the blur chain** 🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/render/shaders/shape.frag.glsl`, `src/render/layers/shape.ts`, `src/render/scene.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 19.5: Particle spawn areas, configurable count, and twinkle controls** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/particles.ts`, `src/render/shaders/particles.vert.glsl`, `src/render/particleState.ts`, `src/presets/layerSchemas.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 19.6: Starfield mode with depth, speed from energy, and sparkle bursts on high-frequency hits** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/shaders/particles.vert.glsl`, `src/render/shaders/particles.frag.glsl`, `src/render/layers/particles.ts`, `src/render/particleState.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 19.7: Seeded per-layer randomise for Shape and effect layers** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/variation.ts`, `src/presets/variation.test.ts`, `src/presets/format.ts`, `src/studio/studio.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 19.8: Audit of legacy bars, waveform and rings against Shape** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `.spec/specs/roadmap/legacy-layer-audit.md` [NEW] | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 19.9: Close the gaps the audit found in Shape** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/shape.ts`, `src/render/shaders/shape.vert.glsl`, `src/presets/layerSchemas.ts`, `src/render/__tests__/shapeLayer.test.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 19.10: Fold legacy layers into Shape with preset migration** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/legacyShapeMigration.ts`, `src/presets/loader.ts`, `src/presets/loader.test.ts`, `src/presets/builtin/index.ts` | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 19.11: Starfield and waveform showcase presets** 🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/builtin/index.ts`, `src/presets/builtin/24-deep-field.json` [NEW], `src/presets/builtin/25-scope-bloom.json` [NEW] | Verify: npm run typecheck && npm test && npm run build
