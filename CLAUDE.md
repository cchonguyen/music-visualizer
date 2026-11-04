# Project Context & Harness Dispatcher

@.claude/harness-rules.md
@.claude/project-rules.md

## Project
- What: a browser app that turns a local music file into live 2D visuals (bars, waveform, radial rings). No accounts, no uploads.
- Scope and decisions: `.spec/SCOPE_BRIEF.md` (v2, Council-reviewed).
- Stack: plain TypeScript + Vite, Canvas 2D, Web Audio API. Hosting: Cloudflare Workers static assets (planned).
- Planned domain: `music-visualizer.charliechonguyen.com` (custom_domain route).
- Status: harness set up, no app code yet. GitHub repo `music-visualizer` to be created by owner.

## Work Mode
- Default is **Manager Mode** (`"workMode": "manager"` in `.spec/harness.json`): no `[IN_PROGRESS]` slice means no edits outside `.spec/` until a task is planned. Small one-file tweaks use `/quick-fix` (added in a later slice).
- `"workMode": "vibe"` turns the plan lock off for this project.
- One `[IN_PROGRESS]` line = **Slice Mode**: strict single-task lock on that slice's target files.

## Project-Specific Commands
- Add the quick checks for this project here (typecheck, unit tests, lint).
