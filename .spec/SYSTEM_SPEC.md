# System Specification & Contracts

**Rescoped 2026-11-04 (owner decision): desktop first.** Primary target is a desktop browser (Chrome or Edge) on macOS and Windows. Phones and iPhone are deferred. Phone-specific notes from the v2 brief are kept in section 8 for later.

**Renderer: WebGL2 from the first visual (owner decision, 2026-11-04).** Reason: the first version should not be built on an engine we'd have to replace. Section 4 and section 9 define how the slices protect that choice.

Source documents: `.spec/SCOPE_BRIEF.md` (v2 brief, phone-focused, superseded for scope by this file; its audio and accessibility rules still apply) and `docs/RFC-milkdrop-next.md` (long-term reference). Where they differ, this file wins.

## 1. Core Scope & Stages

**Target:** a desktop web app (Chrome or Edge, macOS and Windows) that visualizes music either from a file the user picks or from what their computer is playing (tab or system audio, shared through the browser's screen-share prompt).

**Staged roadmap:**
- **Stage 1 — Audio core and GPU proof:** three audio sources feeding one analyser: (a) a local file via `<audio>`, (b) tab or system audio via `getDisplayMedia`, and (c) microphone via `getUserMedia`. Plus a built-in test-signal source and a debug panel showing live numbers (see `docs/visualization-ladder.md`, section 3). Play, pause, seek, volume, source switch. Plus a WebGL2 "tracer bullet": one shader whose brightness follows bass energy. This proves the audio-to-GPU path end to end before any real visual is built. Verified on the owner's Mac and Windows machines.
- **Stage 2 — Visuals on WebGL2 (order revised by Council round 2):** (1) framebuffer helper, ping-pong pair and a trail test; (2) Scene and Compositor with the safety pass; (3) forward-flight tunnel (full-screen shader driven by phase accumulators); (4) treble particles (instanced quads); (5) bars, waveform, rings. Plus sub-bass resolution fix, beat tuning on real music, mode switching, extended Calm mode.
- **Stage 3 — Polish:** keyboard shortcuts, fullscreen, performance budget, hidden-tab and capture-ended handling, GPU-loss reset tested, accessibility pass.
- **Stage 4 — Own preset system:** our own preset format (a preset describes a whole Scene), a preset loader, and crossfades between scenes. Built on our own engine. Butterchurn is a reference only.
- **Later:** `.milk` import (both Council reviewers: a compiler sub-project; our own format gives most of the value), beat and bar tracker (for phrase-based scene changes, owner decision 2026-11-04), recording (canvas + audio), phone and iPhone version.

**Done means:** each stage works on the owner's desktop and has been used for real music before the next stage starts.

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
- Rendering in background tabs; themes or saved visual presets.
- Paid services or paid certificates of any kind.
- Full 3D scenes with physically based lighting and DMX or LED output. The reference guide's flagship examples use Unreal or TouchDesigner. Our v1 is 2D-on-GPU with a fixed-axis forward tunnel; true 3D is a later decision.
- Third-party 3D engines (three.js and similar) in v1. Reason: we build on raw WebGL2 so the render layer stays small and fully understood. Revisit only if a slice proves it necessary.

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
Bin indices are derived from `ctx.sampleRate`. Detection analyser `smoothingTimeConstant` 0–0.2, `fftSize` 4096 (or higher on desktop).

**Beat detection:** spectral flux of the sub band, with hysteresis (trigger at mean×1.3, release at mean×1.05) and a 150 ms cooldown. Tuning is per-track, tested with the Stage 1 test signals.

**Envelope followers (asymmetric):** attack 5–15 ms (near-instant), release 120–450 ms (damped). Visual mass needs momentum; elements settle back down gradually instead of snapping to zero. Exact values tuned in Stage 1 and locked in the debug panel. These are proposals from the reference guide, not verified measurements.

**Two loudness signals (Council round 2):**
- `loudness` (absolute): time-domain RMS of the waveform, mapped from −50 to −6 dBFS onto 0..1, then smoothed. Not normalized. Use it when the visual must know how loud the music really is.
- `energy` (track-relative): `loudness` divided by a slow rolling peak (τ 20 s), with a dim floor: 0 when silent, else 0.08 + 0.92 × that ratio. Drives complexity.
- Per-band `norm`: band envelope divided by a rolling peak (τ 12 s). Drives effect *size*.
- Normalizers stop decaying while the input is below 0.02 (near-silence), so a quiet breakdown isn't pumped back up before the drop.
- Why RMS: the old mean over three wide bands diluted narrow sounds (a solo flute or a pure tone read as near-silent). Verified in the browser: a 2 kHz tone now reads 0.79 loudness.

**Spectrum scale:** the analyser's byte spectrum is already in decibels (`getByteFrequencyData` maps −100..−30 dB to 0..255), so flux is computed on log magnitudes, as the Council recommended. Bin 0 (DC) is excluded: the sub band starts at 20 Hz.

**Known limit, Stage 2 fix:** at 48 kHz and FFT 4096, each bin is 11.7 Hz wide, so the sub band (20–120 Hz) has only about 8 bins. Council split on the fix: a larger FFT (8192, more time smearing) or a time-domain low-pass filter for sub energy. Decide in Stage 2 by testing both on real kicks.

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

**Keyboard:** Space play/pause, arrow keys seek and volume, 1/2/3 switch modes, F fullscreen, Esc exit.

**Fullscreen:** `requestFullscreen` with a `.catch` fallback to a larger in-page view.

**Data:** none. No database or stored user data in v1.

## 5. Browser and Capture Requirement Boundaries

- **Supported browsers:** Chrome and Edge (desktop). Safari and Firefox are not supported for system audio; the app says so rather than failing silently. (Confirm on the owner's machines.)
- **macOS system audio:** requires macOS 14.2 or newer and Chrome's "share system audio" option. (Chrome-version detail is single-source; verify in Stage 1.)
- **Windows:** system audio works when sharing an entire screen with audio on. (Verify in Stage 1.)
- **WebGL2 requirements:** WebGL2 must exist, or the app shows a clear message. Float render targets (`EXT_color_buffer_float`) are used when available, with an 8-bit fallback. Check both on each test machine in Stage 2.
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
