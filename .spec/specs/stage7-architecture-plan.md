# Architectural Synthesis & Stage 7 Implementation Plan

Status: saved 2026-11-06 at Charlie's request for a later `/implement`. Not built. No slice is `[IN_PROGRESS]`. Slices 7.1–7.7 are not yet in `.spec/PROGRESS.md`.

1. Baseline Reconciliation (main @ 35d9009)
The architectural audit operated on a pre-Stage 6 snapshot. All work must anchor to the live main baseline:   
music_visualizer_architecture_review_council.md

Stage Numbering: Slices 5.1–5.11 and 6.1–6.2 are already occupied. This entire initiative is designated Stage 7 (7.1 through 7.7).

Preset & Layer Inventory: main currently houses 25 presets (3 Classics, 10 Starters, and 12 Texture presets from Slice 6.2) and 8 layers (including bassPulse). The 12 new flagship presets will be added alongside the 3 Classics and 12 Texture presets; the 10 legacy starter-* presets will be moved to an archived/hidden group rather than deleted.   
music_visualizer_architecture_review_council.md

Shared Audio Texture Bridge: Do not create a competing AudioUniformBus texture uploader. Extend the existing src/render/bandTexture.ts (introduced in Slice 6.2) and allocate texture units dynamically rather than hard-coding units 1 and 2, which collide with existing texture-binding layers.

Naming Hygiene: Remove all trademarked or real-person names. Rename Geiss Fluid Warp → 01. Curl Fluid Warp and Anamorphic Joy Terrain → 08. Spectral Ridge Terrain.   
music_visualizer_architecture_review_council.md

2. Resolved Council Decisions (Locked Contracts)

Domain	Locked Engineering Contract	Rationale (Claude + Council Synthesis)

1. FFT & Band Boundaries	
Retain fftSize = 8192, smoothingTimeConstant = 0, and existing sub (20–120 Hz), mid (120 Hz–2.5 kHz), and high (2.5–10 kHz) boundaries. 
music_visualizer_architecture_review_council.md

fftSize = 1024 yields 46.9 Hz bins at 48 kHz, destroying sub-bass resolution. Keeping current band edges preserves backward compatibility across all 25 existing presets. 
music_visualizer_architecture_review_council.md
+ 1

2. Kick Detector (kickEnv)	
Single detector only. Derive kickEnv (0..1) from the existing spectral-flux sub-band onset detector (kickEnv = 1.0 on trigger; frame-rate independent decay kickEnv *= Math.pow(0.88, dt * 60)). 
music_visualizer_architecture_review_council.md

The energy-comparator detector fired 27 false positives in Slice 2.3, whereas spectral flux achieved 20/20 true positives.

3. Spectral Centroid	
Compute over 20 Hz – 12 kHz (f_min = 20, f_max = 12000) excluding DC: clamp(log(f_c / 20) / log(12000 / 20), 0, 1). Freeze at 0.5 when RMS falls below the noise floor. 
music_visualizer_architecture_review_council.md
+ 1

Fixes the math bug where log2(f/60)/log2(8000/60) went out of bounds, and prevents NaN/zero-collapse during silence. 
music_visualizer_architecture_review_council.md

4. GPU Audio Texture	
Extend src/render/bandTexture.ts into a single 512 × 2 R32F texture (NEAREST filtering, 1 texSubImage2D call/frame): Row 0 = 512 anti-aliased downsampled waveform samples ([-1, 1]); Row 1 = 128 log-spaced spectrum bins ([0, 1]) zero-padded to 512. 
music_visualizer_architecture_review_council.md
+ 1

Reuses Slice 6.2 infrastructure while giving shaders deterministic texelFetch access to both time-domain and log-frequency data. 
music_visualizer_architecture_review_council.md

5. Blend State & MAX Default	
Scene exclusively owns GL blend state (layers declare blend mode in config; Scene sets and restores GL state per draw). max remains the default (gl.MAX). Support max, alpha, add, and screen. For add and screen, scale source contribution by uLayerOpacity * (1.0 - feedbackDecay * 0.85). 
music_visualizer_architecture_review_council.md
+ 1

