# Stage 12: Consolidated HUD & Segmented Pill Architecture Specification
<!-- Coords: [400, 410, 488] -->

## 1. Overview & Architectural Motivation

The user interface of the music visualizer has accumulated numerous independent controls across Stages 1–11:
1. **Fragmented Popups:** `Volume`, `Visual Gain`, and `Beat Sensitivity` each open separate floating slider popups.
2. **Scattered Display Controls:** `Experience` mode opens a popup card, while `Render Quality` (a `<select>` dropdown) and `Aspect Correction` (a checkbox) stand loosely on the main bar.
3. **Scattered Audio Source Inputs:** `File…`, `Tab / system audio`, `Microphone`, `Test signal…`, and `Stop` all sit side-by-side as distinct standing buttons.
4. **VCR-Era Redundancy:** Having both `Pause` and `Stop` standing side-by-side caused confusion: live audio streams (Tab/Mic) cannot be paused, and local audio files in modern players (Spotify, YouTube, QuickTime) only need a single Play/Pause toggle.
5. **Horizontal Sprawl:** 12+ separate elements compete for horizontal space, causing severe wrapping and visual noise that detracts from the full-screen visualizer canvas.

### The Approved Architecture: Segmented Pill System
Stage 12 consolidates the entire bottom HUD into **three sleek segmented pills** and **two unified hub popups**, featuring:
- **Audio Pill (Source + Contextual Action + Timeline):** Merges Tab Audio, Mic, Local File, and Test Signal into a single `Source ▾` selector. A single **contextual action button** toggles Play/Pause for audio files or Stop Stream for live inputs (Tab, Mic, Test Signal). The timeline scrubber only displays when local file playback is active.
- **Visuals & Studio Pill (`Visuals` | `Studio`):** Combines the creative control center (`Visuals`) with the developer/shader tool (`Studio`) separated by a hairline divider. `Visuals` consolidates Experience Mode, Camera Dynamics, Color Palette, Visual Gain, Beat Sensitivity, Render Quality, and Aspect Correction into one unified dialog.
- **Utilities Pill (`?` | `⛶`):** Clustered Help/Shortcuts and Fullscreen toggles.
- **Startup Onboarding Toast:** A gentle prompt docked above the HUD instructing the user how to start visualizing (Tab, Mic, or File/System), auto-dismissing on interaction, and re-summonable from the Help dialog.

---

## 2. Component Specifications

### 2.1 The Standing HUD Bar (Single Horizontal Row)

```
HUD Bar:
┌────────────────────────────────────────────────────────┐┌───────────────────┐┌────────┐
│ [🎙️ Source: Mic ▾]  │  [⏹ Stop Stream]                 ││ [✨ Visuals ▾] │ [🎛️ Studio] ││ [?]│[⛶]│
└────────────────────────────────────────────────────────┘└───────────────────┘└────────┘
                                    OR (When Local Audio File is loaded)
┌───────────────────────────────────────────────────────────────────────────────┐
│ [🎵 Source: track.mp3 ▾]  │  [⏸ Pause]  │  [ 1:12 ━━━━━●━━━━━ 3:45 ]         │
└───────────────────────────────────────────────────────────────────────────────┘
```

#### Pill 1: Audio Segmented Pill (`#audio-pill`)
- **Container:** `.pill-container` with glassmorphic dark surface, subtle border, and rounded corners (`--radius-lg`).
- **Segment A (`#source-btn`):**
  - Displays icon reflecting active source (🎙️ Mic, 🖥️ Tab, 🎵 File, ⚡ Test Signal, or 🔊 Idle).
  - Displays label: `Source: <Active Name>`.
  - Shows chevron `▾` indicating it opens the Source Popup.
  - Toggles `#source-panel` popup.
- **Separator 1 (`.pill-separator`):** Vertical hairline divider (1px width, `#2a2f40`).
- **Segment B (`#playback-action-btn`):** The contextual action button.
  - **State A (Local Audio File active):** Shows **Pause (⏸)** when playing, **Play (▶)** when paused. Toggles media playback via Spacebar or click.
  - **State B (Live Stream active — Tab / Mic / Test Signal):** Shows **Stop (⏹)** with red badge/accent. Stops the capture stream, releases hardware/browser tracks, and returns engine to idle.
  - **State C (Idle / No Source):** Hidden or prompts source selection.
