# Stage 26: Optional Polish & Parked Visual Improvements Specification

> **Atlas Coordinate: `[496]`**  
> **Sector:** Sector 400 — System Spec & Architecture  
> **Status:** Final Spec (Decided 2026-11-18, Rebased on `origin/main` `f0ca49f`)  
> **Related Coordinates:** `[400]`, `[410]`, `[483]`, `[490]`, `[494]`, `[495]`

---

## 1. Executive Summary & Core Objectives

Following completion of Stages 24 and 25 on `origin/main` (`f0ca49f`), Stage 26 delivers the remaining optional polish and parked visual capabilities without duplicating features already shipped in Stages 18–20 (`bandTexture`, `ShapeLayer` 1024-sample cap, `Layer` retirement of legacy `WaveformLayer`, `WarpField` 11 operators, `BlurChain` bloom, `ColourMap` gradients):

1. **Studio Inline SVGs (`👑` & `⚠️` Emoji Replacement):**
   - Replace remaining `👑` and `⚠️` emoji characters in Studio DOM badges, helper-bar warnings, Tweakpane admin buttons, and admin status toasts with Lucide-style 16px stroke-1.75 inline `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">` icons matching Slice 24.9 (`index.html`, `src/ui/controls.ts`).
   - Preserve Tweakpane plain-text `btn.title` updates (including dynamic dirty `*` state in `refreshDirtyState()`) by injecting the crown `<svg>` into `.tp-btnv_b` before `.tp-btnv_t` (not inside `.tp-btnv_t` text) and safely guarding against mock test elements.
2. **Per-Preset `blendSec` + True `0s` Hard-Cut Beat Mode:**
   - Add optional per-preset `blendSec?: number` (`0..10` s) on `Preset` (`src/presets/format.ts`), falling back to `preset.transition.seconds` via `presetBlendSec(preset)` when absent, and editable via an override toggle + slider in Studio.
   - Add `hardCut?: boolean` to `CycleOptions` (`src/presets/autoCycle.ts`, persisted in `mv.autoCycle`) and a `"Hard cut on beat"` toggle in the Visuals auto-cycle panel when `mode === 'beat'`.
   - Remove the `0.05` lower clamp in `Compositor.setFadeSeconds(seconds)` (`Math.min(10, Math.max(0, seconds))`) so `0` (and `hardCut` beat switches) bypass weight easing and the 0.6s `'morph'` foreground ramp to snap scene weights in a single frame.
