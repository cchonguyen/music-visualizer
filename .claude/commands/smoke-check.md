---
description: Read-only feasibility and collision check before any code is written
allowed-tools: Read, Glob, Grep
disable-model-invocation: true
---
Check the proposed task below against the repo. Do NOT write, edit, create, move, or delete any file, and do NOT run commands that change disk state, including `.spec/` files.

Task: $ARGUMENTS

1. Inspect the target files, their imports, and the existing test suites that touch them.
2. Output exactly 4 bullet points, in this order:
   - **Target files confirmed:** which target files exist, and which are missing or would be new.
   - **Existing tests or schema boundaries affected:** tests, schemas, or contracts the change would touch.
   - **Single biggest technical risk:** the one risk that most threatens the change.
   - **Verdict:** `READY TO BUILD` or `NEEDS ADJUSTMENT`.
