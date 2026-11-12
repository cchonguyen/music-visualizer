# Session Handoff: Stage 19 Shape slices finished

## Last Active State
- **Last Active Platform**: Claude Code (web)
- **Branch**: `claude/project-thread-1jqqjf`, restarted from `main` after each merge.
- **Active Task**: none. Every Stage 19 slice is done and merged to `main`.
- **Status**: Slices 19.9a to 19.9d and 19.10 merged as PRs #294, #296, #297, #298 and #299. Slice 19.4 was removed (owner decision, Charlie). Checks were green on each. Lint is not run because the repo has no lint script.

## What changed in Shape
- Punch option for the spectrum source (19.9a), band texture along the path (19.9b), a rotating 3D curve base shape (19.9c), loudness-driven rings in concentric mode (19.9d).
- Dust Wave, Ripple Field and the starter Circle Wave now load as Shape layers (19.10). Their JSON files are unchanged. Legacy Waveform, Bars and Rings layer code is still in place.

## Next Steps
1. Charlie compares Dust Wave, Ripple Field and Circle Wave on the live site against before. Known differences: band texture also scales height by the mid band, and Shape draws up to 256 points.
2. After that comparison, a later slice can remove the legacy layers. Not started. Lissajous Waveform layers, Bars, Rings and saved user presets still use the legacy layers.
3. Next roadmap stage is Stage 21 (`.spec/specs/roadmap/stage-21-public-release.md`). Triage it before building.
