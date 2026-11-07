# Stage 7 slice briefs (for /implement)

Status: saved 2026-11-06 at Charlie's request. Not built. No slice is `[IN_PROGRESS]`, and none of these slices are in `.spec/PROGRESS.md` yet.

Numbering: Charlie chose (2026-11-07) to renumber these briefs to 7.8–7.17, so the texture-preset slices 7.2–7.5 already in `.spec/PROGRESS.md` keep their IDs. Architecture plan: `.spec/specs/stage7-architecture-plan.md`.

---

## Slice 7.8: Fix the 6 audited layer/blend bugs and centralize GL blend state ownership in Scene.draw()

### Target Files
- `src/main.ts`
- `src/render/scene.ts`
- `src/presets/loader.ts`
- `src/render/layers/waveform.ts`
- `src/render/layers/particles.ts`
- `src/render/shaders/particles.vert.glsl`
- `src/render/shaders/rings.frag.glsl`
- `src/render/shaders/bars.frag.glsl`
- `src/studio/studio.ts`
- `src/render/__tests__/scene.test.ts`

### Strict Invariants & Boundaries
- Do NOT modify any files outside the target list.
- Keep `'max'` (`gl.MAX`) as the default blend mode for all existing layers and presets so current visuals do not saturate to white.
- Do NOT alter audio analysis, feedback shaders, or built-in preset JSON files in this slice.

### Implementation Steps
1. **`src/main.ts`**: Fix the `crownOn` check (around line 129) so `advanceCrown()` is enabled whenever the active preset contains an enabled layer with `type === 'crown'`, rather than hardcoding `id === 'crown'`.
2. **`src/presets/loader.ts` & `src/render/scene.ts`**:
   - Preserve `LayerEntry.opacity` (default `1.0`) and `LayerEntry.blend` (`'max' | 'alpha' | 'add' | 'screen'`, default `'max'`) when constructing scene layers in `buildScene()`.
   - Pass `uLayerOpacity` (`float`) into each layer draw and multiply the layer's output contribution by `uLayerOpacity`.
   - Make `Scene.draw()` the sole owner of GL blend state before each layer draw and restore `gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);` immediately after each layer draw:
     - `'max'`: `gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);`
     - `'alpha'`: `gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);`
     - `'add'`: `gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);`
     - `'screen'`: `gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);`
   - Remove the conflicting `gl.blendFunc(...)` calls inside `src/render/layers/waveform.ts` and `src/render/layers/particles.ts`.
3. **`src/render/shaders/particles.vert.glsl` & `src/render/layers/particles.ts`**:
   - Assign `vMix = aSeed.y;` inside `particles.vert.glsl` `main()` so `particles.frag.glsl` interpolates between `uAccent` and `uAccentA`.
   - Initialize `ParticleLayer` palette from `getCurrentPalette()` instead of hardcoding `'neon'`.
4. **`src/render/shaders/rings.frag.glsl` & `src/render/shaders/bars.frag.glsl`**:
   - Output `vec4(0.0)` on empty exterior background pixels instead of opaque `uBase` so `RingsLayer` and `BarsLayer` can layer cleanly over feedback trails without wiping history.
5. **`src/studio/studio.ts`**: Include `SCHEMAS.post` in `linkTargets` (around lines 336–359) so post-processing parameters can be linked to audio sources in Studio.
6. **`src/render/__tests__/scene.test.ts`**: Add unit tests verifying per-layer `opacity` uniform application, GL blend mode transitions (`max`, `alpha`, `add`, `screen`), `crownOn` activation for non-`'crown'` preset IDs containing a `crown` layer, and default GL blend restoration.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: All 394+ tests pass with zero type errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.9: Wire the Calm safety switch into the composite pass and add GPU-side bidirectional luminance and high-frequency stripe damping

### Target Files
- `src/render/safety.ts`
- `src/render/compositor.ts`
- `src/render/shaders/composite.frag.glsl`
- `src/audio/engine.ts`
- `src/render/__tests__/safety.test.ts`

### Strict Invariants & Boundaries
- Do NOT call `gl.readPixels()` in the live render loop (zero GPU-to-CPU pipeline stalls).
- Keep the safety pass as the mandatory final stage after bloom and post-processing.
- Preserve existing `BrightnessLimiter` behavior for legacy presets when `calm` is off.

### Implementation Steps
1. **`src/render/safety.ts`**:
   - Track bidirectional luminance slew (limiting both rapid upward spikes AND rapid downward drops/inversions) and maintain a rolling 1-second reversal counter so alternating dark/light frames (> 3 reversals/sec) automatically increase damping.
   - Expose `calmFactor` (`1.0` normal, `0.5` when `Calm` mode is enabled) to the compositor uniform state.
   - Update the stale governor comment at `safety.ts:72` (and settle time comment at `src/audio/engine.ts:97`).
2. **`src/render/compositor.ts` & `src/render/shaders/composite.frag.glsl`**:
   - Pass `uCalm` (`float`, `0.0` or `1.0`) and `uReversalDamp` (`float`, `0.0..1.0`) into `composite.frag.glsl`.
   - When `uCalm > 0.5`, reduce contrast excursions from midpoint luminance by 50% and cap peak saturation.
   - Add a screen-space derivative (`fwidth(luma)`) high-frequency stripe guard (`SYSTEM_SPEC.md:94`) that softly attenuates local contrast when high-contrast spatial oscillations exceed safe thresholds.
3. **`src/render/__tests__/safety.test.ts`**:
   - Add unit tests verifying bidirectional luminance slew clamping (catching rapid dark-to-light-to-dark inversions), reversal counter damping at > 3 flashes/sec, and `Calm` mode contrast reduction.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.10: Add kickEnv and kickPulse to AudioFrame, add silence freeze to spectral centroid, and extend bandTexture with waveform + log-spectrum rows

### Target Files
- `src/audio/types.ts`
- `src/audio/frameBuilder.ts`
- `src/presets/links.ts`
- `src/presets/schema.ts`
- `src/render/bandTexture.ts`
- `src/audio/__tests__/frameBuilder.test.ts`
- `src/presets/__tests__/links.test.ts`
- `src/render/__tests__/bandTexture.test.ts`

### Strict Invariants & Boundaries
- Keep `fftSize = 8192` and `smoothingTimeConstant = 0` unchanged.
- Do NOT add a second energy-comparator beat detector; derive `kickEnv` and `kickPulse` strictly from the existing spectral-flux sub-band onset detector (`beatByBand.sub`), respecting the existing beat-sensitivity slider (`1.05..2.0`).
- Do NOT collide with texture units `0–3` used by existing layers and Slice 6.2 `tex-*` presets; bind any new shared audio data texture on `TEXTURE4` (or extend `bandTexture` compatibly).

### Implementation Steps
1. **`src/audio/types.ts` & `src/audio/frameBuilder.ts`**:
   - Add `kickEnv: number` (`0..1`) and `kickPulse: boolean` to `AudioFrame` (update the frame literal at `frameBuilder.ts:158` and test factory at `links.test.ts:7`).
   - When `beatByBand.sub` triggers an onset, set `kickEnv = 1.0` and `kickPulse = true` (for that single frame only). Otherwise set `kickPulse = false` and decay `kickEnv` frame-rate independently via `kickEnv *= Math.pow(0.88, dtSeconds * 60)`.
2. **`src/presets/links.ts` & `src/presets/schema.ts`**:
   - Add a noise-floor freeze to the spectral centroid calculation (`"brightness"` in `links.ts:24`) so it holds `0.5` during silence instead of collapsing toward `0` or dividing by zero.
   - Register `"kickEnv"` and `"centroid"` (aliased to the silence-safe normalized centroid) in `AUDIO_SOURCES`.
3. **`src/render/bandTexture.ts`**:
   - Extend `bandTexture.ts` to provide a persistent `512 x 2` `R32F` audio data texture (`gl.NEAREST`, pre-allocated `Float32Array(1024)` staging buffer, single `texSubImage2D` upload per frame on `TEXTURE4`) without breaking existing Slice 6.2 `bandTexture` callers:
     - Row 0 (`y = 0`): 512 box-averaged time-domain waveform samples in `[-1, 1]`.
     - Row 1 (`y = 1`): 128 log-spaced frequency bins (`20 Hz – 12 kHz`) in `[0, 1]`, zero-padded from index 128 to 511.
4. **Tests**:
   - Add unit tests in `frameBuilder.test.ts`, `links.test.ts`, and `bandTexture.test.ts` verifying `kickEnv` time-independent decay, `kickPulse` single-frame edge behavior, centroid `0.5` silence freeze, and `512x2` buffer packing.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.11: Extend fullscreen per-pixel feedback shader with curl, polarFold, mobius, rgbSplit, sobel edge-detect, and solarize modes

### Target Files
- `src/render/shaders/feedback.frag.glsl`
- `src/render/scene.ts`
- `src/presets/schema.ts`
- `src/presets/loader.ts`
- `src/render/__tests__/feedbackWarp.test.ts`

### Strict Invariants & Boundaries
- Keep the attribute-less fullscreen triangle (`FULLSCREEN_VERT`) and `RGBA8` `PingPong` FBO as the default; do NOT introduce a 32x24 vertex grid.
- Default all new feedback parameters to `0` / `'classic'` so all 25 existing presets render identically.

### Implementation Steps
1. **`src/presets/schema.ts` & `src/presets/loader.ts`**:
   - Extend `SCHEMAS.feedback` with opt-in fields (all defaulting to off/neutral):
     - `warpMode`: `'classic' | 'curl' | 'polarFold' | 'mobius' | 'rgbSplit'` (default `'classic'`)
     - `kaleidoN`: number (`4..16`, default `6`)
     - `portalRadius`: number (`0.0..0.25`, default `0.0`)
     - `rgbSplit`: number (`0.0..0.08`, default `0.0`)
     - `decayRgb`: `[number, number, number]` (default `[1.0, 1.0, 1.0]` multiplier relative to base `decay`)
     - `sobel`: number (`0.0..1.0`, default `0.0`)
     - `solarize`: number (`0.0..1.0`, default `0.0`)
     - `mobiusPoleOffset`: number (`0.1..0.8`, default `0.35`)
