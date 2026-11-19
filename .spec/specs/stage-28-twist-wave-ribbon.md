# Stage 28: Organic Twisting Center Waveform (`twistWave`) & Preset Specification

> **Atlas Coordinate: `[498]`**  
> **Sector:** Sector 400 — System Spec & Architecture  
> **Status:** Final Spec (Decided 2026-11-19, Branch `stage-28-spec` from `8729b04`)  
> **Related Coordinates:** `[400]`, `[410]`, `[485]`, `[486]`

---

## 1. Executive Summary & Core Objectives

Stage 28 introduces an organic, 3D-twisting centered oscilloscope ribbon geometry (`baseShape: 'twistWave'`) on the unified `ShapeLayer` (`[485]`) and ships a dual-layer showcase flagship preset (**Twisting Scope Wave**, ID `32-twisting-scope-wave`) that couples smooth 1024-sample tail-window oscilloscope tracking with helical quadrature displacement, curl trails, radial/swirl warp operators, and bloom post-processing:

1. **Organic Twisting Center Waveform `baseShape: 'twistWave'` (Slice 28.1):**
   - Extend `ShapeBaseType`, `ShapeParams`, `SHAPE_DEFAULTS`, and `SHAPE_SPECS` (`src/presets/layerSchemas.ts`) with `'twistWave'` at index `9` of `baseShape.options` (after `'knot3d'`) and two untiered (advanced) `'Base'` controls (`twistSpeed`, `twistChaos`), while keeping `LAYER_SPECS.shape` at **8** `'basic'` controls and `normalMode.showWhen` untouched.
   - Extend `ShapeLayer` (`src/render/layers/shape.ts`) with `twistWave: 9` in `BASE_SHAPE_MAP`, `uTwistA`/`uTwistB`/`uTwistChaos` uniform bindings, `twistWave` extent `{ halfX: 1.15 * effSize, halfY: 1.15 * effSize }` in `computeShapeBounceExtents`, persistent `twistPhaseA` (`[0.7, 1.9, 3.1, 4.7]`) & `twistPhaseB` (`[0.3, 1.4, 2.6, 0.9]`) exposed via `getTwistState()` (reset in `init()`, preserved across `setParams()`), `clampDt(clock.dtSec)` integration with incommensurate rates + sinusoidal wander/reversals + audio band modulation (`norm.sub`, `norm.mid`, `norm.high`, `energy`) + subtle kick impulse, and smooth contiguous recent `1024`-sample tail-window sampling when `baseShape === 'twistWave' && audioSource === 'scope' && wf.length > 1024`.
   - Extend `src/render/shaders/shape.vert.glsl` without altering `knot3d` (`uBaseShape == 8`) or existing shader test hooks: add `uniform vec4 uTwistA;`, `uniform vec4 uTwistB;`, `uniform float uTwistChaos;`, explicit `} else if (uBaseShape == 9) {` before `} else {` (`figure8`), `vec3 twistWave3D(float u, float effSize)`, 3D helical torsion frame `(T3, N3, B3)` and quadrature oscilloscope displacement (`w1` along `N3`, `0.65 * w2` along `B3`) prior to perspective projection (`depth = 2.4 - p3.z * 0.55`), true displaced screen-space tangent finite difference for `twistWave` ribbons, and 3D depth-cued `halfWidth` & `vAlpha`.
