# Pre-Spec: Global Director Consolidation, Experience Hub & Future Roadmap (Sector 484)

> Status: Pre-spec architecture, codebase audit, and design options recorded 2026-11-07. Ready for interactive trade-off selection and slice generation when prioritized.

---

## 1. Codebase Audit Findings (Why Consolidation Pays Off Now)

Our codebase audit surfaced several structural insights that make consolidating `Calm` and `Global Director` high-leverage:

1. **Mobile & HUD Layout Friction (`index.html:76-90`, `src/style.css:96`)**:
   - `.controls .display-row` uses a 3-column grid (`grid-template-columns: repeat(3, minmax(0, 1fr))`) originally designed for 3 items (`Calm`, `Render quality`, `Aspect correction`).
   - Adding `#director-mode` as a 4th sibling forces an awkward 2nd-row wrap on narrow viewports. Consolidating `Calm` and `Director` into a unified **Experience / Director Hub** restores the clean 3-column HUD layout.
2. **Scattered `Calm` State & Missing Layer Wiring (`src/main.ts:44-53, 253-287`, `src/render/layers/rings.ts:29`)**:
   - `Calm` is currently wired across 7 separate call sites (`#calm` DOM checkbox, `advanceSway`, `advanceCrown`, `colourSwap`, `flagLayer`, `GlobalDirector.setCalm`, `CALM_SCALE`, and `Compositor.draw` DOM polling at `compositor.ts:428`), yet it **isn't persisted to `localStorage`**, has **no keyboard shortcut**, and **`RingsLayer.calm` (`rings.ts:29`) was never wired in `flagLayer()`**.
   - Furthermore, `GlobalDirector.setCalm(true)` currently damps camera motion (`intensity <= 0.25`, `roll/tilt * 0.25`) but leaves color intensity/mood untouched and does not filter out high-energy strobe/shockwave presets.
3. **Shortcut Availability (`src/ui/controls.ts`, `src/main.ts`, `src/ui/debugPanel.ts`)**:
   - `D` is already bound to `DebugPanel` (`debugPanel.ts:139`).
   - **`M` (Mode / Mood)** and **`G` (Global Director Hub)** are completely free and ergonomic.
4. **Toast Occlusion Bug (`src/style.css:112-113`, `src/ui/toast.ts`)**:
   - `#toast` sits at `top: 1rem; right: 1rem` with no `z-index`, so when Preset Studio (`z-index: 5`, `top: 12px; right: 12px`) is open, toasts render *behind* the Studio panel. Raising `.toast` `z-index: 10` (or centering/shifting left when Studio is open) fixes this immediately.
5. **Drag-and-Drop & Import/Export Opportunity (`src/ui/controls.ts:134-143`, `src/presets/session.ts:230-248`)**:
   - Currently,Preset import/export is buried inside Preset Studio (`Studio.exportFile` / `Studio.importFile`), and the window drag-and-drop listener in `controls.ts:134` only accepts audio files. Extending window drag-and-drop and the top-level Hub to accept `.json` files makes sharing presets and palettes zero-friction.

---

## 2. Major Initiative: Calm Consolidation & Experience Hub Options

### 2.1 Experience Profiles (Consolidating `Calm` + `Director`)

Instead of a separate binary `Calm` checkbox fighting with a separate `Director` dropdown, we define **Unified Experience Modes** (cycled via hotkey **`M`** or selected in the HUD):

| Experience Mode | Camera Behavior | Color Behavior | Preset & Layer Behavior (`calm` flag) |
| :--- | :--- | :--- | :--- |
| **`Cinematic` (Default)** | `auto` (Complementary axes, `0.65` intensity) | `auto` (Breathing split-tone palettes, `0.45` intensity) | Full reactivity (`calm = false`) |
| **`Calm / Ambient`** | Gentle drift (`stillAnchor` / `craneSway`, `<= 0.25` intensity, `0.25x` roll/tilt) | Soothing mood (`biolum` / `ember`, `0.30` intensity, no transient burst flares) | `calm = true` across all layers (including `RingsLayer`) + optional switch/filter to ambient presets |
| **`Minimal / Clean`** | `off` (`1.0x` zoom, zero pan/tilt/roll) | `native` (Preset original colors, `0` override) | Full layer geometry (`calm = false`), zero post-camera/color |
| **`Color Walk`** | `stillAnchor` / `off` | `auto` with boosted intensity (`0.70`) & faster breathing hue cycle | Full layer reactivity (`calm = false`) |
| **`Custom` (Studio)** | Whatever custom combination the user dialed in inside Preset Studio | User's custom Studio color settings | Respects user's manual Calm/safety preference |

> **Accessibility & Backward Compatibility Note**:
> To honor WCAG 2.3.1 and `prefers-reduced-motion: reduce`, startup automatically selects **`Calm / Ambient`** when the OS reduced-motion media query matches, and a quick `Calm` toggle or safety lock remains one click away inside the Hub.

---

### 2.2 Three UI Architecture Options for the HUD Experience Hub

When we implement this, we can choose between three UI footprints in the bottom HUD:

- **Option A — Inline HUD Popover Pill (Matches `Volume` / `Visual gain` `.value-item` pattern)**:
  - Replace the separate `#calm` switch and `#director-mode` select in `.display-row` with a single **`Experience: Cinematic ▾`** button (`<button class="value-btn">`) that pops up a compact floating card right above the HUD bar containing:
    1. **Mode Pills**: `Cinematic` · `Calm` · `Minimal` · `Color Walk`
    2. **Quick Sliders / Selects**: `Camera Move`, `Color Mood`, `Calm Safety Lock`, and `"Switch to calmer preset on Calm"` checkbox.
    3. **Share Row**: `Import JSON` (Preset / Palette / Bundle) & `Export Current Look` buttons.
  - *Pros*: Zero new modal paradigms; reuses existing `.value-panel` focus/Escape/mobile-sheet mechanics; fixes the 3-column mobile grid immediately.