2. **`src/render/shaders/feedback.frag.glsl` & `src/render/scene.ts`**:
   - Implement per-pixel UV warp modes in `feedback.frag.glsl`:
     - `'curl'`: 2D simplex/sine curl-noise advection (`uWarpAmp`) + per-channel chromatic decay (`uDecay * uDecayRgb`).
     - `'polarFold'`: Fold polar angle `theta` via `abs(mod(theta, TWO_PI / uKaleidoN) - PI / uKaleidoN)` and apply center portal mask `smoothstep(0.0, uPortalRadius, r)`.
     - `'mobius'`: Complex-plane transformation `f(z) = (a*z + b) / (c*z + d)` with denominator magnitude guarded by `max(denomMag, 1e-4)` to prevent NaNs at singularities; flip pole polarity when `kickPulse` fires.
     - `'rgbSplit'`: Tangential curl `vec2(-p.y, p.x) / max(length(p), 0.05)` + 3-tap sampling of `uPrev` (Red at `zoom + uRgbSplit`, Green at `zoom`, Blue at `zoom - uRgbSplit` with rotational offset).
   - Implement optional post-fetch transforms on `uPrev`:
     - `uSobel > 0.0`: Mix standard feedback sample with a 3x3 Sobel edge-magnitude sample.
     - `uSolarize > 0.0`: Mix color with `0.5 + 0.5 * sin(col.rgb * 6.28318 * 1.25 + uSolarizePhase)`.
3. **`src/render/__tests__/feedbackWarp.test.ts`**:
   - Add tests verifying schema defaults, loader propagation, uniform binding in `Scene`, and shader compilation across all warp modes.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.12: Add orbit_triangles to RingsLayer, star7 and lissajous 3D knot modes to WaveformLayer, CRT scanlines to post, and Flagship Presets 01–06

### Target Files
- `src/render/layers/rings.ts`
- `src/render/shaders/rings.frag.glsl`
- `src/render/layers/waveform.ts`
- `src/render/shaders/waveform.vert.glsl`
- `src/render/shaders/post.frag.glsl`
- `src/presets/schema.ts`
- `src/presets/builtin/index.ts`
- `src/presets/builtin/01-curl-fluid-warp.json`
- `src/presets/builtin/02-kaleidoscopic-mandala.json`
- `src/presets/builtin/03-solarized-contour-rings.json`
- `src/presets/builtin/04-mobius-dual-vortex.json`
- `src/presets/builtin/05-rgb-aberration-vortex.json`
- `src/presets/builtin/06-lissajous-vector-crt.json`
- `src/presets/__tests__/presets.test.ts`

### Strict Invariants & Boundaries
- Do NOT use real person or band names in preset titles or IDs (use `01-curl-fluid-warp`, NOT "Geiss").
- Keep all 25 existing presets valid and passing in the test suite.

### Implementation Steps
1. **`RingsLayer` (`rings.ts`, `rings.frag.glsl`, `schema.ts`)**:
   - Add shape/mode option `'orbitTriangles'` rendering 3 wireframe triangles orbiting at radius `0.4`, scaled by `u_mid` (for Preset 02), and a soft polar grid option (`'polarGrid'`) for Preset 04.
2. **`WaveformLayer` (`waveform.ts`, `waveform.vert.glsl`, `schema.ts`)**:
   - Add mode `'star7'`: 7-pointed wireframe star in the center whose vertices jitter along raw waveform data (for Preset 05).
   - Add mode `'lissajous'`: 1,024-vertex `gl.LINE_STRIP` evaluating 3D parametric knot `x(t) = sin(a*t + delta)`, `y(t) = sin(b*t)`, `z(t) = cos(c*t)` projected to 2D with raw waveform displacement perpendicular to the tangent; advance `delta` on `kickPulse` (for Preset 06).
3. **`src/render/shaders/post.frag.glsl` & `schema.ts`**:
   - Add optional `crtScanlines` (`0.0..1.0`, default `0.0`) and `crtBarrel` (`0.0..0.2`, default `0.0`) to `SCHEMAS.post` and `post.frag.glsl`.
4. **Author Flagship Built-in Presets (`01`–`06`)**:
   - `01-curl-fluid-warp.json` (*Curl Fluid Warp*): `warpMode: 'curl'`, `decay: 0.97`, `decayRgb: [0.99, 0.97, 1.0]`, center `waveform` ribbon linked to `sub` and `mid`.
   - `02-kaleidoscopic-mandala.json` (*Kaleidoscopic Mandala*): `warpMode: 'polarFold'`, `kaleidoN: 8`, `portalRadius: 0.08`, `decay: 0.95`, `rings` in `'orbitTriangles'` mode.
   - `03-solarized-contour-rings.json` (*Solarized Contour Rings*): `sobel: 0.85`, `solarize: 0.8`, `decay: 0.96`, center `rings` + `shockwave` linked to `kickEnv`.
   - `04-mobius-dual-vortex.json` (*Möbius Dual Vortex*): `warpMode: 'mobius'`, `decay: 0.96`, `rings` in `'polarGrid'` mode at `opacity: 0.15` (`blend: 'alpha'`) + `particles` pole accents.
   - `05-rgb-aberration-vortex.json` (*RGB Aberration Vortex*): `warpMode: 'rgbSplit'`, `rgbSplit: 0.03`, `decay: 0.94`, `waveform` in `'star7'` mode + `shockwave`.
   - `06-lissajous-vector-crt.json` (*Lissajous Vector CRT*): `decay: 0.86`, `waveform` in `'lissajous'` mode, phosphor green palette, `crtScanlines: 0.25`, `crtBarrel: 0.08`, bloom `0.7`.
5. **Register & Test (`src/presets/builtin/index.ts`, `presets.test.ts`)**:
   - Register Presets `01`–`06` and verify schema validation, loader instantiation, and safety pass execution across all 6 new presets.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.13: Build MoireLayer and SpectralTerrainLayer, and author Flagship Presets 07 (Moiré Interference Loom) and 08 (Spectral Ridge Terrain)

### Target Files
- `src/render/layers/moire.ts`
- `src/render/shaders/moire.frag.glsl`
- `src/render/layers/spectralTerrain.ts`
- `src/render/shaders/spectralTerrain.vert.glsl`
- `src/render/shaders/spectralTerrain.frag.glsl`
- `src/presets/schema.ts`
- `src/presets/loader.ts`
- `src/presets/builtin/07-moire-interference-loom.json`
- `src/presets/builtin/08-spectral-ridge-terrain.json`
- `src/presets/builtin/index.ts`
- `src/render/__tests__/generators.test.ts`

### Strict Invariants & Boundaries
- Do NOT name Preset 08 after "Joy Division" or "Unknown Pleasures" (use `08-spectral-ridge-terrain` / *Spectral Ridge Terrain*).
- Bind `SpectralTerrainLayer`'s private `128x64` history texture on `TEXTURE5` so it never collides with `TEXTURE0–4`.
- Enforce derivative-based (`fwidth`) anti-aliasing and spatial frequency caps in `moire.frag.glsl` to comply with `SYSTEM_SPEC.md:94`.

### Implementation Steps
1. **`MoireLayer` (`src/render/layers/moire.ts`, `moire.frag.glsl`)**:
   - Fullscreen procedural shader generating two concentric/wave interference grids with analytical `fwidth()` anti-aliasing, combined via smoothed XOR `abs(grid1 - grid2)`.
   - Modulate grid offset with `u_mid`, frequency ratio (`<= 0.08` delta) with `u_sub`, and a radial phase-inversion ring driven by `kickEnv`.
2. **`SpectralTerrainLayer` (`src/render/layers/spectralTerrain.ts`, `.vert.glsl`, `.frag.glsl`)**:
   - Maintain a persistent `128 x 64` `R32F` ring-buffer texture updated once per frame with the 128 log-spectrum bins from `bandTexture` Row 1.
   - Render 64 perspective horizontal ridges from back to front (`z = 0..63`). For each ridge, draw an opaque dark occlusion skirt (`gl.TRIANGLE_STRIP` with `'alpha'` blend) followed by the glowing ridge line (`gl.LINE_STRIP`) so foreground peaks cleanly obscure background ridges.
3. **Register Schema & Loader (`src/presets/schema.ts`, `src/presets/loader.ts`)**:
   - Add `moire` and `spectralTerrain` to `layerSchemas`, `LAYER_FACTORIES`, and `applyValues`.
4. **Author Presets `07` & `08` and Tests**:
   - Create `07-moire-interference-loom.json` (`decay: 0.25`, `moire` layer) and `08-spectral-ridge-terrain.json` (`decay: 0.15`, `spectralTerrain` layer + subtle horizon `bassPulse`).
   - Add unit and safety tests in `src/render/__tests__/generators.test.ts`.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.14: Build ChladniSandLayer, add phyllotaxis spiral mode to ParticleLayer, and author Flagship Presets 09 and 10

### Target Files
- `src/render/layers/chladniSand.ts`
- `src/render/shaders/chladniSand.vert.glsl`
- `src/render/shaders/chladniSand.frag.glsl`
- `src/render/layers/particles.ts`
- `src/render/shaders/particles.vert.glsl`
- `src/presets/schema.ts`
- `src/presets/loader.ts`
- `src/presets/builtin/09-chladni-cymatic-sand.json`
- `src/presets/builtin/10-phyllotaxis-spiral-bloom.json`
- `src/presets/builtin/index.ts`
- `src/render/__tests__/chladniPhyllo.test.ts`

### Strict Invariants & Boundaries
- Reuse `ParticleLayer`'s existing `POOL_SIZE = 600` instanced quad infrastructure for Preset 10 (`phyllotaxis` mode).
- Implement `ChladniSandLayer` using a single static `8,192`-point seed VBO with analytic standing-wave gradient attraction in the vertex shader (no WebGL2 Transform Feedback state complexity required).

### Implementation Steps
1. **`ChladniSandLayer` (`src/render/layers/chladniSand.ts`, `.vert.glsl`, `.frag.glsl`)**:
   - Pre-allocate `8,192` 2D seed points (`vec4(x, y, hash1, hash2)`).
   - In `chladniSand.vert.glsl`, evaluate the Chladni standing wave potential `f(x,y) = cos(n*PI*x)*cos(m*PI*y) - cos(m*PI*x)*cos(n*PI*y)` and its analytic spatial gradient `(df/dx, df/dy)`.
   - Displace each grain down the gradient toward the zero-energy nodal lines (`f(x,y) == 0`), morphing harmonic modes `(n, m)` smoothly with `u_mid` and `u_centroid`, and injecting radial Brownian jitter proportional to `kickEnv`. Render as `1.5px–2.5px` warm gold/amber `gl.POINTS`.
2. **`ParticleLayer` Phyllotaxis Mode (`particles.ts`, `particles.vert.glsl`, `schema.ts`)**:
   - Add `mode: 'radial' | 'phyllotaxis'` (default `'radial'`) to `ParticleLayer` schema.
   - When `mode === 'phyllotaxis'`, position the 600 instances using Golden Angle polar coordinates `r = c * sqrt(i)` and `theta = i * (2.3999632 + uSubTwist * 0.0015)`, modulating instance scale and color mix (`vMix`) via an outward phase wave `sin(i * 0.06 - uTime * uFlowSpeed)`.
