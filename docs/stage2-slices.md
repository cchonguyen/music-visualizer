# Stage 2 Slice Specs: Visuals on WebGL2

Companion to `.spec/SYSTEM_SPEC.md` §7 and `.spec/PROGRESS.md`. Written 2026-11-04 after Stage 1 sign-off. Revised 2026-11-04 after architect review (7 contract fixes). Not started.

Contracts in force: `src/audio/types.ts` (AudioFrame, read-only, reused each frame) and `src/render/layer.ts` (`draw(frame, clock, target)`, no alpha). Motion uses `Phase` from `src/render/clock.ts`, never `time × speed`.

**Ownership rule (architect fix 1):** a `RenderLayer` draws onto whatever target it is given. It never receives or owns feedback history. The `Scene` owns the feedback loop (`PingPong`) and the decay pass. Before `Scene` exists (slice 2.1), the trail test owns its own `PingPong` internally.

**Order:** trail buffers → scene and compositor with the safety pass → sub-bass fix → tunnel → particles → bars, waveform, rings. Each slice passes its browser check before the next starts.

**Worker tiers:** lead (Opus) for GL state, framebuffers, the compositor and the safety pass. Haiku or a free model only for visuals once the contracts exist. Parallel work only for free or cheap workers in separate worktrees.

---

## 2.1 Typed GL helpers, ping-pong framebuffers, trail test `[lead]`

**Goal:** a two-texture feedback buffer that can be drawn into while the previous frame is read.
**Target files:** `src/gl/fbo.ts` [NEW], `src/gl/vao.ts` [NEW], `src/render/layers/trailTest.ts` [NEW], test: `src/gl/fbo.test.ts` [NEW]

**Contract:**
- `class PingPong { constructor(gl, width, height); readonly read: { framebuffer, texture }; readonly write: { framebuffer, texture }; swap(): void; resize(w, h): void; dispose(): void }`. Textures are RGBA8, LINEAR, CLAMP_TO_EDGE.
- `resize(w, h)` is a no-op when `w` and `h` equal the current size. Otherwise it reallocates both textures. Reallocation clears the contents, so the trail resets on resize. That is accepted, not a bug (architect fix 2).
- Never sample a texture while it is the write target. `swap()` runs once per frame, after the draw.
- PingPong is rebuilt inside `init(gl)` after a context restore. Never reuse GL objects across a loss.
- `createVao(gl): WebGLVertexArrayObject` for the empty full-screen-triangle VAO.

**Trail test layer:** `trailTest` owns its own `PingPong`. Each frame it: (1) binds `write`; (2) draws `read.texture` through a decay shader at 0.97 brightness, so old frames fade; (3) draws a white dot at the bass level on top; (4) calls `swap()`. Its output is the `read` texture, shown to the screen with a copy pass. Purpose: prove the feedback loop, resize and context-loss rebuild. Not a shipped visual.

**Pure tests:** swap alternates read and write; `resize` with the same size is a no-op; zero or negative size clamps to 1×1.

**Browser check:** a dot leaves a fading trail. Resizing the window reallocates buffers cleanly, with no stretching, artifacts or WebGL errors; the trail resets. Forced context loss (`WEBGL_lose_context`) restarts the trail cleanly.

**Verify:** `npm run typecheck && npm test && npm run build`, plus the browser check.

---

## 2.2 Scene, Compositor and safety pass `[lead]`

**Goal:** scenes build their own feedback history and output; one final pass blends them and enforces photosensitivity limits.
**Target files:** `src/render/scene.ts` [NEW], `src/render/compositor.ts` [NEW], `src/render/shaders/decay.frag.glsl` [NEW], `src/render/shaders/composite.frag.glsl` [NEW], `src/gl/context.ts` (use Compositor), test: `src/render/compositor.test.ts` [NEW], `src/render/safety.ts` [NEW] (pure luminance limiter), `src/render/safety.test.ts` [NEW]

**Scene contract (architect fix 1):**
- `interface Scene { name: string; layers: RenderLayer[]; init(gl); resize(w, h, dpr); draw(frame, clock); outputTexture(): WebGLTexture; dispose() }`. A Scene owns one `PingPong`.
- Each frame, `Scene.draw` does, in order:
  1. Bind `pingPong.write` as the target.
  2. Draw `pingPong.read.texture` through the scene's decay shader at 0.96–0.98 persistence (the feedback warp/decay pass).
  3. Run `scene.layers[i].draw(frame, clock, pingPong.write)` for each layer, in order, with blending enabled for that draw only.
  4. Call `pingPong.swap()`.
