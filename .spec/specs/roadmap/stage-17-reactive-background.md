# Stage 17: Reactive background

Goal: Feedback and Post react to the music by themselves. Zoom, rotation, warp, blur and colour can kick, step, flip or drift on beats, at intervals, and at dynamic moments, so mood changes do not depend on preset changes.

Read `README.md` in this folder first. Needs Stages 14 and 15 merged.

## Why
- Today the director moves the camera on a slow cadence (35 s or more) and there is no on-beat kick for feedback or post.
- Audio links exist (`src/presets/links.ts`): value = base + amount × range × source, with attack, release, curve, invert. They are continuous only. There are no triggers and no held values.
- FFT is 8192 points, good for bass detail and slow for timing. There is no tempo estimate.

## Design
- **Triggers:** beat, strong beat, every N beats, every N seconds, section change, quiet-to-loud jump.
- **Responses:** Kick (jump then ease back), Step (move to a new value and hold), Flip (reverse sign), Drift (slow wander), Pick (random value in a range).
- A reaction = trigger + response + target control + amount + ease time. Stored per preset beside audio links, and evaluated in the same place.
- All randomness is seeded so tests are deterministic.
- The photosensitivity limiter still has the final say. Reactions must not bypass it.

## Slices

- [ ] **Slice 17.1: Short-window beat detector for tighter timing** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/audio/onset.ts`, `src/audio/onset.test.ts`, `src/audio/frameBuilder.ts`, `src/audio/frameBuilder.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 17.2: Tempo tracker with beat count and bar phase** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/audio/tempo.ts` [NEW], `src/audio/tempo.test.ts` [NEW], `src/audio/types.ts`, `src/audio/frameBuilder.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 17.3: Trigger and response engine** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/reactions.ts` [NEW], `src/presets/reactions.test.ts` [NEW], `src/presets/format.ts`, `src/presets/format.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 17.4: Reactions drive Feedback and Post parameters each frame** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/scene.ts`, `src/render/compositor.ts`, `src/presets/links.ts`, `src/presets/links.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 17.5: Reaction style presets (Off, Gentle, Punchy, Wild) selectable per preset and globally** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/reactionStyles.ts` [NEW], `src/presets/reactionStyles.test.ts` [NEW], `src/ui/controls.ts`, `index.html` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 17.6: Studio editor for reactions** 🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/studio/studio.ts`, `src/studio/studio.test.ts`, `src/style.css` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 17.7: Separate Trails, Feedback and Post fades** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/layerSchemas.ts`, `src/render/shaders/feedback.frag.glsl`, `src/render/shaders/post.frag.glsl`, `src/presets/format.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint

## Slice notes
- **17.1** Add a second analyser (1024 or 2048 points) used only for onset timing. Keep the existing beat outputs and their tests. Compare timing on the kick test signal.
- **17.2** Autocorrelation or inter-onset histogram over the last 8 to 12 seconds, 60 to 180 BPM, with a confidence value. When confidence is low, "every N beats" falls back to counting detected beats.
- **17.4** Order of evaluation: base value, audio link, reaction, clamp to schema range. The existing clamp in `links.ts:143` stays.
- **17.5** Gentle: small zoom kick on beats, slow hue drift. Punchy: zoom and rotation kicks, rotation flip every 8 beats. Wild: adds warp steps on section change and colour picks on strong beats. Default for existing presets is Gentle unless Charlie says otherwise; ask before changing how every preset looks by default.
- **17.7** Replaces the overlapping Persistence, Fade and Decay RGB trio with three clearly named fades, with migration.

## Done when
- With a steady kick test signal, zoom visibly kicks on each beat with Punchy selected and does nothing with Off.
- Reaction tests are deterministic under a fixed seed.
- Safety limiter tests pass unchanged.

## Out of scope
New warp operators (Stage 18). Reactions on layer parameters can follow in Stage 19.
