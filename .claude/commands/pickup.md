---
description: Zero-turn baton pickup from Antigravity/Gemini handoff
allowed-tools: Bash(node *)
disable-model-invocation: true
---
Baton status: !`node "${CLAUDE_PROJECT_DIR:-.}/.harness/scripts/baton-pickup.mjs"`

Output ONLY the 5-line baton pickup digest above and the exact 1-line next command to run (`/implement`, `/spec`, or `clerk` subagent for git merge).
