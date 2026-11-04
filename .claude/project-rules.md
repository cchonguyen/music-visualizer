# Project Rules

This file is owned by this project. The harness never overwrites it.

## Active Project Rules
- Parallel slices are allowed only for free (OpenCode) or cheap (Haiku) workers, each in its own git worktree, with no shared target files. Opus/lead slices run one at a time. (Owner, 2026-11-04)
- Free-model workers run through OpenBot's bundled OpenCode binary, not a separate install (the Homebrew copy is incompatible with its database).
- Workers touch only their slice's target files, add no dependencies, and must paste Verify output. The lead reviews every diff before merge.

## Pending Rule Candidates — not in force
