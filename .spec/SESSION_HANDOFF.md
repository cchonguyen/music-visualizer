# Session Handoff: Stage 22 built

## Last Active State
- **Last Active Platform**: Claude Code (web)
- **Branch**: `claude/project-thread-cvtfkr`, restarted from `main` after each merge.
- **Active Task**: none. No `[IN_PROGRESS]` slice.
- **Status**: Stage 22 (slices 22.1 to 22.7, issues #315 to #321) is built and merged on 2026-11-13. Nothing is in progress.

## What changed (recent)
- Shape work is finished: Slices 19.9a to 19.15 are merged (PRs #294 to #311). The legacy Waveform layer is gone; any Waveform layer loads as Shape. Bars, Rings, Crown and Shockwave still use their legacy layers.
- Stage 20 is built (20.1 to 20.11). Stage 21 slices 21.1 to 21.15 are all `[x]` in `.spec/PROGRESS.md` and merged.
- Issue #295 is an automatic alarm about the pre-gate commit `df9939d3afa1` (Slice 20.10 re-port). It is informational.

## Stage 21 closed (Charlie, 2026-11-12)
- Spec checkboxes ticked, 21.12 to 21.15 added to the spec, and the slices archived to `.spec/HISTORY.md`.
- The spec's three "Done when" checks were not run on the live site. They remain Charlie's optional check.

## Open items
1. Dust Wave Sample count 512 and 1024: Charlie tried them on 2026-11-12 and said they look good. The migrated Waveform default stays 256 unless he asks to raise it.
2. Issues #18 to #29 checked against the code on 2026-11-12 (Charlie approved closing the seven covered ones on 2026-11-12; #18, #22 to #27 are closed):
   - Covered, closed: #18 (`src/audio/envelope.ts`), #22 (superseded by Stages 18 and 20 and the 2026-11-08 projectM decision), #23 (`frameBudget.ts`, `qualityGovernor.ts`), #24 (`TRANSITIONS` in `compositor.ts`: crossfade, wipe, dissolve, zoom, morph), #25 (`warpField.frag.glsl`), #26 (Shape layer), #27 (layer `opacity` and `blend` in `format.ts`).
   - Partly covered: #19 (Reactions kick response exists, a bloom burst on bass onset was not found), #28 (`tempo.ts` has beat count and bar phase, scene changes are not phrase-aligned; auto-cycle beat mode uses strong beats).
   - Correction 2026-11-13: the Global Director (`src/render/globalDirector.ts`) already has camera moves and colour moods. #20 only lacks a kick zoom and #21 only lacks explicit energy tiers. #19 particle kick push exists; only bloom-on-kick presets were missing.
   - Still open: #20, #21, #19, #28, #29. All five are specced as Stage 22 (slices 22.1 to 22.7, issues #315 to #321), not built.
3. No lint script exists in the repo, so Verify lines omit lint.

## Stage 22 (built 2026-11-13, PRs #324 to #329 and the 22.7 PR)
- 22.1 Phrase auto-cycle mode: Off, Timer, Beat, Phrase. Switches on the first beat of every N bars (4, 8 or 16, default 8). `minGapSec` (8 s) also gates it, so 4-bar phrases at about 170 BPM or faster can be skipped.
- 22.2 Kick zoom in the Director camera: peak 0.05, at most 3 per second, halved in Reduced intensity, zero in Calm.
- 22.3 Bloom pulse on strong beats in Punchy and Wild, through the shared flash limiter (so it shares the 3 flashes per second with Shockwave and Tunnel).
- 22.4 Energy tiers (chill, build, drop) in Director colour, with hysteresis. The mood weighting is a spread nudge, not a palette change.
- 22.5 to 22.7 Studio in a second window: `/popout.html` runs the Studio without a GPU and sends edits over a BroadcastChannel; the visual window applies them with clamped, narrow setters and never saves or writes to the server. A "Pop out" button and Shift+E open it. The in-page Studio hides while a pop-out is connected. The service worker keeps `/popout.html` out of the app-shell cache.
- Not tested in a real browser: the pop-out window, blocked-popup toast, narrow-screen label, and admin login from the pop-out (needs Charlie's hand test). The snapshot is not resent when the preset list changes, only when the shown preset changes or the pop-out says hello.

## Open items
1. Issues #19, #20, #21, #28 and #29 are now built; close them if not already closed.
2. No lint script exists in the repo, so Verify lines omit lint.

## Next Steps
1. Charlie tries Phrase mode, the pop-out Studio, Punchy/Wild bloom and the kick zoom on the live site and reports what looks wrong.
2. Plan the next stage with `/triage`.
