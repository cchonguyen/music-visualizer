# Stage 27: True Wall-Bounce Physics & Bouncing Ribbon Wave Preset Specification

> **Atlas Coordinate: `[497]`**  
> **Sector:** Sector 400 — System Spec & Architecture  
> **Status:** Final Spec (Decided 2026-11-19, Branch `stage-27-spec` from `ba28d54`)  
> **Related Coordinates:** `[400]`, `[410]`, `[485]`, `[496]`

---

## 1. Executive Summary & Core Objectives

Stage 27 adds autonomous, audio-reactive wall-bounce physics directly to the unified `ShapeLayer` (`[485]`) and ships a showcase flagship preset (**Bouncing Ribbon Wave**, ID `31-bouncing-ribbon-wave`) that pairs this motion with MilkDrop-style recursive curl trails, a radial `exponent` (`zoomexp`, `[496]`) warp operator, a beat-triggered zoom reaction, and bloom post-processing:

1. **True Wall-Bounce Physics on `ShapeLayer` (Slice 27.1):**
   - Extend `ShapeParams`, `SHAPE_DEFAULTS`, and `SHAPE_SPECS` (`src/presets/layerSchemas.ts`) with four untiered (advanced) controls appended to the `'Base'` group: `bounceSpeed`, `bounceAngle`, `bounceAudioBoost`, and `bounceFlipSpin`.
   - Preserve `LAYER_SPECS.shape` at **8** `'basic'` controls (`baseShape`, `size`, `rotation`, `effectType`, `thickness`, `colorMode`, `solidColor`, `glow`) and keep `posX` / `posY` with `showWhen: undefined`.
   - Implement persistent bounce state (`bounceX`, `bounceY`, `bounceVx`, `bounceVy`, `bounceSpinDir`, `bounceActive`) on `ShapeLayer` (`src/render/layers/shape.ts`) that survives per-frame `setParams()` calls (essential when audio links or reactions call `applyValues()` every frame), uses `clampDt(clock.dtSec)` from `../clock`, computes aspect-corrected rotated AABB half-extents per `baseShape`, reflects and folds overshoot cleanly across `X = ±aspect` / `Y = ±1.0` (with `0.02` inset), flips `bounceSpinDir` on impact when `bounceFlipSpin` is enabled, boosts speed by `(1 + bounceAudioBoost * Math.max(frame.kickEnv ?? 0, frame.energy ?? 0))`, and stays 100% bit-identical to baseline when `bounceSpeed === 0`.
2. **Built-in Bouncing Ribbon Wave Preset (Slice 27.2):**
   - Add `src/presets/builtin/31-bouncing-ribbon-wave.json` (`id: '31-bouncing-ribbon-wave'`, `name: 'Bouncing Ribbon Wave'`, `group: 'flagship'`, `subfolder: 'showcase'`, `theme: 'waveform'`, `mood: 'driving'`, `tags: ["built-in", "flagship", "waveform"]`) featuring a bouncing oscilloscope `centerLine` ribbon (`audioSource: "scope"`, `effectType: "waveform"`), MilkDrop-style curl trails (`decay: 0.93`, `zoom: 1.02`, `rotate: 0.006`, `warpMode: "curl"`, `warpAudioSource: "kick"`, `warpReactivity: 0.35`), a `radial` Warp Field operator (`amount: 0.1`, `exponent: 1.6`), a `beat` `kick` reaction on `feedback.zoom`, and bloom post.
   - Register the preset in `src/presets/builtin/index.ts` (`SHOWCASE_PRESETS_31`, `SYSTEM_PRESET_CATEGORIES`, `ALL_PRESETS`, `PRESET_TAXONOMY`) and update `src/presets/__tests__/presetTaxonomy.test.ts` (`EXPECTED_SHOWCASE_IDS`, lengths `19` / `36`, and the warp-stack exempt list at L228–232).

---

## 2. Detailed Technical Contracts

### 2.1 Slice 27.1: True Wall-Bounce Physics on `ShapeLayer`