2. **Built-in "Twisting Scope Wave" Preset (Slice 28.2):**
   - Add `src/presets/builtin/32-twisting-scope-wave.json` (`id: '32-twisting-scope-wave'`, `name: 'Twisting Scope Wave'`, `group: 'flagship'`, `subfolder: 'showcase'`, `theme: 'waveform'`, `mood: 'dreamy'`, `tags: ["built-in", "flagship", "waveform", "oscilloscope"]`) featuring dual `twistWave` layers (main `frequencyGradient` `waveform` ribbon + accent `dots` layer), curl trails with `warpReactivity: 0.30`, `radial` (`exponent: 1.5`) + `swirl` warp operators, a `beat` `kick` zoom reaction, and bloom post.
   - Register `SHOWCASE_PRESETS_32` in `src/presets/builtin/index.ts` (`SYSTEM_PRESET_CATEGORIES`, `ALL_PRESETS`, `PRESET_TAXONOMY`) and update `src/presets/__tests__/presetTaxonomy.test.ts` (`EXPECTED_SHOWCASE_IDS` length `20`, `ALL_PRESETS.length` `37`, Stage 18 warp-stack exempt list, and `baseShape === 'twistWave'` assertions).

---

## 2. Detailed Technical Contracts

### 2.1 Slice 28.1: Organic Twisting Center Waveform (`twistWave`)

#### A. Schema Contract (`src/presets/layerSchemas.ts` & `src/presets/layerSchemas.test.ts`)

1. **`ShapeBaseType` Addition:**
   ```ts
   export type ShapeBaseType =
     | 'centerLine'
     | 'edgeLine'
     | 'circle'
     | 'arc'
     | 'polygon'
     | 'star'
     | 'spiral'
     | 'figure8'
     | 'knot3d'
     | 'twistWave';
   ```
2. **`ShapeParams` & `SHAPE_DEFAULTS` Additions:**
   - Add to `ShapeParams` (Category 1 — Base Geometry `"Base"`):
     ```ts
     twistSpeed: number; // 0.0..3.0 (organic twist & morph speed; 0 holds still)
     twistChaos: number; // 0.0..1.0 (smooth flowing ribbons to wild 3D knots)
     ```
   - Add to `SHAPE_DEFAULTS`:
     ```ts
     twistSpeed: 1.0,
     twistChaos: 0.65,
     ```
3. **`SHAPE_SPECS` Updates:**
   - Update `baseShape` spec `options` to insert `'twistWave'` at **index `9`** (immediately after `'knot3d'`):
     `options: ['centerLine', 'edgeLine', 'circle', 'arc', 'polygon', 'star', 'spiral', 'figure8', 'knot3d', 'twistWave']`
   - Keep `normalMode.showWhen` **untouched**:
     `showWhen: { baseShape: ['polygon', 'star', 'spiral', 'figure8', 'knot3d', 'arc'] }`
   - Append two untiered (advanced) specs at the very end of the `'Base'` group (immediately after `bounceFlipSpin`):
     - `{ type: 'float', name: 'twistSpeed', label: 'Twist speed', group: 'Base', default: SHAPE_DEFAULTS.twistSpeed, min: 0.0, max: 3.0, step: 0.05, showWhen: { baseShape: 'twistWave' }, description: 'Controls how fast the centered waveform spine twists, curls, and morphs organically over time.' }`
     - `{ type: 'float', name: 'twistChaos', label: 'Twist complexity', group: 'Base', default: SHAPE_DEFAULTS.twistChaos, min: 0.0, max: 1.0, step: 0.05, showWhen: { baseShape: 'twistWave' }, description: 'Blends between smooth flowing ribbons (0) and wild multi-harmonic 3D knots and folds (1).' }`
4. **Schema & Test Invariants (`src/presets/layerSchemas.test.ts`):**
   - `LAYER_SPECS.shape` retains exact **8** `'basic'` controls (`['baseShape', 'size', 'rotation', 'effectType', 'thickness', 'colorMode', 'solidColor', 'glow']`). Both `twistSpeed` and `twistChaos` stay untiered (`advanced`).
   - Update `SHAPE_SPECS.length` assertion from `49` to `51`.
   - Append `'twistSpeed', 'twistChaos'` to the expected `'Base'` group name list.
   - Assert `'twistWave'` sits at index `9` of `baseShape.options`, `normalMode.showWhen` remains `['polygon', 'star', 'spiral', 'figure8', 'knot3d', 'arc']`, and `twistSpeed` / `twistChaos` match exact ranges, defaults, `showWhen: { baseShape: 'twistWave' }`, non-empty `description`, and `tierOf(...) === 'advanced'`.

