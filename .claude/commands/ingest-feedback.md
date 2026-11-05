---
description: Parse external Gemini audit verdict into .spec/SYSTEM_SPEC.md and .spec/PROGRESS.md
argument-hint: [pasted verdict | verdict | --from-file | --from-pr <number>]
allowed-tools: Read, Edit, mcp__github__pull_request_read, Bash(node *)
disable-model-invocation: true
---
Ingest external audit feedback according to $ARGUMENTS:

1. **Resolve Feedback Source:**
   - **From PR review (`--from-pr [number]`):** Fetch the pull request review comments and issue comments using `mcp__github__pull_request_read`. Extract the latest audit verdict block and findings.
   - **From file (`verdict` or `--from-file`):** Read `.spec/AUDIT_VERDICT.json` using `Read`. Parse the structured audit verdict (`status`, `findings`, `remediations`).
   - **From pasted text ($ARGUMENTS):** If $ARGUMENTS contains pasted review/verdict text directly (and is not a flag/file keyword above), parse the verdict from $ARGUMENTS.

2. **Apply Architectural Fixes & Remediations:**
   - Apply any blocking architectural fixes to `.spec/SYSTEM_SPEC.md`.
   - Update task risk tags (`[UI / VISUAL]` or `[CORE / DATA]`) and prepend any required remediation slices to `.spec/PROGRESS.md`.
   - If an audit status was provided (e.g. `CLEAN`, `NEEDS_CHANGES`, `AUDIT_PENDING`), update `- **Audit Status:** [CLEAN | NEEDS_CHANGES | AUDIT_PENDING | none]` in `.spec/SESSION_HANDOFF.md`.

3. **Output Receipt:**
   - Output a 1-line receipt confirming the updates and state the next command to run (`/implement` or `/spec`).