scene.ts documents that unattenuated gl.ONE additive blending blows out the feedback buffer to solid white within 1 second. Energy-attenuated add/screen prevents runaway blowout.

6. Feedback Geometry & Format	
Keep the fullscreen per-pixel triangle and standard RGBA8 FBO as the global default. Do not switch global feedback to RGBA16F. 
music_visualizer_architecture_review_council.md
+ 1

Global half-float buffers double memory, prevent faint trails from rounding to zero, and alter all 25 existing presets.

7. Seeded Morph Transition	
Keep dual-scene architecture. On morph transition start: copy Outgoing Scene's read FBO into Incoming Scene's initial FBO, freeze Outgoing Scene layer evaluation, run Incoming Scene's warp + layers over the inherited pixels, and crossfade outputs over transitionDuration. 
music_visualizer_architecture_review_council.md
+ 1

Avoids blending incompatible boolean/enum uWarpMode switches and halves GPU cost during transitions while still warping outgoing trails into the new preset. 
music_visualizer_architecture_review_council.md

8. Stateful Sim Isolation	
Cut Reaction-Diffusion (12) from Phase A/B and isolate it in an optional Phase C (Slice 7.7) with its own dedicated 256 × 256 ping-pong simulation FBO (RGBA16F with RGBA8 dual-byte fallback) and fixed-timestep accumulator. 
music_visualizer_architecture_review_council.md

Running Gray-Scott inside the color trail FBO fails because zoom, rotation, hue-shift, and alpha = 1 scrambling destroy chemical U/V concentrations every frame.

9. Lissajous & Chladni Scope	
Lissajous (06): Projected 3D parametric knot (sin(at + δ), sin(bt), cos(ct)) displaced along normal by bandTexture Row 0. Chladni (09): Analytic 2D gradient evaluation in the vertex shader (8,192 instanced points sliding toward nodal lines with kick jitter)—no GPU transform-feedback state in v1. 
music_visualizer_architecture_review_council.md
+ 1

Eliminates ambiguity and avoids WebGL2 transform-feedback context/state overhead. 
music_visualizer_architecture_review_council.md

3. Phased Stage 7 Slice Roadmap

Every slice below accounts for the full vertical stack (schema.ts, loader.ts, Studio UI bindings, shaders, unit tests, and fixture updates) and is scoped to keep diffs atomic and verifiable.

Phase A: Core Engine, Audio Extensions, Feedback Warps & Presets 01–06

Slice 7.1 — AudioFrame Extensions & bandTexture Upgrade
Scope: Add centroid (20–12000 Hz log-normalized, noise-floor freeze at 0.5) and kickEnv (spectral-flux triggered, time-based exponential decay) to AudioFrame. Upgrade src/render/bandTexture.ts to pack the 512 × 2 R32F texture (Row 0: 512 downsampled waveform samples; Row 1: 128 log-spectrum bins). Update all AudioFrame test fixtures and AUDIO_SOURCES schema/Studio links.   
music_visualizer_architecture_review_council.md
+ 2
Files (~7): src/audio/types.ts, src/audio/frameBuilder.ts, src/render/bandTexture.ts, src/presets/schema.ts, src/studio/studio.ts, plus test fixtures and unit tests.

