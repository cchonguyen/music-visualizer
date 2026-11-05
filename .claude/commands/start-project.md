---
description: Set up the harness in a new or existing project. Shows what is there, then fills only the missing files after you confirm. An optional sentence also creates a scope brief.
argument-hint: [optional: one sentence describing the project]
allowed-tools: Bash(node *), Read, Write, Agent
---
Project state: !`node "${CLAUDE_PROJECT_DIR:-.}/.harness/scripts/start-project.mjs" status`

Idempotent setup. Existing files are never overwritten. Nothing is written until the user confirms.

1. Show the user the project state above in plain English, in under 12 lines. Keep the names of files and the work mode. Do not print file contents.
2. If the state says "Already set up", report that and stop. Do not run `apply`.
3. If `$ARGUMENTS` is not empty, the user gave a one-sentence intake. Spawn the `discovery` subagent (Haiku) with `"$ARGUMENTS"`, the same step `/triage` uses. It is read-only. Show its Scope Brief and "Do NOT Build" list in under 12 lines. Do not write anything yet. Do not run `/spec`, `/implement`, or edit `.spec/PROGRESS.md`.
4. Ask one question and stop: "Reply yes to write these files" with the count from step 1. If there was an intake, say the brief will go to `.spec/SCOPE_BRIEF.md`.
5. Only after the user replies yes:
   - Run `node "${CLAUDE_PROJECT_DIR:-.}/.harness/scripts/start-project.mjs" apply`. It creates only the missing files and skips any file that already exists.
   - If there was an intake and `.spec/SCOPE_BRIEF.md` does not exist, write the brief to it with the Write tool. If it already exists, do not overwrite it and say so.
   - Output a 1-line receipt. Do not start a build.
6. If the user says no, or does not answer, write nothing.
