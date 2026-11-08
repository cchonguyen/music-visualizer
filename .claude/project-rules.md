# Project Rules

This file is owned by this project. The harness never overwrites it.

## Active Project Rules
- Parallel slices are allowed only for free (OpenCode) or cheap (Haiku) workers, each in its own git worktree, with no shared target files. Opus/lead slices run one at a time. (Owner, 2026-11-04)
- Free-model workers run through OpenBot's bundled OpenCode binary, not a separate install (the Homebrew copy is incompatible with its database).
- Workers touch only their slice's target files, add no dependencies, and must paste Verify output. The lead reviews every diff before merge.
- **Regular PR Cadence**: Work must be committed and pushed to GitHub PRs regularly (batched in small groups of related slices, or after each milestone/stage). Never let more than a small batch of slices accumulate locally without opening/updating a PR, preventing GitHub documentation, review visibility, and tracking from going stale. (Owner, 2026-11-07)

## Pending Rule Candidates — not in force