#### B. TypeScript Layer & Audio Sampling Contract (`src/render/layers/shape.ts` & `src/render/__tests__/shapeLayer.test.ts`)

1. **`BASE_SHAPE_MAP` & Uniform Bindings:**
   - Add `twistWave: 9` to `BASE_SHAPE_MAP`.
   - Add private uniform location fields `uTwistA`, `uTwistB`, `uTwistChaos` (`WebGLUniformLocation | null = null`) and look up `'uTwistA'`, `'uTwistB'`, `'uTwistChaos'` in `init(gl)`.
2. **Wall-Bounce Extents (`computeShapeBounceExtents`):**
   - Add explicit `case 'twistWave':` before `default:`:
     ```ts
     case 'twistWave':
       return { halfX: s * 1.15, halfY: s * 1.15 };
     ```
     (where `s = Math.max(0, Number.isFinite(effSize) ? effSize : 0)`, so `halfX = effSize * 1.15`, `halfY = effSize * 1.15`).
3. **Persistent Twist State (`twistPhaseA`, `twistPhaseB`, `getTwistState()`):**
   - Define exported interface and initial constants:
     ```ts
     export interface ShapeTwistState {
       phaseA: [number, number, number, number];
       phaseB: [number, number, number, number];
     }
     ```
     Initial tuples:
     - `TWIST_INIT_A: readonly [number, number, number, number] = [0.7, 1.9, 3.1, 4.7]`
     - `TWIST_INIT_B: readonly [number, number, number, number] = [0.3, 1.4, 2.6, 0.9]`
   - Store `private readonly twistPhaseA: [number, number, number, number] = [...TWIST_INIT_A]` and `private readonly twistPhaseB: [number, number, number, number] = [...TWIST_INIT_B]`.
   - **Lifecycle guarantees:**
     - `init(gl)` resets `twistPhaseA` to `[0.7, 1.9, 3.1, 4.7]` and `twistPhaseB` to `[0.3, 1.4, 2.6, 0.9]`.
     - `setParams(params)` preserves `twistPhaseA` and `twistPhaseB` (no reset on live Studio tweaks, audio links, or morph frames).
     - `getTwistState(): ShapeTwistState` returns defensive tuple copies `{ phaseA: [...this.twistPhaseA], phaseB: [...this.twistPhaseB] }`.
4. **Twist Phase Advancement & Uniform Upload (`draw()`):**
   - Advance ONLY when `this.p.baseShape === 'twistWave'` and `speed > 0 && bounceDt > 0`, where `speed = Math.max(0, Number.isFinite(this.p.twistSpeed) ? this.p.twistSpeed : 0)` and `bounceDt = clampDt(clock.dtSec)`:
     - Use incommensurate base rates across the 8 channels (`0.43, 0.61, 0.79, 0.37` for `A`; `0.53, 0.71, 0.89, 0.41` for `B`) with cross-coupled sinusoidal wander/reversals (e.g., `Math.sin` / `Math.cos` modulation whose swing exceeds small biases on wandering axes so velocities smoothly drift forward and reverse organically rather than spinning at constant velocity).
     - Modulate advance rates with audio bands (`frame.norm.sub`, `frame.norm.mid`, `frame.norm.high`, `frame.energy`) and add a subtle kick impulse scaled by `speed` (`(frame.kickPulse ? 0.08 : 0) + kickEnv * 0.35 * bounceDt`).
     - When `twistSpeed <= 0` or `baseShape !== 'twistWave'`, `twistPhaseA` and `twistPhaseB` do not change.
   - Upload every frame:
     ```ts
     const twistChaos = Math.max(0, Math.min(1, Number.isFinite(this.p.twistChaos) ? this.p.twistChaos : 0.65));
     gl.uniform4f(this.uTwistA, this.twistPhaseA[0], this.twistPhaseA[1], this.twistPhaseA[2], this.twistPhaseA[3]);
     gl.uniform4f(this.uTwistB, this.twistPhaseB[0], this.twistPhaseB[1], this.twistPhaseB[2], this.twistPhaseB[3]);
     gl.uniform1f(this.uTwistChaos, twistChaos);
     ```