Slice 7.2 — Scene Blend State Ownership & Layer Opacity
Scope: Consolidate GL blend state management inside Scene.ts. Keep max as the default blend mode for backward compatibility. Wire uLayerOpacity and blend (max, alpha, add, screen) across all 8 existing layer shaders, applying feedback-safe energy attenuation to add and screen.   
music_visualizer_architecture_review_council.md
+ 1
Files (~10): src/render/scene.ts, src/presets/schema.ts, src/render/layers/*.ts (8 layers), src/render/__tests__/sceneBlend.test.ts.

Slice 7.3 — Advanced Per-Pixel Feedback Warps & Contour Post-FX
Scope: Extend the fullscreen feedback fragment shader with opt-in warpMode branches (classic, curl, polarFold, mobius with ϵ=10 
−4
  denominator guard, and rgbSplit chromatic zoom). Add optional Sobel edgeContour + sine solarize curve (0.5 + 0.5 * sin(...)). Expose parameters in preset schema and Tweakpane Studio.   
music_visualizer_architecture_review_council.md
+ 2
Files (~7): src/render/shaders/feedback.frag.ts, src/render/scene.ts, src/presets/schema.ts, src/presets/loader.ts, src/studio/studio.ts, src/render/__tests__/feedbackWarp.test.ts.

Slice 7.4 — Waveform XY/Knot Extension, Seeded Morph & Presets 01–06
Scope: Extend WaveformLayer with lissajousKnot parametric mode and CRT scanline vignette option. Implement the morph transition mode in Compositor.ts (seed incoming FBO from outgoing FBO, freeze outgoing scene layers, crossfade) plus beat-quantized auto-cycling (dwell timer + kickEnv trigger + 2s fallback timeout). Author Presets 01 (Curl Fluid Warp), 02 (Kaleidoscopic Mandala), 03 (Solarized Contour Rings), 04 (Möbius Dual Vortex), 05 (RGB Aberration Vortex), and 06 (Lissajous Vector CRT). Add dynamic frame-to-frame luminance delta tests in safety.test.ts for 03 (solarize inversions) and 05.   
music_visualizer_architecture_review_council.md
+ 3
Files (~9): src/render/layers/waveform.ts, src/render/compositor.ts, src/presets/autoCycler.ts, src/presets/builtIn/*.ts, src/render/__tests__/safety.test.ts.

Phase B: Procedural Generator Layers & Presets 07–11

Slice 7.5 — Optical & Terrain Generators (MoireLayer, SpectralTerrainLayer) + Presets 07–08
Scope: Build MoireLayer (derivative anti-aliased fwidth() dual-grid interference with spatial frequency and velocity caps for photosensitivity safety) and SpectralTerrainLayer (128 × 64 ring-buffer history texture fed by bandTexture Row 1, 64 perspective triangle-strip ridges with black hidden-line occlusion skirts). Register in schema, loader, and Studio. Author Presets 07 (Moiré Interference Loom) and 08 (Spectral Ridge Terrain) with dedicated WCAG flash-rate tests.   
music_visualizer_architecture_review_council.md
+ 2
Files (~9): src/render/layers/moire.ts, src/render/layers/spectralTerrain.ts, src/presets/schema.ts, src/presets/loader.ts, src/studio/studio.ts, src/presets/builtIn/*.ts, tests.

Slice 7.6 — Physics & Material Generators (ChladniLayer, PhyllotaxisLayer, FerrofluidLayer) + Presets 09–11
Scope: Build ChladniLayer (8,192 instanced points using analytic Chladni gradient attraction + kickEnv scatter), PhyllotaxisLayer (600 golden-angle instanced quads), and FerrofluidLayer (subdivided icosahedron displaced via 3D Simplex noise + MatCap studio normal gradient—avoiding expensive fullscreen raymarching to guarantee frame budget). Archive the 10 legacy starter-* presets outside the primary selector.   
music_visualizer_architecture_review_council.md
+ 1
Files (~10): src/render/layers/chladni.ts, src/render/layers/phyllotaxis.ts, src/render/layers/ferrofluid.ts, src/presets/schema.ts, src/presets/loader.ts, src/studio/studio.ts, src/presets/index.ts, tests.

Phase C: Isolated Stateful Simulation (Optional / Decoupled)

Slice 7.7 — Dedicated Gray-Scott Simulation Buffer & Preset 12 (Reaction-Diffusion Coral)
Scope: Create ReactionDiffusionLayer owning an isolated 256 × 256 ping-pong state target (with fixed-timestep dt accumulator capped at 6 substeps/frame and EXT_color_buffer_float detection with RGBA8 fallback). Colorize chemical V gradients via dFdx/dFdy normal mapping into the standard scene pass without polluting the scene trail FBO.   
music_visualizer_architecture_review_council.md
+ 1

4. Ready-to-Run Dispatch: Slice 7.1
Here is the @claude-dispatch payload for Slice 7.1 to kick off Phase A cleanly against main (35d9009):
Markdown

Implement Slice 7.1: Extend AudioFrame with Spectral Centroid and Kick Envelope, and upgrade bandTexture to a unified 512x2 Audio Data Bridge.

### Target Files
- `src/audio/types.ts`
- `src/audio/frameBuilder.ts`
- `src/render/bandTexture.ts`
- `src/presets/schema.ts`
- `src/studio/studio.ts`
- `src/audio/__tests__/frameBuilder.test.ts`
- `src/render/__tests__/bandTexture.test.ts`

### Strict Invariants & Boundaries
- Keep `fftSize = 8192`, `smoothingTimeConstant = 0`, and existing `sub` (20–120Hz), `mid` (120Hz–2.5kHz), and `high` (2.5–10kHz) band boundaries unchanged.
- Do NOT add a second energy-comparator beat detector; derive `kickEnv` strictly from the existing spectral-flux sub-band onset event.
- Do NOT hardcode reserved texture units 1 or 2; preserve dynamic texture unit binding compatibility with Slice 6.2 texture layers.

### Implementation Steps
1. **`src/audio/types.ts`**: Add `centroid: number` and `kickEnv: number` (both normalized `0..1`) to `AudioFrame`. Update all test mocks/fixtures constructing `AudioFrame` across the test suite so existing tests compile cleanly.
2. **`src/audio/frameBuilder.ts`**:
   - Compute magnitude-weighted spectral centroid `f_c` across bins within `20 Hz – 12,000 Hz` (excluding DC, derived dynamically from `sampleRate` and `fftSize`).
   - Normalize via `clamp(Math.log(f_c / 20) / Math.log(12000 / 20), 0, 1)` and apply 60ms attack / 200ms release smoothing. When energy is below the noise floor (silence), freeze `centroid` at `0.5`.
   - Compute `kickEnv`: set to `1.0` when the existing sub-band onset detector fires; decay frame-rate independently each frame via `kickEnv *= Math.pow(0.88, dtSeconds * 60)`.
3. **`src/render/bandTexture.ts`**: Extend the existing Slice 6.2 helper to maintain a persistent `512 x 2` `R32F` texture (`gl.NEAREST`, pre-allocated `Float32Array(1024)` staging buffer, single `texSubImage2D` upload per frame):
   - Row 0 (`y = 0`): 512 uniformly downsampled (box-averaged) waveform samples in `[-1, 1]`.
   - Row 1 (`y = 1`): 128 log-spaced spectrum buckets (`20 Hz – 12 kHz`) normalized in `[0, 1]`, zero-padded from index 128 to 511.
   - Maintain backward-compatible accessors or shader helpers so existing Slice 6.2 layers continue functioning without regression.
4. **`src/presets/schema.ts` & `src/studio/studio.ts`**: Register `centroid` and `kickEnv` as valid scalar `AUDIO_SOURCES` for parameter linking.
5. **Tests**: Add unit tests in `frameBuilder.test.ts` (verifying `centroid` bounds at 20Hz/12kHz, `0.5` silence freeze, and frame-rate independent `kickEnv` decay) and `bandTexture.test.ts` (verifying `512x2` staging buffer layout and single-upload lifecycle).

### Verification
- Run: `npx vitest run --silent` and `npx tsc --noEmit`
- Expected: All existing and new tests pass with zero type errors.

### Communication Rule
Output ONLY a 1-line receipt upon completion. Do not reprint unchanged code or provide conversational explanations.
