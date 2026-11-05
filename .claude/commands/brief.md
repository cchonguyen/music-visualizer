---
description: Bundle batched status telemetry (.spec/STATUS_BATCH.jsonl) for the Gemini Briefing Agent
allowed-tools: Bash(node *)
disable-model-invocation: true
---
Briefing bundle status: !`node "${CLAUDE_PROJECT_DIR:-.}/.harness/scripts/status-batch.mjs" bundle`

Do NOT print `.spec/BRIEFING_PACKET.md` in chat. Output ONLY:
---
Needed from you:
1. **(Antigravity IDE):** Switch to Antigravity and type `brief me` (the Gemini Flash-Lite Briefing Agent will read `.spec/STATUS_BATCH.jsonl` directly from disk and clear the queue).
2. **(Gemini Web):** `.spec/BRIEFING_PACKET.md` is copied to your clipboard — paste (`Cmd+V`) into Gemini Web for a plain-English briefing.
