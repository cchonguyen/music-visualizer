# System Specification & Contracts

**Rescoped 2026-11-04 (owner decision): desktop first.** Primary target is a desktop browser (Chrome or Edge) on macOS and Windows. Phones and iPhone are deferred. Phone-specific notes from the v2 brief are kept in section 8 for later.

**Renderer: WebGL2 from the first visual (owner decision, 2026-11-04).** Reason: the first version should not be built on an engine we'd have to replace. Section 4 and section 9 define how the slices protect that choice.

Source documents: `.spec/SCOPE_BRIEF.md` (v2 brief, phone-focused, superseded for scope by this file; its audio and accessibility rules still apply) and `docs/RFC-milkdrop-next.md` (long-term reference). Where they differ, this file wins.

## 1. Core Scope & Stages

**Target:** a desktop web app (Chrome or Edge, macOS and Windows) that visualizes music either from a file the user picks or from what their computer is playing (tab or system audio, shared through the browser's screen-share prompt).

**Staged roadmap:**
- **Stage 1 — Audio core and GPU proof:** three audio sources feeding one analyser: (a) a local file via `<audio>`, (b) tab or system audio via `getDisplayMedia`, and (c) microphone via `getUserMedia`. Plus a built-in test-signal source and a debug panel showing live numbers (see `docs/visualization-ladder.md`, section 3). Play, pause, seek, volume, source switch. Plus a WebGL2 "tracer bullet": one shader whose brightness follows bass energy. This proves the audio-to-GPU path end to end before any real visual is built. Verified on the owner's Mac and Windows machines.
- **Stage 2 — Visuals on WebGL2:** frequency bars, waveform, radial rings, all drawn with shaders. Shared analyser, beat/energy detection, mode switching, reduced-motion mode. Includes a feedback test (two framebuffers, one frame feeding the next).
- **Stage 3 — Polish:** keyboard shortcuts, fullscreen, performance budget, hidden-tab and capture-ended handling, GPU-loss reset tested, accessibility pass.
- **Stage 4 — Own preset system:** our own preset format, a preset loader, and crossfades between presets. Built on our own engine. Butterchurn is a reference only. Optional `.milk` import comes last and only if the owner still wants it.
- **Later:** beat and bar tracker (for phrase-based scene changes, owner decision 2026-11-04), recording (canvas + audio), phone and iPhone version.

**Done means:** each stage works on the owner's desktop and has been used for real music before the next stage starts.

## 2. Out of Scope (Do NOT Build)

Until moved into a stage above:
- iPhone, Android, and phone-layout work.
- Spotify, Apple Music, YouTube, or any streaming-service API integration.
- Accounts, logins, saved playlists, cloud storage, any database.
- Uploading audio to any server.
- Native desktop wrapper (Tauri, Rust, Electron), installers, code signing.
- Video or audio recording, export.
- Butterchurn as a runtime dependency. `.milk` import (Stage 4, optional, last). ISF shaders (later).
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

**Dynamic normalization (rolling, 5–10 s):** a rolling peak/RMS window scales the response, so quiet intros remain readable and loud drops don't blow out to white. Rule: normalization scales the *visual size of effects*, never the *complexity* signal. Complexity tracks absolute loudness relative to the rolling window, so a real swell still reads as a swell (see owner's target).

**Rendering budget (desktop):** device pixel ratio capped at 2; target 60 fps at 1440p on the owner's main machine, with a fallback to lower resolution if frames drop.

**Accessibility:** flashes ≤3/sec, luminance change <10%, no full-screen white flashes. `prefers-reduced-motion` read in JS (`matchMedia`) and switchable in the UI. Controls are native `<button>` and `<input type="range">` with visible focus. `aria-live="polite"` for source and mode names; canvas has `role="img"` and a description.

**Latency target:** under 100 ms from audio event to visual response, measured in the Stage 1 debug panel (owner, 2026-11-04). Stage 1 pass criteria are confirmed as the four checks in `docs/visualization-ladder.md`, section 3.

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
- **Share prompt every session:** the browser asks each time. The app cannot skip it. Capture stops when the user stops sharing or closes the tab.
- **Hidden tab:** keeps audio, pauses rendering, resumes cleanly.
- **Cloudflare:** static files only; no per-request code. Limits not at risk.
- **Domain:** `music-visualizer.charliechonguyen.com` as a custom domain, if the zone is in the owner's Cloudflare account. Fallback: `*.workers.dev`.

