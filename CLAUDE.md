# Project Context & Harness Dispatcher

@.claude/harness-rules.md
@.claude/project-rules.md

## Project
- What: a desktop web app (Chrome/Edge, Mac and Windows) that visualizes a music file, tab/system audio, or the mic. No accounts, no uploads.
- Scope and contracts: `.spec/SYSTEM_SPEC.md` (current). Decisions: `.spec/DECISIONS.md`.
- Stack: plain TypeScript + Vite, raw WebGL2, Web Audio API, Vitest. Hosting: Cloudflare Workers static assets (planned).
- Live (Stage 1 test build): https://music-visualizer.charliechonguyen.com (custom domain, owner approved 2026-11-04). Backup: https://music-visualizer.charliechonguyen.workers.dev
- Status: Stages 1–10 built and verified in code. Deployed to production (custom domain & workers.dev). 20 Flagship Presets, 14 WebGL2 visual layer types, Preset Studio with folder hierarchy, and photosensitivity safety governor active. 993 unit tests pass across 65 test files.
- GitHub: https://github.com/cchonguyen/music-visualizer (branch `main`).

## Work Mode
- Default is **Manager Mode** (`"workMode": "manager"` in `.spec/harness.json`): no `[IN_PROGRESS]` slice means no edits outside `.spec/` until a task is planned. Small one-file tweaks use `/quick-fix` (added in a later slice).
- `"workMode": "vibe"` turns the plan lock off for this project.
- One `[IN_PROGRESS]` line = **Slice Mode**: strict single-task lock on that slice's target files.

## Project-Specific Commands
- `npm run dev` — local dev server
- `npm run typecheck` — TypeScript check
- `npm test` — unit tests (Vitest)
- `npm run build` — production build to `dist/`
- `npm run deploy` — disabled locally; production deploys run via GitHub Actions on PR merge to `main`
- `npm run deploy:ci` — CI-only deploy script used by GitHub Actions
- Free-model slices: `~/OpenBot/Agents/agent-29a801b6-9741-4a30-91c7-ffeb35065c9e/scripts/run-slice.sh <id> <model>` (OpenBot's bundled OpenCode)

## Autonomous Issue Lifecycle
When instructed to work on any feature or fix:
1. Search open issues via `gh issue list` to identify the matching issue ID.
2. Link work by starting the branch from the issue: `gh issue develop <id> --checkout`.
3. In every commit and pull request body, append `Closes #<id>`.
4. Keep all responses to a single line: what changed and the PR link.