- **Separator 2 (`#timeline-separator`):** Visible *only* when the timeline scrubber is active.
- **Segment C (`#playback-scrubber-segment`):**
  - Visible *only* when a local audio file is loaded or was the last active source.
  - Current elapsed time readout (`#time-current`).
  - Native range slider (`#seek`) styled with visualizer accent fill and thumb glow.
  - Total duration readout (`#time-total`).

#### Pill 2: Visuals & Studio Segmented Pill (`#visuals-pill`)
- **Container:** `.pill-container` matching Pill 1 styling.
- **Segment A (`#experience-btn`):**
  - Displays sparkle icon ✨ and label: `Visuals` (with active mode pill e.g. `Cinematic`).
  - Chevron `▾` indicating it opens the Consolidated Visuals Popup.
  - Toggles `#experience-panel`.
- **Separator (`.pill-separator`):** Vertical hairline divider.
- **Segment B (`#studio-open`):**
  - Displays slider icon 🎛️ and label: `Studio`.
  - Toggles the Tweakpane-based Studio drawer/panel.

#### Pill 3: Utilities Pill (`#utilities-pill`)
- **Segment A (`#shortcuts-btn`):** Help/Shortcuts icon button `?`.
- **Separator:** Vertical hairline divider.
- **Segment B (`#fs-btn`):** Fullscreen toggle icon button `⛶`.

---

### 2.2 Consolidated Source Popup (`#source-panel`)

Floats directly above the `#source-btn` in desktop view; opens as an accessible drawer on narrow viewports.

Contains 4 first-class audio sources:
1. **Tab / System Audio Card:**
   - Icon: Screen/Tab 🖥️
   - Title: "Tab / System Audio"
   - Description: "Capture audio stream playing in your browser or desktop."
   - Action: Calls `engine.useDisplayCapture()`.
2. **Microphone Card:**
   - Icon: Mic 🎙️
   - Title: "Microphone"
   - Description: "Live microphone input with low latency."
   - Action: Calls `engine.useMic()`.
3. **Local Audio File Card:**
   - Icon: Music Note 🎵
   - Title: "Local Audio File"
   - Description: "Play MP3, WAV, FLAC, AAC with full timeline scrubbing."
   - Elements: Current track title, "Browse / Change File" button (`#file-btn`), hidden input (`#file-input`).
   - Action: Calls `engine.useFile(file)`.
4. **Hardware Test Signal Card:**
   - Icon: Lightning Bolt ⚡
   - Title: "Hardware Test Signal"
   - Description: "Synthesized reference signals for audio & visual calibration."
   - Elements: `<select id="test-select">` with options:
     - `kick`: Kick drum pulse (60 Hz, 120 BPM)
     - `tone`: Pure reference tone (2 kHz sine wave)
     - `sweep`: Frequency sweep chirp (40 Hz – 8 kHz)
     - `silence`: Zero-signal baseline
   - Action: Calls `engine.useTestSignal(val)`.
5. **Output Volume Slider (Footer):**
   - Speaker icon, Master Volume percentage readout (`#volume-value`), range slider (`#volume`).
   - Action: Calls `engine.setVolume(val)`.

---

### 2.3 Consolidated Visuals Popup (`#experience-panel`)

Floats directly above `#experience-btn`. Combines all visual tuning, mode, reactivity, and rendering settings into one creative dashboard:

1. **Experience Mode Header & Grid:**
   - Title: "Experience Mode" (Shortcut: `M`)
   - 4 Mode Buttons: `Cinematic`, `Calm`, `Minimal`, `Color Walk`.
   - Selecting a mode applies camera, color, and motion presets immediately.
2. **Camera Dynamics & Color Palette Row:**
   - Camera Select (`#exp-camera-select`): Auto, Crane sway, Dutch roll, Push swell, Horizon 2.5D, Still anchor, Off.
   - Color Palette Select (`#exp-color-select`): Auto-cycle, Native, Cyberpunk, Ember, Biolum, Vapor, Prismatic.
3. **Reactivity & Sensitivity Sliders:**
   - Visual Gain (`#gain`): `0.50×` to `3.00×` with live readout (`#gain-value`).
   - Beat Sensitivity (`#beat-sensitivity`): `0%` to `100%` with live readout (`#beat-value`).
4. **Render Quality & Aspect Correction Row:**
   - Render Quality (`#render-quality`): 1080p, 720p, 540p.
   - Aspect Correction (`#aspect-correct`): Checkbox/toggle with clear label.
