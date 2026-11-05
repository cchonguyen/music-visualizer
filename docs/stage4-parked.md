# Stage 4: parked work (for later pickup)

**Status:** parked 2026-11-05. Stage 4 is built and deployed (commit `9a75891`). These items are not started. Pick them up in the order below unless the owner says otherwise.

Full plan: `docs/stage4-presets-plan.md`. Slice status: `.spec/PROGRESS.md`.

## 1. Fix first

- [ ] **Safety check for random and linked presets.** Randomise, mutate and audio links can create strobes. Add tests that random and linked presets stay inside the brightness cap, the red-saturation rule and the flash governor (max 3 per second). Check: `src/render/safety.ts`, `src/presets/variation.ts`, `src/presets/links.ts`.
- [ ] **Layer opacity and blend are not drawn.** Presets store them and the Studio shows them, but nothing uses them. Add per-layer alpha and blend modes in `src/render/scene.ts` (currently a fixed MAX blend per layer).
- [ ] **Filled rings wash out the screen.** The `filled` style in `src/render/shaders/rings.frag.glsl` fills the whole inside area and builds up in the trails. Either fix the fill (for example, fill only between rings) or remove the style. The Circle wave starter currently uses outline rings as a workaround.

## 2. Planned features not built

- [ ] **E4 post effects:** invert, solarize, echo. Add to `src/render/shaders/post.frag.glsl` and `src/presets/layerSchemas.ts` (`POST_SPECS`).
- [ ] **V2 particle variants:** outflow modes (vortex is partly done via `swirlGain`), and shapes (star, streak, ring). Files: `src/render/shaders/particles.*.glsl`, `src/render/layers/particles.ts`.
- [ ] **V5 waveform modes:** XY scope, mirrored, dots. File: `src/render/layers/waveform.ts`, `waveform.vert.glsl`.
- [ ] **T4 Studio in a second window** (optional in the plan). Uses `BroadcastChannel` between windows. Files: `src/studio/studio.ts`.

## 3. Decisions and checks for the owner

- [ ] **Visual sign-off** on every 🖐 item in `.spec/PROGRESS.md`. Crown must match the old look side by side (slices 4.2 and 4.4).
- [ ] **Starter presets** (`src/presets/builtin/starter-*.json`, tagged `draft`): tune and approve, or replace.
- [ ] **Definition of "bass" for audio links:** currently the sub-band envelope (`frame.env.sub`). Confirm, or pick another source.
- [ ] **LFO rates** (`lfoSine`, `lfoSaw`, `lfoRandom`) are fixed at 0.5 Hz and 2 Hz steps. Decide whether they should be settings.

## 4. Cleanup

- [ ] Remove the unused `POST_IDENTITY` export and any leftover helpers (search `src/` for unused exports).
- [ ] Add a Studio test for undo across layer add, remove and reorder.
- [ ] Replace the per-frame `console.warn` for skipped saved presets with an on-screen notice.

## Notes for whoever picks this up

- The dev server runs at http://localhost:5173 (`npm run dev` in the repo).
- Deploy: `npm run deploy` (check `npx wrangler whoami` first). Live: https://music-visualizer.charliechonguyen.com
- Every change: `npm run typecheck && npm test && npm run build`, then a browser check with keys 0–9 and `[ ]`.