5. **Contiguous Tail-Window Scope Sampling (`audioSource === 'scope'`):**
   - When `this.p.baseShape === 'twistWave' && this.p.audioSource === 'scope' && wf.length > 1024`:
     - Read ONLY the contiguous recent `1024`-sample tail window `[start .. wf.length - 1]` (`windowLen = 1024`, `start = wf.length - windowLen`) and linearly interpolate each bin `i` in `0 .. sampleCount - 1`:
       ```ts
       const windowLen = 1024;
       const start = wf.length - windowLen;
       for (let i = 0; i < sampleCount; i++) {
         const t = sampleCount > 1 ? i / (sampleCount - 1) : 0;
         const pos = start + t * (windowLen - 1);
         const idx0 = Math.floor(pos);
         const idx1 = Math.min(wf.length - 1, idx0 + 1);
         const frac = pos - idx0;
         rawBins[i] = (wf[idx0] ?? 0) * (1 - frac) + (wf[idx1] ?? 0) * frac;
       }
       ```
     - Eliminates `8192`-sample `bucketExtreme` sign-flip aliasing at runtime while keeping real-time waveform continuity (~21 ms at 48 kHz).
   - When `wf.length <= 1024` OR `this.p.baseShape !== 'twistWave'`:
     - Preserve the existing `const step = wf.length / sampleCount; for (let i = 0; i < sampleCount; i++) rawBins[i] = bucketExtreme(wf, i, step);` loop **verbatim** so all non-`twistWave` and `1024`-sample unit tests behave identically.
6. **Unit Tests (`src/render/__tests__/shapeLayer.test.ts`):**
   - Add `uniform4f` mock handler to `createMockGl()` recording `[x, y, z, w]` into `uniformValues`.
   - Include `'twistWave'` in the `Base Geometries` test array (`geometries`).
   - Add a `describe('Organic twistWave baseShape (Stage 28.1)', ...)` block verifying:
     - `uBaseShape == 9`, `uTwistA`, `uTwistB`, `uTwistChaos` uploads.
     - `getTwistState()` initial tuple values (`[0.7, 1.9, 3.1, 4.7]` & `[0.3, 1.4, 2.6, 0.9]`), advancement over frames, audio modulation & kick impulse response, freeze when `twistSpeed === 0` or `baseShape !== 'twistWave'`, `init()` reset, `setParams()` preservation, and `clampDt` protection against large `dtSec`.
     - `computeShapeBounceExtents({ baseShape: 'twistWave' }, size, rot, aspect)` returns `{ halfX: size * 1.15, halfY: size * 1.15 }`.
     - `8192`-sample `scope` tail-window smooth interpolation for `twistWave` (ignores pre-tail spikes, smooth across ramp/sine) while preserving `wf.length === 1024` and non-`twistWave` `bucketExtreme` behavior.
     - Shader source assertions on `vertSrc`: `uniform vec4 uTwistA;`, `uniform vec4 uTwistB;`, `uniform float uTwistChaos;`, `} else if (uBaseShape == 9) {`, `vec3 twistWave3D(float u, float effSize)`, `2.4 - p3.z * 0.55`, and preservation of `knot3d` (`uBaseShape == 8`) and existing `vAlpha = instAlpha * brightMul;` hook.

#### C. Vertex Shader Contract (`src/render/shaders/shape.vert.glsl`)