5. **Look Import/Export Actions:**
   - "Export Look" button (`#exp-export-btn`)
   - "Import JSON" label/input (`#exp-import-input`)

---

### 2.4 Onboarding Guidance Toast (`#onboarding-toast`)

- **Placement:** Docked gently above the center of the HUD bar on app initialization.
- **Copy:**
  > *"Ready to visualize audio — Click Source ▾ to choose Tab Audio, Microphone, Local File, or Test Signal."*
- **Auto-Dismiss:** Dismisses automatically upon any click or interaction on the HUD controls.
- **Re-summonable:** The Shortcuts/Help dialog (`#shortcuts`) includes a button: *"Show Getting Started Guide"*, allowing users to restore the toast at any time.

---

## 3. Slice Breakdown

### Slice 12.1: DOM & HTML Structure Consolidation in `index.html`
- **Target Files:** `index.html`
- **Scope:**
  - Restructure `#controls` into the 3 segmented pill containers (`#audio-pill`, `#visuals-pill`, `#utilities-pill`).
  - Create `#source-panel` containing Tab, Mic, File (with `#file-btn` and `#file-input`), Test Signal (`#test-select`), and Master Volume (`#volume`).
  - Update `#experience-panel` to house `#gain`, `#beat-sensitivity`, `#render-quality`, and `#aspect-correct` in addition to existing modes/camera/palette.
  - Insert `#onboarding-toast` template above the HUD controls.
  - Add "Show Getting Started Guide" button in `#shortcuts` dialog.
- **Verification:** `npm run build`

### Slice 12.2: CSS Styles & Segmented Pill Design in `src/style.css`
- **Target Files:** `src/style.css`
- **Scope:**
  - Define `.pill-container`, `.pill-segment`, and `.pill-separator` classes using existing design tokens (`--surface`, `--surface-2`, `--border`, `--accent`).
  - Single-line alignment for `.controls` on desktop (horizontal row with `justify-content: space-between`).
  - Positioning and animations for `#source-panel` and updated `#experience-panel`.
  - Toast styling with `@keyframes toastSlideUp` and dismiss transitions.
  - Responsive layout under 600px ensuring touch targets meet 44px minimum.
- **Verification:** `npm run build`

### Slice 12.3: Controls Logic & Contextual Action Wiring in `src/ui/controls.ts`
- **Target Files:** `src/ui/controls.ts`
- **Scope:**
  - Wire `#source-btn` and `#source-panel` toggle logic.
  - Wire the 4 audio sources from within `#source-panel` (Tab, Mic, File, Test Signal).
  - Implement contextual action button (`#playback-action-btn`):
    - Toggles `play()` / `pause()` when local file is active.
    - Calls `engine.stop()` when Tab / Mic / Test Signal is active.
    - Updates icon, label, and accessible tooltip.
  - Morph `#audio-pill` dynamically: hide/show scrubber segment and divider based on source.
  - Wire consolidated sliders and selects inside `#experience-panel`.
  - Implement `#onboarding-toast` lifecycle: auto-show on initial startup, dismiss on HUD interaction, re-summon via help dialog.
- **Verification:** `npm run typecheck && npm run build`

### Slice 12.4: Unit Tests & Regression Verification in `src/ui/controls.test.ts`
- **Target Files:** `src/ui/controls.test.ts`
- **Scope:**
  - Update existing test suite to reflect new segmented pill DOM hierarchy.
  - Test Source popup opening, selection of all 4 sources, and Volume adjustment.
  - Test contextual action button states (Play/Pause vs. Stop).
  - Test consolidated Visuals popup interactions (Gain, Beat, Quality, Aspect).
  - Test onboarding toast auto-dismiss and re-summon.
- **Verification:** `npm test -- run src/ui/controls.test.ts && npm run typecheck && npm run build`

---

## 4. Invariants & Guardrails
1. **Zero Audio Core Changes:** `src/audio/engine.ts` and `src/audio/sources.ts` contracts remain completely untouched. All changes are strictly UI presentation, event orchestration, and styling.
2. **Zero Shader/Preset Changes:** All WebGL2 shaders, render pipelines, and preset loaders remain untouched.
3. **WCAG AA Compliance:** Minimum touch targets >= 44px on mobile, contrast >= 4.5:1 for text, >= 3:1 for borders and focus indicators.
4. **Desktop & Mobile Parity:** The HUD works seamlessly across both desktop Chrome/Edge and mobile viewports.
