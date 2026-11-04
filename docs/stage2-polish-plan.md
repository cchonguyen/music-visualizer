# Stage 2 Polish Plan (draft, not started)

Source: external reviewer's feedback on the owner's screen recording (2026-11-04).
Status: approved by owner 2026-11-04; ready for an implementing agent. Nothing implemented yet.

## Review of the feedback (checked against the code)

| Reviewer claim | Verdict | Notes from the code |
|---|---|---|
| Grey-teal fog comes from 0.97 trail decay | Partly right | The main cause is the tunnel shader itself: stripes are a full-screen cosine, so the space *between* rings is about half accent colour, and output is capped at 0.5 per channel. Decay adds haze to bars and particles only. Fix both. |
| Particles are blobs in spiral arms | Right | Every particle shares one speed (`phase × 0.1`), so they move in lockstep and form arcs. Needs per-particle speed. |
| Tunnel sits in the right third | Check | The shader centres at 0.5 with ±5% sway. Likely the bars overlay or a cropped frame. Verify on a frame from the recording before changing anything. |
| Bars and tunnel collide | Right | Two unrelated 2D layouts on one screen. |
| Rings look like flat ripples | Mostly right | Depth already uses 1/r, but stroke width is constant and circles hide any rotation. |
| Kicks barely register | Right | Kicks only brighten crests slightly; there's no travelling event. |
| Energy saturates on loud tracks | Right | Already listed under known limits. |
| WCAG only limits flashes over 25% of the view, so peaks can go to white | Overstated | WCAG 2.3.1's "general flash" uses a small area: any 341×256 px rectangle on a 1024×768 screen, about 11% of the screen. Thin bright crests are fine if the bright area inside any such rectangle stays small and nothing flashes more than 3 times a second. A real gap the reviewer missed: beat cooldown is 150 ms, so beat flashes could reach 6–7 per second on busy hi-hats. |

## Slices (in order)

Each slice is followed by a browser screenshot check with the Zedd track and `npm test`, then a commit and deploy so the owner can watch it live.

### P1. Black floor and contrast (parameters plus small shader changes)
- Tunnel: the colour between rings falls to the palette base (near black). Only stripe crests carry colour; use a sharper stripe, e.g. `pow(wave, 4)`.
- Remove the 0.5-per-channel cap. The compositor's luminance cap does that job.
- Scene decay: `prev × 0.92 − 0.004`, clamped at 0, so trails clear to black in about 300 ms.
- Palette base for neon: about `#05050a`.
- Done when: frames show mostly black with neon rings, with no grey-teal wash.

### P2. Particles become streaks that twinkle
- Each particle gets three independent hashes: speed (life rate 0.06–0.16), angle, and swirl direction (−1.2 to +1.2 × mid).
- Radius accelerates outward: `r = mix(0.14, 0.95, life^1.8)`.
- Quads are stretched along the direction of motion: width 0.0025–0.005, length 0.006 + 0.025 × energy × life.
- Profile: a white core fading to the accent. Twinkle is a sharp per-particle sine, 6–14 rad/s.
- Done when: no arcs or spirals are visible, and particles read as streaks flying past.

### P3. Tunnel depth, bend and roll
- Stroke gets thicker toward the edge (thin far away, thick close up).
- Bending sway: the vanishing point drifts on a figure-eight (±10% X, ±6% Y, about 0.1 Hz, scaled by mid). It's weighted by (1 − r), so the deep centre moves and the outer rim stays put. Off in Calm.
- Ring shape: a gentle 6-sided modulation (5%) with a slow roll: `roll += dt × (0.08 + 0.15 × energy)`.
- Done when: the tunnel reads as a bending 3D corridor, not ripples.

### P4. Musical events
- **Kick shockwave:** on a sub-band beat, a bright ring travels from r 0.16 to 0.85 over 350 ms and fades. It's a local ring, not a full-screen flash.
- **Section contrast:** `fast loudness − 8 s slow loudness`, clamped to ±0.5. It gives loud mastered tracks a signal again: breakdowns drop rings and particle speed, drops surge them.
- **Drop colour change:** when a kick lands after a breakdown dip and energy is above 0.75, accents A and B swap over about 1 s. That's slower than the reviewer's 600 ms, so it isn't a large sudden change.
- Done when: kicks are visible as waves, and a drop looks different from a verse.

### P5. Unify the bars with the tunnel (owner chose Option B)
- **Option A (small):** cut a soft circular hole in the bars around the tunnel centre, so the bars frame the edges.
- **Option B (bigger, recommended end state):** draw the 48 bars radially as a "crown" around the tunnel's inner rim, emitting the particles. The flight scene becomes one system, and the separate bars scene stays on key 2.

### P6. Photosensitivity guard (runs alongside P1–P4)
- Global flash governor: no visible flash event (beat flash, shockwave, palette swap) more than 3 times per second, so at least 333 ms apart.
- The luminance cap is estimated from the area of bright features, not just energy. Thin crests and particle cores may reach white; the full-screen average may not jump.
- Update `docs/stage2-test-report.md` with a check: watch a drop section fullscreen and look for strobing.

## Owner decisions (2026-11-04)
1. Bars: **Option B.** Build the radial crown of 48 bars around the tunnel rim, with particles launching from it. Skip Option A. The auto blend of the separate bars scene is removed from the default view; the bars scene stays on key 2.
2. **Yes:** small bright features (crests, particle cores, shockwave) may briefly reach full white. The P6 flash governor must be in place first: at most 3 flashes per second, and no full-screen average jump.

## Handoff notes for the implementing agent
- Read `/Users/charliechonguyen/Projects/music-visualizer/CLAUDE.md` and `.spec/` first.
- Do the slices in order: P1, then P6, then P2 and P3 (these two can run in parallel), then P4, then P5.
- Before P1, commit and confirm the tree is clean.
- After each slice, run `npm test`, take a browser screenshot with the Zedd track (`/Users/charliechonguyen/OpenBot/Shared/Transfers/352bb0fa-c3ea-4b33-8a65-e45d15e2d2dc/Zedd Out of Time Reverb Edit.mp3`), commit, push, and `npx wrangler deploy`.
- Before P3, verify the "off-centre" claim on a frame from `/Users/charliechonguyen/OpenBot/Shared/Transfers/9aed644c-0cfe-4bfe-b646-aabb8341cf87/Screen Recording 2026-11-04 at 3.04.25-PM.mov`.
- Keep motion integrated (phase accumulators). Keep Calm mode working (sway, shockwave and swap off; motion slowed).
- When done, update `CLAUDE.md` (Decision Log), `.spec/PROGRESS.md`, and `docs/stage2-test-report.md`.
- Free or cheap models only. No paid services.

## Delegation
P1 and P6 are small, so the lead does them. P2–P4 are shader slices for Haiku or free-model workers in parallel worktrees: P2 is particles only, P3 tunnel only, and P4 touches both, so it goes after P3. P5 goes after P4.
