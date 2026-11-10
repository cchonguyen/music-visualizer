# Stage 19: Shapes and particles

Goal: a richer foreground. A true MilkDrop-style waveform, per-element reactivity, a starfield, twinkling particles, seeded randomisation, and the legacy layers folded into Shape after an audit.

Read `README.md` in this folder first. Needs Stages 15 and 18 merged.

## Why
- Shape `waveform` maps the signal to `(wf + 1) / 2`, so silence draws at half height. It is not a signed oscilloscope. `pulsingLine` and `waveform` run the same shader path. `sub` and `bass` sources are the same branch (`shape.ts:286`). `glow` is a brightness multiplier.
- Particles: fixed pool of 600, always spawn at dead centre, twinkle hard-coded (`particles.vert.glsl` near lines 180 to 183), `mode: 'field'` exists in the type and is not wired. `uCrown` and `uFlowSpeed` are uploaded and unused.
- Legacy `bars`, `waveform` and `rings` layers overlap Shape. Charlie's decision: fold them in only after an audit shows Shape gives a similar level of function and reactivity.

## Slices

- [ ] **Slice 19.1: Signed MilkDrop-style waveform effect in Shape, with line, dots and additive blend** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/shape.ts`, `src/render/shaders/shape.vert.glsl`, `src/presets/layerSchemas.ts`, `src/render/__tests__/shapeLayer.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 19.2: Per-element reactivity: each bar or dot follows its own frequency slice with its own delay** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/shape.ts`, `src/render/shaders/shape.vert.glsl`, `src/presets/layerSchemas.ts`, `src/render/__tests__/shapeLayer.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 19.3: Shape motion over time: travel along the path, scale wobble, per-copy rotation** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/shape.ts`, `src/render/shaders/shape.vert.glsl`, `src/presets/layerSchemas.ts`, `src/render/__tests__/shapeLayer.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 19.4: Real Shape glow from the blur chain** 🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/render/shaders/shape.frag.glsl`, `src/render/layers/shape.ts`, `src/render/scene.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 19.5: Particle spawn areas, configurable count, and twinkle controls** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/particles.ts`, `src/render/shaders/particles.vert.glsl`, `src/render/particleState.ts`, `src/presets/layerSchemas.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 19.6: Starfield mode with depth, speed from energy, and sparkle bursts on high-frequency hits** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/shaders/particles.vert.glsl`, `src/render/shaders/particles.frag.glsl`, `src/render/layers/particles.ts`, `src/render/particleState.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 19.7: Seeded per-layer randomise for Shape and effect layers** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/variation.ts`, `src/presets/variation.test.ts`, `src/presets/format.ts`, `src/studio/studio.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 19.8: Audit of legacy bars, waveform and rings against Shape** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `.spec/specs/roadmap/legacy-layer-audit.md` [NEW] | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 19.9: Close the gaps the audit found in Shape** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/layers/shape.ts`, `src/render/shaders/shape.vert.glsl`, `src/presets/layerSchemas.ts`, `src/render/__tests__/shapeLayer.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 19.10: Fold legacy layers into Shape with preset migration** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/legacyShapeMigration.ts`, `src/presets/loader.ts`, `src/presets/loader.test.ts`, `src/presets/builtin/index.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 19.11: Starfield and waveform showcase presets** 🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/builtin/index.ts`, `src/presets/builtin/24-deep-field.json` [NEW], `src/presets/builtin/25-scope-bloom.json` [NEW] | Verify: npm run typecheck && npm test && npm run build && npm run lint

## Slice notes
- **19.1** Variants to cover: centred line, circle, double line, spectrum line, radial burst. Merge `pulsingLine` into one path and keep the old key loading. Split `sub` and `bass` or remove one.
- **19.5** Spawn areas: centre, ring, full screen, edges. Count becomes a parameter up to a few thousand, limited by quality tier; remove the hard-coded `600.0` in the vertex shader. Remove the unused `uCrown` and `uFlowSpeed`. Wire or delete `mode: 'field'`.
- **19.6** Random screen position, depth from far to near, perspective divide; size, brightness and streak length scale with nearness. This covers the "tinkling" idea together with the twinkle controls in 19.5.
- **19.8** The audit lists every option and audio response of bars, waveform and rings (including waveform's star7 and 3D lissajous modes and the rings 6-loop look), and marks each as covered, close enough, or missing in Shape. Post it to Charlie and wait for his go-ahead before 19.9 and 19.10. This is his stated condition.
- **19.10** Migrate presets on load. Keep the legacy layer code until Charlie has compared before and after on the live site, then remove it in a later slice.

## Done when
- Silence draws a flat waveform line.
- A starfield preset shows stars across the whole screen moving toward the viewer.
- The audit is accepted by Charlie before any legacy layer is removed.

## Out of scope
New generator layers (Stage 20).
