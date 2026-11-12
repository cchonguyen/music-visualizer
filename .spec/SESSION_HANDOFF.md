# Session Handoff: Shape tuning and legacy Waveform removed

## Last Active State
- **Last Active Platform**: Claude Code (web)
- **Branch**: `claude/project-thread-1jqqjf`, restarted from `main` after each merge.
- **Active Task**: none. Slices 19.11 to 19.15 are merged to `main` (PRs #301, #305, #309, #310). Checks were green on each. Lint is not run because the repo has no lint script.
- **Status**: Charlie confirmed Dust Wave looks acceptable after the tuning.

## What changed
- Remote (database) system presets override the built-in ones at app start. They are now migrated to Shape too (19.11), which fixed Dust Wave still showing a Waveform layer.
- Shape feels sharper (19.12, 19.13): faster attack and release defaults, reactivity default 1.25, migrated Waveform uses 256 points, and each audio bucket keeps its largest swing instead of an average.
- Shape sample cap is now 1024 (19.14). The default stays 64 and migrated Waveform stays 256. Frame cost at 512 and 1024 on a real GPU is not measured.
- The legacy Waveform layer is gone (19.15). Any Waveform layer, in any mode, loads as Shape wherever a preset enters the app. The `waveform` schema stays so old saved presets still parse. Bars, Rings, Crown and Shockwave still use their legacy layers.
- Issues #287 to #290 were closed. Issue #295 is an automatic alarm about a pre-gate commit and is informational.

## Next Steps
1. Charlie may try Sample count 512 or 1024 on Dust Wave and say whether to raise the migrated Waveform default.
2. Stage 21 (`.spec/specs/roadmap/stage-21-public-release.md`) is next. Triage it before building. Older enhancement issues #18 to #29 are untriaged.