3. **Extra Global Director Palettes, Live Tint RGB Pickers & Low-Power Mode:**
   - Expand `GlobalDirector` (`src/render/globalDirector.ts`) with the 4 roadmap palettes: `noir` (*Monochrome Noir*), `acid` (*Acid Neon*), `aurora` (*Nordic Aurora*), and `sunset` (*Deep Sunset*), exposed in `#exp-color-select` (`index.html`) and Studio `buildGlobalDirectorControls`.
   - Add live custom `shadowTint` / `highlightTint` RGB overrides (`customTint`, `customShadowTint`, `customHighlightTint`) in `GlobalDirectorSettings` and bind live Tweakpane `view: 'color'` pickers in `buildGlobalDirectorControls` (`src/studio/studio.ts`).
   - Add a persistent **Low-Power Mode** toggle (`mv.lowPowerMode` in `src/gl/size.ts`, `#low-power-mode` in `index.html` / `src/ui/controls.ts`, wired in `src/main.ts`) that caps `getEffectiveRenderScale()` at `LOW_POWER_SCALE = 0.5` (without overwriting the user's saved Render Quality ceiling) and enables `Compositor.setLowPower(true)` to bypass heavy post-processing (`post.frag.glsl` / `BlurChain`) and cap crossfades (`LIGHT_FADE_MAX_SEC`) while keeping the single-pass `composite.frag.glsl` WCAG 2.3.1 safety pass active.
4. **Parked Visual Effects (Genuinely Missing Only):**
   - **`invert` Post Effect:** Add `invert` (`0..1`, default `0`, `intense: true`) to `POST_SPECS`, `FEEDBACK_POST_LAYOUT.Colour`, `POST_IDENTITY`, `Compositor`, and `post.frag.glsl` (executed before `clamp` + `applySafety(c)`).
   - **Radial `zoomexp` (`exponent`) WarpField Parameter:** Add `exponent` (`0.25..4.0`, step `0.05`, default `1.0`) to `warpOpSpecs('radial')` in `src/presets/warpOps.ts`, pack it into `uOpExtra[n].x` in `src/render/warpField.ts`, and evaluate `pow(clamp(r * scale * 1.4, 0.0, 1.0), expVal)` in `src/render/shaders/warpField.frag.glsl` (bit-identical at `1.0`).

---

## 2. Detailed Technical Contracts

### 2.1 Studio Inline SVGs (`👑` & `⚠️` Replacement)

1. **Icon Helper (`src/studio/adminControls.ts`):**
   - Export `type StudioIconName = 'crown' | 'alert-triangle'`.
   - Export `createStudioIconSvg(doc: Document, name: StudioIconName): SVGSVGElement | null` creating an SVG element in namespace `http://www.w3.org/2000/svg` (falling back safely if `createElementNS` is unavailable in minimal test doubles) with `class="ui-icon"`, `data-icon="${name}"`, `viewBox="0 0 24 24"`, `aria-hidden="true"`, and Lucide 16px stroke-1.75 geometry (`bundle.css` / `src/app.css` `.ui-icon` rules apply `width: 1em; height: 1em; stroke: currentColor; stroke-width: 1.75; fill: none`).
   - Export `attachButtonIcon(elementOrButton: unknown, name: StudioIconName, show = true): void`: resolves `el = elementOrButton?.element ?? elementOrButton`; looks up `btnEl = el?.querySelector?.('.tp-btnv_b') ?? el`; removes any existing `.ui-icon[data-icon="${name}"]`; when `show` is true, creates and prepends the `<svg>` before `.tp-btnv_t` (or `firstChild`). Because `.tp-btnv_t` holds Tweakpane's `btn.title` text, updating `btn.title` in `refreshDirtyState()` leaves the sibling `<svg>` intact.
2. **Label Constants & DOM Updates (`src/studio/adminControls.ts`, `src/studio/studio.ts`, `src/main.ts`):**
   - `ADMIN_BADGE_LABEL = 'Admin Mode Active'` (no emoji), `EXIT_ADMIN_LABEL = 'Exit Admin Mode'` (no emoji).
   - `renderAdminBadge(container, isAdmin)` clears `.studio-admin-badge`, appends `createStudioIconSvg(doc, 'crown')` (if non-null) and a text node `ADMIN_BADGE_LABEL`.
   - `renderHelperBar` in `src/studio/studio.ts` builds `.helper-warning` with `createStudioIconSvg(doc, 'alert-triangle')` + a `<span>` containing `warnText` (no `⚠️`).
   - `'Save System Preset'` and `'Promote to System Preset'` use plain-text titles in Tweakpane plus `attachButtonIcon(btn, 'crown', true)` (and the Admin toggle button uses `attachButtonIcon(btn, 'crown', isAdmin)`).
   - Toast strings in `adminControls.ts` and `main.ts` contain plain readable text without `👑`.
3. **Styling (`src/app.css`, `src/ui/style.css`):**
   - `.helper-warning` uses `display: inline-flex; align-items: center; gap: var(--space-1);`.
   - `.studio .tp-btnv_b:has(.ui-icon)` and `.studio-admin-action-btn` use `display: inline-flex; align-items: center; justify-content: center; gap: var(--space-1);`.

---

### 2.2 Per-Preset `blendSec` & True `0s` Hard-Cut Beat Mode

1. **Preset Format (`src/presets/format.ts`):**
   - `PRESET_BLEND_MIN_SEC = 0`, `PRESET_BLEND_MAX_SEC = 10`.
   - `clampBlendSec(value: unknown): number | undefined`: returns `undefined` if not a finite number; otherwise clamps to `[0, 10]` and rounds to `0.01` (`Math.round(clamped * 100) / 100`).
   - `presetBlendSec(preset: { blendSec?: number; transition: { seconds: number } } | undefined): number`: returns `clampBlendSec(preset?.blendSec) ?? preset?.transition.seconds ?? 1.2`.
   - `Preset` gains optional `blendSec?: number`. `parsePreset` validates `raw.blendSec` with `clampBlendSec`, pushes warning `'blendSec: not a number, ignored'` for non-finite/non-number values, and preserves `blendSec` when present.
2. **Auto-Cycle `hardCut` (`src/presets/autoCycle.ts`):**
   - Add `hardCut?: boolean` to `CycleOptions` and set `hardCut: false` in `DEFAULT_CYCLE`.
   - `loadCycleSettings` reads `typeof saved.hardCut === 'boolean'`; `saveCycleSettings` writes `hardCut: Boolean(opts.hardCut)`.
3. **Compositor `0s` Instant Cut (`src/render/compositor.ts`):**
   - `setFadeSeconds(seconds: number)`: `this.fadeSec = Number.isFinite(seconds) ? Math.min(10, Math.max(0, seconds)) : 1.2;` (preserving `0`).
   - `easeOne(name, w, dtSec)`: when `this.effectiveFadeSec() <= 0`, sets `this.weights.set(name, t)` immediately without calling `releaseEnvelope`.
   - `draw()`: `isMorph = TRANSITIONS[this.transition] === 'morph' && this.effectiveFadeSec() > 0`. When `this.effectiveFadeSec() <= 0`, `easeWeights(clock.dtSec)` runs even if `initialising` is true so the incoming scene draws at weight `1` and outgoing drops to `0` on the same frame.
4. **Session, Main, Studio & HUD Wiring:**
   - `src/presets/session.ts`: `show()` and remote system-preset refresh call `this.host.setFadeSeconds(presetBlendSec(preset))`.
   - `src/main.ts`: on auto-cycle beat switch (`cycle.mode === 'beat' && cycle.hardCut`), call `compositor?.setFadeSeconds(0)` immediately after `switchShown(pick)`.
   - `src/studio/studio.ts`: add `"Custom blend time"` checkbox + `"Blend time (s)"` slider (`0..10`, step `0.05`, hidden when override is off) in the Transition section.
   - `index.html` & `src/ui/controls.ts`: add `#exp-cycle-hard-cut-row` / `#exp-cycle-hard-cut` checkbox (visible only when `cycle.mode === 'beat'`).

---

### 2.3 Extra Global Director Palettes, Live Tint Pickers & Low-Power Mode

1. **4 Roadmap Palettes (`src/render/globalDirector.ts`):**
   - Add `'noir'`, `'acid'`, `'aurora'`, `'sunset'` to `COLOR_MOODS`, `PALETTE_NAMES`, `AUTOCYCLE_PALETTES`, and `DIRECTOR_PALETTES`:
     - `noir` (*Monochrome Noir*): `shadowTint: [0.12, 0.12, 0.14]`, `highlightTint: [0.95, 0.95, 0.98]`, `spatialSpread: 0.25`.
     - `acid` (*Acid Neon*): `shadowTint: [0.18, 0.02, 0.35]`, `highlightTint: [0.65, 1.0, 0.05]`, `spatialSpread: 0.55`.
     - `aurora` (*Nordic Aurora*): `shadowTint: [0.0, 0.35, 0.28]`, `highlightTint: [0.65, 0.12, 0.85]`, `spatialSpread: 0.55`.
     - `sunset` (*Deep Sunset*): `shadowTint: [0.22, 0.04, 0.18]`, `highlightTint: [1.0, 0.42, 0.12]`, `spatialSpread: 0.50`.
   - Expose `<option>` entries in `index.html` (`#exp-color-select`) and `buildGlobalDirectorControls` (`src/studio/studio.ts`).
2. **Live `shadowTint` / `highlightTint` Pickers (`src/render/globalDirector.ts`, `src/studio/studio.ts`):**
   - Extend `GlobalDirectorSettings` with optional `customTint?: boolean`, `customShadowTint?: string` (`#rrggbb`), `customHighlightTint?: string` (`#rrggbb`), sanitized and persisted in `mv.globalDirector`.
   - When `settings.customTint` is true (and `colorMood !== 'native'` and `colorIntensity > 0`), `getColorUniforms()` applies the parsed `customShadowTint` / `customHighlightTint` RGB triples directly (and preserves luminance-safe scaling in `post.frag.glsl`).
   - In `buildGlobalDirectorControls` (`src/studio/studio.ts`), add `"Custom tint"` boolean binding plus live `"Shadow tint"` and `"Highlight tint"` (`view: 'color'`) bindings, synced with `director.subscribeExperienceChange` and `attachControlHelper`.
3. **Low-Power Mode (`src/gl/size.ts`, `src/render/compositor.ts`, `index.html`, `src/ui/controls.ts`, `src/main.ts`):**
   - `src/gl/size.ts`: export `LOW_POWER_SCALE = 0.5`, `LOW_POWER_STORAGE_KEY = 'mv.lowPowerMode'`, `getLowPowerMode(): boolean`, `setLowPowerMode(on: boolean): boolean`. When `lowPowerMode` is true, `getEffectiveRenderScale()` returns `Math.min(renderScale, autoScale, LOW_POWER_SCALE)` without altering the saved `mv.renderScale`.
   - `src/render/compositor.ts`: add `setLowPower(on: boolean): void` and `isLowPower(): boolean`. When `lowPower` is true:
     - `postActive()` returns `false`, so `draw()` skips `BlurChain` / `post.frag.glsl` and executes the single-pass `composite.frag.glsl` (`blendPass` with `safety = 1`), preserving WCAG 2.3.1 safety guarantees.
     - `effectiveFadeSec()` caps crossfade duration at `LIGHT_FADE_MAX_SEC` and `draw()` skips redrawing the outgoing scene during crossfades (`lightFade` behavior).
   - `index.html`, `src/ui/controls.ts`, `src/main.ts`: add `#low-power-mode` checkbox in `#experience-panel`, persist via `setLowPowerMode()`, and call `compositor.setLowPower(on)` on startup and toggle.

---

### 2.4 Parked Visual Effects (`invert` Post & Radial `exponent`)

1. **`invert` Post Effect (`src/presets/layerSchemas.ts`, `src/presets/schema.ts`, `src/render/compositor.ts`, `src/render/shaders/post.frag.glsl`):**
   - Add `{ type: 'float', name: 'invert', label: 'Invert colours', group: 'Colour', default: 0, min: 0, max: 1, step: 0.01, description: 'Blends pixels toward their RGB inverse before the brightness safety limiter.', intense: true, warning: 'Intense visual transform. Can invert dark backgrounds to bright — use with care.' }` to `POST_SPECS` and `'invert'` to `FEEDBACK_POST_LAYOUT.Colour`.
   - Add `invert: 0` to `POST_IDENTITY`, `p.invert > 0` to `hasPost()`, and upload `uInvert` in `finalPass()`.
   - In `post.frag.glsl`, declare `uniform float uInvert;` and apply `if (uInvert > 0.0) c = mix(c, 1.0 - clamp(c, 0.0, 1.0), uInvert);` immediately before the final `clamp(c, 0.0, 1.0); c = applySafety(c);` (leaving `@blend-begin`/`@blend-end` and `@safety-begin`/`@safety-end` untouched).
2. **Radial `zoomexp` (`exponent`) (`src/presets/warpOps.ts`, `src/render/warpField.ts`, `src/render/shaders/warpField.frag.glsl`):**
   - Add `exponent` (`float`, `0.25..4.0`, step `0.05`, default `1.0`, label `'Zoom exponent'`) to `warpOpSpecs('radial')`.
   - In `WarpField.update()`, pack `numberOf(op.values, 'exponent', 1)` into `this.extras[n * 3]` for `op.type === 'radial'`.
   - In `warpField.frag.glsl` (`type == 0`), compute `float expVal = max(0.25, extra.x > 0.0 ? extra.x : 1.0); float edge = pow(clamp(r * scale * 1.4, 0.0, 1.0), expVal);`. At default `exponent = 1.0`, output is bit-identical to prior behavior.

---

## 3. Atomic Implementation Slices (Stage 26)

Every slice touches `< 5` target files (including all affected test files):

- **Slice 26.1:** Replace `👑` emoji in Studio Admin controls, toast messages, and CSS alignment (`src/studio/adminControls.ts`, `src/main.ts`, `src/app.css`, `src/studio/studio.test.ts`)
- **Slice 26.2:** Replace `⚠️` and `👑` in Studio helper bar and Tweakpane admin buttons (`src/studio/studio.ts`, `src/ui/style.css`, `src/studio/studio.test.ts`)
- **Slice 26.3:** Add optional per-preset `blendSec` in format and `hardCut` option in autoCycle (`src/presets/format.ts`, `src/presets/format.test.ts`, `src/presets/autoCycle.ts`, `src/presets/autoCycle.test.ts`)
- **Slice 26.4:** Support `0s` instant cut in Compositor and wire `presetBlendSec` and `hardCut` in Session and Main (`src/render/compositor.ts`, `src/render/compositor.test.ts`, `src/presets/session.ts`, `src/main.ts`)
- **Slice 26.5:** Add Studio `Blend time` override controls (`src/studio/studio.ts`, `src/studio/studio.test.ts`)
- **Slice 26.6:** Add HUD `Hard cut on beat` toggle (`index.html`, `src/ui/controls.ts`, `src/ui/controls.test.ts`)
- **Slice 26.7:** Add 4 roadmap Global Director palettes and live tint override support (`src/render/globalDirector.ts`, `src/render/__tests__/globalDirector.test.ts`)
- **Slice 26.8:** Expose new Global Director palettes and live tint RGB pickers in Studio and Visuals menu (`src/studio/studio.ts`, `src/studio/studio.test.ts`, `index.html`, `src/ui/controls.test.ts`)
- **Slice 26.9:** Implement Low-Power Mode scale cap and Compositor post-pass bypass (`src/gl/size.ts`, `src/gl/size.test.ts`, `src/render/compositor.ts`, `src/render/compositor.test.ts`)
- **Slice 26.10:** Wire Low-Power Mode toggle in Visuals panel and Main (`index.html`, `src/ui/controls.ts`, `src/ui/controls.test.ts`, `src/main.ts`)
- **Slice 26.11:** Add `invert` post-processing effect to schema, Compositor, and post shader (`src/presets/layerSchemas.ts`, `src/presets/schema.ts`, `src/render/shaders/post.frag.glsl`, `src/render/compositor.ts`)
- **Slice 26.12:** Verify `invert` post effect and add radial `exponent` (`zoomexp`) to WarpField (`src/render/compositor.test.ts`, `src/presets/warpOps.ts`, `src/render/warpField.ts`, `src/render/shaders/warpField.frag.glsl`)
- **Slice 26.13:** Update `warpOps`, `warpField`, and `layerSchemas` tests for radial `exponent` and `invert` (`src/presets/warpOps.test.ts`, `src/render/warpField.test.ts`, `src/presets/layerSchemas.test.ts`)
