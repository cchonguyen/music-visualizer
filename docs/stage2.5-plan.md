# Stage 2.5 Plan: Quiet-passage fixes (draft, not started)

Source: frame-by-frame review of the owner's test recording `video_1.mov` (2026-11-04).
Owner rule (SYSTEM_SPEC, resolved 2026-11-04): **quiet passages dim, never go black.**

## What the video shows
- At 00:01–02, 00:04, 00:09–11, 00:13–15, 00:17–20 and 00:23–24, the tunnel and particles vanish. Only one static ring stays on black.
- The view snaps between the full neon tunnel (00:00, 00:03, 00:05, 00:08, 00:12) and the empty one-ring state. It reads like a strobe, a dropped frame rate or a noise gate.
- The inner radial lines (crown) look separate from the outer hexagonal rings, like two widgets stacked on each other.

## Hard constraints (each one must pass before Stage 2.5 is done)

### C1. Quiet passages dim, never go black
- When energy or `norm` falls near zero, tunnel rings and particle alpha ease down to a resting floor of **at least 0.12 alpha**. They never reach 0.
- No binary layer cut-outs: no layer may switch off, skip its draw, or drop geometry because audio is quiet.
- Check: play a track with a silent break. Every frame in the break still shows the tunnel and some particles, dimmed.

### C2. Smooth release, no strobe
- All layer opacities and the master brightness scalar use a damped exponential release envelope with a **250–400 ms time constant**. Attack can stay fast.
- Check: step from loud to silence. Brightness falls over about 1 s (3 time constants), with no single-frame jump.

### C3. One continuous flow from core to tunnel
- Particles and inner waveforms start at the tips of the radial bars (r = 0.16) and fly outward into the tunnel's perspective depth.
- Check: in a still frame, streaks visibly leave the crown tips and join the ring stripes; nothing floats unattached between them.

## Suspects in the code (root cause not yet confirmed; verify before changing)
The review's guessed cause (an audio gate or visibility toggle) has not been checked. A quiet-floor patch already exists (tunnel crests keep at least 12%, see `.spec/DECISIONS.md`). Owner confirmed `video_1.mov` was recorded after that patch deployed, so the floor alone does not prevent the blackout.

Code trace (2026-11-04): no audio gate or layer toggle was found. The tunnel draws an opaque full-screen pass every frame, and its stripe crests reach 0.75 × accent no matter the audio level. The compositor cap only trims bright pixels and never drops below 0.15. Scenes switch only on a key press. Unexplained so far: in the code, the tunnel should never fully vanish. Next step is a live repro that logs per-frame values at a blackout moment, or frames taken from the video. Places that can push the picture to black:
- `src/render/shaders/decay.frag.glsl`: trail decay `prev × 0.92 − 0.004`, clamped at 0, clears to black in about 300 ms (P1 choice). Conflicts with C1 if nothing redraws.
- `src/render/particleState.ts`: `highFlash` release is 150 ms, shorter than C2's 250–400 ms.
- `src/render/shaders/crown.frag.glsl`: fades out near-silent bars.
- `src/render/sectionContrast.ts` (P4): breakdowns "drop rings and particle speed". A big negative contrast may zero ring brightness.
- `src/render/compositor.ts`: brightness cap `0.2 + 0.8 × loudness` through the limiter; check what floor the limiter enforces.
- `src/render/layers/tunnel.ts`, `particles.ts`: any `if (energy < x) return` style early exit.

## Order
1. Reproduce: play the track from `video_1.mov` and log energy, contrast, cap and per-layer alpha at a blackout timestamp. Find which value hits 0.
2. C1 floor, then C2 envelopes (one shared helper, unit-tested), then C3 particle spawn radius.
3. Keep the P6 flash governor and Calm mode working. Run `npm test`, screenshot, update `docs/stage2-test-report.md`.
