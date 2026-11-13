---
description: One-file fix as an on-the-fly slice, opened and closed in one turn
argument-hint: <file> <what to change>
---
1. Refuse unless `$ARGUMENTS` names exactly one file. Refuse if that file is a Red tripwire path: a dependency manifest or lockfile, `migrations/`, a schema file, an auth file, `.env*`, `AGENTS.md`, or `.github/workflows/`. Refuse if it is an engine path (`.harness/`, `.claude/`, `.harness-version`).
2. Run `git ls-remote --tags origin harness-main-red`. If it prints a line, refuse: main is red.
3. Read `.spec/PROGRESS.md`. If a slice is already `[IN_PROGRESS]`, refuse and name it.
4. Open one GitHub Issue with GitHub MCP `issue_write`. Labels: `slice`, `status:backlog` and the project label. Never use `gh`.
5. Run `node .harness/scripts/start-slice.mjs --adhoc --tag ui --targets <file> --title "<what to change>" --verify "<quick check command>" --issue <N> --reason "<operator request>"`. It writes the slice line, marks it `[IN_PROGRESS]` and commits the anchor.
6. Make the change to that file only.
7. Run the quick checks from `CLAUDE.md` once, after the final edit.
8. Run `node .harness/scripts/finish-slice.mjs "<msg>"`. It closes the slice `[x]` and stamps the Referee trailers in the same turn. Never mark `[x]` by hand.
9. Output a 1-line receipt.
