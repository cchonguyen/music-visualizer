---
description: Generate system architecture contracts and risk-tagged task slices (<5 files per slice)
allowed-tools: Bash(node *)
---
Tier gate status: !`node "${CLAUDE_PROJECT_DIR:-.}/.harness/scripts/evaluate-upshift.mjs" spec $ARGUMENTS`

1. Read the Tier gate status above:
   - Dispatch `harness:el-architect` to translate `.spec/SYSTEM_SPEC.md` into schemas, file boundaries, and atomic (<5 target files) risk-tagged tasks in `.spec/PROGRESS.md`.
   - If it reports Level 1, the change is small: skip planning and use `/quick-fix` or an on-the-fly slice.
2. Run `node "${CLAUDE_PROJECT_DIR:-.}/.harness/scripts/bundle-handoff.mjs" spec` to prepare `.spec/HANDOFF_PACKET.md`.
3. Do NOT print the packet in chat. Do not wait for an external audit. Continue to implementation. If the operator later sends an audit verdict, apply it with /ingest-feedback.