- **Option B — Dedicated Top-Level "Director & Assets" Drawer / Modal (`G` Key)**:
  - Keep a 1-click **Mode Cycle pill** (`Mode: Cinematic` -> `Calm` -> `Minimal` -> `Color Walk`) directly on the HUD bar, plus a **`Hub (G)`** button next to `Studio (E)` that opens a clean, consumer-friendly overlay for browsing Presets by mood tag (`All`, `Flagship`, `Calm / Ambient`, `Yours`), picking Palettes with visual color swatches, and dragging/dropping JSON files.
  - *Pros*: Gives visual color swatches and preset browsing room to breathe without opening the developer-heavy Tweakpane Studio.

- **Option C — Hybrid (Quick Mode Pill in HUD + Expanded Top Section in Studio)**:
  - Put the unified Mode selector + Import/Export buttons in the HUD `.value-panel` popover, while enriching the `Global Director` folder in Studio with custom palette color pickers.

---

### 2.3 Calmer Preset Tagging & Auto-Cycle Filtering

How should **`Calm / Ambient`** mode interact with the 35 built-in presets?
1. **Curated `"calm"` Tag on Ambient Built-ins**:
   - Tag the ~12 naturally contemplative presets with `"calm"` (e.g., `01-curl-fluid-warp`, `03-solarized-contour-rings`, `08-spectral-ridge-terrain`, `09-chladni-cymatic-sand`, `10-phyllotaxis-spiral-bloom`, `12-reaction-diffusion-coral`, `tex-silk-rings`, `tex-dust-wave`, `starter-quiet-tunnel`, `starter-soft-smoke`).
   - Add aheuristic fallback `isCalmPreset(preset)` so user-created presets without `shockwave` or `moire` are also recognized as calm-friendly.
2. **Behavior When Entering `Calm / Ambient` Mode**:
   - **Auto-Cycle Pool**: `eligible()` in `src/presets/autoCycle.ts` automatically restricts auto-cycling to `"calm"` presets while in Calm mode.
   - **Immediate Switch Option**: If the user is currently on an intense preset (like `05-rgb-aberration-vortex` or `07-moire-interference-loom`) when they activate `Calm / Ambient`, automatically crossfade to a curated `"calm"` preset (configurable via a toggle in the Hub).

---

### 2.4 Polymorphic Preset & Palette Import / Export

We can unify sharing so **one Import button (and window drag-and-drop)** handles any JSON asset automatically via a `kind` discriminator:

1. **Standard Preset JSON (`version: 1`, backward-compatible)**:
   - Optional new field: `"directorProfile": { "cameraMode": "horizonTilt", "colorMood": "ember", "colorIntensity": 0.55 }`.
   - Existing preset files import with zero changes; presets exported from the Hub optionally bundle their recommended Director mood.
2. **Standalone Custom Palette JSON (`kind: "mv-director-palette"`)**:
   ```json
   {
     "kind": "mv-director-palette",
     "version": 1,
     "id": "nordic-aurora",
     "name": "Nordic Aurora",
     "shadowTint": [0.0, 0.35, 0.28],
     "highlightTint": [0.65, 0.12, 0.85],
     "spatialSpread": 0.55
   }
   ```
   - Saved to `localStorage['mv.customDirectorPalettes']` and immediately selectable in the Color Mood dropdown and auto-cycle pool.
3. **Experience Look Pack Bundle (`kind: "mv-experience-bundle"`)**:
   - Exports multiple user presets + custom director palettes + active director settings in a single shareable `.json` file.

---

### 2.5 Enhanced Toast Notifications (`src/ui/toast.ts`)

1. **Structured & Swatch-Aware `showToast(text, opts?)`**:
   - Maintain 100% backward compatibility with `showToast("message")`.
   - Support `showToast("Mode: Calm", { detail: "Still Anchor · Bioluminescent", swatch: [[0.0, 0.17, 0.21], [0.0, 1.0, 0.67]], durationMs: 2400 })` which renders a dual-tone gradient dot next to the title and subtitle.
   - Fix `.toast` `z-index: 10` so toasts are always visible even when Studio is open.
2. **Macro Transition Toasts (Optional / Toggleable)**:
   - Always show a toast when the user switches Experience Modes (`M` key or HUD), imports/exports an asset, or manually changes Director settings.
   - Optionally allow a subtle toast when the Global Director autonomously transitions on a song section change (e.g., *"Director: Horizon Tilt · Vapor"*).

---

## 3. Additional Future Roadmap Items (For Later Drilldown)

- **Expanded Built-in Palettes**: *Monochrome Noir*, *Acid Neon*, *Nordic Aurora*, *Deep Sunset*.
- **In-App Custom Palette Picker**: Live `shadowTint` / `highlightTint` RGB color pickers in Studio / Hub.
- **Advanced Camera Dynamics**:
  - *Bass-Kick Micro-Zooms* (subtle 2–4% spring impulse on heavy drops).
  - *Handheld Simplex Drift* (organic 2D noise camera floating).
  - *Centrifugal Drop Transitions* (brief energetic tilt/roll on major section drops).
- **Performance / Low-Power Mode**: Bypass post pass on battery-saver or when frame budget exceeds 16.7ms.
