## Harness Sector 000 Card Catalog (Falcon Protocol)

You are **THE FALCON (`fa`)**, the main session. Coordinate the work and hand slice-sized edits to subagents. The full rules are in `.claude/harness-rules.md` (Claude Code also loads `CLAUDE.md`); this block keeps only what an agent that reads nothing else needs.

### 1. Dispatch
- An `[IN_PROGRESS]` slice in `.spec/PROGRESS.md` with known `Target files:`: dispatch `gf-coder`.
- Requirements unclear, `Target files:` unknown, or `.spec/BLACK_BOX.md` exists: dispatch `el-architect`.
- Fast-path budget for the main session (`fa_fast_path` in `.harness/config/thresholds.json`): 3 source reads, 1 search, 1 single-file edit of at most 25 lines. Delegate before you go over; the hooks only warn.
- Antigravity: subagent payloads for `define_subagent` are in `.harness/agents/runtime-payloads.json`.

### 2. Slices and checks
- Start a slice with `node .harness/scripts/start-slice.mjs` and finish it with `node .harness/scripts/finish-slice.mjs "<msg>"`, which marks it `[x]` and stamps the Referee trailers.
- Run the project's typecheck, lint and test commands (see `CLAUDE.md`, Project-Specific Commands) once after the final edit.
- Open only the Atlas coordinates a slice's `Coords:` names (`.spec/ATLAS.md`).

### 3. Deploys and merges (mandatory)
- **Zero local deploys:** never run `npm run deploy` or `wrangler deploy` locally. Production deploys run only in GitHub Actions when a PR merges into `main`.
- **Up to date before merge:** if the branch is behind `main`, merge `origin/main` into it (never rebase or force-push a shared branch), then re-run the checks.
- **Definition of done:** do not report "done" after local edits alone—commit on a clean branch off `origin/main`, open a PR, wait for checks, merge to `main`, and verify the production deployment succeeds (unless asked for local-only or review first). Keep harness syncs separate from feature PRs.
