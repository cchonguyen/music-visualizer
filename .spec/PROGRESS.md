# Task Progress & Single-Slice Work Lock

> Rule: Mark only ONE task line at a time as in progress (the IN_PROGRESS tag).
> Stages 1 through 26 are archived in `.spec/HISTORY.md`.

## Stage 27 — True Wall-Bounce Physics & Bouncing Ribbon Wave Preset (.spec/specs/stage-27-wall-bounce-and-ribbon-preset.md)
- [ ] **Slice 27.1: Add wall-bounce schema controls and persistent ShapeLayer wall-bounce physics** `[CORE / DATA]` worker: gf-coder (Haiku) Target files: `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts`, `src/render/layers/shape.ts`, `src/render/__tests__/shapeLayer.test.ts` | Coords: [400, 410, 485, 497] | Verify: npm run typecheck && npm test && npm run build
- [ ] **Slice 27.2: Add built-in Bouncing Ribbon Wave preset (31-bouncing-ribbon-wave) and taxonomy tests** `[UI / VISUAL]` worker: gf-coder (Haiku) Target files: `src/presets/builtin/31-bouncing-ribbon-wave.json` [NEW], `src/presets/builtin/index.ts`, `src/presets/__tests__/presetTaxonomy.test.ts` | Coords: [400, 410, 496, 497] | Verify: npm run typecheck && npm test && npm run build
