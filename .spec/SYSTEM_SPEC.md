# System Specification & Contracts

Source documents: `.spec/SCOPE_BRIEF.md` (v2 web brief, Council-reviewed) and `docs/RFC-milkdrop-next.md` (long-term RFC). This file is the working contract. Where they differ, this file wins until the owner changes it.

## 1. Core Scope & MVP Boundaries

**v1 (now):** A web app (desktop and phone browsers) that plays a music file the user picks and draws live 2D visuals from it. Nothing is uploaded, no accounts, no backend.

**Staged roadmap (owner decision, 2026-11-04: iterate and test before adding complexity):**
- **Stage 1 — Audio core (v1 foundation):** file picker, `<audio>` element → `MediaElementAudioSourceNode` → `AnalyserNode` → `GainNode`. Play, pause, seek, volume. Verified on iPhone Safari.
- **Stage 2 — Three 2D visuals:** frequency bars, waveform, radial rings. Shared analyser, beat/energy detection, mode switching, reduced-motion mode.
- **Stage 3 — Polish and sharing:** controls and accessibility pass, fullscreen/expand, hidden-tab and interruption handling, performance budget.
- **Stage 4 — Study the RFC:** test whether richer rendering (WebGL2, shader presets) is worth it, using real feedback from Stages 1–3. Each step is a separate decision.
- **Later (not scheduled):** microphone mode (v1.1), desktop app wrapper, detached control screen, `.milk` preset support, native system-audio capture.

**Done means:** each stage is usable on its own and the owner has tried it on an iPhone and a laptop before the next stage starts.

## 2. Strictly Out of Scope ("Do NOT Build")

Until the owner moves an item into a stage above:
- Spotify, Apple Music, YouTube, or any streaming-service integration (they don't expose raw audio to web apps).
- Accounts, logins, saved playlists, cloud storage, any database (no D1, no Supabase).
- Uploading audio to any server.
- Microphone input (v1.1).
- System or tab audio capture (`getDisplayMedia`) and any native desktop wrapper (Tauri, Rust).
- Video export or screen recording.
- 3D scenes, WebGL2/WebGPU shaders, Butterchurn or `.milk` presets, ISF shaders (RFC; Stage 4 at earliest).
- Detached control screen or multi-window sync.
- Rendering in hidden tabs; themes or saved visual presets.
- Paid services, paid app-store or code-signing certificates.

## 3. Guiding Principles

1. **Musical, not mathematical.** Smoothed, perceptual audio analysis beats raw frequency bars.
2. **Free by default.** Free tiers only. Any paid item is stopped and costed before the owner approves it.
3. **Private by default.** Audio stays on the device.
4. **Phone-first.** iPhone Safari is a primary target. A feature that can't work there gets a fallback or is cut.
5. **Accessible and safe.** Flash limits (WCAG 2.3.1), reduced-motion mode, keyboard and screen-reader support.
6. **Small, testable slices.** One stage at a time. Each slice is committed separately and tested on real devices.
7. **Learn as we build.** Plain-language explanations; the owner makes the real design choices.

## 4. Technical Contracts (v1)

**Stack:** plain TypeScript + Vite, static build, Canvas 2D, Web Audio API. (Council 3–1; owner may override.)

**Audio pipeline:**
```
<audio> element → MediaElementAudioSourceNode → AnalyserNode (visuals) → GainNode (volume) → output
```
- Never `decodeAudioData` the whole file.
- `AudioContext` created and `resume()` called synchronously inside the first tap or click.
- Position comes from `audio.currentTime`; volume only through `GainNode.gain`.

**Beat/energy detection:** spectral flux of the 20–120 Hz band, EMA-smoothed, hysteresis (trigger at mean×1.3, release at mean×1.05), 150 ms cooldown. Detection analyser `smoothingTimeConstant` 0–0.2, `fftSize` 4096, bin indices derived from `ctx.sampleRate`.

**Rendering budget:** device pixel ratio capped at 2; backing store capped near 2.1 million pixels; `setTransform` re-applied after a debounced resize. Target ≥30 fps at 1080p on a recent phone; 60 fps measured on a 2024 mid-range laptop.

**Accessibility:** flashes ≤3/sec, luminance change <10%, no full-screen white flashes. `prefers-reduced-motion` read in JS (`matchMedia`) and switchable in the UI. Controls are native `<button>` and `<input type="range">` with visible focus. `aria-live="polite"` for track and mode names; canvas has `role="img"` and a description.

**Lifecycle:** hidden tab keeps audio, stops rendering, clamps the time step on return. On interruption (`statechange` to `interrupted`), show "tap to continue."

**Fullscreen:** real fullscreen where `requestFullscreen` exists (with `.catch` fallback). On iPhone, expand to viewport (`100dvh`, hide controls). Feature-detect; never ship a dead button.

**Data:** none. No database or stored user data in v1.

## 5. Technical Requirement Boundaries (preliminary; Council research pending)

To be confirmed by the Council's review. Current known limits:
- **iOS:** playback silence with the mute switch, `MediaElementAudioSourceNode` behavior on current iOS, M4A support from the file picker, background playback after `createMediaElementSource`. All need testing on a real iPhone.
- **Memory and CPU:** long tracks must not be decoded whole. Canvas size is capped.
- **Browser support:** Web Audio and Canvas 2D are required. Older browsers get a clear message, not a broken page.
- **Cloudflare free tier:** static assets only; no per-request code. Limits are not at risk.
- **Domain:** `music-visualizer.charliechonguyen.com` as a `custom_domain` route, if the zone is in the owner's Cloudflare account. Fallback: `*.workers.dev`.

## 6. Cost Guardrails

- v1 is free: GitHub, Cloudflare static hosting, no paid APIs.
- Anything that costs money (Apple Developer membership about $99/year, Windows code-signing certificate, paid services) is stopped and costed before the owner approves it.
- Owner has not approved any paid item.
