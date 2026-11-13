# Session Handoff: Stage 21 closed, Shape work finished

## Last Active State
- **Last Active Platform**: Claude Code (web)
- **Branch**: `claude/project-thread-cvtfkr`, from `main` at `4572288` (PR #311 merged).
- **Active Task**: none. No `[IN_PROGRESS]` slice. No open pull requests.
- **Status**: Stage 21 closed on 2026-11-12. Stage 22 (slices 22.1 to 22.7) is specced. Slice 22.1 (Phrase auto-cycle, PR #324) is built and merged on 2026-11-13. 22.2 to 22.7 are not started.

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

## Next Steps
1. Charlie tries Phrase mode on the live site (Visuals menu, Auto-cycle, Phrase, play a steady-beat track) and says whether to start 22.2.
2. Then `/implement` one slice at a time: 22.2 (kick zoom, halved in Reduced), 22.3, 22.4, then 22.5 to 22.7 (22.2 before 22.4, 22.6 before 22.7).
3. 22.1 note: `minGapSec` (8 s) also gates phrase boundaries, so 4-bar phrases at about 170 BPM or faster can be skipped.
