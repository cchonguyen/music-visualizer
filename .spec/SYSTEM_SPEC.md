# System Specification & Contracts

**Rescoped 2026-11-04 (owner decision): desktop first.** Primary target is a desktop browser (Chrome or Edge) on macOS and Windows. Phones and iPhone are deferred. Phone-specific notes from the v2 brief are kept in section 8 for later.

**Renderer: WebGL2 from the first visual (owner decision, 2026-11-04).** Reason: the first version should not be built on an engine we'd have to replace. Section 4 and section 9 define how the slices protect that choice.

Source documents: `.spec/SCOPE_BRIEF.md` (v2 brief, phone-focused, superseded for scope by this file; its audio and accessibility rules still apply) and `docs/RFC-milkdrop-next.md` (long-term reference). Where they differ, this file wins.

## 1. Core Scope & Stages

**Target:** a desktop web app (Chrome or Edge, macOS and Windows) that visualizes music either from a file the user picks or from what their computer is playing (tab or system audio, shared through the browser's screen-share prompt).

**Staged roadmap:**
- **Stage 1 — Audio core and GPU proof:** three audio sources feeding one analyser: (a) a local file via `<audio>`, (b) tab or system audio via `getDisplayMedia`, and (c) microphone via `getUserMedia`. Plus a built-in test-signal source and a debug panel showing live numbers (see `docs/visualization-ladder.md`, section 3). Play, pause, seek, volume, source switch. Plus a WebGL2 "tracer bullet": one shader whose brightness follows bass energy. This proves the audio-to-GPU path end to end before any real visual is built. Verified on the owner's Mac and Windows machines.
- **Stage 2 — Visuals on WebGL2 (order revised by Council round 2):** (1) framebuffer helper, ping-pong pair and a trail test; (2) Scene and Compositor with the safety pass; (3) forward-flight tunnel (full-screen shader driven by phase accumulators); (4) treble particles (instanced quads); (5) bars, waveform, rings. Plus sub-bass resolution fix, beat tuning on real music, mode switching, extended Calm mode.
- **Stage 3 — Polish (parked by owner 2026-11-04; Stage 4 goes first):** keyboard shortcuts, fullscreen, performance budget, hidden-tab and capture-ended handling, GPU-loss reset tested, accessibility pass.
- **Stage 4 — Own preset system (expanded 2026-11-04, plan in `docs/stage4-presets-plan.md`):** our own preset format (a preset describes a whole Scene), a preset loader, crossfades, MilkDrop-inspired feedback and post effects, more component variants, and a Preset Studio for live tuning and saving. Built on our own engine. Butterchurn is a reference only.
- **Particle spread (Charlie, 2026-11-06):** treble particles fill the whole frame, corners included, with the current edge fade kept. Overall particle size doubles (factor 2.0). A new per-layer switch, "Follow scene transform", lets particles inherit the scene's feedback zoom, rotation and drift and the tunnel and swirl motion. Off in existing presets; on for presets created from now on.
- **Later:** `.milk` import (both Council reviewers: a compiler sub-project; our own format gives most of the value), beat and bar tracker (for phrase-based scene changes, owner decision 2026-11-04), recording (canvas + audio), phone and iPhone version.
- **Shape layer opacity (Charlie, 2026-11-09, bug fix):** the layer opacity slider must change the visible output of Shape layers. Scope: the Shape fragment shader scales output color by the layer opacity uniform, so the slider works under the default additive blend. No other layer or blend mode changes.
- **Visuals menu: auto-cycle and shuffle (Charlie, confirmed 2026-11-12; Slice 21.13):** the Visuals popup gets one auto-cycle selector (Off / Timer / Beat) and a Shuffle toggle. When Timer is selected, a timer-length control appears (5 to 120 s, step 5, default 20 s). They drive the existing `AutoCycler` and `eligible()` in `src/presets/autoCycle.ts` (no new engine) and the same `cycle` state that keys C, B and X change, so keys update the menu and the menu updates what keys toggle. The choice (mode, shuffle, timer length) persists in localStorage across reloads. With nothing stored, the Slice 21.12 default applies (Timer, 20 s, shuffle off). Beat mode keeps its fixed 8 s minimum gap.

**Done means:** each stage works on the owner's desktop and has been used for real music before the next stage starts.

**Studio scroll jump (2026-11-12, triage, not yet confirmed):** Picking a Layer in the Studio rebuilds the whole panel (`bind` in `src/studio/studio.ts:677`, called from the Layer dropdown at `:1020` and from `structure()` at `:1527`). The rebuild collapses sections and resets the scroll to the top. Sliders do not rebuild. Fix: keep the scroll position and which sections are open across a rebuild, or update the layer section in place.

**Design system review (2026-11-13, triage, not yet confirmed):** Proposal only, no build. Harness UI (hub `.harness/design-system/`) is identical in hub and this spoke, but the visualizer does not load it: no `ui-` classes, no `design-system/profile.md`, no `app.css`, and its own tokens live in `src/style.css`. Proposed tweaks: (1) decide adopt versus documented exception; (2) write `design-system/profile.md` (dark lock, accent, density, focus override); (3) focus ring is 3px yellow, kit floor is 2px; (4) emoji used as icons in `index.html`; (5) reduced motion misses transitions on `.pill-segment`, `.source-card`, `.exp-mode-btn`, `.onboarding-toast`; (6) hub only: profile path differs between README and harness-rules; (7) hub only: record offer-back candidates (segmented pill, value-button slider, sheet handle); (8) hub only: unused tokens (`--measure`, `--duration-enter`, `--z-pop`, `--bp-*`).

## 2. Out of Scope (Do NOT Build)

Until moved into a stage above:
- iPhone, Android, and phone-layout work.
- Spotify, Apple Music, YouTube, or any streaming-service API integration.
- Accounts, logins, saved playlists, cloud storage, any database.
- Uploading audio to any server.
- Native desktop wrapper (Tauri, Rust, Electron), installers, code signing.
- Video or audio recording, export.
- Butterchurn as a runtime dependency. `.milk` import (later, only on owner request). ISF shaders (later).
- Detached control screen or multi-window sync.
- Rendering in background tabs. (Saved visual presets moved into Stage 4, 2026-11-04: browser storage and JSON files only.)
- Paid services or paid certificates of any kind.
- Full 3D scenes with physically based lighting and DMX or LED output. The reference guide's flagship examples use Unreal or TouchDesigner. Our v1 is 2D-on-GPU with a fixed-axis forward tunnel; true 3D is a later decision.
- Particle outflow modes, XY scope, and a separate particle morph control. The spread slice only widens reach, scales size, and adds the follow switch.
- Shape layer opacity fix (2026-11-09): no changes to `applyLayerBlend` or any blend mode, no changes to other layers' shaders, no changes to trail attenuation.
- Visuals menu auto-cycle and shuffle (2026-11-12): no new cycling or shuffle engine (reuse `src/presets/autoCycle.ts`), no new key bindings, no changes to Studio favourite/skip tags, no changes to the colour "Auto-cycle" option, no beat minimum-gap editor (8 s stays; only the timer length is adjustable), no render or safety pipeline changes.
- Studio scroll jump (2026-11-12): no new state store or framework, no virtual scroller, no changes to presets, schema or render code, no rewrite of every `bind` call site. Only the Studio panel's scroll and open-section state are kept across rebuilds.
- Third-party 3D engines (three.js and similar) in v1. Reason: we build on raw WebGL2 so the render layer stays small and fully understood. Revisit only if a slice proves it necessary.
- Design system review (2026-11-13): no Lucide icon set, rail or collapsible sidebar, theme picker, Newsreader or JetBrains font loading, Tweakpane restyling, or new hub components until a second app needs them.

## 3. Guiding Principles

1. **Musical, not mathematical.** Smoothed, perceptual audio analysis beats raw frequency bars.
2. **Build on the engine we'll keep.** Choose the foundation that Stage 4 needs, and make the cheap-to-change parts easy to change.
3. **Free by default.** Free tiers only. Any paid item is stopped and costed before approval.
4. **Private by default.** Audio never leaves the device. Captured system audio is processed locally only.
5. **Accessible and safe.** Flash limits (WCAG 2.3.1), reduced-motion mode, keyboard and screen-reader support.
6. **Small, testable slices.** One slice at a time, each committed separately and tested on the owner's real machines.
7. **Learn as we build.** Plain-language explanations; the owner makes the real design choices.

## 4. Technical Contracts (v1, desktop)

**Stack:** plain TypeScript + Vite, static build, WebGL2 (raw API, no 3D library), Web Audio API.

**Audio sources (both feed one analyser):**
```
File:       <audio> → MediaElementAudioSourceNode ─┐
Tab/System: getDisplayMedia({audio:true}) → MediaStreamAudioSourceNode ─┴→ AnalyserNode → GainNode → output
```
- File playback: never `decodeAudioData` the whole file. Position from `audio.currentTime`.
- Capture: request audio in the share prompt. If the stream has no audio track, show "Tick 'Share audio' in the share prompt." Stop tracks when sharing ends; show a "capture ended" state.
- Volume only through `GainNode.gain`.
- `AudioContext` created and `resume()` called inside the user's click.

**Per-frame audio data (the only thing visuals may read):** one `AudioFrame` object per animation frame containing levels, band energies, a waveform buffer, the spectrum buffer, and beat flags. Visuals never touch Web Audio nodes directly. This is the boundary that keeps the audio code stable as visuals change.

**Test signals (Stage 1):** the app can generate known input: a 60 Hz kick every 500 ms, a 2 kHz tone, a 40 Hz–8 kHz sweep, and silence. The bass pulse must respond to the kick and not to the tone. Latency is measured and shown in the debug panel.

**Microphone:** `getUserMedia` with `echoCancellation`, `noiseSuppression`, and `autoGainControl` all set to false, so the music isn't filtered. Chrome asks for permission once.

**Signal streams (four, not one):** the analyser output is split into:
- Sub/kick: below 120 Hz. Drives pulses and the bass response.
- Mid body: 120 Hz to 2.5 kHz. Drives motion speed and fluid noise.
- High/air: 2.5 kHz to 10 kHz. Drives the particle "twinkle" layer.
- Spectral flux (novelty): detects sudden timbre or section changes. Drives scene changes.
Bin indices are derived from `ctx.sampleRate`. Detection analyser `smoothingTimeConstant` 0–0.2, `fftSize` 8192 (`FFT_SIZE` in `src/audio/engine.ts`).

**Beat detection:** spectral flux of the sub band, with hysteresis (trigger at mean×1.3, release at mean×1.05) and a 150 ms cooldown. Tuning is per-track, tested with the Stage 1 test signals.

**Envelope followers (asymmetric):** attack 5–15 ms (near-instant), release 120–450 ms (damped). Visual mass needs momentum; elements settle back down gradually instead of snapping to zero. Exact values tuned in Stage 1 and locked in the debug panel. These are proposals from the reference guide, not verified measurements.

**Two loudness signals (Council round 2):**
- `loudness` (absolute): time-domain RMS of the waveform, mapped from −50 to −6 dBFS onto 0..1, then smoothed. Not normalized. Use it when the visual must know how loud the music really is.
- `energy` (track-relative): `loudness` divided by a slow rolling peak (τ 20 s), with a dim floor: 0 when silent, else 0.08 + 0.92 × that ratio. Drives complexity.
- Per-band `norm`: band envelope divided by a rolling peak (τ 12 s). Drives effect *size*.
- Normalizers stop decaying while the input is below 0.02 (near-silence), so a quiet breakdown isn't pumped back up before the drop.
- Why RMS: the old mean over three wide bands diluted narrow sounds (a solo flute or a pure tone read as near-silent). Verified in the browser: a 2 kHz tone now reads 0.79 loudness.

**Spectrum scale:** the analyser's byte spectrum is already in decibels (`getByteFrequencyData` maps −100..−30 dB to 0..255), so flux is computed on log magnitudes, as the Council recommended. Bin 0 (DC) is excluded: the sub band starts at 20 Hz.

**Resolved in Stage 2:** the FFT is 8192 (measured on real kicks: 4096 missed 6 of 20 kicks and fired 27 false beats under a 95 Hz note; 8192 caught 20 of 20). At 48 kHz each bin is about 5.9 Hz wide, so the sub band (20–120 Hz) has about 17 bins.

**Rendering budget (desktop):** device pixel ratio capped at 2; target 60 fps at 1440p on the owner's main machine, with a fallback to lower resolution if frames drop.

**Accessibility:** flashes ≤3/sec, luminance change <10%, no full-screen white flashes. Also (Council round 2, WCAG 2.3.1): the saturated-red flash rule (pixels where R/(R+G+B) ≥ 0.8 have a stricter limit); no high-contrast moving stripes (more than about 5 alternating light-dark pairs in the central view) in the tunnel; motion sickness (vection) risk from forward flight. Enforcement happens in one place: a final safety pass in the Compositor that rate-limits full-screen brightness rises per 333 ms window and clamps saturated red. Calm mode (and `prefers-reduced-motion`) slows flight to a gentle drift, softens ring contrast, and turns off beat-triggered camera kicks. `prefers-reduced-motion` read in JS (`matchMedia`) and switchable in the UI. Controls are native `<button>` and `<input type="range">` with visible focus. `aria-live="polite"` for source and mode names; canvas has `role="img"` and a description.

**Latency target:** under 100 ms from audio event to visual response, measured in the Stage 1 debug panel (owner, 2026-11-04). What the number means (Council round 2): **detector latency versus what you hear, for the Kick test signal only**: detection gap + one display frame − (output + base latency). It is valid only for sources the app plays itself (file, test signal). For microphone and tab/system capture, the app isn't the player, so end-to-end delay isn't measurable this way; the panel shows n/a. It can be negative when output latency is large (Bluetooth, some Windows drivers): the visual then arrives before the sound. Stage 1 pass criteria are confirmed as the four checks in `docs/visualization-ladder.md`, section 3.

**Response model (owner, 2026-11-04):**
- Beat response: fast attack, tight pulse on the kick.
- Energy response: a slower measure of overall loudness. Swells raise complexity and color vibrancy; quiet passages fade to a calm, lower-detail look rather than cutting off.
- Bass, beat, mids, and treble each drive a visible element.
- Treble drives a particle "twinkle" layer that stays visually below the pulses.
- Psychedelic and strobing effects are accents only, and always pass the WCAG 2.3.1 limits.

**Visual rules from the reference guide (2026-11-04, adopted as design guidance, unverified until tested):**
- **Visual mass:** large structures (tunnel walls, landscape) move on steady vectors. Small elements (sparks, particles, edge glow) react to transients. Never map transients directly to the scale or rotation of large geometry.
- **Negative space:** quiet passages reduce detail and brightness. Full-screen bloom, strobing, and dense particles are kept for drops and peaks. **Owner decision (2026-11-04):** quiet passages use a dim floor, never pure black. The guide's black clamp is rejected.
- **Pacing:** the visual cortex habituates after roughly 15–20 seconds of unchanged motion. The guide changes state on 16/32/64-bar phrases, which needs beat and bar tracking. **Not in v1.** v1 changes state on energy and novelty (section changes) instead.
- **Fixed-axis forward motion** (a tunnel or landscape looking down its center) gives the self-motion feeling the owner wants. This is the first Stage 2 prototype.
- **Co-location:** bass reads as ground-level pulses that travel outward; treble reads as sparks or sparkles. Sound and visual should feel connected.

**Visual character (owner, 2026-11-04):** movement through space or a landscape is the primary look (forward flight, camera drift). Static shapes are secondary. Detailed targets are in `docs/visualization-ladder.md`, section 4.

**Keyboard:** Space play/pause, arrow keys seek and volume, 1/2/3 switch modes, F fullscreen, Esc exit. Auto-cycle: C timer on/off, B beat on/off, X shuffle. No new bindings are added for the Visuals menu auto-cycle controls.

**Auto-cycle storage (Slice 21.13):** localStorage key `mv.autoCycle`, JSON `{ mode: 'off' | 'timer' | 'beat', shuffle: boolean, intervalSec: number }`. Read and written through `safeStorage()`; invalid or missing values fall back to `DEFAULT_CYCLE`; `intervalSec` is clamped to 5..120.

**Fullscreen:** `requestFullscreen` with a `.catch` fallback to a larger in-page view.

**Data:** none. No database or stored user data in v1.

## 5. Browser and Capture Requirement Boundaries

- **Supported browsers:** Chrome and Edge (desktop). Safari and Firefox are not supported for system audio; the app says so rather than failing silently. (Confirm on the owner's machines.)
- **macOS system audio:** requires macOS 14.2 or newer and Chrome's "share system audio" option. (Chrome-version detail is single-source; verify in Stage 1.)
- **Windows:** system audio works when sharing an entire screen with audio on. (Verify in Stage 1.)
- **WebGL2 requirements:** WebGL2 must exist, or the app shows a clear message. Scene, ping-pong feedback and post targets are 8-bit `RGBA8` (`src/gl/fbo.ts`, `src/render/scene.ts`). Float textures are used only for data: `R32F` for audio bands and the terrain heightfield, and a Reaction Diffusion state texture that is `RGBA16F` when `EXT_color_buffer_float` is available, with an `RGBA8` fallback.
- **GPU loss (simple reset):** if the browser drops the WebGL2 connection (for example, on sleep or graphics switching), the visuals restart from a clean state. Nothing is restored from before the loss. Audio capture and playback keep running. Feedback trails reset; that's accepted. Built in Stage 1, tested in Stage 3. No page reload, because a reload would stop the capture.
- **Screen-share video track:** Chrome requires video in the request. The app asks for the smallest, slowest video (≤1 fps, ≤320×240), never draws it, and keeps it alive (stopping it can end the whole share in some Chrome builds). If no audio track arrives, every track is stopped and the user sees "tick Share audio".
- **macOS system audio (Council round 2):** tab audio always works in Chrome. Whole-system audio needs a recent macOS and Chrome, usually the "Entire screen" choice, and clean Screen Recording permission; it can fail silently. Verify in slice 1.13.
- **Voice filters:** echo cancellation, noise suppression and auto gain are requested off for mic and capture. The debug panel shows the browser's actual settings so we can confirm.
- **Share prompt every session:** the browser asks each time. The app cannot skip it. Capture stops when the user stops sharing or closes the tab.
- **Hidden tab:** keeps audio, pauses rendering, resumes cleanly.
- **Cloudflare:** static files only; no per-request code. Limits not at risk.
- **Domain (live 2026-11-04):** `music-visualizer.charliechonguyen.com` (custom domain, owner approved). `*.workers.dev` kept as backup.

## 6. Cost Guardrails

- v1 is free: GitHub, Cloudflare static hosting, no paid APIs.
- Anything that costs money (Apple Developer membership about $99/year, Windows code-signing certificate, paid services) is stopped and costed before approval.
- No paid item has been approved.

## 7. Renderer Plan by Stage (how we avoid refactors)

**Build now, because it's hard to add later:**
- The `AudioFrame` boundary (section 4).
- A render-layer interface: `init(gl)`, `resize(width, height, dpr)`, `draw(frame, clock, target)`, `dispose()`. Every visual implements it. The app owns the canvas and the WebGL2 context. (Revised 2026-11-04: `alpha` removed; render clock added.)
- **Two clocks:** `AudioFrame.time`/`dtSec` is the audio clock (stops when audio is suspended). `RenderClock` (`timeSec`, `dtSec`, `frameIndex`) is the visual clock passed to `draw()`. Motion uses `Phase` accumulators (`phase += dt × speed`), never `time × speed`, so speed changes can't make the camera jump.
- **Frame lifetime:** the `AudioFrame` and its arrays are reused every frame. Read-only; never keep a reference past the current draw.
- **GPU state:** before each layer, the host binds the target, sets the viewport and disables blending. Layers set anything else themselves.
- Simple GPU-loss reset (section 5) and resize handling in the shared layer, from Stage 1.
- A shader-compile path that reports errors clearly to the owner.

**Build in Stage 2, as separate slices:**
- Texture helper: uploads the spectrum and waveform as one-row textures each frame.
- Framebuffer helper with a ping-pong pair (two framebuffers swapped each frame). Proven with a simple trail test before any visual depends on it. Never read a texture while drawing into it.
- **Scene and Compositor (Council round 2, both reviewers):** a Scene is a group of layers plus its own offscreen target and its own feedback history. The Compositor renders each active Scene to its own framebuffer at full strength, then blends the finished images in one final pass, then runs the safety pass. Crossfades never fade individual layers (that muddies trails). During a crossfade two scenes each hold their own ping-pong pair; the old scene's resources are released when the fade ends.
- Particles use instanced quads (`drawArraysInstanced`), not `gl.POINTS` (point sizes are clamped and clip differently on Windows and Mac).
- Bars, waveform, and rings, each a separate shader and render-layer module.

**Stage 4 plan (owner decision, 2026-11-04: own as much of the code as possible):**
- **4a — Own preset format:** a JSON file per preset listing its shader programs, settings (each with a name, default, and range), colors, and transition preference. Start with 5–10 presets we make and tune by eye.
- **4b — Preset loader and crossfade:** load a preset as a Scene, and blend two Scenes over 3–10 seconds in the Compositor (each Scene keeps its own feedback buffers).
- **`.milk` import:** moved to Later. Both Council reviewers call it a compiler sub-project.
- **Butterchurn:** reference only (MIT-licensed, readable). Not a dependency. Its maintenance is one person, with issues turned off.
- **regl (decided 2026-11-04: dropped, owner approved):** Council round 2 recommends against it (it predates WebGL2 patterns like VAOs and GLSL 300 es). Our earlier check found the repo still receives commits, but that doesn't show WebGL2 fit. Recommendation: drop the checkpoint and keep a small typed helper set (`createProgram`, `createVAO`, `createFBO`, `createPingPong`). Owner may override.

**What's cheap to change later:** visual styles, colors, shader math, UI layout.
**What's expensive to change later (so we set it now):** the audio data shape, who owns the GPU context, the feedback-buffer capability, resize and pixel-ratio logic, and context-loss recovery.

**Stage 7 — Compositing, Stencil Alpha & Reactivity Contracts (decided 2026-11-07):**
- **Stencil Alpha & Layer Blend State:** Every layer accepts `options?: { uLayerOpacity?: number }` in `draw(frame, clock, options)` and emits `alpha = 0` on dark/empty gaps (inter-ring space, Moiré troughs, Terrain sky) so underlying layers peek through cleanly. Default layer blend mode is `'max'` (`gl.MAX`); `'add'` and `'screen'` auto-attenuate opacity by `1.0 - decay * 0.82` when feedback trails are active.
- **Per-Layer `trails: boolean` Dual-Pass Pipeline:** `Scene.draw()` splits active layers into two passes:
  1. `trails !== false` (default `true`): rendered into the feedback write FBO before ping-pong swap so their pixels feed recursive warp trails.
  2. `trails === false`: rendered after the feedback swap (and before post/bloom) so foreground geometry stays razor-sharp over trippy feedback backgrounds.
- **Dark-Floor Safety Invariant:** `composite.frag.glsl` and `safety.ts` (`uCalm`, `uReversalDamp`) must attenuate luminance downward via multiplicative scaling and never mix dark pixels (`0.0`) toward `vec3(0.5)` mid-grey.
- **Macro Phrase vs. Micro Transient Reactivity:** Macro structural symmetries (Chladni `(n, m)` modes, Mandala fold count, Phyllotaxis golden divergence, Möbius dipole polarity, Tunnel flight direction) hold steady across musical phrases (6–8s cooldown; 18s cooldown for Tunnel breakdown reversal) and morph smoothly over 2–3s on section changes, with a Studio dropdown for manual lock. Micro transients (`kickEnv`, `kickPulse`, `sub`, `high`) drive phase-integrated speed, ripples, and grain sparkle—never raw position multipliers that snap backward.
- **Shared Terrain Heightfield (`TEXTURE5`):** When `SpectralTerrainLayer` is active, it publishes its `128 × 64` `R32F` history texture to `terrainStore` (`TEXTURE5`) so companion layers (`Particles`, `Waveform`) can displace vertices over the 3D spectral ridges (`terrainDisplace`), while `Scene` can advect feedback trails along the mountain perspective (`terrainFlow`).
- **Global Director Camera & Color Evolution (decided 2026-11-07; Sector 483):**
  - **Compositor Placement**: Executes inside `post.frag.glsl` after scene crossfades and before safety pass, guaranteeing continuous camera motion and color evolution across preset changes.
  - **2.5D Camera Engine**: 5 moves (`craneSway`, `dutchRoll`, `breathingPush`, `horizonTilt`, `stillAnchor`). Overscan zoom floor $\ge 1.03$ with mirrored-repeat UV folding preventing hard black borders. 6.0s `smoothstep` velocity-continuous morphing. Macro trigger cadence (`section` 35s–75s cooldown, `beats32/64/128`, `timer45`).
  - **Complementary Axes (`analyzePresetMotion`)**: Z-flight suppresses push; rotational spin suppresses Dutch roll; planar geometries unlock full weights. Interpolated over 4.0s on preset changes.
  - **Luminance-Safe Curated Split-Tone & Spatial Gradient**: 6 curated palettes (`native`, `cyberpunk`, `ember`, `biolum`, `vapor`, `prismatic`). Rotating 2D spatial screen gradient axis (~0.025 rad/s). Perceived luminance $Y = \text{dot}(c, \text{vec3}(0.2126, 0.7152, 0.0722))$ is strictly preserved ($c_{\text{final}} = c_{\text{tinted}} \cdot (Y / Y_{\text{tinted}})$); dark floor invariant is strictly maintained ($Y \le 1\text{e}-5 \implies 0.0$).
  - **Calm Integration**: Attenuates effective camera intensity ($\le 0.25$) and suppresses roll/tilt excursions.
- **Stage 9 — Unified Composable `shape` Layer Architecture (decided 2026-11-07; Sector 485):**
  - **Single Unified Layer (`shape`)**: Replaces legacy `crown`, `waveform`, `bars`, `rings`, and `shockwave` layers; registered first in `LAYER_SPECS` and `LAYER_FACTORIES`; supports full multi-layer stacking with descriptive Studio labels (`shape (baseShape · effectType)`).
  - **5 Orthogonal Categories (`ShapeParams`)**: (1) Base Geometry (`centerLine`, `edgeLine`, `circle`, `arc`, `polygon`, `star`, `spiral`, `figure8`, `edgeMode`, `sides`, `starInner`, `cornerRadius`, `arcSweep`, `spiralTurns`, `size`, `posX`, `posY`, `rotation`, `spinSpeed`, `basePulse`); (2) Reactive Effect (`solidLine`, `pulsingLine`, `waveform`, `harmonicWave`, `bars`, `segmentedBars`, `dots`, `auroraFill`, `sampleCount`, `effectLength`, `thickness`, `barGap`, `ledSegments`, `peakCaps`); (3) Direction & Symmetry (`extrudeDirection` with inward anti-inversion clamping, `symmetry` with seamless $0 \to 1 \to 0$ `mirror`, `normalMode`); (4) Propagation (`single`, `concentric`, `shockwave`, `stream`, `orbit`, `polar`, `propCount`, `propSpacing`, `propSpeed`, `propDirection`, `propSelfSpin`, `propDelay`); (5) Audio & Style (`audioSource`, `reactivity`, `attackMs`, `releaseMs`, `colorMode`, `solidColor`, `glow`).
  - **Conditional Studio Visibility (`ParamSpec.showWhen`)**: Declarative `showWhen` rules in `src/presets/schema.ts` dynamically toggle Tweakpane blade `.hidden` in `src/studio/studio.ts` so only relevant controls are displayed.
- **Stage 10 — Preset Folders & Organization System Contracts (decided 2026-11-07; Sector 486):**
  - **Two-Tier Categorical Taxonomy**: Library is structured into top-level "System Presets" (read-only factory presets) and "User Presets" (custom user folders).
  - **Curated System Presets Subfolders**: 43 built-in presets partitioned into three subfolders: (1) `Stage 9 Showcase (13–20)` (8 showcase presets), (2) `Flagship Generative (01–12)` (12 flagship presets), and (3) `Classics & Textures` (23 classic and texture presets). The 20 numbered presets are the Flagship Presets.
  - **System Preset Immutability & Persistent Tag Overrides**: Geometry and parameter mutations, saving, renaming, deleting, and moving folders are blocked for system presets. User playback tags (`favourite` and `skip`) are supported and persisted across browser sessions in `localStorage` under `mv.systemPresetTagOverrides`.
  - **User Folders & Storage Schema**: User folders stored in `localStorage` under `mv.userPresetFolders` as `UserPresetFolder { id: string, name: string, createdAt: number }`. User presets associate with folders via `folderId?: string` stored in `mv.userPresets`. Deleting a folder unfiles presets (`folderId = undefined`) without deleting them.
  - **Studio UI Hierarchy**: Replaces flat `<select>` list in `src/studio/studio.ts` with an organized `<optgroup>` hierarchy. Contextual preset bar affordances: read-only badges and disabled save/delete for System presets; dynamic folder assignment, "New Folder" creation, and folder management actions for User presets.
- **Stage 11 — Administrator System Preset Management Contracts (decided 2026-11-08; Sector 487):**
  - **Remote Cloud Persistence**: System presets persist remotely in a PostgreSQL table (`system_presets`) via Supabase PostgREST with JSONB preset structures, subfolder grouping (`showcase`, `flagship`, `classics`), sort order, and RLS policies (public read, admin write).
  - **Cloudflare Access Edge Identity Worker (`src/worker.ts`)**: `wrangler.jsonc` sets `run_worker_first: ["/admin", "/admin/*"]`, so only `/admin`, `/admin/api/identity` and `/admin/api/presets` reach the Worker; all public routes stay static-first via `env.ASSETS`. Admin access is Cloudflare Access only. The Worker verifies the `cf-access-jwt-assertion` JWT (issuer from `CF_ACCESS_TEAM_DOMAIN`, audience `CF_ACCESS_AUD`, expiry) and the header email, and checks the email against the `ADMIN_EMAIL` variable. No email is hardcoded in the Worker. With any of those three settings missing it fails closed with 503. `/admin/api/identity` returns `200 { email }` with `Cache-Control: no-store`.
  - **Admin Security Gateway (`adminGateway.ts`)**: Session-based admin state (`IAdminGateway`) from one source: probing `/admin/api/identity` with `{ credentials: 'include', redirect: 'manual', cache: 'no-store' }`. The client passkey path and direct database writes were removed in Stage 14; system preset saves and deletes go only through the Worker proxy `/admin/api/presets`. Stored in `sessionStorage` (cleared on browser close).
  - **Non-Disruptive Studio Login & `/admin` Return Flow**: Clicking `"Admin Access"` on production opens `/admin` in a centered popup synchronously inside the click gesture and listens for `{ type: 'mv-admin-authenticated' }` via `window.postMessage` (falling back to top-level navigation with `sessionStorage['mv.returnToStudio'] = 'true'` if popups are blocked). Visiting `/admin` directly or via popup verifies identity at top-level startup (`src/main.ts`), cleans the URL to `/`, and automatically reopens Preset Studio once started.
  - **Local Cache First & Background Sync**: Startup immediately loads local bundled (`ALL_PRESETS`) and cached (`mv.cachedSystemPresets`) presets, then triggers an asynchronous background sync. Full offline fallback if remote is unreachable.
  - **Studio Admin Mode**: Unlocks system preset name editing, subfolder reassignment, `"Save System Preset 👑"` remote persistence, 2-tap deletion, and `"Promote to System Preset 👑"` for custom user presets.
- **Stage 14 — Trust and foundations (2026-11-10; plan `.spec/specs/roadmap/stage-14-trust-foundations.md`):**
  - **Worker request rules (`src/worker.ts`)**: `/admin/api/presets` accepts only `POST` and `PATCH` (405 otherwise), same-origin requests with `Content-Type: application/json` (415), and a body of at most `MAX_BODY_BYTES` = 256 KiB (413). Only the allowlisted columns `id, name, subfolder, preset_data, sort_order, tags, is_deleted, updated_at` are forwarded, each type-checked (400 `invalid_field`); `subfolder` must be `showcase`, `flagship` or `classics`; `updated_by` is set from the verified identity. Every Worker-built response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and a strict Content-Security-Policy.
  - **Time step clamp**: every per-frame `dt` is clamped to `0..MAX_DT_SEC` = 0.1 s (`clampDt` in `src/render/clock.ts`), used in `src/main.ts`, `src/gl/context.ts`, the scene and the global director, so a pause, seek or hidden tab cannot jump motion.
  - **Per-second feedback**: feedback zoom, rotate, drift and decay are rates per 1/60 s scaled by the real `dt` (`pow(value, dt * 60)` in `feedback.frag.glsl`). Output at 60 Hz matches the old per-frame behavior; other refresh rates now look the same.
  - **Morph phase**: the morph LFO integrates its phase (`phase += rate * dt`, `dt` clamped to `MORPH_MAX_DT_SEC` = 0.1 s) in `src/presets/morph.ts`, so changing the rate never makes the wave jump. The dead Mandala kick flare control was removed, with a preset migration.



## 8. Deferred (phone and iPhone notes, for later)

- iPhone Safari has no system-audio capture. File input is the only audio source there. Use an explicit list of audio file types; `accept="audio/*"` greys out music files on iOS.
- Mute switch silences routed audio on iPhone. Fix: `navigator.audioSession.type = 'playback'` inside the first tap (feature-detected).
- After lock or app switch, the audio context can look "running" while time stops. Suspend and resume on visibility change.
- iPhone has no element fullscreen. Use expand-to-viewport plus Add-to-Home-Screen.
- Low Power Mode caps animation at 30 fps; treat 30 fps as a pass on iPhone.

## 9. Owner Decisions

**Resolved 2026-11-04:** system audio and mic in Stage 1; test on Mac and Windows; WebGL2 from the first visual; no rendering library; own preset format; quiet passages dim, never black; beat/bar tracking later; latency under 100 ms; Stage 1 pass criteria (four checks); H1 research done (not unique; edge is curated presets and musical response).

**Open:**
1. Time estimates per stage.
2. Owner's notes on the five reference videos (what to copy from each).