1. **Preservation Invariants (tested by existing `shapeLayer.test.ts` assertions):**
   - Keep `knot3d` (`uBaseShape == 8`), `uniform vec3 uKnot;`, `knotRot(...)`, and `vec2 knotPoint(float u, float effSize)` **untouched**.
   - Keep `abs(uTravel) > 0.00001`, `if (uTexGain > 0.0) {`, `audioAmp *= heightMul;`, `vAudioAmp = abs(audioAmp);`, and `vAlpha = instAlpha * brightMul;` verbatim in `shape.vert.glsl`.
   - For all `uBaseShape` values `0..8`, vertex shader output must remain unchanged.
2. **Uniforms & Spine Function:**
   - Update `uBaseShape` comment to include `9: twistWave`.
   - Declare `uniform vec4 uTwistA;`, `uniform vec4 uTwistB;`, `uniform float uTwistChaos;`.
   - Implement `vec3 twistWave3D(float u, float effSize)`:
     - Blends via `chaos = clamp(uTwistChaos, 0.0, 1.0)` between a smooth flowing centered 3D ribbon spine (`smoothSpine` across `s = 2.0 * u - 1.0`) and a multi-harmonic 3D knot/fold spine (`knotSpine` driven by `uTwistA`, `uTwistB`, `2.0 * t`, `3.0 * t`, `5.0 * PI * u`).
     - Applies organic 3D tumble pitch/yaw via existing `knotRot` helper (low-amplitude gentle sway at `chaos = 0`, wider 3D knot tumbling at `chaos = 1`).
     - Scales XY by `effSize * 2.15` and Z by `clamp(effSize, 0.35, 1.35)` so projected points stay within `±1.15 * effSize` and perspective depth stays strictly positive across the full `[0.1, 2.0]` `size` range.
3. **Explicit `uBaseShape == 9` Branch & 3D Quadrature Frame:**
   - Place `} else if (uBaseShape == 9) {` **explicitly BEFORE** `} else { // figure8 }` inside `evaluateBaseCurve`.
   - Helper `void twistWaveFrame(float uPos, float effSize, out vec3 c0, out vec3 T3, out vec3 N3, out vec3 B3)`:
     - Evaluates `c0 = twistWave3D(uPos, effSize)` and finite-difference tangent `dc = twistWave3D(uPos + 0.002, effSize) - twistWave3D(uPos - 0.002, effSize)` normalized safely (`(lenDc > 1e-5) ? dc / lenDc : vec3(1.0, 0.0, 0.0)`).
     - Builds singularity-safe orthogonal basis `(nBase, bBase)` around `T3` and rotates by helical torsion angle `twistAngle = uTwistA.w * 0.9 + uTwistB.x * 0.6 + (2.5 + 5.5 * chaos) * PI * uPos + 0.8 * sin(TAU * uPos + uTwistB.z)` to yield orthonormal `(N3, B3)`.
   - Shared symmetry/travel mapper `float mapSymmetryU(float uPos)` (preserving `abs(uTravel) > 0.00001` in `main()`):
     - Computes primary audio coordinate `uAudio = mapSymmetryU(uPos)` and seam-free quadrature coordinate `float qRaw = uAudio + 0.0625; float uQuad = (qRaw <= 1.0) ? qRaw : (2.0 - qRaw);`.
     - Samples `w1` at `uAudio` and `w2` at `uQuad` (honoring `delayScale`, `uTexGain` / `uTexMid` height modulation, `uPeakCaps`, `uEffectType == 0` zeroing, `uEffectType == 3` harmonic wave, and `uExtrudeDir` sign).
   - Evaluates 3D displaced position before projection:
     `vec3 p3 = c0 + w1 * N3 + (0.65 * w2) * B3;`
     `float depth = max(0.45, 2.4 - p3.z * 0.55);`
     `vec2 p2 = p3.xy / depth;`
