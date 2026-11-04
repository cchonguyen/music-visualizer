# Stage 2 Slice Specs: Visuals on WebGL2

Companion to `.spec/SYSTEM_SPEC.md` §7 and `.spec/PROGRESS.md`. Written 2026-11-04 after Stage 1 sign-off. Not started.

Contracts in force: `src/audio/types.ts` (AudioFrame, read-only, reused each frame) and `src/render/layer.ts` (`draw(frame, clock, target)`, no alpha). Motion uses `Phase` from `src/render/clock.ts`, never `time × speed`.

**Order (Council round 2):** trail buffers → scene and compositor with the safety pass → sub-bass fix → tunnel → particles → bars, waveform, rings. Each slice must pass its browser check before the next starts.

**Worker tiers:** lead (Opus) for GL state, framebuffers and the compositor. Haiku or a free model only for visuals once the contracts exist. Parallel work only for free or cheap workers in separate worktrees.

---

## 2.1 Typed GL helpers, ping-pong framebuffers, trail test `[lead]`

**Goal:** a two-texture feedback buffer that a layer can draw into while reading the previous frame.
**Target files:** `src/gl/fbo.ts` [NEW], `src/gl/vao.ts` [NEW], `src/render/layers/trailTest.ts` [NEW], test: `src/gl/fbo.test.ts` [NEW]
**Contract:**
- `class PingPong { constructor(gl, width, height); read: RenderTarget-like {framebuffer, texture}; write: same; swap(); resize(w, h): void; dispose() }`. Textures are RGBA8, LINEAR, CLAMP_TO_EDGE. Reallocate on `resize`, never reuse across a context loss (rebuilt in `init`).
- Rule: never sample a texture while it is the write target. `swap()` after each draw.
- `createVao(gl): WebGLVertexArrayObject` for the empty full-screen VAO.
**Trail test layer:** each frame, draws the previous image at 0.98 brightness plus a white dot at the bass level. Purpose: prove the feedback loop, the resize path and the context-loss rebuild. Not a shipped visual.
**Pure tests:** swap alternates read and write; resize with the same size is a no-op; zero size clamps to 1×1.
**Browser check:** the dot leaves a fading trail; resizing the window keeps the trail; forced context loss restarts the trail cleanly (`WEBGL_lose_context`).
**Verify:** `npm run typecheck && npm test && npm run build` plus browser check.

## 2.2 Scene, Compositor and safety pass `[lead]`

**Goal:** scenes render into their own targets; one final pass blends and enforces photosensitivity limits.
**Target files:** `src/render/scene.ts` [NEW], `src/render/compositor.ts` [NEW], `src/render/shaders/composite.frag.glsl` [NEW], `src/gl/context.ts` (use Compositor), test: `src/render/compositor.test.ts` [NEW]
**Contracts:**
- `interface Scene { name: string; layers: RenderLayer[]; init(gl); resize(w, h, dpr); draw(frame, clock, target); dispose() }`. A scene owns its own `PingPong` (feedback history).
- `class Compositor { addScene; setWeights(map: name→0..1); render(frame, clock) }`. Each active scene draws at full strength into its own target. The final pass blends by weight (linear over the two weights during a crossfade), then applies the safety pass, then writes to the canvas.
- Safety pass (in the composite shader): (a) luminance may rise by at most 10% of full scale per 333 ms window (rate limit held in JS and passed as a uniform); (b) saturated red is clamped where R/(R+G+B) ≥ 0.8, reducing R toward the mean of G and B; (c) no effect on dim frames (below 0.1 luminance) beyond clamping.
- On crossfade end, release the outgoing scene's targets.
**Pure tests:** weights sum correctly during a fade; outgoing scene disposed after the fade; rate limiter caps an instant full-white jump; the red clamp leaves neutral greys unchanged.
**Browser check:** a test scene crossfades to a second test scene over 5 s with no frame drops and no stacked trails; a full-white test scene is visibly rate-limited.
**Verify:** `npm run typecheck && npm test && npm run build` plus browser check.

## 2.3 Sub-bass resolution, measured `[lead]`

