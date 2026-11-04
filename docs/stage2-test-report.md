# Stage 2 Device Test Report

Live URL: https://music-visualizer.charliechonguyen.com (backup: https://music-visualizer.charliechonguyen.workers.dev)
Automated checks (2026-11-04): typecheck clean, 122 unit tests pass, production build passes.

Live build shows the Stage 1 tracer visuals by default. Stage 2 visuals are behind URL options so each can be checked alone:
- `?tunnel` — forward-flight tunnel (rings, dim centre, beat flash on ring crests)
- `?particles` — treble sparkles streaming outward (needs high-frequency sound: use the Sweep test signal or a file)
- `?scenes` — two-scene crossfade demo (bass pulse, waveform)
- `?trail` — feedback trail proof

## How to run (about 15 minutes per machine)
1. Open each URL in Chrome or Edge, click **Start**, then choose a test signal or a file.
2. Press **P** to cycle palettes (neon, ember, coral, bloom). The name appears briefly on screen. Check that each palette keeps a dark background.
3. **Tunnel:** does it feel like flying forward? Does it move steadily, with no camera jolt on the kick? Does the centre stay dim?
4. **Particles:** dots should stream outward from the centre, sparse in quiet parts. Note whether the arc-like patterns look right to you.
5. **Calm mode:** tick **Calm** and check that motion slows and beat flashes stop.
6. **Flashing:** with a loud file, is there any flashing that feels too strong or too fast? Report it.
7. **Stability:** play a file for 5 minutes. Note any stutter, freeze or blank screen.
8. **Fullscreen (F)** and resizing the window: no stretching, no blank frame.

## Mac — Chrome version: ____  macOS: ____
| Check | Pass? | Notes |
|---|---|---|
| Tunnel flies steadily, no jolt on beat | | |
| Tunnel centre dim, no strobe | | |
| Particles stream outward, sparse in quiet parts | | |
| Palettes switch with P, background stays dark | | |
| Calm mode slows motion and stops beat flashes | | |
| No uncomfortable flashing on a loud file | | |
| 5-minute file playback is stable | | |
| Fullscreen and resize clean | | |

## Windows — Chrome/Edge version: ____  Windows: ____
| Check | Pass? | Notes |
|---|---|---|
| Tunnel flies steadily, no jolt on beat | | |
| Tunnel centre dim, no strobe | | |
| Particles stream outward, sparse in quiet parts | | |
| Palettes switch with P, background stays dark | | |
| Calm mode slows motion and stops beat flashes | | |
| No uncomfortable flashing on a loud file | | |
| 5-minute file playback is stable | | |
| Fullscreen and resize clean | | |

## Sign-off
- [ ] Owner: Stage 2 passes on Mac
- [ ] Owner: Stage 2 passes on Windows

## Known open items (not blocking sign-off, for Stage 2 completion)
- Bars: built and unit-tested, not yet checked on screen (they sit under the rings in the test view).
- Waveform: still the Stage 1 version, not moved into a scene.
- Basic scene (bars + rings + waveform together) not built yet.
