# Project Context & Harness Dispatcher

@.claude/harness-rules.md
@.claude/project-rules.md

## Project
- Describe this project here: what it is, the stack, and how to run its checks.

## Work Mode
- Default is **Manager Mode** (`"workMode": "manager"` in `.spec/harness.json`): no `[IN_PROGRESS]` slice means no edits outside `.spec/` until a task is planned. Small one-file tweaks use `/quick-fix`. Larger fixes open an on-the-fly slice with `node .harness/scripts/start-slice.mjs --adhoc`.
- `"workMode": "vibe"` turns the plan lock off for this project.
- One `[IN_PROGRESS]` line = **Slice Mode**: strict single-task lock on that slice's target files.

## Project-Specific Commands
- Add the quick checks for this project here (typecheck, unit tests, lint).