3. **Register & Author Presets `09` & `10`**:
   - Register `chladniSand` in `schema.ts` and `loader.ts`.
   - Author `09-chladni-cymatic-sand.json` (`decay: 0.90`, `chladniSand` layer) and `10-phyllotaxis-spiral-bloom.json` (`decay: 0.88`, `particles` in `'phyllotaxis'` mode).
   - Add unit tests in `src/render/__tests__/chladniPhyllo.test.ts`.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.15: Build FerrofluidLayer using a 4-subdivision icosahedron mesh with 3D curl displacement and MatCap shading, and author Flagship Preset 11

### Target Files
- `src/render/layers/ferrofluid.ts`
- `src/render/shaders/ferrofluid.vert.glsl`
- `src/render/shaders/ferrofluid.frag.glsl`
- `src/presets/schema.ts`
- `src/presets/loader.ts`
- `src/presets/builtin/11-ferrofluid-magnetic-crown.json`
- `src/presets/builtin/index.ts`
- `src/render/__tests__/ferrofluid.test.ts`

### Strict Invariants & Boundaries
- Use a pre-allocated 4-subdivision icosahedron triangle mesh (`2,562` vertices / `5,120` triangles) displaced in the vertex shader; do NOT use a fullscreen raymarching loop so 60fps performance is guaranteed at 1440p.
- Ensure depth testing (`gl.DEPTH_TEST`) is enabled only during `FerrofluidLayer.draw()` and disabled immediately afterward so 2D layers are unaffected.

### Implementation Steps
1. **`FerrofluidLayer` (`src/render/layers/ferrofluid.ts`, `.vert.glsl`, `.frag.glsl`)**:
   - Generate a static 4-subdivision unit icosahedron indexed mesh once during `init()`.
   - In `ferrofluid.vert.glsl`, displace vertices along their normal `N` using 3D Simplex/harmonic lobe noise: base radius scaled by `u_sub`, spike spatial frequency controlled by `u_mid`, and sharp magnetic spike extrusion driven by `kickEnv`. Compute perturbed surface normals via finite differences along tangent vectors.
   - In `ferrofluid.frag.glsl`, shade the surface using a procedural studio **MatCap Chrome** reflection gradient mapped to `(vNormal.x, vNormal.y)` plus a high-contrast cyan/amber **Fresnel Rim Halo** `pow(1.0 - max(dot(V, vNormal), 0.0), 3.0)`.
2. **Register & Author Preset `11`**:
   - Register `ferrofluid` in `schema.ts` and `loader.ts`.
   - Author `11-ferrofluid-magnetic-crown.json` (`decay: 0.82`, `zoom: 1.02`, `ferrofluid` layer with `'alpha'` blend + subtle background `rings`).
   - Add unit tests in `src/render/__tests__/ferrofluid.test.ts` verifying mesh generation, GL depth-state cleanup, and preset loading.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.16: Add ghost-free seeded-feedback morph transition to Compositor and organize the preset library into Flagship, Textures, Classics, and Archive groups

### Target Files
- `src/render/compositor.ts`
- `src/render/scene.ts`
- `src/presets/autoCycler.ts`
- `src/presets/builtin/index.ts`
- `src/ui/controls.ts`
- `src/render/__tests__/morphTransition.test.ts`

### Strict Invariants & Boundaries
- Keep all 12 `tex-*` presets (Slice 6.2), 3 Classics (`crown`, `flight`, `bars`), and 10 `starter-*` presets loadable by ID so all existing tests pass without breakage.
- Avoid double-exposure ghosting during `morph` transitions: when Scene B inherits Scene A's feedback pixels at `t = 0`, immediately display Scene B evolving those inherited pixels rather than crossfading Scene A's static snapshot on top.