4. **Displaced Screen-Space Finite-Difference Tangents & Depth Cueing (`main()`):**
   - When `uBaseShape == 9`:
     - Compute `du = 0.5 / float(max(16, uSampleCount))`, `uMinus = max(0.0, u - du)`, `uPlus = min(1.0, u + du)`, and evaluate displaced projected points `pMinus` and `pPlus` using the same 3D quadrature + projection helper.
     - Derive true screen-space tangent `Tscreen = normalizeSafe(pPlus - pMinus, T0)` and ribbon normal `ribNorm = vec2(-Tscreen.y, Tscreen.x)`.
     - Apply 3D depth cueing from `depthMain`:
       - `float depthCue = clamp(2.4 / depthMain, 0.55, 1.65);`
       - `float twistDepthAlpha = clamp(2.4 / depthMain, 0.45, 1.15);`
     - Handle all ribbon (`uIsRibbon == 1`: `solidLine`, `pulsingLine`, `waveform`, `harmonicWave`, `auroraFill`) and discrete (`uIsRibbon == 0`: `dots`, `bars`, `segmentedBars`) geometry outputs cleanly:
       - Ribbons (`uEffectType != 7`): `halfWidth = 0.003 * uThickness * depthCue; P = pMain + side * halfWidth * ribNorm;`.
       - `auroraFill` (`uEffectType == 7`): interpolate `mix(pBase, pMain, (side + 1.0) * 0.5)`.
       - `dots` (`uEffectType == 6`): `dotRadius = 0.008 * uThickness * depthCue; P = pMain + qCorner.x * Tscreen * dotRadius + qCorner.y * ribNorm * dotRadius;`.
       - `bars`/`segmentedBars` (`4`, `5`): quad corners between `pBase` and `pMain` with `barWidth` scaled by `depthCue`.
     - After `vAlpha = instAlpha * brightMul;`, apply `if (uBaseShape == 9) { vAlpha *= twistDepthAlpha; }`.

---

### 2.2 Slice 28.2: Built-in "Twisting Scope Wave" Preset (`32-twisting-scope-wave`)

1. **Preset JSON (`src/presets/builtin/32-twisting-scope-wave.json`):**
   - `"version"`: `1`
   - `"name"`: `"Twisting Scope Wave"` (zero forbidden reference words)
   - `"tags"`: `["built-in", "flagship", "waveform", "oscilloscope"]`
   - `"theme"`: `"waveform"`, `"mood"`: `"dreamy"`
   - `"transition"`: `{ "style": "crossfade", "seconds": 0.4 }`
   - `"feedback"`:
     - `"decay"`: `0.93`, `"zoom"`: `1.015`, `"rotate"`: `0.005`
     - `"warpMode"`: `"curl"`, `"warp"`: `0.16`, `"warpScale"`: `2.0`, `"warpSpeed"`: `0.55`
     - `"warpAudioSource"`: `"kick"`, `"warpReactivity"`: `0.30`, `"warpAttackMs"`: `15`, `"warpReleaseMs"`: `240`
     - `"curlOctaves"`: `2`, `"curlTurbulence"`: `0.4`, `"curlFlowPattern"`: `"eddies"`
     - `"hueDrift"`: `0.012`, `"decayRgb"`: `[0.93, 0.94, 0.98]`
   - `"warp"`:
     - `{ "type": "radial", "params": { "amount": 0.08, "scale": 1.0, "speed": 0.0, "exponent": 1.5 } }`
     - `{ "type": "swirl", "params": { "amount": 0.14, "scale": 1.0, "speed": 0.18 } }`
   - `"reactions"`:
     - `[{ "trigger": { "type": "beat" }, "response": "kick", "target": { "group": "feedback", "name": "zoom" }, "amount": 0.05, "ease": 0.35 }]`
   - `"layers"` (dual `twistWave` layers):
     - Layer 0 (main `frequencyGradient` ribbon): `type: "shape"`, `enabled: true`, `opacity: 1.0`, `blend: "add"`, `trails: true`, `params`: `baseShape: "twistWave"`, `size: 0.62`, `posX: 0.0`, `posY: 0.0`, `rotation: 0`, `spinSpeed: 0.0`, `basePulse: 0.18`, `twistSpeed: 1.05`, `twistChaos: 0.65`, `effectType: "waveform"`, `audioSource: "scope"`, `symmetry: "wrap"`, `extrudeDirection: "outward"`, `sampleCount: 384`, `effectLength: 0.45`, `reactivity: 2.0`, `attackMs: 6`, `releaseMs: 70`, `thickness: 2.8`, `colorMode: "frequencyGradient"`, `glow: 1.0`
     - Layer 1 (accent `dots` layer): `type: "shape"`, `enabled: true`, `opacity: 0.72`, `blend: "add"`, `trails: false`, `params`: `baseShape: "twistWave"`, `size: 0.62`, `posX: 0.0`, `posY: 0.0`, `rotation: 0`, `spinSpeed: 0.0`, `basePulse: 0.18`, `twistSpeed: 1.05`, `twistChaos: 0.65`, `effectType: "dots"`, `audioSource: "scope"`, `symmetry: "wrap"`, `extrudeDirection: "outward"`, `sampleCount: 128`, `effectLength: 0.45`, `reactivity: 2.0`, `attackMs: 6`, `releaseMs: 70`, `thickness: 1.35`, `colorMode: "palette"`, `glow: 0.85`
   - `"post"`:
     - `"bloom"`: `0.75`, `"bloomThreshold"`: `0.4`, `"vignette"`: `0.35`