#### A. Schema Contract (`src/presets/layerSchemas.ts` & `src/presets/layerSchemas.test.ts`)

1. **`ShapeParams` Additions (Category 1 — Base Geometry `"Base"`):**
   ```ts
   bounceSpeed: number;      // 0.0..3.0 (viewport half-height units/s; 0 = off)
   bounceAngle: number;      // 0..360 (launch heading in degrees)
   bounceAudioBoost: number; // 0.0..2.0 (audio speed multiplier)
   bounceFlipSpin: boolean;  // true = reverse spin direction on wall hit
   ```
2. **`SHAPE_DEFAULTS` Additions:**
   - `bounceSpeed: 0.0`
   - `bounceAngle: 37`
   - `bounceAudioBoost: 0.5`
   - `bounceFlipSpin: true`
3. **`SHAPE_SPECS` Additions (appended at the end of `'Base'` group, immediately after `basePulse`, all untiered / advanced):**
   - `{ type: 'float', name: 'bounceSpeed', label: 'Wall bounce speed', group: 'Base', default: SHAPE_DEFAULTS.bounceSpeed, min: 0.0, max: 3.0, step: 0.05, description: 'Drives autonomous velocity across the viewport with true wall-bounce reflections (0 turns off bouncing and uses Position X/Y).' }`
   - `{ type: 'float', name: 'bounceAngle', label: 'Bounce launch angle (°)', group: 'Base', default: SHAPE_DEFAULTS.bounceAngle, min: 0, max: 360, step: 1, showWhen: { bounceSpeed: { above: 0 } }, description: 'Sets the initial travel heading in degrees when wall-bounce motion activates.' }`
   - `{ type: 'float', name: 'bounceAudioBoost', label: 'Bounce audio speed boost', group: 'Base', default: SHAPE_DEFAULTS.bounceAudioBoost, min: 0.0, max: 2.0, step: 0.05, showWhen: { bounceSpeed: { above: 0 } }, description: 'Multiplies bounce velocity during loud passages and kick transients.' }`
   - `{ type: 'bool', name: 'bounceFlipSpin', label: 'Flip spin on wall hit', group: 'Base', default: SHAPE_DEFAULTS.bounceFlipSpin, showWhen: { bounceSpeed: { above: 0 } }, description: 'Reverses continuous base rotation spin direction on each wall reflection.' }`
4. **Schema Invariants:**
   - `LAYER_SPECS.shape` basic list remains unchanged (`8` `'basic'` controls: `['baseShape', 'size', 'rotation', 'effectType', 'thickness', 'colorMode', 'solidColor', 'glow']`).
   - `posX` and `posY` keep `showWhen: undefined`.
   - `src/presets/layerSchemas.test.ts` must update `SHAPE_SPECS.length` assertion from `45` to `49`, append `'bounceSpeed', 'bounceAngle', 'bounceAudioBoost', 'bounceFlipSpin'` to the expected `'Base'` group name list, and assert `bounceSpeed.showWhen === undefined` and `{ bounceSpeed: { above: 0 } }` on the three dependent controls.

#### B. Physics & Renderer Contract (`src/render/layers/shape.ts` & `src/render/__tests__/shapeLayer.test.ts`)

1. **Exports & Constants (`src/render/layers/shape.ts`):**
   - Import `clampDt` from `../clock`: `import { clampDt, type RenderClock } from '../clock';`.
   - Export `BOUNCE_WALL_INSET = 0.02`.
   - Export interface `ShapeBounceState`:
     ```ts
     export interface ShapeBounceState {
       x: number;
       y: number;
       vx: number;
       vy: number;
       spinDir: 1 | -1;
       active: boolean;
     }
     ```
