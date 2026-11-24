# Project Context & Harness Dispatcher

@.claude/harness-rules.md
@.claude/project-rules.md

## Project
- What: a desktop web app (Chrome/Edge, Mac and Windows) that visualizes a music file, tab/system audio, or the mic. No accounts, no uploads.
- Scope and contracts: `.spec/SYSTEM_SPEC.md` (current). Decisions: `.spec/DECISIONS.md`.
- Stack: plain TypeScript + Vite, raw WebGL2, Web Audio API, Tweakpane (Studio only), Vitest. Hosting: Cloudflare Workers static assets, plus a small Worker for the `/admin` routes (Cloudflare Access) and Supabase for system presets.
- Live: https://music-visualizer.charliechonguyen.com (custom domain, owner approved 2026-11-04). Backup: https://music-visualizer.charliechonguyen.workers.dev
- Status: Stages 1–29 built, verified and deployed (custom domain and workers.dev). 31 numbered built-in presets plus Classics & Textures, 16 WebGL2 visual layer types, Preset Studio with folders, pop-out Studio and music-reactive (⚡) controls, and the photosensitivity safety governor. Stage history: `.spec/HISTORY.md`. Run `npm test` for the current test count (1,849 tests in 83 files on 2026-11-24).
- GitHub: https://github.com/cchonguyen/music-visualizer (branch `main`).

## Work Mode
- Default is **Manager Mode** (`"workMode": "manager"` in `.spec/harness.json`): no `[IN_PROGRESS]` slice means no edits outside `.spec/` until a task is planned. Every change in this repo is a slice, including one-file tweaks (standing rule, Charlie); do not use the quick-fix path here.
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
