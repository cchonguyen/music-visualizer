# Project Context & Harness Dispatcher

@.claude/harness-rules.md
@.claude/project-rules.md

## Project
- What: a desktop web app (Chrome/Edge, Mac and Windows) that visualizes a music file, tab/system audio, or the mic. No accounts, no uploads.
- Scope and contracts: `.spec/SYSTEM_SPEC.md` (current). Decisions: `.spec/DECISIONS.md`.
- Stack: plain TypeScript + Vite, raw WebGL2, Web Audio API, Vitest. Hosting: Cloudflare Workers static assets (planned).
- Planned domain: `music-visualizer.charliechonguyen.com` (custom_domain route).
- Status: Stage 1 planned (14 slices, `.spec/PROGRESS.md`; detail in `docs/stage1-slices.md`). No app code yet.
- GitHub: https://github.com/cchonguyen/music-visualizer (branch `main`).

## Work Mode
- Default is **Manager Mode** (`"workMode": "manager"` in `.spec/harness.json`): no `[IN_PROGRESS]` slice means no edits outside `.spec/` until a task is planned. Small one-file tweaks use `/quick-fix` (added in a later slice).
- `"workMode": "vibe"` turns the plan lock off for this project.
- One `[IN_PROGRESS]` line = **Slice Mode**: strict single-task lock on that slice's target files.

## Project-Specific Commands
- Add the quick checks for this project here (typecheck, unit tests, lint).
