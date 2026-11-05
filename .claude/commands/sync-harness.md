---
description: Pull or push global harness rules and scripts with claude-harness-hub
allowed-tools: Bash(node *)
disable-model-invocation: true
---
Sync status: !`node "${CLAUDE_PROJECT_DIR}/.harness/scripts/hub-sync.mjs" pull`
Output the 1-line status above. If it starts with `HUB_NOT_ATTACHED`, display its `Needed from you:` block verbatim.
