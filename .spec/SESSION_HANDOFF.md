# Session Handoff: Stage 21 closed, Shape work finished

## Last Active State
- **Last Active Platform**: Claude Code (web)
- **Branch**: `claude/project-thread-cvtfkr`, from `main` at `4572288` (PR #311 merged).
- **Active Task**: none. No `[IN_PROGRESS]` slice. No open pull requests.
- **Status**: Stage 21 closed on 2026-11-12. No next stage is defined.

## What changed (recent)
- Shape work is finished: Slices 19.9a to 19.15 are merged (PRs #294 to #311). The legacy Waveform layer is gone; any Waveform layer loads as Shape. Bars, Rings, Crown and Shockwave still use their legacy layers.
- Stage 20 is built (20.1 to 20.11). Stage 21 slices 21.1 to 21.15 are all `[x]` in `.spec/PROGRESS.md` and merged.
- Issue #295 is an automatic alarm about the pre-gate commit `df9939d3afa1` (Slice 20.10 re-port). It is informational.

## Stage 21 closed (Charlie, 2026-11-12)
- Spec checkboxes ticked, 21.12 to 21.15 added to the spec, and the slices archived to `.spec/HISTORY.md`.
- The spec's three "Done when" checks were not run on the live site. They remain Charlie's optional check.

## Open items
1. Dust Wave Sample count 512 or 1024: Charlie may try them and say whether the migrated Waveform default (256) should rise. Frame cost at 512 and 1024 on a real GPU is not measured.
2. Older enhancement issues #18 to #29 are untriaged. Likely already covered by built work: #25 (per-pixel warp, Slices 20.1 and 20.2), #26 (polygons, Shape), #23 (frame-rate watchdog, `src/render/frameBudget.ts`), #27 (blend modes exist in `src/presets/format.ts`). Not yet verified one by one. Likely still open: #24 transitions, #28 beat and bar tracker, #29 second-window Control Deck, #18 to #22.
3. No lint script exists in the repo, so Verify lines omit lint.

## Next Steps
1. Charlie says what to do with issues #18 to #29 (check each against the code and propose closing the covered ones).
2. After confirmation: `/spec` for any new slices, then `/implement` one slice at a time.
