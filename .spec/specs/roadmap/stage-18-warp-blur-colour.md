# Stage 18: Warp field, blur chain and colour

Goal: three shared effect systems that every preset can use. They cover the warp-field, stretch, tiling, vignette, colour-mapping and bloom ideas in `docs/ideas.md`.

Read `README.md` in this folder first. Needs Stage 16 merged (half-float buffers, merged final pass, program cache).

## Why
- The feedback warp is one global transform plus five special modes. MilkDrop's look comes from warp that varies across the screen.
- Curl mode computes 16 to 24 noise evaluations per pixel. A small field texture gives the same look for far less.
- Bloom is two half-resolution passes with one threshold. Shape "glow" is only a brightness multiplier.
- There is no colour map. Hue is controlled in four places.

## Design
- **Warp field:** a small texture (start at 64 × 36, two channels of displacement) rendered once per frame from a stack of operators. The feedback pass adds one lookup. Each operator has amount, scale, speed, centre X and Y, and can be a target for audio links and Stage 17 reactions.
- **Operators, first batch:** Radial (in at centre and out at edge, or reversed), Swirl, Ripple, Stripes, Stretch and squish, Tile and mirror. **Second batch:** Tunnel perspective, Sphere bulge, plus curl, polar fold and Mobius moved in from the old modes.
- **Blur chain:** half, quarter and eighth size blurred copies of the frame, built only when something samples them.
- **Colour map:** a gradient texture indexed by brightness, by distance from centre, or by angle. Two gradients can morph over time or on a trigger.
- **Vignette:** shape (round, oval, box), colour or gradient, blend (darken, tint, add, hue shift), softness.

## Slices

- [ ] **Slice 18.1: Warp operator schema and preset format, with a stack of up to 4 operators** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/warpOps.ts` [NEW], `src/presets/warpOps.test.ts` [NEW], `src/presets/format.ts`, `src/presets/format.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 18.2: Warp field pass with Radial, Swirl, Ripple and Stripes, read by the feedback shader** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/warpField.ts` [NEW], `src/render/shaders/warpField.frag.glsl` [NEW], `src/render/shaders/feedback.frag.glsl`, `src/render/scene.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 18.3: Stretch and squish, Tile and mirror, Tunnel perspective and Sphere bulge operators** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/shaders/warpField.frag.glsl`, `src/presets/warpOps.ts`, `src/presets/warpOps.test.ts`, `src/render/__tests__/feedbackWarp.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 18.4: Studio editor for the warp operator stack** 🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/studio/studio.ts`, `src/studio/studio.test.ts`, `src/style.css` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 18.5: Curl moved into the warp field as an operator, with preset migration** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/shaders/warpField.frag.glsl`, `src/render/shaders/feedback.frag.glsl`, `src/presets/format.ts`, `src/presets/format.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 18.6: Blur chain built on demand** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/blurChain.ts` [NEW], `src/render/blurChain.test.ts` [NEW], `src/render/shaders/blur.frag.glsl`, `src/render/compositor.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 18.7: Bloom rebuilt on the blur chain with wide, tight, tinted and beat-pulsed options** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/compositor.ts`, `src/render/shaders/post.frag.glsl`, `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 18.8: Colour map stage with gradient morphs** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/colourMap.ts` [NEW], `src/render/colourMap.test.ts` [NEW], `src/render/shaders/post.frag.glsl`, `src/presets/layerSchemas.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 18.9: Vignette shapes, colours and blend types** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/shaders/post.frag.glsl`, `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts`, `src/presets/format.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 18.10: Four showcase presets using warp field, bloom and colour map** 🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/builtin/index.ts`, `src/presets/builtin/21-inhale-exhale.json` [NEW], `src/presets/builtin/22-ripple-pool.json` [NEW], `src/presets/builtin/23-gradient-storm.json` [NEW] | Verify: npm run typecheck && npm test && npm run build && npm run lint

## Slice notes
- **18.2** The field is displacement added to the existing global transform, so old presets look the same with an empty stack. Field resolution scales with the quality tier.
- **18.5** Curl presets must look close to before; compare by eye and say so in the PR. Polar fold and Mobius can move in a follow-up slice once curl is proven; the old modes keep working until then.
- **18.6** Use `invalidateFramebuffer` on intermediate targets. Skip levels nothing samples.
- **18.7** Fixes the old bloom's separate threshold dependency by showing threshold only when bloom is on (Stage 15 rule).
- **18.8** Gradients are 256 × 1 textures. Ship about 12 built-in gradients and allow custom ones through the existing custom palette storage. The one Colour group from Stage 15 becomes the home for this.
- **18.10** The fourth preset reuses an existing slot if the builtin index needs fewer new files; keep to 4 target files.

## Done when
- A preset with Radial set to "in at centre, out at edge" visibly pulls the middle in while pushing the edges out.
- Benchmark shows curl presets cheaper than before Stage 18 on the laptop tier.
- Old presets with an empty operator stack render as before.

## Out of scope
Fluid and fractal operators (Stage 20).
