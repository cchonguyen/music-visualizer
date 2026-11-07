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
