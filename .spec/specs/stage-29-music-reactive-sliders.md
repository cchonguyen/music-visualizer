# Stage 29 Architectural Specification: Music-Reactive Core Sliders & Song-Arc Modulation (Sector 499)

**Status:** Approved & Locked for Implementation (2026-11-23)  
**Coordinate:** `499` (`.spec/specs/stage-29-music-reactive-sliders.md`)

---

## 1. Executive Summary & Architectural Goals

Stage 29 brings inline music-reactive core sliders to the Stage 28 codebase across **Feedback, Warp Operators (`WarpOp`), Post-Processing, Shape, Particles, Spectral Terrain, and all generative layers**:
1. **100% Backward-Compatible `PRESET_VERSION = 1` Extension:** All new properties on `AudioLink` and `LayerEntry.opacityLink` are optional and omitted when unset, preserving existing presets, `WarpOp` stacks, `displaySec`/`blendSec`, and exact `parseLink` round-trip equality.
2. **Song-Arc Macro Sources & Direction Flipping:** Appends `drop`, `breakdown`, `phrase16`, `phrase32`, and `energySlow` to `AUDIO_SOURCES`, plus response curves (`linear`, `punch`, `swell`, `gate`), normalized bounds (`minBound`, `maxBound`), and smooth polarity-slewed direction-reversal modes (`flipOnBeat`, `flipOnDrop`, `flipOnSection`) centered on each parameter's neutral point (`1.0` for `zoom`, `0.0` for signed params, `spec.default` otherwise).
3. **Calm & Photosensitivity Safety:** `LinkInputs.calm` attenuates modulation depth (`0.35×`, or `0.20×` for `spec.intense` params) and works alongside the compositor `BrightnessLimiter` (`safety.ts`) and Stage 26 Low-Power Mode.
4. **Parameter-Aware 1-Click Recipes (`linkRecipes.ts`):** Curated recipes (`kickPunch`, `bassSwell`, `dropSurge`, `flipOnDrop`, `flipOnBeat`, `phraseDrift`, `breakdownBloom`) automatically scale `amount` for sensitive parameters (`zoom`, `rotate`, `decay`, `fade`, `driftX/Y`, `centreX/Y`, `intense`).
5. **Extended Targets (`enum`, `colour`, `opacityLink`):** Cooldown-gated discrete `enum` switching (`cooldownSec` doubled in Calm mode), per-layer `LayerEntry.opacityLink` resolved in `loader.ts`, and HSL `colour` hue shifting (`hexToHsl`, `hslToHex`, `shiftHexHue`) with dark-floor preservation.
6. **Inline Studio UX & Deferred Rebind Fix:** Every numeric slider, enum dropdown, colour picker, and selected layer `Opacity` slider across Feedback (`F`), Warp Operators (`W${w}`), Layers (`L${k}`), and Post (`P`) gets an inline `⚡` toggle button, single-open collapsible mini-drawer, live CSS modulation range + dot overlays driven by `rAF` only when Studio is open, and a bottom `⚡ Active Links` overview folder (while preserving `linkTargets` and `.studio-link-badge`/`.studio-morph-badge` compatibility). `Studio.bind()` defers `oldPane.dispose()` via `queueMicrotask` to eliminate `"View has been already disposed"` errors on preset/layer switching.
7. **Flagship Presets:** Stage 28 flagship presets `01`, `02`, `04`, `05`, `08`, `10`, `13`, and `14` are upgraded with non-destructive musical reactivity while preserving all Stage 25–28 parameters (`skirtOpacity: 0.15` on `08`, no retired `mandalaKickFlare` on `02`).

---

## 2. Atomic Slice Breakdown

- **Slice 29.1 (`[CORE / DATA]`):** Extended `AudioLink` + `LayerEntry.opacityLink` schema/parsing, 5 song-arc `AUDIO_SOURCES`, `LinkRunner` curves/flips/macro/calm/enum/colour/caches, `loader.ts` `opacityLink` + `warpOps` resolution, and `linkRecipes.ts` with comprehensive unit tests.
- **Slice 29.2 (`[UI / VISUAL]`):** `src/studio/reactiveSlider.ts`, Studio inline `⚡` controls (Feedback, WarpOps, Layers, Opacity, Post), live track overlays, `⚡ Active Links`, deferred Tweakpane rebind dispose fix, `main.ts` wiring, CSS, and `studio.test.ts` tests.
- **Slice 29.3 (`[CORE / DATA]`):** Musical reactivity pass on flagship built-in presets `01`, `02`, `04`, `05`, `08`, `10`, `13`, `14` and regression assertions in `presets.test.ts`.
