# Project Context & Harness Dispatcher

@.claude/harness-rules.md
@.claude/project-rules.md

## Project
- What: a desktop web app (Chrome/Edge, Mac and Windows) that visualizes a music file, tab/system audio, or the mic. No accounts, no uploads.
- Scope and contracts: `.spec/SYSTEM_SPEC.md` (current). Decisions: `.spec/DECISIONS.md`.
- Stack: plain TypeScript + Vite, raw WebGL2, Web Audio API, Vitest. Hosting: Cloudflare Workers static assets (planned).
- Live (Stage 1 test build): https://music-visualizer.charliechonguyen.com (custom domain, owner approved 2026-11-04). Backup: https://music-visualizer.charliechonguyen.workers.dev
- Status: Stage 1 signed off. Stage 2 polish (P1–P5 + patch) deployed 2026-11-04; owner device check open in `docs/stage2-test-report.md`. Stage 2.5 quiet-passage fixes deployed 2026-11-04 (root cause not fully confirmed); previously next: (`docs/stage2.5-plan.md`). Stage 3 parked; Stage 4 (presets, effects, Preset Studio) planned in `docs/stage4-presets-plan.md`, awaiting owner approval. Queue: `.spec/PROGRESS.md`.
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
- `npm run deploy` — build and deploy to Cloudflare (check `npx wrangler whoami` first)
- Free-model slices: `~/OpenBot/Agents/agent-29a801b6-9741-4a30-91c7-ffeb35065c9e/scripts/run-slice.sh <id> <model>` (OpenBot's bundled OpenCode)