2. **Registry (`src/presets/builtin/index.ts`):**
   - Import `preset32 from './32-twisting-scope-wave.json';`.
   - Add `'32-twisting-scope-wave': 'showcase'` to `SYSTEM_PRESET_CATEGORIES`.
   - Export `SHOWCASE_PRESETS_32: readonly BuiltinPresetEntry[]` with `{ id: '32-twisting-scope-wave', group: 'flagship', subfolder: 'showcase', ...parsePreset(preset32, SCHEMAS) }`.
   - Spread `...SHOWCASE_PRESETS_32` at the end of `ALL_PRESETS`.
   - Add `'32-twisting-scope-wave': { theme: 'waveform', mood: 'dreamy' }` to `PRESET_TAXONOMY`.
3. **Tests (`src/presets/__tests__/presetTaxonomy.test.ts`):**
   - Append `'32-twisting-scope-wave'` to `EXPECTED_SHOWCASE_IDS` and update `toHaveLength(20)`.
   - Update `expect(ALL_PRESETS.length).toBe(37)`.
   - Add `p.id === '32-twisting-scope-wave'` to the Stage 18 warp-stack exempt list (around L229–234).
   - Add Stage 28 preset verification block asserting: zero parse warnings, `showcase` subfolder, no forbidden words, `theme === 'waveform'`, `mood === 'dreamy'`, `tags` containing `'built-in'`, `'flagship'`, `'waveform'`, `'oscilloscope'`, dual `twistWave` layers (main `waveform` + `frequencyGradient` ribbon & accent `dots` layer), curl feedback with `warpReactivity === 0.30`, `radial` (`exponent: 1.5`) + `swirl` warp operators, `beat` `kick` reaction on `feedback.zoom`, and bloom post.

---

## 3. Atomic Implementation Slices (Stage 28)

- **Slice 28.1:** Add organic twisting center waveform `baseShape` (`twistWave`) schema controls, persistent twist kinematics, contiguous `1024`-sample `scope` tail window, 3D quadrature oscilloscope displacement in `shape.vert.glsl`, and unit tests (`src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts`, `src/render/layers/shape.ts`, `src/render/shaders/shape.vert.glsl`, `src/render/__tests__/shapeLayer.test.ts`).
- **Slice 28.2:** Add built-in *Twisting Scope Wave* preset (`32-twisting-scope-wave`), register `SHOWCASE_PRESETS_32`, and add taxonomy/preset assertions (`src/presets/builtin/32-twisting-scope-wave.json` [NEW], `src/presets/builtin/index.ts`, `src/presets/__tests__/presetTaxonomy.test.ts`).
