---
description: One-file fix in Manager Mode, planned and closed in one turn
argument-hint: <file> <what to change>
---
1. Refuse unless `$ARGUMENTS` names exactly one file. Refuse if that file is a Red tripwire path: a dependency manifest or lockfile, `migrations/`, a schema file, an auth file, `.env*`, `AGENTS.md`, or `.github/workflows/`. Refuse if it is an engine path (`.harness/`, `.claude/`, `.harness-version`).
2. Run `git ls-remote --tags origin harness-main-red`. If it prints a line, refuse: main is red.
3. Read `.spec/PROGRESS.md`. If a slice is already `[IN_PROGRESS]`, refuse and name it.
4. Append one line to `.spec/PROGRESS.md`, using the next free `QF-N` number, and mark it `[IN_PROGRESS]`:
   `- [ ] **Slice QF-N** [IN_PROGRESS] `[GREEN][UI / VISUAL]`: <what to change> — Target files: <file>`
5. Make the change to that file only.
6. Run the quick checks from `CLAUDE.md` once, after the final edit.
7. Mark the line `[x]` and output a 1-line receipt.