### Implementation Steps
1. **`src/render/scene.ts` & `src/render/compositor.ts`**:
   - Add `seedFromTexture(sourceTex: WebGLTexture)` on `Scene` (blits/draws `sourceTex` into the scene's `PingPong` read FBO).
   - Add transition mode `'morph'` to `Compositor`:
     - On transition start (`t = 0`), copy the Outgoing Scene's read FBO into the Incoming Scene's read FBO via `seedFromTexture()`, so Incoming Scene's Pass 1 warp immediately advects Outgoing Scene's trails.
     - During `'morph'`, render only the Incoming Scene (with incoming foreground layer opacity ramping smoothly `0.0 -> 1.0` over the first `0.6s`) and retire the Outgoing Scene cleanly, eliminating ghosting and halving dual-scene GPU cost.
2. **`src/presets/autoCycler.ts`**:
   - Add a `3.0s` max-wait fallback timeout to beat-synced preset switching so auto-cycle still advances smoothly during beatless ambient breakdowns.
3. **`src/presets/builtin/index.ts` & `src/ui/controls.ts`**:
   - Group built-in presets with metadata `group: 'flagship' | 'textures' | 'classic' | 'archive'`:
     - `'flagship'`: Presets `01` through `11` (and `12` in Slice 7.17).
     - `'textures'`: All 12 `tex-*` presets from Slice 6.2.
     - `'classic'`: `crown`, `flight`, `bars`.
     - `'archive'`: The 10 `starter-*` draft presets (excluded from primary default auto-cycle rotation, but still accessible by ID).
4. **`src/render/__tests__/morphTransition.test.ts`**:
   - Add unit tests verifying `seedFromTexture` FBO handoff, `'morph'` transition lifecycle, `3.0s` beatless auto-cycle fallback, and preset group filtering.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.17: Build ReactionDiffusionLayer with an isolated 256x256 ping-pong chemical state FBO and author Flagship Preset 12 (Reaction-Diffusion Coral)

### Target Files
- `src/render/layers/reactionDiffusion.ts`
- `src/render/shaders/rdSim.frag.glsl`
- `src/render/shaders/rdRender.frag.glsl`
- `src/presets/schema.ts`
- `src/presets/loader.ts`
- `src/presets/builtin/12-reaction-diffusion-coral.json`
- `src/presets/builtin/index.ts`
- `src/render/__tests__/reactionDiffusion.test.ts`

### Strict Invariants & Boundaries
- Do NOT run the Gray-Scott simulation inside the scene's main RGBA color trail `PingPong` FBO; `ReactionDiffusionLayer` MUST own its own isolated `256 x 256` simulation `PingPong` FBO bound on `TEXTURE5`.
- Detect `EXT_color_buffer_float` at runtime: use `gl.RGBA16F` when supported and fall back cleanly to `gl.RGBA8` so all devices/headless test environments succeed.

### Implementation Steps
1. **`ReactionDiffusionLayer` (`src/render/layers/reactionDiffusion.ts`, `rdSim.frag.glsl`, `rdRender.frag.glsl`)**:
   - Allocate a dedicated `256 x 256` `PingPong` FBO (`RGBA16F` with `RGBA8` fallback) seeded with chemical `U = 1.0, V = 0.0` and a central ring of `V = 0.5`.
   - Use a frame-rate independent fixed-timestep accumulator running **8 sub-steps per frame** (capped at 10) in `rdSim.frag.glsl`:
     - Compute 9-point Laplacian of `U` (`.r`) and `V` (`.g`) with `Du = 0.16`, `Dv = 0.08`.
     - Map `u_mid` and `u_centroid` to shift Feed `F` (`0.035..0.055`) and Kill `K` (`0.060..0.065`) between mitosis spots and labyrinthine coral stripes.
     - Inject fresh chemical `V` along a central ring whenever `kickPulse` or `kickEnv > 0.7` fires.
   - In `rdRender.frag.glsl`, sample the `256 x 256` state texture (`gl.LINEAR`), compute surface normals from `V` gradients (`dFdx(V), dFdy(V)`), and render embossed neon pink/cobalt coral ridges with specular highlights into the main scene FBO.
   - Implement full WebGL context-loss/restore and `dispose()` cleanup for the simulation FBO.
2. **Register & Author Preset `12`**:
   - Register `reactionDiffusion` in `schema.ts` and `loader.ts`.
   - Author `12-reaction-diffusion-coral.json` (`decay: 0.20`, `reactionDiffusion` layer) and add it to the `'flagship'` group in `src/presets/builtin/index.ts`.
   - Add unit tests in `src/render/__tests__/reactionDiffusion.test.ts` verifying simulation substep capping, `RGBA16F`/`RGBA8` fallback allocation, context-restore recreation, and WCAG safety compliance.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: All tests pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.18: Restore `'max'` blend default, add per-layer `trails: boolean` pass split in `Scene`, attenuate `'add'`/`'screen'` under feedback decay, and fix dark-floor washout in `composite.frag.glsl` & `safety.ts`

### Target Files
- `src/presets/format.ts`
- `src/render/scene.ts`
- `src/render/safety.ts`
- `src/render/shaders/composite.frag.glsl`
- `src/render/__tests__/scene.test.ts`

### Strict Invariants & Boundaries
- Restore `BLEND_SPEC.default = 'max'` in `src/presets/format.ts` so every preset that omits an explicit `"blend"` uses peak-hold (`gl.MAX`) instead of cumulative additive blow-out (`1 / (1 - decay)`).
- Never lift `0.0` black backgrounds toward `vec3(0.5)` mid-grey when `uCalm` or `uReversalDamp` activates in `composite.frag.glsl`.
- Do NOT break existing `Scene` unit tests; update `src/render/__tests__/scene.test.ts` to cover `'max'`, `'alpha'`, `'add'`, `'screen'`, decay attenuation, and the `trails: true` vs `trails: false` dual-pass render order.

### Implementation Steps
1. **`src/presets/format.ts`**:
   - Update `BLEND_MODES = ['max', 'alpha', 'add', 'screen'] as const` and set `BLEND_SPEC.default = 'max'`.
   - Add `TRAILS_SPEC: BoolSpec = { key: 'trails', label: 'Trails', kind: 'bool', default: true }`.
   - Add `trails?: boolean` (default `true`) to `LayerEntry` in `format.ts` and preserve `trails: entry.trails ?? true` in `normalisePreset()`.
2. **`src/render/scene.ts`**:
   - Update `LayerEntry.blend` type to `'add' | 'max' | 'alpha' | 'screen'` and add `trails?: boolean` (default `true`).
   - In `applyLayerBlend(gl, blend)`:
     - `'max'`: `gl.blendEquation(gl.MAX); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);`
     - `'alpha'`: `gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);`
     - `'add'`: `gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);`
     - `'screen'`: `gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);`
   - Compute energy-compensated layer opacity: when `entry.trails !== false && this.feedback.decay > 0.05 && (entry.blend === 'add' || entry.blend === 'screen')`, scale `effectiveOpacity = entry.opacity * (1.0 - this.feedback.decay * 0.82)`; otherwise `effectiveOpacity = entry.opacity`.
   - Split `Scene.draw()` layer rendering into two passes:
     - **Pass 1B (Trailing Layers):** Draw all enabled layers where `entry.trails !== false` into `this.targets.write.fbo` before `this.targets.swap()`.
     - **Pass 1C (Sharp Overlay Layers):** After `this.targets.swap()`, if any enabled layer has `entry.trails === false`, copy `this.targets.read.tex` into `this.targets.write.fbo`, draw all enabled layers with `entry.trails === false` on top using `applyLayerBlend` and `uLayerOpacity: entry.opacity`, and call `this.targets.swap()` again so `this.targets.read.tex` holds the combined output while keeping `trails: false` layers out of next frame's feedback history! Wait: to ensure `trails: false` layers do NOT enter next frame's feedback history, copy `this.targets.read.tex` into `this.postTarget.fbo` (or draw `trails: false` layers after feedback swap into a composite buffer before post/bloom, OR restore the pre-overlay texture as `read`). Specifically:
       - If any enabled layer has `entry.trails === false`: after Pass 1B `this.targets.swap()`, `this.targets.read` holds the pure feedback history for next frame. If post/bloom is inactive, blit `this.targets.read.tex` into `this.targets.write.fbo`, draw `trails: false` layers into `this.targets.write.fbo`, and have `Scene.texture` return that buffer while keeping `this.targets.read` untouched for next frame's Pass 1A feedback input! (Expose a private `outputTex: WebGLTexture | null` on `Scene` set at the end of `draw()` so `get texture()` returns `this.outputTex ?? this.targets.read.tex`.)
3. **`src/render/shaders/composite.frag.glsl` & `src/render/safety.ts`**:
   - In `composite.frag.glsl`:
     - Replace `col = mix(col, vec3(0.5), (1.0 - contrastFactor) * 0.5)` with dark-preserving highlight roll-off: `col = col / (1.0 + col * (1.0 - contrastFactor)) * contrastFactor;`
     - Replace `col = mix(col, vec3(0.5), uReversalDamp * 0.5)` with `col *= (1.0 - uReversalDamp * 0.35);`
   - In `src/render/safety.ts`:
     - Raise `REVERSAL_THRESHOLD` from `0.05` to `0.12` so normal musical beat dynamics do not trigger false-positive reversal damping.
4. **`src/render/__tests__/scene.test.ts`**:
   - Add tests verifying `'max'` default blend, `'screen'` blend state, additive decay attenuation, and `trails: false` overlay isolation from the feedback loop.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.19: Wire live Studio controls for `Opacity`, `Blend`, `Trails`, and `vec3` (`decayRgb`), plus preset loader `trails` support and safety dark-floor tests

### Target Files
- `src/presets/loader.ts`
- `src/studio/studio.ts`
- `src/studio/studio.test.ts`
- `src/render/__tests__/safety.test.ts`

### Strict Invariants & Boundaries
- Changing `Opacity`, `Blend`, or `Trails` in Studio must immediately update the live `Scene` and commit to the active `PresetSession` without requiring a preset reload.
- `bindSpec` in `src/studio/studio.ts` must support `kind: 'vec3'` (`decayRgb`) via three per-channel sliders (`R`, `G`, `B`).

### Implementation Steps
1. **`src/presets/loader.ts`**:
   - Pass `trails: entry.trails ?? true` when constructing `Scene` `LayerEntry` objects in `buildSceneFromPreset` and `applyPresetToScene`.
2. **`src/studio/studio.ts`**:
   - In `buildLayerControls`:
     - Wire `.on('change', ...)` on the `Opacity` binding (`OPACITY_SPEC.key`) to call `applyPresetToScene(p, currentScene, gl); session.commit(true);`.
     - Wire `.on('change', ...)` on the `Blend` binding (`BLEND_SPEC.key`) to call `applyPresetToScene(p, currentScene, gl); session.commit(true);`.
     - Add a `Trails` boolean toggle bound to `entry.trails` (using `TRAILS_SPEC`) that calls `applyPresetToScene(p, currentScene, gl); session.commit(true);`.
   - In `bindSpec`:
     - Add `case 'vec3':` creating three numeric slider bindings (`${spec.label} R`, `${spec.label} G`, `${spec.label} B` with `min: spec.min, max: spec.max, step: spec.step`) reading/writing `bag[spec.key][0..2]` and firing `onEdit()`.
3. **`src/studio/studio.test.ts` & `src/render/__tests__/safety.test.ts`**:
   - Add Studio unit tests verifying live `Opacity`, `Blend`, `Trails`, and `vec3` (`decayRgb`) edits update the scene and commit to session.
   - Update `src/render/__tests__/safety.test.ts` to verify `REVERSAL_THRESHOLD = 0.12` and dark-floor preservation (`0.0` black stays `0.0` under `uCalm` and `uReversalDamp`).

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.20: Wire `uLayerOpacity` and see-through stencil alpha (`alpha = 0` on dark gaps) across legacy layers (`Crown`, `Shockwave`, `BassPulse`)

### Target Files
- `src/render/layers/crown.ts`
- `src/render/shaders/crown.frag.glsl`
- `src/render/layers/shockwave.ts`
- `src/render/shaders/shockwave.frag.glsl`
- `src/render/layers/bassPulse.ts`

### Strict Invariants & Boundaries
- Do not alter the internal visual look of `Crown`, `Shockwave`, or `BassPulse` when `uLayerOpacity === 1.0`, except that empty/dark background pixels must emit proportional alpha (`alpha = clamp(peakChannel, 0.0, 1.0) * uLayerOpacity`) instead of opaque `1.0` so `'alpha'` and `'max'` blending let underlying layers show through.

### Implementation Steps
1. **`src/render/layers/crown.ts` & `src/render/shaders/crown.frag.glsl`**:
   - Accept `options?: { uLayerOpacity?: number }` in `CrownLayer.draw(frame, clock, options)` and upload `uLayerOpacity` (`options?.uLayerOpacity ?? 1.0`).
   - Remove the hardcoded `gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);` override inside `CrownLayer.draw()` so `Scene.applyLayerBlend()` controls the blend state.
   - In `crown.frag.glsl`, add `uniform float uLayerOpacity;`, scale `col *= uLayerOpacity;`, and output `float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0); fragColor = vec4(col, a);`.
2. **`src/render/layers/shockwave.ts` & `src/render/shaders/shockwave.frag.glsl`**:
   - Accept `options?: { uLayerOpacity?: number }` in `ShockwaveLayer.draw(frame, clock, options)` and upload `uLayerOpacity` (`options?.uLayerOpacity ?? 1.0`).
   - Remove the hardcoded `gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);` override inside `ShockwaveLayer.draw()`.
   - In `shockwave.frag.glsl`, add `uniform float uLayerOpacity;`, scale `col *= uLayerOpacity;`, and output `float a = clamp(ring, 0.0, 1.0) * uLayerOpacity; fragColor = vec4(col, a);`.
3. **`src/render/layers/bassPulse.ts`**:
   - Accept `options?: { uLayerOpacity?: number }` in `BassPulseLayer.draw(frame, clock, options)`, upload `uLayerOpacity`, remove hardcoded `gl.blendFunc(gl.ONE, gl.ONE)`, and output proportional alpha `clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0)` in its inline fragment shader.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.21: Overhaul `TunnelLayer` (`tunnelState.ts`, `tunnel.ts`, `tunnel.frag.glsl`) with stencil alpha, smooth round `rings` mode, Multi-Color Depth Rainbow (`hueSpread`), Cosmic Star-Streaks & Wall Glow (`wallTexture`), and 4 combinable flight controls (`zoomPunch`, `swirlPulse`, `horizonDrift`, `reverseOnBreakdown` with 18s cooldown)

### Target Files
- `src/render/tunnelState.ts`
- `src/render/layers/tunnel.ts`
- `src/render/shaders/tunnel.frag.glsl`
- `src/presets/layerSchemas.ts`
- `src/render/__tests__/tunnelOverhaul.test.ts`

### Strict Invariants & Boundaries
- When `sides == 0` (`uSides < 2.5`), `rings` mode MUST render smooth round circular rings (no forced hexagonal wobble).
- Breakdown flight reversal (`flightMode: 'dropReverse'` / `reverseOnBreakdown: true`) MUST enforce a **minimum 18-second cooldown** (`reverseCooldownSec >= 18.0`) between direction reversals so the camera slows to a stop and drifts backward during breakdowns, then launches forward on drops without ever flipping every second.
- All 4 movement controls (`zoomPunch`, `swirlPulse`, `horizonDrift`, `reverseOnBreakdown` / `flightMode`) must work independently in any permutation.
- Dark gaps between tunnel rings/grid lines must emit `alpha = 0` (`clamp(line + streak + wallNebula + glow, 0.0, 1.0) * uLayerOpacity`) so underlying layers remain visible through the tunnel walls.

### Implementation Steps
1. **`src/presets/layerSchemas.ts`**:
   - Expand `TUNNEL_SCHEMA` with:
     - `flightMode`: `'dropReverse' | 'forward' | 'reverse' | 'pendulum'` (default `'dropReverse'`, label `'Flight mode'`)
     - `reverseOnBreakdown`: boolean (default `true`, label `'Breakdown reverse flight'`)
     - `hueSpread`: `0..1`, default `0.55`, step `0.05` (label `'Multi-color depth rainbow'`)
     - `wallTexture`: `0..1`, default `0.55`, step `0.05` (label `'Cosmic star-streaks & wall glow'`)
     - `zoomPunch`: `0..1`, default `0.40`, step `0.05` (label `'Kick FOV warp & depth ripple'`)
     - `swirlPulse`: `0..1`, default `0.35`, step `0.05` (label `'Mid corkscrew swirl'`)
     - `horizonDrift`: `0..1`, default `0.40`, step `0.05` (label `'Bass horizon curve sway'`)
2. **`src/render/tunnelState.ts`**:
   - Extend `TunnelState` with `flightSign: number` (initial `1`), `velocityMultiplier: number` (initial `1`), `reverseCooldownSec: number` (initial `18`), `reverseHoldSec: number` (initial `0`), and `horizonSwayPhase: number` (initial `0`).
   - In `stepTunnel(state, frame, dt, params)`:
     - Advance `reverseCooldownSec += dt` and `horizonSwayPhase += dt * (0.45 + frame.sub * 0.85)`.
     - Scale vanishing-point offset (`vanishX`, `vanishY`) by `params.horizonDrift ?? 0.4` with bassline banking (`Math.sin(state.horizonSwayPhase) * 0.22 * horizonDrift`) so the tunnel curves like banking through a space tube.
     - For `flightMode === 'forward'` (or when `params.reverseOnBreakdown === false` and `flightMode === 'dropReverse'`): target velocity is `+1.0`.
     - For `flightMode === 'reverse'`: target velocity is `-0.75`.
     - For `flightMode === 'pendulum'`: target velocity is `Math.sin(frame.time * 0.28)`.
     - For `flightMode === 'dropReverse'` with `reverseOnBreakdown !== false` (default):
       - When `state.flightSign > 0`, if `state.reverseCooldownSec >= 18.0` and a musical breakdown occurs (`frame.sectionContrast < -0.06` or `frame.energy < 0.18`), flip `state.flightSign = -1`, reset `state.reverseCooldownSec = 0`, and set `state.reverseHoldSec = 4.5` (slows to a stop and drifts backward during breakdowns).
       - When `state.flightSign < 0`, count down `state.reverseHoldSec = Math.max(0, state.reverseHoldSec - dt)`. Once `state.reverseHoldSec <= 0` and a drop/build arrives (`frame.kick > 0.45 || frame.sectionContrast > 0.05 || state.reverseCooldownSec >= 8.0`), flip `state.flightSign = 1` and reset `state.reverseCooldownSec = 0` (launches forward on drops).
       - Smoothly slew `state.velocityMultiplier` toward `state.flightSign > 0 ? 1.0 : -0.65` with a `1.4s` time constant (`1 - Math.exp(-dt / 1.4)`), and multiply `forwardDelta` by `state.velocityMultiplier`.
3. **`src/render/layers/tunnel.ts` & `src/render/shaders/tunnel.frag.glsl`**:
   - Accept `options?: { uLayerOpacity?: number }` in `TunnelLayer.draw`, remove hardcoded `gl.disable(gl.BLEND)`, and upload `uLayerOpacity`, `uHueSpread`, `uWallTexture`, `uZoomPunch`, and `uSwirlPulse`.
   - In `tunnel.frag.glsl`:
     - When `uSides < 2.5` (`sides == 0` round rings), keep `r = length(q)` perfectly circular (zero polygonal wobble).
     - Modulate radial depth `r` by kick FOV warp jump + travelling depth shockwave ripple (`uZoomPunch`): `float rMod = max(r * (1.0 - uKick * uZoomPunch * 0.22), 0.025); float z = 0.28 / rMod + uForwardPhase + uKick * uZoomPunch * 0.35 * sin(0.28 / rMod * 3.0 - uForwardPhase * 4.0);`.
     - Add mid-band corkscrew swirl & twist (`uSwirlPulse`): `float a = atan(q.y, q.x) + uRollPhase + (uSpiral + uMid * uSwirlPulse * 0.9) / max(rMod, 0.08);`.
     - Use seamless angular wrapping `float aNorm = fract(a / 6.2831853);` and `sin(a * N)` so there is no discontinuity at `±PI`.
     - Overhaul `uPattern == 0` (`rings`):
       - **Cosmic Star-Streaks & Wall Glow Between Rings (`uWallTexture`):** Render longitudinal warp-speed star-streaks and soft nebula glow in the inter-ring gaps: `float streak = pow(max(0.0, sin(a * 24.0 + floor(z * 2.0) * 1.9)), 6.0) * smoothstep(0.05, 0.45, r) * uWallTexture; float wallNebula = (0.5 + 0.5 * sin(a * 6.0 - z * 1.2)) * 0.18 * uWallTexture;`.
       - **Multi-Color Depth Rainbow (`uHueSpread`):** Shift each ring's hue along tunnel depth `z` using a vivid cosine rainbow palette blended with `uColorA` / `uColorB`: `float ringIdx = floor(z * 1.6); vec3 rainbow = 0.55 + 0.45 * cos(6.28318 * (ringIdx * 0.14 * uHueSpread + uRollPhase * 0.15 + vec3(0.0, 0.33, 0.67))); vec3 ringCol = mix(mix(uColorA, uColorB, 0.5 + 0.5 * sin(ringIdx * 0.7)), rainbow, uHueSpread);`.
     - Compute stencil alpha `float alpha = clamp((line + streak * 0.65 + wallNebula + centerGlow * 0.35) * fog * vanish, 0.0, 1.0) * uLayerOpacity;` and output `fragColor = vec4(col * uLayerOpacity, alpha);`.
4. **`src/render/__tests__/tunnelOverhaul.test.ts`**:
   - Add unit tests verifying all 4 combinable movement controls (`zoomPunch`, `swirlPulse`, `horizonDrift`, `reverseOnBreakdown` with 18s cooldown), smooth velocity slewing, and shader compilation.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.22: Overhaul `feedback.frag.glsl` and `Scene` for Multi-Octave Simplex Curl (4 Flow Styles + Hue Drift), Luminance-Gated Topographic Solarize, Full-Screen Tiled Mandala, and Dynamic Wandering Möbius Dipole Flow

### Target Files
- `src/render/shaders/feedback.frag.glsl`
- `src/render/scene.ts`
- `src/presets/schema.ts`
- `src/presets/loader.ts`
- `src/render/__tests__/feedbackWarp.test.ts`

### Strict Invariants & Boundaries
- **Curl (`uWarpMode == 1`):** Replace the single-frequency `sin(x)*cos(y)` displacement (`* 0.01`) with a 2-to-3 octave 2D Simplex stream-function curl field supporting all 4 combinable controls: `curlFlowPattern` (`'plumes' | 'eddies' | 'outflow' | 'inflow'`), working `warpScale`/`warpSpeed`, `curlTurbulence` (fine multi-octave smoky detail driven by treble/hi-hats), and `hueDrift` (shifting trail hue as smoke ages).
- **Mandala (`uWarpMode == 2`):** Add mirror-continuous polar reflection, concentric radial accordion folding (`uRadialFold`), and Wallpaper / Fractal Tiling (`uMandalaTile`) + symmetry/counter-spin/kick-flare controls (`mandalaPattern`: `'auto' | '4' | '6' | '8' | '12' | '16'`, 8s minimum cooldown).
- **Solarize (`uSolarize > 0`):** Gate topographic contour bands by source luminance (`smoothstep(0.035, 0.14, lum)`) so `lum == 0` stays pitch-black (`0.0`) and never explodes into recursive full-screen Sobel white noise.
- **Möbius (`uWarpMode == 3`):** Remove the instantaneous `kickPulse` sign-flip on `mobiusPolePolarity` in `scene.ts`! Replace the global complex inversion with a smooth incremental complex dipole velocity step where the two vortex poles **shift smoothly in position relative to each other (separation distance & relative angle) AND relative to the entire screen (center drift / orbital wander `uMobiusCenter`)**, reacting smoothly in time to the music (smoothed bass/mid envelopes + slow LFOs).

### Implementation Steps
1. **`src/presets/schema.ts` & `src/presets/loader.ts`**:
   - Expand `FEEDBACK_SCHEMA` with:
     - **Curl controls:** `curlOctaves` (`1..3`, default `2`, step `1`), `curlTurbulence` (`0..1`, default `0.45`, step `0.05`, label `'Treble smoke turbulence'`), `curlFlowPattern` (`['plumes', 'eddies', 'outflow', 'inflow']`, default `'plumes'`, label `'Curl flow style'`).
     - **Mandala controls:** `radialFold` (`0..1`, default `0.0`, step `0.05`, label `'Radial fold repetition'`), `mandalaTile` (`0..1`, default `0.0`, step `0.05`, label `'Wallpaper crystal tiling'`), `mandalaCounterSpin` (`-1..1`, default `0.25`, step `0.05`, label `'Counter-rotation speed'`), `mandalaKickFlare` (`0..1`, default `0.35`, step `0.05`, label `'Kick crystal flare'`), `mandalaPattern` (`['auto', '4', '6', '8', '12', '16']`, default `'auto'`, label `'Symmetry lock'`).
     - **Solarize contour controls:** `contourFreq` (`2..16`, default `7.85`, step `0.25`, label `'Line count'`), `contourWidth` (`0.1..1.0`, default `0.45`, step `0.05`, label `'Line thickness'`), `colorSpread` (`0..1`, default `0.65`, step `0.05`, label `'Color spread'`).
     - **Möbius dipole controls:** `mobiusFlow` (`0..2`, default `0.85`, step `0.05`, label `'Dipole flow speed'`), `mobiusSwirl` (`-2..2`, default `0.65`, step `0.05`, label `'Spiral tightness'`), `mobiusPoleOffset` (`0.2..0.85`, default `0.48`, step `0.02`, label `'Pole separation'`), `mobiusWander` (`0..1`, default `0.55`, step `0.05`, label `'Pole & screen drift'`), `mobiusMode` (`['auto', 'dipoleFlow', 'doubleVortex', 'figureEight', 'breathingOrbit']`, default `'auto'`, label `'Vortex flow mode'`).
   - Wire all new fields in `loader.ts` (`readFeedbackSettings`).
2. **`src/render/scene.ts`**:
   - Remove `if (frame.kickPulse > 0.5) { this.mobiusPolePolarity = -this.mobiusPolePolarity; }`.
   - Maintain smoothed audio-reactive Möbius pole coordinates in `Scene`:
     - Smoothly integrate two slow phase accumulators driven by bass and mid envelopes (`poleOrbitPhase += dt * (0.28 + norm.mid * 0.45)` and `screenDriftPhase += dt * (0.19 + norm.sub * 0.35)`).
     - Compute screen-relative center drift `center = vec2(sin(screenDriftPhase) * 0.24, cos(screenDriftPhase * 0.77) * 0.16) * mobiusWander` (shifting both poles together across the screen).
     - Compute relative pole separation `sep = mobiusPoleOffset * (1.0 + 0.28 * mobiusWander * (sin(poleOrbitPhase * 0.63) * 0.5 + (norm.sub - 0.3) * 0.6))` and relative pole angle `ang = poleOrbitPhase * 0.45 * mobiusWander`.
     - Compute `poleA = center - sep * vec2(cos(ang), sin(ang))` and `poleB = center + sep * vec2(cos(ang), sin(ang))` and upload `uMobiusPoleA` and `uMobiusPoleB` (`vec2`) plus `uMobiusFlow`, `uMobiusSwirl` (with phrase-locked breathing cooldown >= 8.0s).
   - Upload all new Curl, Mandala, and Solarize uniforms (`uCurlOctaves`, `uCurlTurbulence`, `uCurlFlowPattern`, `uRadialFold`, `uMandalaTile`, `uMandalaCounterSpin`, `uMandalaKickFlare`, `uContourFreq`, `uContourWidth`, `uColorSpread`).
3. **`src/render/shaders/feedback.frag.glsl`**:
   - **`uWarpMode == 1` (Multi-Octave Simplex Curl with 4 Flow Styles):**
     - Implement 2D Simplex noise `snoise(vec2)` and multi-octave stream-function curl (`1..3` octaves, with higher octaves weighted by `uCurlTurbulence * (0.5 + uHigh * 0.8)`).
     - Apply flow style bias (`uCurlFlowPattern`): `0` (`plumes`): buoyant rising/billowing plumes drifting outward from the center waveform; `1` (`eddies`): balanced stationary whirlpools; `2` (`outflow`): radial bass-driven outward expansion; `3` (`inflow`): inward vortex suction.
     - Scale displacement by `uWarp * 0.032` and apply `uHueShift` (`hueDrift`) so smoke trails shift hue as they age.
   - **`uWarpMode == 2` (Kaleidoscopic Mandala with Radial Fold & Wallpaper Tiling):**
     - When `uMandalaTile > 0.001`, blend UV into a tiled hexagonal/mirrored crystal grid across the full 16:9 viewport before polar folding.
     - Apply mirror-continuous angular folding (`symmetry` + `uMandalaCounterSpin` + `uMandalaKickFlare`) and concentric radial accordion folding (`uRadialFold`).
   - **`uWarpMode == 3` (Smooth Incremental Möbius Dipole Flow with Dynamic Poles `uMobiusPoleA`, `uMobiusPoleB`):**
     - Compute incremental complex dipole step around the live moving poles `a = uMobiusPoleA` and `b = uMobiusPoleB` in log-ratio coordinates (`w = log((z - a)/(z - b))`), add `vec2(uMobiusFlow * 0.035, uMobiusSwirl * 0.035) * uWarp`, and invert back via `(a - b * exp(w)) / (1.0 - exp(w))` so grid lines form a smooth S-curve / figure-8 river spiraling out of one moving pole and into the other without ever flashing.
   - **Luminance-Gated Topographic Solarize (`uSolarize > 0.001`):**
     - Compute luminance `float lum = dot(c, vec3(0.299, 0.587, 0.114)); float gate = smoothstep(0.035, 0.14, lum);`.
     - Generate crisp rainbow topographic isolines `float band = pow(0.5 + 0.5 * sin(lum * uContourFreq * 3.14159 + phase), mix(6.0, 1.2, uContourWidth));` with a 3-stop neon palette (`cyan -> magenta -> gold/emerald` controlled by `uColorSpread`), multiplied by `gate` so dark backgrounds remain `vec3(0.0)` with zero white-noise explosion.
4. **`src/render/__tests__/feedbackWarp.test.ts`**:
   - Update and expand tests to verify smooth Möbius dipole continuity (no sign-flip on `kickPulse`, dynamic `uMobiusPoleA`/`uMobiusPoleB` drift), luminance-gated solarize (`vec3(0)` stays `vec3(0)`), and new Curl/Mandala uniforms.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.23: Add multi-color ink injection (`colorMode`) to `WaveformLayer` and 3-tier stained-glass Mandala seed lattice + stencil alpha to `RingsLayer`

### Target Files
- `src/render/layers/waveform.ts`
- `src/render/shaders/waveform.frag.glsl`
- `src/render/layers/rings.ts`
- `src/render/shaders/rings.frag.glsl`
- `src/presets/layerSchemas.ts`

### Strict Invariants & Boundaries
- Default `WaveformLayer` `colorMode` to `'white'` so existing classic/starter presets look unchanged, while `'palette'` and `'gradient'` inject cool cyan/blue on low amplitudes and hot orange/magenta on audio peaks (matching Mockup 01).
- `RingsLayer` must accept `options?: { uLayerOpacity?: number }` and scale its output by `uLayerOpacity` with `alpha = clamp(ringAlpha, 0.0, 1.0) * uLayerOpacity`.
- In `rings.frag.glsl`, expand `orbitTriangles` (`uSeedMode == 1`) from 3 small triangles at `r = 0.4` into a full-viewport 3-tier counter-rotating stained-glass lattice (`r = 0.24` inner star, `r = 0.56` middle sharp chevrons, `r = 0.98` outer crystal rays in neon cyan & pink matching Mockup 02).

### Implementation Steps
1. **`src/presets/layerSchemas.ts`**:
   - Add `colorMode`: `'white' | 'palette' | 'gradient'` (default `'white'`, label `'Ink color mode'`) to `WAVEFORM_SCHEMA`.
2. **`src/render/layers/waveform.ts` & `src/render/shaders/waveform.frag.glsl`**:
   - Pass displacement amplitude / UV coordinate from vertex to fragment shader (`vAmp`, `vUv`) and upload `uColorMode` (`0` = `'white'`, `1` = `'palette'`, `2` = `'gradient'`), `uColorA`, `uColorB`, and `uTime` to `waveform.frag.glsl`.
   - When `uColorMode == 1` (`'palette'`), blend `uColorA` and `uColorB` by audio amplitude + arc position; when `uColorMode == 2` (`'gradient'`), map low amplitudes to electric cyan/cobalt (`vec3(0.08, 0.78, 1.0)`) and high-energy peaks to fiery orange/magenta (`vec3(1.0, 0.32, 0.65)`) with a white-hot core so Curl fluid warp plumes billow with multi-color ink!
3. **`src/render/layers/rings.ts` & `src/render/shaders/rings.frag.glsl`**:
   - Accept `options?: { uLayerOpacity?: number }` in `RingsLayer.draw(frame, clock, options)`, upload `uLayerOpacity` (`options?.uLayerOpacity ?? 1.0`), and remove hardcoded `gl.blendFunc(gl.ONE, gl.ONE)`.
   - In `rings.frag.glsl`, upgrade `orbitTriangles(vec2 p, float time, float kick)` (`uSeedMode == 1`) to draw three concentric counter-rotating geometric tiers (inner star at `r = 0.24`, middle 6-chevron diamond ring at `r = 0.56`, outer 12-ray crystal spikes reaching `r = 0.98`), alternating between `uColorA` (neon cyan) and `uColorB` (neon magenta/pink).
   - Output `fragColor = vec4(col * uLayerOpacity, clamp(alpha, 0.0, 1.0) * uLayerOpacity);`.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.24: Retune Flagship Presets 01–04 (`01-curl-fluid-warp`, `02-kaleidoscopic-mandala`, `03-solarized-contour-rings`, `04-mobius-dual-vortex`) to match Mockups 01–04

### Target Files
- `src/presets/builtin/01-curl-fluid-warp.json`
- `src/presets/builtin/02-kaleidoscopic-mandala.json`
- `src/presets/builtin/03-solarized-contour-rings.json`
- `src/presets/builtin/04-mobius-dual-vortex.json`
- `src/presets/__tests__/presets.test.ts`

### Strict Invariants & Boundaries
- All 4 presets must pass schema validation, loader tests, and WCAG flash safety checks in `src/presets/__tests__/presets.test.ts`.

### Implementation Steps
1. **`src/presets/builtin/01-curl-fluid-warp.json` (Mockup 01 — Curl Fluid Warp):**
   - Set `feedback`: `warpMode: "curl"`, `warp: 0.58`, `warpScale: 2.8`, `warpSpeed: 0.85`, `curlOctaves: 3`, `curlTurbulence: 0.55`, `curlFlowPattern: "plumes"`, `decay: 0.92`, `decayRgb: [0.95, 0.91, 0.96]`, `hueShift: 0.018`.
   - Set `waveform`: `colorMode: "gradient"`, `thickness: 4.5`, `style: "circle"`, and add audio links from `mid` to `feedback.warp` (`amount: 0.35`) and `bass` to `feedback.warpSpeed` (`amount: 0.4`).
2. **`src/presets/builtin/02-kaleidoscopic-mandala.json` (Mockup 02 — Kaleidoscopic Mandala):**
   - Set `feedback`: `warpMode: "polarFold"`, `symmetry: 8`, `mandalaPattern: "auto"`, `radialFold: 0.48`, `mandalaTile: 0.35`, `mandalaCounterSpin: 0.3`, `mandalaKickFlare: 0.4`, `zoom: 1.038` (drives continuous outward radial propagation past all 4 corners of the 16:9 frame!), `rotation: 0.015`, `decay: 0.88`, `decayRgb: [0.92, 0.90, 0.96]`.
   - Set `rings`: `seedMode: "orbitTriangles"`, `count: 6`, `blend: "max"`, `trails: true`; set `waveform`: `style: "star7"`, `colorMode: "palette"`, `trails: false` (crisp core star).
3. **`src/presets/builtin/03-solarized-contour-rings.json` (Mockup 03 — Solarized Contour Rings):**
   - Set `feedback`: `warpMode: "curl"`, `warp: 0.28`, `warpScale: 2.2`, `curlOctaves: 2`, `sobel: 0.22`, `solarize: 0.78`, `contourFreq: 6.5`, `contourWidth: 0.42`, `colorSpread: 0.85`, `zoom: 1.022`, `decay: 0.86`, `decayRgb: [0.90, 0.92, 0.95]`.
   - Set `rings`: `count: 5`, `thickness: 0.032`, `blend: "max"`, `trails: true` so clean concentric ripples advect outward into glowing rainbow topographic isolines over pitch-black space.
4. **`src/presets/builtin/04-mobius-dual-vortex.json` (Mockup 04 — Möbius Dual Vortex):**
   - Set `feedback`: `warpMode: "mobius"`, `warp: 0.55`, `mobiusFlow: 0.9`, `mobiusSwirl: 0.75`, `mobiusPoleOffset: 0.46`, `mobiusWander: 0.60`, `mobiusMode: "auto"`, `decay: 0.90`, `decayRgb: [0.92, 0.91, 0.96]`.
   - Set `rings`: `seedMode: "polarGrid"`, `blend: "max"`, `trails: true`, plus `particles` (`blend: "max"`, `opacity: 0.7`) flowing along the double-spiral dipole streamlines.
5. **`src/presets/__tests__/presets.test.ts`**:
   - Add assertions verifying the updated preset settings and audio links load cleanly.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.25: Overhaul `MoireLayer` (`moire.ts`, `moire.frag.glsl`) with stencil alpha, `contrast`, `edgeSoftness` (`waveShape`), two-tone `colorSpread`, 4 Loom Pattern Styles, and strong bass center-sweep + kick ripples (Preset 07)

### Target Files
- `src/render/layers/moire.ts`
- `src/render/shaders/moire.frag.glsl`
- `src/presets/schema.ts`
- `src/presets/builtin/07-moire-interference-loom.json`
- `src/render/__tests__/generators.test.ts`

### Strict Invariants & Boundaries
- Dark interference troughs MUST emit `alpha = 0` (`fragColor = vec4(col * a, a)` where `a = clamp(moire * uContrast, 0.0, 1.0) * uLayerOpacity`) so `MoireLayer` acts as a see-through optical interference veil over underlying layers instead of overwriting the canvas with opaque black/white.
- Bass (`u_sub`) must visibly sweep the wave centers apart (`0.20 + 0.22 * uAudioWarp * u_sub`) while kicks send a phase ripple wave across the interference grid (`uKickRipple`).

### Implementation Steps
1. **`src/presets/schema.ts`**:
   - Expand `MOIRE_SCHEMA` with:
     - `contrast`: `0.1..1.0`, default `0.60`, step `0.05` (label `'Contrast'`)
     - `waveShape`: `0..1`, default `0.25`, step `0.05` (label `'Edge softness / sharpness'`, `0` = silky cosine glow, `1` = crisp op-art ribbon)
     - `colorSpread`: `0..1`, default `0.80`, step `0.05` (label `'Two-tone color gradient'`)
     - `patternMode`: `['starburstLoom', 'twinCircles', 'doubleSpirals', 'warpedCrossGrid']`, default `'starburstLoom'` (label `'Loom pattern style'`)
     - `audioWarp`: `0..1`, default `0.65`, step `0.05` (label `'Bass center sweep & kick ripple'`)
2. **`src/render/layers/moire.ts` & `src/render/shaders/moire.frag.glsl`**:
   - Accept `options?: { uLayerOpacity?: number }` in `MoireLayer.draw(frame, clock, options)` and upload `uLayerOpacity` (`options?.uLayerOpacity ?? 1.0`), `uColorA`, `uColorB`, `uContrast`, `uWaveShape`, `uColorSpread`, `uPatternMode` (`0..3`), `uAudioWarp`, and `uKickEnv` (`frame.kickEnv`).
   - In `moire.frag.glsl`:
     - Support 4 selectable Loom Pattern Styles (`uPatternMode`):
       - `0` (`starburstLoom`): Dual eccentric wave centers + diamond starburst angular spokes (`sin(theta1 * 8.0) - sin(theta2 * 8.0)`) matching Mockup 07.
       - `1` (`twinCircles`): Pure overlapping concentric circular wave emitters pulled apart by bass.
       - `2` (`doubleSpirals`): Counter-rotating logarithmic spiral gratings (`r1 * freq + theta1 * 6.0` vs `r2 * freq - theta2 * 6.0`).
       - `3` (`warpedCrossGrid`): Hyperbolic curved diagonal line gratings rotating in opposition.
     - Add strong bass center-sweep (`sep = (0.14 + u_sub * 0.24 * uAudioWarp)`) and kick radial ripple modulation (`+ uKickEnv * uAudioWarp * 2.2 * sin(r * 10.0 - uTime * 6.0)`).
     - Shape interference fringes between silky cosine waves (`0.5 + 0.5 * cos(phase)`) and crisp bands via `uWaveShape` and `uContrast`.
     - Color primary fringes with `uColorA` (electric cyan/indigo) and secondary beat fringes with `uColorB` (warm magenta/violet) controlled by `uColorSpread`.
     - Output `float a = clamp(moire * uContrast, 0.0, 1.0) * uLayerOpacity; fragColor = vec4(col * a, a);`.
3. **`src/presets/builtin/07-moire-interference-loom.json` & `src/render/__tests__/generators.test.ts`**:
   - Update Preset 07 to use `blend: "alpha"`, `opacity: 0.88`, `contrast: 0.62`, `waveShape: 0.25`, `colorSpread: 0.82`, `patternMode: "starburstLoom"`, `audioWarp: 0.70`, paired with a subtle background `bassPulse` layer (`trails: true`) so the see-through interference loom shimmers over deep color gradients.
   - Add unit tests in `src/render/__tests__/generators.test.ts` verifying `uLayerOpacity`, `patternMode`, and stencil alpha.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.26: Overhaul `SpectralTerrainLayer` (`spectralTerrain.ts`, `.vert.glsl`, `.frag.glsl`) with `gl.FUNC_ADD` skirt occlusion fix, ribbon `lineThickness`, 3D longitudinal `gridCols`, `ridgeShape`, `layoutMode`, `skirtOpacity`, and cyan-to-magenta gradient (Preset 08)

### Target Files
- `src/render/layers/spectralTerrain.ts`
- `src/render/shaders/spectralTerrain.vert.glsl`
- `src/render/shaders/spectralTerrain.frag.glsl`
- `src/presets/schema.ts`
- `src/presets/builtin/08-spectral-ridge-terrain.json`

### Strict Invariants & Boundaries
- Explicitly call `gl.blendEquation(gl.FUNC_ADD)` inside `SpectralTerrainLayer.draw()` before setting `gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)` for occlusion skirts and `gl.blendFunc(gl.SRC_ALPHA, gl.ONE)` for ridge ribbons so `Scene`'s `'max'` blend mode never breaks foreground-over-background mountain occlusion.
- Uncovered sky above the backmost ridge must remain at `alpha = 0` so background layers (`BassPulse`, `Rings`, `Particles`) shine behind the horizon.

### Implementation Steps
1. **`src/presets/schema.ts`**:
   - Expand `SPECTRAL_TERRAIN_SCHEMA` with:
     - `lineThickness`: `0.5..4.0`, default `1.8`, step `0.1` (label `'Line thickness'`)
     - `ridgeShape`: `['smooth', 'rounded', 'pointed', 'stepped']`, default `'smooth'` (label `'Ridge profile'`)
     - `layoutMode`: `['fullHorizon', 'centerPeak', 'canyon']`, default `'fullHorizon'` (label `'Mountain layout'`, where `'fullHorizon'` spans the full width like Mockup 08, `'centerPeak'` focuses a Joy Division central peak, and `'canyon'` raises twin side walls with a central valley)
     - `gridCols`: `0..32`, default `16`, step `4` (label `'3D front-to-back grid lines'`)
     - `skirtOpacity`: `0..1`, default `0.90`, step `0.05` (label `'Mountain fill opacity'`)
     - `colorSpread`: `0..1`, default `0.85`, step `0.05` (label `'Cyan-to-magenta gradient'`)
     - `invertColors`: boolean, default `false` (label `'Invert colors'`)
     - `terrainFlow`: `0..1`, default `0.35`, step `0.05` (label `'Downhill trail drift'`)
2. **`src/render/layers/spectralTerrain.ts`, `.vert.glsl`, `.frag.glsl`**:
   - Accept `options?: { uLayerOpacity?: number }` in `SpectralTerrainLayer.draw` and upload `uLayerOpacity`, `uColorA`, `uColorB`, `uLineThickness`, `uRidgeShape` (`0..3`), `uLayoutMode` (`0..2`), `uSkirtOpacity`, `uColorSpread`, and `uInvertColors`.
   - Call `gl.blendEquation(gl.FUNC_ADD)` before drawing each ridge's occlusion skirt and glowing line.
   - Render each ridge line as a screen-space quad strip (`gl.TRIANGLE_STRIP`, 2 vertices per frequency bin offset vertically by `uLineThickness * 0.0022 * perspectiveScale`) so `lineThickness` (`0.5..4.0`) works on macOS Metal/WebGL2 where `gl.lineWidth` is clamped to `1.0`.
   - When `gridCols > 0`, also draw `gridCols` front-to-back longitudinal perspective lines connecting the 64 rows so the terrain forms a true 3D wireframe mountain grid matching Mockup 08.
   - In `spectralTerrain.vert.glsl`:
     - Apply horizontal envelope according to `uLayoutMode` (`0` = `'fullHorizon'` wide plateau envelope, `1` = `'centerPeak'` Gaussian bell curve, `2` = `'canyon'` bimodal twin-wall valley).
     - Shape the 5-tap smoothed spectrum using `uRidgeShape` (`0` = `'smooth'`, `1` = `'rounded'` `sqrt`, `2` = `'pointed'` `pow(x, 1.85)`, `3` = `'stepped'` terrace quantization).
   - In `spectralTerrain.frag.glsl`:
     - Color ridge crests with a side-to-side + elevation gradient between `uColorA` (electric cyan on flanks) and `uColorB` (neon magenta/violet on central peaks) controlled by `uColorSpread` (and swapped when `uInvertColors == 1`), while occlusion skirts output dark indigo-black with alpha `uSkirtOpacity * uLayerOpacity`.
3. **`src/presets/builtin/08-spectral-ridge-terrain.json`**:
   - Configure Preset 08 with `lineThickness: 1.9`, `ridgeShape: "smooth"`, `layoutMode: "fullHorizon"`, `gridCols: 16`, `skirtOpacity: 0.90`, `colorSpread: 0.88`, `terrainFlow: 0.40`, `blend: "alpha"`, `trails: true`, paired with a subtle horizon `bassPulse` (`trails: true`) and `particles` (`trails: false`).

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.27: Implement Spectral Terrain Option A (`Scene` downhill feedback trail drift) and Option B (`terrainStore` + `TEXTURE5` 3D heightfield displacement for `ParticleLayer`)

### Target Files
- `src/render/terrainStore.ts`
- `src/render/scene.ts`
- `src/render/layers/particles.ts`
- `src/render/shaders/particles.vert.glsl`
- `src/render/__tests__/generators.test.ts`

### Strict Invariants & Boundaries
- When no `SpectralTerrainLayer` is active in the current scene (or when `terrainDisplace === 0`), `ParticleLayer` must behave identically to before with zero texture-binding conflicts.
- `terrainStore` must hold disposable per-GL-context state (`historyTex: WebGLTexture | null`, `writeRow: number`, `scrollRate: number`, `terrainFlow: number`, `active: boolean`) and reset cleanly at the start of each `Scene.draw()`.

### Implementation Steps
1. **`src/render/terrainStore.ts` [NEW]**:
   - Export `getTerrainState(gl)` / `setTerrainState(gl, state)` / `clearTerrainState(gl)` storing `{ active: boolean, historyTex: WebGLTexture | null, writeRow: number, rows: number, tilt: number, heightScale: number, terrainFlow: number }`.
   - Have `SpectralTerrainLayer.draw()` publish its `historyTex`, `writeRow`, `tilt`, `heightScale`, and `terrainFlow` to `terrainStore` whenever it draws.
2. **Option A — `Scene` Downhill Feedback Trail Drift (`src/render/scene.ts`)**:
   - When `getTerrainState(gl).active` is true and `terrainFlow > 0`, bias the feedback pass (`feedback.frag.glsl` via `uZoom` / perspective drift) so feedback trails glide downhill along the 3D mountain perspective slope in sync with the advancing spectral ridges.
3. **Option B — `TEXTURE5` Companion Layer 3D Heightfield Displacement (`src/render/layers/particles.ts`, `src/render/shaders/particles.vert.glsl`)**:
   - Add `terrainDisplace` (`0..1`, default `0.0`, step `0.05`, label `'Ride spectral terrain'`) to `ParticleLayer`.
   - When `terrainState.active && this.p.terrainDisplace > 0 && terrainState.historyTex`, bind `terrainState.historyTex` to `gl.TEXTURE5` and upload `uTerrainDisplace`, `uTerrainWriteRow`, and `uTerrainTex = 5` to `particles.vert.glsl`.
   - In `particles.vert.glsl`, sample `uTerrainTex` at the particle's normalized `(u, v)` perspective coordinates and lift `center.y += terrainHeight * uTerrainDisplace * 0.42;` so particles physically float and crest over the moving 3D audio mountains!
4. **`src/render/__tests__/generators.test.ts`**:
   - Add unit tests verifying `SpectralTerrainLayer` `gl.FUNC_ADD` blend state, `terrainStore` publication, and `ParticleLayer` `TEXTURE5` terrain displacement binding.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.28: Overhaul `ChladniSandLayer` (`chladniSand.ts`, `.vert.glsl`, `.frag.glsl`) with `plateMode` (`fullscreen` default, `isometricPlate`, `radialMandala`), wired `uScale`, 3-step Newton-Raphson convergence, and 12-eigenmode phrase morphing (Preset 09)

### Target Files
- `src/render/layers/chladniSand.ts`
- `src/render/shaders/chladniSand.vert.glsl`
- `src/render/shaders/chladniSand.frag.glsl`
- `src/presets/schema.ts`
- `src/presets/builtin/09-chladni-cymatic-sand.json`

### Strict Invariants & Boundaries
- Default `plateMode` to `'fullscreen'` so Preset 09 fills the entire 16:9 viewport edge-to-edge without black pillarbox bars (`pos.x` spans `[-1, 1]` while wave evaluation uses aspect-corrected `vec2(x * uAspect, y)`).
- Keep `'isometricPlate'` (tilted 3D diamond resonator plate from Mockup 09) and `'radialMandala'` (circular Bessel-like nodal plate) selectable in Studio.
- Enforce a minimum **6-second phrase cooldown** on automatic `(n, m)` eigenmode changes (`harmonyMode === 'auto'`), morphing smoothly over `2.0s` between curated integer pairs so nodal patterns stay symmetric and legible.

### Implementation Steps
1. **`src/presets/schema.ts`**:
   - Expand `CHLADNI_SAND_SCHEMA` with:
     - `plateMode`: `['fullscreen', 'isometricPlate', 'radialMandala']`, default `'fullscreen'` (label `'Plate geometry'`)
     - `harmonyMode`: `['auto', '1:2', '2:3', '3:4', '3:5', '4:5', '5:7', '6:8']`, default `'auto'` (label `'Harmonic mode (n:m)'`)
     - `nodalSharpness`: `0.2..2.0`, default `1.25`, step `0.05` (label `'Nodal line sharpness'`)
     - `grainWarmth`: `0..1`, default `0.75`, step `0.05` (label `'Amber/cyan color mix'`)
2. **`src/render/layers/chladniSand.ts`**:
   - Wire `this.p.scale` to uniform `uScale` (fixing the previously unwired `scale` parameter!).
   - Accept `options?: { uLayerOpacity?: number }` in `draw()` and upload `uLayerOpacity`, `uPlateMode` (`0..2`), `uModeN1`, `uModeM1`, `uModeN2`, `uModeM2`, `uModeMorph`, `uNodalSharpness`, and `uGrainWarmth`.
   - Maintain phrase-locked eigenmode state (`currentPairIdx`, `nextPairIdx`, `morphProgress`, `phraseCooldownSec` with 6.0s cooldown):
     - Curated integer eigenmode table (`n !== m`): `[[1,2], [2,3], [1,4], [3,4], [2,5], [3,5], [4,5], [3,7], [5,6], [5,7], [4,9], [6,8]]`.
     - When `harmonyMode === 'auto'` and `phraseCooldownSec >= 6.0` and a musical phrase boundary (`frame.sectionContrast > 0.05 || frame.kickPulse > 0.5`) occurs, select a new eigenmode pair and smoothly ramp `morphProgress` `0 -> 1` over `2.0s`.
     - When `harmonyMode !== 'auto'`, lock `(n, m)` to the user-selected ratio.
3. **`src/render/shaders/chladniSand.vert.glsl` & `.frag.glsl`**:
   - Perform **3-step damped Newton-Raphson root-finding** toward the zero-potential nodal lines `f(p) == 0`:
     - In each step, evaluate `f = mix(chladni(p, n1, m1), chladni(p, n2, m2), uModeMorph)` and analytic gradient `grad = vec2(dfdx, dfdy)`.
     - Step `p -= f * grad / (dot(grad, grad) + 0.35) * (0.28 * uNodalSharpness * settleWeight);`.
   - Apply `uScale` and project according to `uPlateMode`:
     - `0` (`fullscreen`): `p` evaluated in `vec2(seed.x * uAspect, seed.y) / uScale`, mapped back to full clip-space `vec2(p.x / uAspect, p.y)`.
     - `1` (`isometricPlate`): 45° rotated diamond plate with 3D perspective foreshortening (`y * 0.68`).
     - `2` (`radialMandala`): polar coordinate standing wave `cos(n * theta) * cos(m * r * PI)`.
   - Pass nodal proximity `vNodeDist = abs(f)` to `chladniSand.frag.glsl` so settled nodal grains glow warm incandescent gold/white (`vec3(1.0, 0.86, 0.45)`) while excited antinode grains shimmer electric cyan/amber (`uGrainWarmth`), scaled by `uLayerOpacity`.
4. **`src/presets/builtin/09-chladni-cymatic-sand.json`**:
   - Configure Preset 09 with `plateMode: "fullscreen"`, `harmonyMode: "auto"`, `nodalSharpness: 1.35`, `grainWarmth: 0.78`, `scale: 1.0`, `decay: 0.90`.

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

---

## Slice 7.29: Overhaul `ParticleLayer` Phyllotaxis Mode (`particles.ts`, `particles.vert.glsl`, `particles.frag.glsl`) with continuous outward seed bloom, integrated one-way spin, full-16:9 corner coverage, kick ripple waves, and `seedShape` selector (`orb | petal | star`, Preset 10)

### Target Files
- `src/render/layers/particles.ts`
- `src/render/shaders/particles.vert.glsl`
- `src/presets/schema.ts`
- `src/presets/builtin/10-phyllotaxis-spiral-bloom.json`
- `src/render/__tests__/chladniPhyllo.test.ts`

### Strict Invariants & Boundaries
- Remove the raw `id * uSubTwist * 0.0015` multiplier in `particles.vert.glsl` that caused outer seeds (`id = 599`) to snap backward and forward by `±258°` on every kick!
- Replace static seed indices `id` with a continuous phase-integrated outward index `uIndex = mod(id + uFlowPhase * 24.0, 600.0)` so seeds continuously birth at the golden center, spiral outward along parastichy arms to all 4 corners of the 16:9 screen (`uFar = hypot(aspect, 1.0) * 1.05`, removing the `min(uFar, 1.25)` clamp), and recycle seamlessly.
- Support selectable seed shapes (`seedShape`: `'orb' | 'petal' | 'star'`).

### Implementation Steps
1. **`src/presets/schema.ts` & `src/render/layers/particles.ts`**:
   - Add Phyllotaxis customization controls to `PARTICLES_SCHEMA` / `ParticleLayer`:
     - `seedShape`: `['orb', 'petal', 'star']`, default `'petal'` (label `'Seed shape'`)
     - `phylloPattern`: `['auto', 'golden137.5', 'lucas99.5', 'fibonacci137.6', 'rosette137.3', 'starburst144']`, default `'auto'` (label `'Spiral divergence'`)
     - `petalStretch`: `0.5..3.0`, default `1.65`, step `0.05` (label `'Petal elongation'`)
   - In `ParticleLayer`:
     - Maintain two monotonic phase accumulators in `draw(frame, clock)`:
       - `this.flowPhase += dt * this.p.flowSpeed * (0.45 + norm.sub * 1.15 + frame.kickEnv * 1.4);` (always moves forward—never reverses!).
       - `this.twistPhase += dt * (0.12 + norm.mid * 0.35 * this.p.subTwist);` (smooth one-way integrated spin).
     - Maintain phrase-locked divergence angle morphing (minimum `7.0s` cooldown in `'auto'` mode, morphing over `2.5s` between `2.3999632` (`137.508°`), `2.4016` (`137.6°`), and `2.3963` (`137.3°`), or locked to the selected `phylloPattern`).
     - Compute `const far = Math.hypot(aspect, 1.0) * 1.05;` and upload `uFar`, `uFlowPhase`, `uTwistPhase`, `uDivergenceAngle`, `uPetalStretch`, and `uSeedShape` (`0` = `'orb'`, `1` = `'petal'`, `2` = `'star'`).
2. **`src/render/shaders/particles.vert.glsl`**:
   - In `uMode == 1` (Phyllotaxis):
     - Compute continuous outward index `float uIdx = mod(id + uFlowPhase * 24.0, 600.0); float normR = sqrt(uIdx / 600.0);`.
     - Compute travelling kick ripple wave `float kickWave = sin(normR * 12.0 - uFlowPhase * 4.0) * uKickEnv;`.
     - Compute full-viewport radius `float r = normR * uFar * (1.0 + 0.08 * kickWave);` (smooth outward shockwave ripple on kicks, zero backward snapping!).
     - Compute angle `float theta = uIdx * uDivergenceAngle + uTwistPhase + 0.06 * sin(normR * 8.0 - uFlowPhase * 2.0);`.
     - Shape and orient each instanced quad according to `uSeedShape`:
       - `0` (`orb`): isotropic glowing circle.
       - `1` (`petal`): radially oriented biological sunflower/pinecone scale stretched along `(cos(theta), sin(theta))` by `uPetalStretch`.
       - `2` (`star`): 4-pointed star flare modulated by `abs(local.x) + abs(local.y)` and `kickWave`.
     - Fade alpha smoothly at birth (`smoothstep(0.0, 0.05, normR)`) and outer edge (`1.0 - smoothstep(0.88, 1.0, normR)`), and map `vMix = clamp(normR * 0.82 + 0.18 * kickWave, 0.0, 1.0)` so the core glows warm golden-amber (`uColorA`) transitioning to electric cyan/emerald (`uColorB`) at the outer petals (matching Mockup 10).
3. **`src/presets/builtin/10-phyllotaxis-spiral-bloom.json` & `src/render/__tests__/chladniPhyllo.test.ts`**:
   - Configure Preset 10 with warm gold `colorA: [1.0, 0.78, 0.22]` and electric cyan `colorB: [0.12, 0.88, 0.96]`, `seedShape: "petal"`, `phylloPattern: "auto"`, `petalStretch: 1.75`, `flowSpeed: 1.1`, `size: 16`, `decay: 0.86`.
   - Update `src/render/__tests__/chladniPhyllo.test.ts` to test `ChladniSandLayer` `plateMode`/`uScale` and `ParticleLayer` continuous phase accumulators (`uFlowPhase`, `uDivergenceAngle`, `seedShape`, full-16:9 `uFar`).

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: Pass with zero errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.