**Goal:** settle the 8-bin sub-bass problem with a measurement, not an opinion.
**Options:** (A) FFT 8192 (bins 5.9 Hz, slower reaction); (B) a second analyser fed by a low-pass BiquadFilter at 120 Hz with its own small FFT or time-domain envelope.
**Target files:** `src/audio/engine.ts`, `src/audio/frameBuilder.ts`, `src/audio/subband.ts` [NEW] (only if B wins)
**Method:** feed test kicks at 45 Hz and 95 Hz (808-style and bass guitar analogue) and measure beat count and latency for A and B in the browser. Pick the option with correct beats on both and the lower latency. Record the numbers in `docs/stage2-slices.md`.
**Pure tests:** the chosen option's band indices or filter cutoff are derived from `sampleRate`.
**Verify:** `npm test && npm run typecheck`, plus the recorded browser numbers.

## 2.4 Forward-flight tunnel `[cheap, after 2.2 merged]`

**Goal:** the owner's top preference: flying through a tunnel, driven by music.
**Target files:** `src/render/layers/tunnel.ts` [NEW], `src/render/shaders/tunnel.frag.glsl` [NEW], `src/render/tunnelState.ts` [NEW], test: `src/render/tunnelState.test.ts` [NEW]
**Contract:**
- Motion: `flightPhase = Phase` advanced by `clock.dtSec × (base + boost × frame.energy)`. Never `time × speed`.
- Shader: full-screen triangle, polar UV (angle, depth = 1/radius), ring stripes at depth using `flightPhase`, sub band drives a slow radial brightness pulse (uses `env.sub`, dim floor kept).
- Stripe limit: no more than about 5 alternating light-dark rings in the central view; stripe contrast is a uniform so Calm mode can soften it.
- Calm mode: `base` is a gentle drift and `boost` is zero; no beat-triggered kicks.
**Pure tests:** `tunnelState` phase never decreases while energy swings 0.08↔1.0; speed clamps to zero or above.
**Browser check:** visibly flying forward; no jump when the music drops; Calm mode slows it.
**Verify:** `npm run typecheck && npm test && npm run build` plus browser check.

## 2.5 Treble particles (instanced quads) `[cheap, after 2.4]`

**Goal:** a "twinkle" layer driven by the high band, kept visually below the pulses.
**Target files:** `src/render/layers/particles.ts` [NEW], `src/render/shaders/particles.vert.glsl` [NEW], `src/render/shaders/particles.frag.glsl` [NEW]
**Contract:** a fixed pool of N particles (for example 600) drawn with `drawArraysInstanced` on a 4-vertex quad. Each particle has a seed. Position and brightness come from `phase` and `frame.env.high`, with `frame.beatByBand.high` giving a brief spawn flash. Soft radial falloff in the fragment shader. Brightness weight stays below the bass pulse.
**Pure tests:** the particle pool is deterministic for a given seed; brightness is 0 when `env.high` is 0.
**Browser check:** sparkles appear on hi-hat-like test input (the test kick has no high band, so use a sweep or a file); dim with a silent input.
**Verify:** `npm run typecheck && npm test && npm run build` plus browser check.

## 2.6 Bars, waveform and rings `[cheap, after 2.5]`

**Goal:** the three basic visuals, moved onto the scene system.
**Target files:** `src/render/layers/bars.ts` [NEW], `src/render/layers/rings.ts` [NEW], `src/render/layers/waveform.ts` (move into a scene), `src/render/scenes/basic.ts` [NEW]
**Contract:** bars read `frame.smoothedSpectrum` (not raw spectrum). Rings use `frame.norm` for size and `frame.energy` for complexity. Waveform stays as in Stage 1.
**Pure tests:** bar count and bin mapping are derived from the sample rate.
**Browser check:** each mode responds to the test signals; mode switch keys 1/2/3 work; no stale trail when switching.
**Verify:** `npm run typecheck && npm test && npm run build` plus browser check.

---

## Open before 2.1 starts
- Owner's three to five reference-visual notes (what to copy from each) would tune 2.4 and 2.5. Not blocking 2.1 to 2.3.
