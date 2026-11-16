# Stage 25: Visual Improvements, Warp/Feedback Responsiveness, Tooltips & Studio Cleanup Specification

> **Atlas Coordinate: `[490]`**  
> **Sector:** Sector 400 — System Spec & Architecture  
> **Status:** Final Spec (Decided 2026-11-16, Rebased on `origin/main` Stage 24)  
> **Approved By Operator:** via `/grill-me` alignment review

---

## 1. Executive Summary & Core Objectives

Following the delivery of Stages 9 through 24 (including Unified `shape` Layer Architecture, Two-Tier Preset Taxonomy & Folder Hierarchy, Cloudflare Access Edge Identity & Remote Presets, Consolidated Segmented Pill HUD, Reactions, Warp Field Operators, Generators, Pop-out Studio, and Harness UI Adoption), an in-depth codebase audit identified remaining visual rough edges, dead/half-wired parameter contracts, tooltip/accessibility gaps, administrative status feedback gaps, and Studio UI papercuts.

This specification adapts and unifies all remaining audit improvements on top of `origin/main` (`fa62a48`) into an atomic, testable, and backwards-compatible roadmap (**Stage 25**):
1. **Dead & Half-Wired Visual Controls Pruning & Wiring:**
   - Remove dead/unwired parameters (`Tunnel.horizonDrift` and `Crown.rimFactor` in `src/presets/layerSchemas.ts`) and remaining dead feedback uniforms (`mandalaKickFlare` in `FEEDBACK_WARP_DEFAULTS`, `uMandalaKickFlare` in `feedback.frag.glsl` and `scene.ts`), while adding `'horizonDrift'` and `'rimFactor'` to `REMOVED_LAYER_SETTINGS` in `src/presets/format.ts` so legacy presets load cleanly with zero warnings.
   - Remove dead `POST_CRT_SPECS` (`crtScanlines`, `crtBarrel`) from `src/presets/schema.ts` and `src/presets/builtin/index.ts`, add `'crtScanlines'` and `'crtBarrel'` to `REMOVED_POST_SETTINGS` in `src/presets/format.ts`, and update `src/presets/__tests__/presets.test.ts` (matching Slice 14.8's `shaderInputs.test.ts` contract that `uCrtScanlines` and `uCrtBarrel` are retired).
   - Add `'morph'` to `TRANSITION_STYLES` and `STYLE_SPEC.options` in `src/presets/format.ts` so morph transitions survive `parsePreset` and appear in Studio.
   - Expose all 7 `ChladniSand` `plateMode` options (`'fullscreen'`, `'isometricPlate'`, `'radialMandala'`, `'hexagon'`, `'triangle'`, `'starMandala'`, `'morph'`) in `CHLADNI_SPECS` (`src/presets/schema.ts`), matching `ChladniSandLayer`.
   - Wire `PARTICLE_DISPLACE_SPEC` (with `description`) into `PARTICLE_SPECS` and `PARTICLE_DEFAULTS` in `src/presets/layerSchemas.ts`, add `showWhen: { mode: 'phyllotaxis' }` to all 5 `PHYLLOTAXIS_SPECS`, and unify `SPECTRAL_TERRAIN_DEFAULTS.skirtOpacity` to `0.15` in `src/presets/schema.ts`.
2. **Feedback & Warp Operator Responsiveness:**
   - Add 4 CPU-envelope-smoothed responsiveness parameters (`warpAudioSource`, `warpReactivity`, `warpAttackMs`, `warpReleaseMs`) to `FEEDBACK_WARP_SPECS` (`src/presets/schema.ts`), `FEEDBACK_POST_LAYOUT.Warp`, and `FEEDBACK_WARP_DEFAULTS` (`src/render/scene.ts`).
   - Maintain a persistent asymmetric CPU envelope (`smoothedWarpAudio`) in `Scene` (`src/render/scene.ts`) that smoothly modulates warp displacement across `classic`, `curl`, `mobius`, and `rgbSplit` without single-frame feedback loop jitter.
   - Update `linkTargets()` in `src/studio/studio.ts` so integer `WarpOperator` settings (`octaves`, `iterations`) can also take audio links and morphs alongside float settings, and populate `meterKey: 'W${i}.${spec.name}'` so the Studio live meter works for linked Warp Operators.
   - Update `hasLinks(preset)` in `src/presets/loader.ts` to check `setting.link !== undefined || setting.morph !== undefined` across `layers`, `feedback`, `post`, and `warp` operators so morph-only presets animate at runtime.
   - Unify Visual Gain (`getVisualGain()`) and Calm mode scaling (`CALM_SCALE = 0.5`) across all `AudioFrame` signals (`norm`, `env`, `energy`, `loudness`, `kickEnv`, `beatStrength`, `fluxByBand`, `raw`) via `applyVisualGainAndCalm()` in `src/presets/loader.ts` and `src/main.ts`.
3. **100% Tooltips & Studio Helper Bar Coverage:**
   - Add `description` strings to all `warpOps.ts` specs (`amount`, `scale`, `speed`, `centreX`, `centreY`, `iterations`, `octaves`, `turbulence`, `flow`) and `format.ts` specs (`OPACITY_SPEC`, `BLEND_SPEC`, `TRAILS_SPEC`, `STYLE_SPEC`, `SECONDS_SPEC`).
   - Generalize `attachControlHelper` in `src/studio/studio.ts` to accept arbitrary `ControlHelperDescriptor` objects and wire helper descriptions across 100% of Studio rows (Preset/Folder, Vary/Mashup, Global Director, Layer stack & actions, Warp Operators, Audio Links, Morphs, Reactions, Frame time, and Admin).
   - Implement an accessible `[data-tooltip]` popover system in `src/app.css` and `src/ui/controls.ts` (using Harness UI tokens `--surface-raised`, `--line`, `--text`, `--radius-control`, `--shadow-pop`, and respecting `prefers-reduced-motion: reduce`), with complete `aria-label` and `data-tooltip` coverage across `index.html`, `src/ui/controls.ts`, and Studio icon buttons.
4. **Admin Persistence Truthful Feedback & Studio Cleanup:**
   - Ensure `PresetSession` admin mutations (`saveSystemPreset`, `removeSystemPreset`, `promoteToSystemPreset`, `setSystemPresetSubfolder`) and `adminControls.ts` action helpers provide truthful remote-synced vs. local-only/offline/error toast feedback.
   - Fix the `setInterval` leak in `Studio` by storing the timer handle and clearing it in `Studio.dispose()`.
   - Deduplicate the Admin Access / Exit Admin Mode button in `Studio` (keeping a single clean control and removing the duplicate blade/footer redundancy).
   - Subscribe `buildGlobalDirectorControls` to `director.subscribeExperienceChange` and dynamically update the Save button's dirty indicator when edits occur.
   - Prune dead legacy HUD elements (`#play-btn`, `button[data-source="stop"]`, `#time`, `#playback`) from `index.html` and dead selectors (`#calm` in `compositor.ts`, `#director-mode`, `.value-item`/`.value-panel`) from `src/ui/controls.ts` and `src/style.css`.
   - Humanize layer titles (`formatLayerType`), enum dropdown options, `AUDIO_SOURCES`, and `TRANSITION_STYLES`; add `[Linked]` / `[Morphed]` markers in `linkTargets`; add read-only preset hints; and replace all remaining `window.prompt()` / `window.confirm()` calls in `studio.ts` and `adminControls.ts` with inline Studio DOM controls.

---

## 2. Detailed Technical Contracts

### 2.1 Dead & Half-Wired Visual Controls

#### Contract 1: Dead Parameter & Uniform Removal with Silent Backward-Compatible Ignore
1. **`Tunnel.horizonDrift` & `Crown.rimFactor`:** Remove `horizonDrift` from `TunnelParams`, `TUNNEL_DEFAULTS`, and `TUNNEL_SPECS`, and remove `rimFactor` from `CrownParams`, `CROWN_DEFAULTS`, and `CROWN_SPECS` in `src/presets/layerSchemas.ts`. Update `src/presets/layerSchemas.test.ts` and `src/render/__tests__/tunnelOverhaul.test.ts`.
2. **`mandalaKickFlare` & `uMandalaKickFlare`:** Remove `mandalaKickFlare` from `FEEDBACK_WARP_DEFAULTS` and `UNIFORMS` in `src/render/scene.ts`, remove `uniform float uMandalaKickFlare;` from `src/render/shaders/feedback.frag.glsl`, and update `src/render/__tests__/feedbackWarp.test.ts`.
3. **`POST_CRT_SPECS` (`crtScanlines`, `crtBarrel`):** Remove `POST_CRT_SPECS` from `src/presets/schema.ts` and `src/presets/builtin/index.ts`, remove `"crtScanlines"` and `"crtBarrel"` from `FEEDBACK_POST_LAYOUT.Colour`, and update `src/presets/__tests__/presets.test.ts`. Note: `src/render/__tests__/shaderInputs.test.ts` strictly enforces that `uCrtScanlines`, `uCrtBarrel`, `uKick`, `uSub`, and `uMobiusPolePolarity` never appear in shaders, `scene.ts`, or `compositor.ts`.
4. **Silent Ignore in `format.ts`:** Add `REMOVED_LAYER_SETTINGS = ['horizonDrift', 'rimFactor']` and `REMOVED_POST_SETTINGS = ['crtScanlines', 'crtBarrel']` in `src/presets/format.ts` and pass them to `parseSettings` so older presets containing those keys load with zero warnings.

#### Contract 2: Half-Wired Visual Controls Activation
1. **`TRANSITION_STYLES`:** In `src/presets/format.ts`, update `export const TRANSITION_STYLES = ["crossfade", "wipe", "dissolve", "zoom", "morph"] as const;` and reference `TRANSITION_STYLES` in `STYLE_SPEC.options`.
2. **`CHLADNI_SPECS` Plate Modes:** In `src/presets/schema.ts`, update `ChladniPlateMode` and `CHLADNI_SPECS`'s `plateMode` `options` to `["fullscreen", "isometricPlate", "radialMandala", "hexagon", "triangle", "starMandala", "morph"]`.
3. **Particles `terrainDisplace` & `PHYLLOTAXIS_SPECS` `showWhen`:**
   - Move `PARTICLE_DISPLACE_SPEC` (with `description: 'Displaces particles along the 3D terrain ridges published by Spectral Terrain.'`) into `src/presets/layerSchemas.ts`, add `terrainDisplace: 0.0` to `PARTICLE_DEFAULTS`, include `PARTICLE_DISPLACE_SPEC` in `PARTICLE_SPECS`, and re-export `PARTICLE_DISPLACE_SPEC` from `src/render/layers/particles.ts`.
   - Add `showWhen: { mode: 'phyllotaxis' }` to all 5 specs in `PHYLLOTAXIS_SPECS` (`seedShape`, `phylloPattern`, `petalStretch`, `flowSpeed`, `subTwist`) in `src/presets/schema.ts`.
4. **SpectralTerrain Skirt Opacity:** In `src/presets/schema.ts`, set `SPECTRAL_TERRAIN_DEFAULTS.skirtOpacity = 0.15` (matching `SpectralTerrainLayer` constructor default).

---

### 2.2 Feedback & Warp Operator Responsiveness

#### Contract 1: Feedback Warp Audio Envelope Specs & Smoothing
Add to `FEEDBACK_WARP_SPECS` in `src/presets/schema.ts` (and `FEEDBACK_POST_LAYOUT.Warp`):
- `warpAudioSource`: `enum`, options `['sub', 'bass', 'mid', 'high', 'energy', 'kick']`, default `'sub'`, label `'Warp audio source'`, description `'Selects the frequency band or transient signal driving dynamic coordinate warp swells.'`
- `warpReactivity`: `float`, `0.0..1.0`, step `0.05`, default `0.0`, label `'Warp audio swell'`, description `'Scales audio-driven warp coordinate displacement and flow velocity.'`
- `warpAttackMs`: `float`, `5..200`, step `5`, default `15`, label `'Warp attack (ms)'`, description `'Sets envelope rise time in milliseconds for warp transient expansion.'`
- `warpReleaseMs`: `float`, `50..1000`, step `10`, default `250`, label `'Warp release (ms)'`, description `'Sets envelope recovery time in milliseconds as warp settles back to resting scale.'`

In `src/render/scene.ts`:
- Track `private smoothedWarpAudio = 0.0;` with `getSmoothedWarpAudio(): number`.
- Each frame in `Scene.draw()`, evaluate the selected `warpAudioSource` from `frame`, multiply by `warpReactivity`, and smooth with asymmetric one-pole attack/release (`1 - Math.exp(-dt / tauSec)`).
- Scale effective `uWarp` / `uWarpAmp` (`getEffectiveWarp()`) and `uRgbSplit` (in `rgbSplit` mode) smoothly by `smoothedWarpAudio`. When `warpReactivity === 0`, `smoothedWarpAudio` is `0` and all uniforms remain bit-identical to baseline.

#### Contract 2: Warp Operator Link/Morph Support, `hasLinks()` & Universal Gain/Calm Scaling
- In `src/studio/studio.ts`, update `linkTargets(preset)` so `preset.warp` operators include both `spec.type === 'float'` and `spec.type === 'int'` specs, and set `meterKey: 'W${i}.${spec.name}'`.
- In `src/presets/loader.ts`, update `hasLinks(preset)` to check `setting.link !== undefined || setting.morph !== undefined` across `layers`, `feedback`, `post`, and `warp`.
- Export `CALM_SCALE = 0.5` and `applyVisualGainAndCalm(frame, gain, calm, calmScale)` from `src/presets/loader.ts` and call it in `src/main.ts` so all `AudioFrame` signals (`norm`, `env`, `energy`, `loudness`, `kickEnv`, `beatStrength`, `fluxByBand`, `raw`) are shaped by `shapeReaction(x, gain)` when `gain !== 1` and scaled by `calmScale` in Calm mode without double-scaling `frame.env.sub`.

---

### 2.3 100% Tooltips & Studio Helper Bar Coverage

#### Contract 1: Complete `ParamSpec.description` Coverage in `warpOps.ts` & `format.ts`
- In `src/presets/warpOps.ts`, add `description` to every spec in `commonSpecs()`, `foldSpecs()`, and `curlSpecs()`:
  - `amount`: `'Sets the strength and direction of the warp displacement (0 does nothing; negative reverses it).'`
  - `scale`: `'Adjusts the spatial frequency or tile count of the warp pattern across the screen.'`
  - `speed`: `'Controls the animation speed and direction of the warp motion over time.'`
  - `centreX`: `'Shifts the horizontal centre of the warp operator (-1 left, 0 middle, 1 right).'`
  - `centreY`: `'Shifts the vertical centre of the warp operator (-1 bottom, 0 middle, 1 top).'`
  - `iterations`: `'Sets how many kaleidoscopic fold-and-scale rounds are applied (capped on lower render scales).'`
  - `octaves`: `'Sets the number of Simplex noise octave layers blended into the curl flow.'`
  - `turbulence`: `'Controls how strongly treble energy adds fine swirling detail to the curl noise.'`
  - `flow`: `'Chooses the large-scale flow pattern: rising plumes, stationary eddies, outward expansion, or inward vortex.'`
- In `src/presets/format.ts`, add `description` to `OPACITY_SPEC`, `SECONDS_SPEC`, `BLEND_SPEC`, `TRAILS_SPEC`, and `STYLE_SPEC`.

#### Contract 2: Universal Studio Helper Bar (`attachControlHelper`)
- In `src/studio/studio.ts`, export `ControlHelperDescriptor` and `attachControlHelper(elementOrBlade, info, onHelperUpdate)` (keeping `attachSpecHelper` as a compatible alias).
- Wire `attachControlHelper` across every non-spec Studio control row: Preset selector, Category/Subfolder, Name, Folder selector & folder buttons, Favourite/Skip tags, Transition style/seconds, Display time, action tiles (Save, Save as, Duplicate, Delete, Promote, Export/Import, Undo, Redo), Vary/Mashup buttons, Global Director bindings, Layer stack bindings & buttons, Expand/Collapse All, Warp Operator controls, Audio Link controls, Morph controls, Reaction controls, Frame time monitor, and Admin button.

#### Contract 3: Accessible `[data-tooltip]` Popover System (Harness UI Compliant)
- In `src/ui/controls.ts` and `src/app.css` (never editing `.harness/design-system/tokens.css` or `bundle.css`), implement `initTooltips(root)`:
  - Floating tooltip element `.ui-tooltip-popover` styled with Harness UI tokens (`background: var(--surface-raised)`, `border: 1px solid var(--line)`, `color: var(--text)`, `border-radius: var(--radius-control)`, `box-shadow: var(--shadow-pop)`), `pointer-events: none`, and `transition: none` under `prefers-reduced-motion: reduce`.
  - Shows on pointer hover and keyboard `:focus-visible`, hides on `Escape`, `pointerdown`, `scroll`, or `blur`, and clamps horizontally/vertically within the viewport.
  - Add `data-tooltip` and complete `aria-label` attributes across HUD controls in `index.html`, dynamic controls in `src/ui/controls.ts`, and Studio close/reset buttons.

---

### 2.4 Admin Persistence, Studio Cleanup, Labels & Inline Prompts

#### Contract 1: Admin Persistence & Truthful Status Feedback
- In `src/presets/session.ts` and `src/studio/adminControls.ts`, ensure `saveSystemPresetAction`, `deleteSystemPresetAction`, `promoteUserPresetAction`, and subfolder updates report truthful toast messages via `RemotePresetWriter` / `upsertRemotePreset` & `softDeleteRemotePreset` (distinguishing verified remote server sync from local-only/unconfigured or failed sync).

#### Contract 2: Studio Timer Leak, Admin Button Deduplication & Global Director Sync
- Store the `setInterval` handle in `Studio` and clear it in `Studio.dispose()`.
- Remove the duplicate Admin button in `.studio-footer` so Studio has a single Admin Access / Exit Admin Mode control.
- Subscribe `buildGlobalDirectorControls` to `director.subscribeExperienceChange` so Studio controls stay in sync when Experience Mode changes via HUD or keyboard (`M`), and update the Save button title dynamically when `session.isDirty(id)` changes.

#### Contract 3: Legacy HUD Pruning & Dead Selector Cleanup
- Remove dead hidden elements (`#play-btn`, `button[data-source="stop"]`, `#time`, `#playback`) from `index.html`.
- Remove dead `#calm` lookup in `src/render/compositor.ts` (using `this.calm` directly) and remove dead `#director-mode` and `.value-item`/`.value-panel` code from `src/ui/controls.ts` and `src/style.css`.

#### Contract 4: Humanized Labels, `[Linked]`/`[Morphed]` Badges & Inline DOM Prompts
- Export `LAYER_TYPE_LABELS` and `formatLayerType(type)` in `src/presets/builtin/index.ts` and use human-readable names in `formatLayerTitle`, `formatLayerLabel`, `Add layer` options, `AUDIO_SOURCE_LABELS`, `TRANSITION_STYLE_LABELS`, and enum dropdowns.
- Prefix linked/morphed settings in `linkTargets()` with `[Linked] `, `[Morphed] `, or `[Linked & Morphed] `.
- Replace `window.prompt()` and `window.confirm()` in `Studio` (`handleNewFolder`, `handleRenameFolder`, `handleDeleteFolder`, `handlePromoteUserPreset`) with accessible inline DOM prompt/confirmation rows inside `.studio-body` styled in `src/app.css` with Harness UI tokens.

---

## 3. Atomic Implementation Slices (Stage 25)

All slices strictly obey the `< 5` target files limit (3 to 4 files per slice) and include all affected unit test files in `Target files:`.

- **Slice 25.1: Prune dead Tunnel/Crown controls, wire Particle `terrainDisplace` into `PARTICLE_SPECS`, and silently ignore retired layer/post keys**
  - Target files: `src/presets/layerSchemas.ts`, `src/presets/format.ts`, `src/presets/layerSchemas.test.ts`, `src/render/__tests__/tunnelOverhaul.test.ts`
- **Slice 25.2: Remove dead `POST_CRT_SPECS` and `uMandalaKickFlare` uniform**
  - Target files: `src/presets/schema.ts`, `src/presets/builtin/index.ts`, `src/presets/__tests__/presets.test.ts`, `src/render/shaders/feedback.frag.glsl`
- **Slice 25.3: Wire `'morph'` transition style, Chladni 7 plate modes, `PHYLLOTAXIS_SPECS` `showWhen`, and `skirtOpacity` `0.15` default**
  - Target files: `src/presets/schema.ts`, `src/render/layers/particles.ts`, `src/render/__tests__/chladniPhyllo.test.ts`, `src/presets/format.test.ts`
- **Slice 25.4: Add CPU-envelope-smoothed feedback warp responsiveness (`warpAudioSource`, `warpReactivity`, `warpAttackMs`, `warpReleaseMs`) and prune `mandalaKickFlare` from `Scene`**
  - Target files: `src/presets/schema.ts`, `src/render/scene.ts`, `src/render/__tests__/feedbackWarp.test.ts`
- **Slice 25.5: Activate morph-only presets in `hasLinks()` and unify Visual Gain / Calm scaling across audio signals**
  - Target files: `src/presets/loader.ts`, `src/main.ts`, `src/presets/loader.test.ts`
- **Slice 25.6: Complete `ParamSpec.description` strings across `warpOps.ts` & `format.ts` and wire universal Studio helper bar (`attachControlHelper`)**
  - Target files: `src/presets/warpOps.ts`, `src/presets/warpOps.test.ts`, `src/presets/format.ts`, `src/studio/studio.ts`
- **Slice 25.7: Verify universal Studio helper bar coverage and Warp Operator int/meter link targets**
  - Target files: `src/studio/studio.ts`, `src/studio/studio.test.ts`, `src/ui/style.css`
- **Slice 25.8: Add accessible Harness UI `[data-tooltip]` popover system and complete HUD ARIA labels**
  - Target files: `index.html`, `src/app.css`, `src/ui/controls.ts`, `src/ui/controls.test.ts`
- **Slice 25.9: Prune dead legacy HUD DOM elements (`#play-btn`, `stop`, `#time`, `#playback`, `#calm`, `#director-mode`, `.value-item`)**
  - Target files: `index.html`, `src/ui/controls.ts`, `src/render/compositor.ts`, `src/style.css`
- **Slice 25.10: Fix Studio `setInterval` leak, deduplicate Admin button, sync Global Director & dynamic dirty `*`, and wire truthful admin sync feedback**
  - Target files: `src/studio/studio.ts`, `src/studio/adminControls.ts`, `src/presets/session.ts`, `src/studio/studio.test.ts`
- **Slice 25.11: Humanize Studio layer/enum/source labels, add `[Linked]`/`[Morphed]` badges, and replace `window.prompt`/`confirm` with inline Studio DOM controls**
  - Target files: `src/presets/builtin/index.ts`, `src/studio/studio.ts`, `src/app.css`, `src/studio/studio.test.ts`