- After step 4 the finished image is `pingPong.read.texture`, which is what `outputTexture()` returns.

**Compositor contract (architect fix 4):**
- `class Compositor { addScene(scene); setWeights(map: name → 0..1); render(frame, clock) }`.
- The Compositor creates **no extra framebuffers**. It calls `scene.draw` for each active scene, then binds each scene's `outputTexture()` to texture units 0 and 1 and draws once to the canvas with `composite.frag.glsl`.
- Crossfade: the final pass mixes the two textures by their weights. Crossfades never fade individual layers, because that muddies trails.
- When a fade ends, the outgoing scene is disposed, which releases its `PingPong`.

**Safety pass (architect fix 3). JS cannot read the luminance of a procedural shader's output without a GPU stall, so the limit is an estimate:**
- `safety.ts` keeps `estimatedLuminance` in JS. Each frame it moves toward the target brightness, taken from `frame.loudness` and `frame.env.sub` with a dim floor. It rises by at most `0.30 × dtSec` (that is, +0.10 per 333 ms) and falls with τ = 0.5 s. The falling rule lets quiet breakdowns pull the cap back down, so it can't stick at 1.0.
- The result is passed to the shader as `u_luminanceCap`.
- In `composite.frag.glsl`: `L = dot(rgb, vec3(0.2126, 0.7152, 0.0722))`. If `L > u_luminanceCap`, then `rgb *= u_luminanceCap / max(L, 0.0001)`.
- Saturated red: where `R / (R + G + B) ≥ 0.8`, reduce R toward the mean of G and B. Neutral greys are unchanged.
- The estimate is not a measurement. A test-only check may read pixels with `readPixels` in a dev build, to confirm the shader really caps brightness. That check never ships.

**Pure tests:** weights sum correctly during a fade; the outgoing scene is disposed after the fade; the limiter caps a jump from 0 to 1 at the slew rate; the limiter falls back down within about 2 s of a quiet passage; neutral grey is unchanged by the red clamp.

**Browser check:** a test scene crossfades to a second test scene over 5 s with no frame drops and no stacked trails. A full-white test scene is visibly rate-limited.

**Verify:** `npm run typecheck && npm test && npm run build`, plus the browser check.

---

## 2.3 Sub-bass resolution, measured `[lead]`

**Goal:** settle the sub-bass resolution problem with a measurement, not an opinion.
**Options:** (A) FFT 8192 (bins about 5.9 Hz, slower reaction); (B) a second analyser fed by a low-pass BiquadFilter at 120 Hz, with its own small FFT or a time-domain envelope.
**Target files:** `src/audio/engine.ts`, `src/audio/frameBuilder.ts`, `src/audio/subband.ts` [NEW] (only if B wins)

**Benchmark signal (architect fix 5). Masking, not isolated hits:**
- A sustained 95 Hz bass note at −12 dBFS, playing continuously.
- 45 Hz kicks on the beat, at −6 dBFS, every 500 ms.
- Pass criteria for the winning option: every 45 Hz kick is detected (no false negatives), the 95 Hz note does not create false kick beats, and detection latency is 25 ms or less.
- Record the beat count, false-negative count and latency for A and B in this file.

**Pure tests:** the chosen option's band indices or filter cutoff are derived from `sampleRate`.

**Verify:** `npm test && npm run typecheck`, plus the recorded browser numbers.

---

## 2.4 Forward-flight tunnel `[cheap, after 2.2 merged]`

**Goal:** the owner's top preference: flying through a tunnel, driven by the music.
**Target files:** `src/render/layers/tunnel.ts` [NEW], `src/render/shaders/tunnel.frag.glsl` [NEW], `src/render/tunnelState.ts` [NEW], test: `src/render/tunnelState.test.ts` [NEW]