## 6. Cost Guardrails

- v1 is free: GitHub, Cloudflare static hosting, no paid APIs.
- Anything that costs money (Apple Developer membership about $99/year, Windows code-signing certificate, paid services) is stopped and costed before approval.
- No paid item has been approved.

## 7. Renderer Plan by Stage (how we avoid refactors)

**Build now, because it's hard to add later:**
- The `AudioFrame` boundary (section 4).
- A render-layer interface: `init(gl)`, `resize(width, height, dpr)`, `draw(frame, time)`, `dispose()`. Every visual implements it. The app owns the canvas and the WebGL2 context.
- Simple GPU-loss reset (section 5) and resize handling in the shared layer, from Stage 1.
- A shader-compile path that reports errors clearly to the owner.

**Build in Stage 2, as separate slices:**
- Texture helper: uploads the spectrum and waveform as one-row textures each frame.
- Framebuffer helper with a ping-pong pair (two framebuffers swapped each frame). Proven with a simple trail test before any visual depends on it.
- Bars, waveform, and rings, each a separate shader and render-layer module.

**Stage 4 plan (owner decision, 2026-11-04: own as much of the code as possible):**
- **4a — Own preset format:** a JSON file per preset listing its shader programs, settings (each with a name, default, and range), colors, and transition preference. Start with 5–10 presets we make and tune by eye.
- **4b — Preset loader and crossfade:** load a preset into the render interface, and blend two presets over 3–10 seconds using the Stage 2 ping-pong buffers.
- **4c — Optional `.milk` import:** a parser and evaluator for MilkDrop's expression language (EEL) and shader pair. Judged only after 4a and 4b are working, because most of its work goes into compatibility, not visuals.
- **Butterchurn:** reference only (MIT-licensed, readable). Not a dependency. Its maintenance is one person, with issues turned off.
- **regl checkpoint (end of Stage 2):** if the helper layer is hard to follow or debug, adopt regl inside it before Stage 4. Otherwise keep raw WebGL2.

**What's cheap to change later:** visual styles, colors, shader math, UI layout.
**What's expensive to change later (so we set it now):** the audio data shape, who owns the GPU context, the feedback-buffer capability, resize and pixel-ratio logic, and context-loss recovery.

## 8. Deferred (phone and iPhone notes, for later)

- iPhone Safari has no system-audio capture. File input is the only audio source there. Use an explicit list of audio file types; `accept="audio/*"` greys out music files on iOS.
- Mute switch silences routed audio on iPhone. Fix: `navigator.audioSession.type = 'playback'` inside the first tap (feature-detected).
- After lock or app switch, the audio context can look "running" while time stops. Suspend and resume on visibility change.
- iPhone has no element fullscreen. Use expand-to-viewport plus Add-to-Home-Screen.
- Low Power Mode caps animation at 30 fps; treat 30 fps as a pass on iPhone.

## 9. Open Owner Decisions

**Resolved 2026-11-04:**
1. System audio is in Stage 1, alongside file playback.
2. Test on both Mac and Windows.
3. Renderer: WebGL2 from the first visual.
4. Library: raw WebGL2 with small in-house helpers. No `regl` or other library (owner decision, 2026-11-04).

5. Stage 4 direction: own preset format; `.milk` import optional and last (owner, 2026-11-04).
6. Microphone is in Stage 1, on the same analyser as the other sources (owner, 2026-11-04).

**Open:**
7. regl decision at the end of Stage 2 (checkpoint, see section 7).
8. Time estimates per stage: not yet set. Needed before approving the plan.
9. Reference visuals the owner likes, to set the quality bar (see `docs/visualization-ladder.md`, section 4).
10. Stage 1 pass criteria and latency target: proposed in `docs/visualization-ladder.md`, owner to confirm.
11. Research check: do other web tools already visualize system audio? Run before Stage 1 ends (hypothesis H1).
