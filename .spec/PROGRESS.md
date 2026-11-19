# Task Progress & Single-Slice Work Lock

> Rule: Mark only ONE task line at a time as in progress (the IN_PROGRESS tag).
> Stages 1 through 27 are archived in `.spec/HISTORY.md`.

## Stage 28 — Organic Twisting Center Waveform & Preset (.spec/specs/stage-28-twist-wave-ribbon.md)
- [x] **Slice 28.1: Add organic twisting center waveform baseShape (twistWave) with 3D quadrature oscilloscope displacement** `[CORE / DATA]` worker: gf-coder (Haiku) Target files: `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts`, `src/render/layers/shape.ts`, `src/render/shaders/shape.vert.glsl`, `src/render/__tests__/shapeLayer.test.ts` | Coords: [400, 410, 485, 498] | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 28.2: Add built-in Twisting Scope Wave preset (32-twisting-scope-wave) and taxonomy tests** [IN_PROGRESS] `[UI / VISUAL]` worker: gf-coder (Haiku) Target files: `src/presets/builtin/32-twisting-scope-wave.json` [NEW], `src/presets/builtin/index.ts`, `src/presets/__tests__/presetTaxonomy.test.ts` | Coords: [400, 410, 486, 498] | Verify: npm run typecheck && npm test && npm run build