**Contract:**
- Motion: `flightPhase` is a `Phase`, advanced by `clock.dtSec × (base + boost × frame.energy)`. Never `time × speed`. Keep the `boost` small: owner references show steady flight with no camera shake (see `docs/reference-visuals.md`).
- Beat acts on rings: `frame.beatByBand.sub` thickens and brightens ring strokes for a short release. The camera never jolts on a beat.
- Shader: full-screen triangle, polar coordinates (angle, `radius`). `depth = 1 / max(radius, 0.15)`, so depth is capped near the centre.
- **Centre mask (architect fix 6):** `mask = smoothstep(0.02, 0.18, radius)`. The tunnel centre blends into the dim floor colour, so rings never bunch into a high-frequency strobe at the vanishing point.
- Ring stripes at `depth` offset by `flightPhase`. Sub band (`env.sub`) drives a slow radial brightness pulse, and the dim floor is kept.
- Stripe limit: no more than about 5 alternating light-dark rings in the central view. Stripe contrast is a uniform, so Calm mode can soften it.
- Calm mode: `base` is a gentle drift, `boost` is zero, and beat-triggered kicks are off.
- Palette: a uniform set from the palette option (default cyan, magenta, ultraviolet on near-black; see `docs/reference-visuals.md`).

**Pure tests:** `tunnelState` phase never decreases while energy swings 0.08↔1.0; speed clamps to zero or above; the centre mask is 0 at radius 0 and 1 beyond 0.18.

**Browser check:** visibly flying forward; no jump when the music drops; Calm mode slows it; no moiré at the centre.

**Verify:** `npm run typecheck && npm test && npm run build`, plus the browser check.

---

## 2.5 Treble particles (instanced quads) `[cheap, after 2.4]`

**Goal:** a sparkle layer driven by the high band, kept visually below the pulses.
**Target files:** `src/render/layers/particles.ts` [NEW], `src/render/shaders/particles.vert.glsl` [NEW], `src/render/shaders/particles.frag.glsl` [NEW]

**Contract:**
- A fixed pool of N particles (for example 600), drawn with `drawArraysInstanced` on a 4-vertex quad. Each particle has a seed.
- **Do not multiply brightness by `frame.beatByBand.high` directly.** That flag is true for one frame (16 ms) and would flicker. Use a CPU envelope instead: `highFlashEnv`, attack 0 ms, release 150 ms, triggered by the flag.
- **Motion:** particles stream **outward from the vanishing point** (as in the Neon Particle Tunnel reference), not in random drift.
- **Density:** sparse in quiet sections, rising only with `energy`.
- Twinkle: each particle's brightness is `smoothstep` applied to `fract(phase + seed)`, scaled by `frame.env.high`. This staggers the twinkles continuously, so they don't pulse all at once.
- Soft radial falloff in the fragment shader. Brightness weight stays below the bass pulse.

**Pure tests:** the particle pool is deterministic for a given seed; brightness is 0 when `env.high` is 0; `highFlashEnv` rises at once and falls to near 0 within 150 ms.

**Browser check:** sparkles on high-frequency input (a sweep or a file; the test kick has no high band); dim with silent input.

**Verify:** `npm run typecheck && npm test && npm run build`, plus the browser check.

---

## 2.6 Bars, waveform and rings `[cheap, after 2.5]`

**Goal:** the three basic visuals, moved onto the scene system.
**Target files:** `src/render/layers/bars.ts` [NEW], `src/render/layers/rings.ts` [NEW], `src/render/layers/waveform.ts` (moved into a scene), `src/render/scenes/basic.ts` [NEW], `src/render/logScale.ts` [NEW], test: `src/render/logScale.test.ts` [NEW]

**Contract:**
- **Logarithmic frequency mapping (architect fix 7):** bars cover **40 Hz to 12 kHz** on a log scale. Each bar's frequency edges are `40 × (12000 / 40)^(i / N)`, mapped to FFT bins with `binForFrequency`. Linear bin mapping is not allowed: it packs all bass and mid activity into the first few bars.
- Bars read `frame.smoothedSpectrum`, not the raw spectrum. Each bar's value is the mean over its bins.
- Rings use `frame.norm` for size and `frame.energy` for complexity. Waveform stays as in Stage 1.

**Pure tests:** bar edges are monotonic and span 40 Hz to 12 kHz for any sample rate; bar count and bin mapping are derived from the sample rate; a 1 kHz tone lights a bar near the middle of the scale, not the first few.

**Browser check:** each mode responds to the test signals; keys 1/2/3 switch modes; no stale trail when switching.

**Verify:** `npm run typecheck && npm test && npm run build`, plus the browser check.

---

## Open before 2.1 starts
- The owner's reference-visual notes (what to copy from each video) would tune 2.4 and 2.5. They don't block 2.1 to 2.3.