2. **Extent Helper (`computeShapeBounceExtents`):**
   - Signature:
     ```ts
     export function computeShapeBounceExtents(
       p: Pick<ShapeParams, 'baseShape'>,
       effSize: number,
       rotRad: number,
       aspect: number,
     ): { halfX: number; halfY: number }
     ```
   - Operates in aspect-corrected `uInstOffset` space (where `gl_Position.x = (P.x + uInstOffset.x) / uAspect` and `gl_Position.y = P.y + uInstOffset.y`, matching `src/render/shaders/shape.vert.glsl`), using `safeAspect = Math.max(0.01, Number.isFinite(aspect) ? aspect : 1)`, `s = Math.max(0, Number.isFinite(effSize) ? effSize : 0)`, `absCos = Math.abs(Math.cos(rotRad))`, and `absSin = Math.abs(Math.sin(rotRad))`:
     - `'centerLine'`: local unrotated box `(s * safeAspect, 0)` → `{ halfX: s * safeAspect * absCos, halfY: s * safeAspect * absSin }`.
     - `'edgeLine'`: local unrotated box `(0.92 * s * safeAspect, 0.92 * s)` → `{ halfX: 0.92 * s * safeAspect * absCos + 0.92 * s * absSin, halfY: 0.92 * s * safeAspect * absSin + 0.92 * s * absCos }`.
     - `'figure8'`: local unrotated box `(s, 0.55 * s)` → `{ halfX: s * absCos + 0.55 * s * absSin, halfY: s * absSin + 0.55 * s * absCos }`.
     - `'knot3d'`: conservative perspective projection bounding radius `1.05 * s` → `{ halfX: 1.05 * s, halfY: 1.05 * s }`.
     - Other shapes (`'circle'`, `'arc'`, `'polygon'`, `'star'`, `'spiral'`): circumradius `s` → `{ halfX: s, halfY: s }`.
3. **Physics Stepper (`stepBouncePhysics`):**
   - Signature:
     ```ts
     export function stepBouncePhysics(
       state: ShapeBounceState,
       p: Pick<ShapeParams, 'posX' | 'posY' | 'bounceSpeed' | 'bounceAngle' | 'bounceAudioBoost' | 'bounceFlipSpin'>,
       dtSec: number,
       aspect: number,
       extents: { halfX: number; halfY: number },
       audioLevel: number,
     ): { state: ShapeBounceState; hit: boolean }
     ```
   - Behavior:
     - **Inactive / Reset (`bounceSpeed <= 0` or non-finite):** returns `{ state: { x: p.posX, y: p.posY, vx: 0, vy: 0, spinDir: 1, active: false }, hit: false }`.
     - **Delta Clamp:** uses `const dt = clampDt(dtSec);` so tab pauses or large frame gaps never teleport the shape.
     - **Wall Bounds (`limitX`, `limitY`):**
       `safeAspect = Math.max(0.01, Number.isFinite(aspect) ? aspect : 1)`
       `limitX = Math.max(0, safeAspect - BOUNCE_WALL_INSET - Math.max(0, extents.halfX))`
       `limitY = Math.max(0, 1.0 - BOUNCE_WALL_INSET - Math.max(0, extents.halfY))`
     - **Activation (`!state.active` transition `false -> true`):**
       Seeds position `(x, y)` from `(p.posX, p.posY)` clamped to `[-limitX, +limitX]` × `[-limitY, +limitY]`, velocity `(vx, vy) = (Math.cos(angleRad) * speed, Math.sin(angleRad) * speed)` where `angleRad = (p.bounceAngle * Math.PI) / 180`, and `spinDir = 1`.
     - **Live Speed Update (`state.active === true`):**
       Preserves current position `(state.x, state.y)`, `spinDir`, and normalized heading `state.vx / hypot, state.vy / hypot` while rescaling velocity magnitude to current `p.bounceSpeed` (or re-seeding from `p.bounceAngle` if velocity magnitude is near zero).
     - **Audio Speed Scaling & Integration:**
       `speedMult = 1 + Math.max(0, p.bounceAudioBoost) * Math.max(0, audioLevel)`
       `x += vx * speedMult * dt`
       `y += vy * speedMult * dt`
       where `ShapeLayer.draw()` passes `audioLevel = Math.max(frame.kickEnv ?? 0, frame.energy ?? 0)`.
     - **Overshoot Folding, Reflection & Collapsed-Axis Guard:**
       - For each axis (`X` against `limitX`, `Y` against `limitY`):
         - If `limit <= 0` (shape extent fills or exceeds viewport axis): clamp coordinate to `0` without marking a wall hit or flipping spin (prevents 60 Hz spin jitter).
         - Otherwise (`limit > 0`): fold overshoot via reflection (`if pos > limit: pos = 2 * limit - pos; vel = -Math.abs(vel); axisHit = true;` and `if pos < -limit: pos = -2 * limit - pos; vel = Math.abs(vel); axisHit = true;`, up to 8 fold iterations followed by a safety clamp into `[-limit, +limit]` with inward velocity).
       - `hit = hitX || hitY`.
       - When `hit && p.bounceFlipSpin`, invert `spinDir` (`1` ↔ `-1`).
