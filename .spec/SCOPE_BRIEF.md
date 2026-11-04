# Scope Brief — Music Visualizer (v2 draft, revised after Council review 2026-11-04)

Status: v2, saved as `.spec/SCOPE_BRIEF.md`. Project folder: `~/Projects/music-visualizer`.
Owner: product manager / vibe coder, new to dev tooling. Hard rule: stay on free tiers.
Council verdict: REVISE before scaffolding (DeepSeek, Crouton, GPT, Gemini). Changes below are folded in.

## Goal
A browser app that turns music into live, good-looking visuals. Fun to open, nothing to sign up for.

## Users
The owner and friends, on desktop and phone browsers (iPhone Safari is a primary target).

## Decisions (proposed picks; owner confirms)
- A. Audio source: **file only for v1** (Council 3–1). Mic deferred to v1.1 as a separate mode that never plays audio at the same time.
- B. Visual style: **classic 2D** (Council consensus).
- C. Framework: **plain TypeScript + Vite** (Council 3–1; one imperative animation loop, no React lifecycle to fight Web Audio).

## v1 requirements
1. **Audio in:** a tappable `<input type="file" accept="audio/*">` is the primary path (works on phones).
   Drag-and-drop is a desktop-only extra. Audio stays on the device; nothing is uploaded.
2. **Audio pipeline (fixed):** one `<audio>` element per file → `MediaElementAudioSourceNode` → `AnalyserNode` → `GainNode` → speakers.
   - Never `decodeAudioData` the whole file (10 min ≈ 200 MB+ of raw audio; can crash an iPhone tab).
   - Seek and position come from the element's `currentTime`.
   - Volume only via `GainNode.gain` (iOS ignores `audio.volume`). The analyser taps before the gain node.
   - Create the `AudioContext` and call `resume()` synchronously inside the first tap/click, before any `await`.
3. **Beat/energy detection:** spectral flux (positive difference) of the 20–120 Hz band, EMA-smoothed, hysteresis (trigger at mean×1.3, release at mean×1.05), 150 ms cooldown.
   Separate detection analyser with `smoothingTimeConstant` 0–0.2; `fftSize` 4096; bin indices computed from `ctx.sampleRate` (iOS often runs 48 kHz). No tempo tracking or onset library in v1.
4. **Visuals:** Canvas 2D, three modes switchable by keyboard and on-screen buttons: frequency bars, waveform, radial rings (rings are first to cut if time runs short; all share one analyser pipeline).
5. **Controls:** play/pause, seek, volume, mode switch, fullscreen. Native `<button>` / `<input type="range">`, visible focus ring, `aria-live="polite"` for track name and mode, canvas `role="img"` with a descriptive label.
   - Fullscreen: real fullscreen where `requestFullscreen` exists (with `.catch` fallback); on iPhone, "expand to viewport" (CSS `100dvh`, hide controls). Feature-detect; never ship a dead button.

## Safety and accessibility acceptance (WCAG 2.3.1)
- At most 3 flashes per second; beat pulses raise brightness by less than 10%; no full-screen white flashes. Drop a pulse if it would break these limits.
- `prefers-reduced-motion` checked in JS (`matchMedia`): disables pulses and shows a calm, low-detail view. In-app toggle for the same.

## Performance and lifecycle
- Device pixel ratio capped at 2; backing store capped at about 2.1 million pixels (drop to ratio 1 or fewer bars above that). Re-apply `setTransform` on a debounced resize.
- Target: ≥30 fps at 1080p on a recent phone; 60 fps measured on a 2024 mid-range laptop.
- Hidden tab: audio keeps playing, rendering stops, time delta clamped when the tab returns.
- iOS interruptions (calls, Siri, app switch, `interrupted` state): listen to `statechange` and show a "tap to continue" overlay.

## Stack and hosting
- Plain TypeScript + Vite, static build. Cloudflare Workers static assets, `npx wrangler deploy`.
- Domain: `music-visualizer.charliechonguyen.com` as a `custom_domain: true` route (zone is in the same Cloudflare account). Fallback: `*.workers.dev`.
- No backend, no database, no accounts. No Worker code runs per request, so free-tier limits are not at risk.

## Do NOT build (v1)
- Spotify / Apple Music / YouTube integration (no raw audio access for web apps).
- Microphone input (v1.1), system/tab audio capture (`getDisplayMedia`).
- Accounts, logins, saved playlists, any server storage (no D1, no Supabase); no uploading audio to a server.
- Video export / screen recording; 3D (Three.js) scenes (v2 candidate).
- Rendering in hidden tabs; themes or saved visual presets.

## Effort
About 3–5 days for the file-only v1 (Council estimate).

## Must verify on a real iPhone (unverified by Council)
- Hardware mute switch silencing Web Audio; `MediaElementAudioSourceNode` quirks with blob URLs; lock-screen/background playback after `createMediaElementSource`.
- M4A playback from the iOS file picker.
