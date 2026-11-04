# Stage 1 Device Test Report

Live URL: https://music-visualizer.charliechonguyen.workers.dev
Pass criteria: `docs/visualization-ladder.md` §3. Fill one table per machine. Press **D** to show the debug panel.

## How to run each test (about 10 minutes per machine)
1. Open the URL in **Chrome** (or Edge). Click **Start**.
2. Press **D**. A panel with live numbers appears top-left.
3. **Test signals:** pick each from the "Test signal…" menu.
   - **Kick:** you hear a low thump twice a second. The background should brighten on every thump and dim between them. Panel: `beat YES` flickers once per thump. After ~10 s the latency line should turn green (`PASS`, under 100 ms).
   - **Tone:** a steady high beep. Background stays dim and still; the white line shows a dense, even wave.
   - **Silence:** nothing heard; background dim and still; flat line.
4. **File:** click **File…**, pick a song. It should play, the line should move with it, and the background should pulse on the bass. Try seek, pause (Space), volume (↑/↓).
5. **Tab / system audio:** play music in another tab or app (Spotify, YouTube). Click **Tab / system audio**. In the share prompt, pick the tab (or Entire screen) and **tick "Share audio"**. Visuals should react. Note whether "share system audio" was offered on your Mac.
6. **Microphone:** click **Microphone**, allow access, play music out loud. Visuals should react.
7. Press **F** for fullscreen; Esc to exit. Tick **Calm**: the pulse should get much smaller.

## Mac — Chrome version: ____  macOS version: ____
| Test | Pass? | Latency (kick) | Notes |
|---|---|---|---|
| Kick pulses on every thump | | | |
| Tone: no pulse | | — | |
| Silence: no pulse | | — | |
| Waveform matches sound | | — | |
| File plays and reacts | | — | |
| Tab audio reacts | | — | |
| System audio offered / works | | — | |
| Microphone reacts | | — | |
| Fullscreen + Calm | | — | |

## Windows — Chrome/Edge version: ____  Windows version: ____
| Test | Pass? | Latency (kick) | Notes |
|---|---|---|---|
| Kick pulses on every thump | | | |
| Tone: no pulse | | — | |
| Silence: no pulse | | — | |
| Waveform matches sound | | — | |
| File plays and reacts | | — | |
| Tab audio reacts | | — | |
| System audio (Entire screen + Share audio) | | — | |
| Microphone reacts | | — | |
| Fullscreen + Calm | | — | |

## Lead pre-check (2026-11-04, embedded browser)
Test signals pass in automated checks (see `docs/stage1-slices.md`, "Browser test results"). File, capture and microphone are untested: they need your machines and permission prompts.

## Sign-off
- [ ] Owner: Stage 1 passes on Mac
- [ ] Owner: Stage 1 passes on Windows