4. **`ShapeLayer` Integration:**
   - Fields `bounceX = 0`, `bounceY = 0`, `bounceVx = 0`, `bounceVy = 0`, `bounceSpinDir: 1 | -1 = 1`, `bounceActive = false` initialized on construction and reset in `init(gl)`.
   - `setParams(params)` updates `this.p` **without** resetting bounce state so per-frame audio links/morphs never stall bounce motion.
   - `getBounceState(): ShapeBounceState` returns a snapshot `{ x, y, vx, vy, spinDir, active }`.
   - In `draw(frame, clock, target, options)`:
     - Keep `const dt = Math.max(0, clock.dtSec);` for non-bounce phases and audio envelopes (preserving existing `pathTravel` tests with `dtSec > 0.1`), and compute `const bounceDt = clampDt(clock.dtSec);` and `const aspect = target.width / Math.max(1, target.height);`.
     - When `this.p.bounceSpeed > 0`:
       - Compute `effSize = this.p.size * (1.0 + this.p.basePulse * (frame.kickEnv ?? 0))`.
       - Compute `extents = computeShapeBounceExtents(this.p, effSize, rotRad + this.spinPhase, aspect)`.
       - Run `stepBouncePhysics(this.getBounceState(), this.p, bounceDt, aspect, extents, Math.max(frame.kickEnv ?? 0, frame.energy ?? 0))` and store updated state.
       - Advance `this.spinPhase += this.p.spinSpeed * this.bounceSpinDir * bounceDt;`.
     - When `this.p.bounceSpeed <= 0`:
       - Reset `bounceActive = false`, `bounceSpinDir = 1`, `bounceVx = 0`, `bounceVy = 0`, `bounceX = this.p.posX`, `bounceY = this.p.posY`.
       - Advance `this.spinPhase += this.p.spinSpeed * dt;` (100% bit-identical to pre-Stage-27 baseline).
     - Use `anchorX = this.bounceActive ? this.bounceX : this.p.posX` and `anchorY = this.bounceActive ? this.bounceY : this.p.posY` across all 6 propagation modes (`single`, `concentric`, `shockwave`, `stream`, `orbit`, `polar`).

---

### 2.2 Slice 27.2: Built-in Bouncing Ribbon Wave Preset

