# Stage 2 Device Test Report

Live URL: https://music-visualizer.charliechonguyen.com (backup: https://music-visualizer.charliechonguyen.workers.dev)
Automated checks (2026-11-04): typecheck clean, 122 unit tests pass, production build passes.

The live site opens on the Stage 2 **flight** scene (tunnel and treble sparkles). Press **2** for the **bars** scene (bars and rings), **1** to go back. Stage 1 tracers are at `?tracer`. Single checks:
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

## Polish round (2026-11-04, plan: docs/stage2-polish-plan.md)
Deployed: https://music-visualizer.charliechonguyen.com (bundle index-D9FOwwzl.js). Automated: 194 unit tests, typecheck and build pass.
Keys now: **0** = flight + radial crown (default), **1** = flight only, **2** = bars scene. The automatic bars blend is gone.

Owner checks, please on Mac and Windows:
- [ ] Black floor: between rings the screen is near black, with no grey-teal wash.
- [ ] Particles are streaks flying out, no arcs or spirals.
- [ ] Tunnel reads as a bending 3D corridor (figure-eight sway, slow roll). Calm stops the sway.
- [ ] Kick shockwave: a thin ring travels out from the rim on each kick, and it's visible.
- [ ] Breakdowns calm the rings; drops surge them; a drop after a dip swaps the two accent colours over about 1 s.
- [ ] Radial crown: 48 bars around the tunnel rim, with particles launching from the bar tips. Visual gain changes its height. Calm shrinks it.
- [ ] Photosensitivity: fullscreen on a loud drop, look for strobing. Flashes must stay at 3 per second or fewer.

Known gaps, found while writing this round:
- Crown bars were not clearly visible in the one automated frame checked (test signal: sweep). Confirm on a real track.
- The outer tunnel bands are wide and bright near the edge; the owner may want them thinner.
- Shaders were checked only in one headless Chrome session.
- The recording named `3.11.48 PM.mov` is not in the shared folder; the 3.04.25 PM check stands.