1. **Preset JSON (`src/presets/builtin/31-bouncing-ribbon-wave.json`):**
   - `version`: `1`
   - `name`: `"Bouncing Ribbon Wave"` (must NOT contain `'milkdrop'` or any forbidden reference string)
   - `tags`: `["built-in", "flagship", "waveform"]`
   - `theme`: `"waveform"`, `mood`: `"driving"`
   - `transition`: `{ "style": "crossfade", "seconds": 0.4 }`
   - `feedback`:
     - `decay`: `0.93`, `zoom`: `1.02`, `rotate`: `0.006`
     - `warpMode`: `"curl"`, `warp`: `0.22`, `warpScale`: `2.0`, `warpSpeed`: `0.65`
     - `warpAudioSource`: `"kick"`, `warpReactivity`: `0.35`, `warpAttackMs`: `12`, `warpReleaseMs`: `220`
     - `curlOctaves`: `2`, `curlTurbulence`: `0.4`, `curlFlowPattern`: `"plumes"`
     - `hueDrift`: `0.012`, `decayRgb`: `[0.93, 0.94, 0.98]`
   - `warp`:
     - `[{ "type": "radial", "params": { "amount": 0.1, "scale": 1.0, "speed": 0.0, "exponent": 1.6 } }]`
   - `reactions`:
     - `[{ "trigger": { "type": "beat" }, "response": "kick", "target": { "group": "feedback", "name": "zoom" }, "amount": 0.08, "ease": 0.35 }]`
   - `layers`:
     - Glowing bouncing oscilloscope `Shape` layer:
       - `type`: `"shape"`, `enabled`: `true`, `opacity`: `1.0`, `blend`: `"add"`, `trails`: `true`
       - `params`: `baseShape: "centerLine"`, `size: 0.36`, `posX: 0.0`, `posY: 0.0`, `rotation: 15`, `spinSpeed: 0.35`, `basePulse: 0.15`, `bounceSpeed: 0.85`, `bounceAngle: 37`, `bounceAudioBoost: 0.65`, `bounceFlipSpin: true`, `effectType: "waveform"`, `audioSource: "scope"`, `sampleCount: 256`, `effectLength: 0.42`, `thickness: 3.0`, `extrudeDirection: "outward"`, `symmetry: "wrap"`, `colorMode: "frequencyGradient"`, `glow: 1.1`, `reactivity: 1.4`, `attackMs: 6`, `releaseMs: 90`
   - `post`:
     - `bloom`: `0.75`, `bloomThreshold`: `0.4`, `vignette`: `0.4`
2. **Registry (`src/presets/builtin/index.ts`):**
   - Import `preset31 from './31-bouncing-ribbon-wave.json'`.
   - Add `'31-bouncing-ribbon-wave': 'showcase'` to `SYSTEM_PRESET_CATEGORIES`.
   - Export `SHOWCASE_PRESETS_31: readonly BuiltinPresetEntry[]` with `{ id: '31-bouncing-ribbon-wave', group: 'flagship', subfolder: 'showcase', ...parsePreset(preset31, SCHEMAS) }`.
   - Append `...SHOWCASE_PRESETS_31` to `ALL_PRESETS`.
   - Add `'31-bouncing-ribbon-wave': { theme: 'waveform', mood: 'driving' }` to `PRESET_TAXONOMY`.
3. **Tests (`src/presets/__tests__/presetTaxonomy.test.ts`):**
   - Append `'31-bouncing-ribbon-wave'` to `EXPECTED_SHOWCASE_IDS` (`toHaveLength(19)`).
   - Update `expect(ALL_PRESETS.length).toBe(36)`.
   - Add `'31-bouncing-ribbon-wave'` to the warp-stack exempt list at L228–232.
   - Add dedicated Stage 27 preset assertions verifying zero parse warnings, forbidden-word exclusion, `theme`/`mood`/`tags`/`subfolder`, true wall-bounce oscilloscope `Shape` params, `radial` `exponent: 1.6` warp operator, `beat` `kick` reaction on `feedback.zoom`, and bloom post.

---

## 3. Atomic Implementation Slices (Stage 27)

Every slice touches `< 5` target files (including affected tests):

- **Slice 27.1:** Add true wall-bounce physics schema controls and `ShapeLayer` bounce engine with unit tests (`src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts`, `src/render/layers/shape.ts`, `src/render/__tests__/shapeLayer.test.ts`)
- **Slice 27.2:** Add built-in Bouncing Ribbon Wave preset (`31-bouncing-ribbon-wave`) and taxonomy registration/tests (`src/presets/builtin/31-bouncing-ribbon-wave.json` [NEW], `src/presets/builtin/index.ts`, `src/presets/__tests__/presetTaxonomy.test.ts`)
