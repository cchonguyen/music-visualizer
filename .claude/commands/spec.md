---
description: Generate system architecture contracts and risk-tagged task slices (<5 files per slice)
argument-hint: [optional: sonnet|opus]
allowed-tools: Bash(node *)
---
Tier gate status: !`node "${CLAUDE_PROJECT_DIR:-.}/.harness/scripts/evaluate-upshift.mjs" spec $ARGUMENTS`

1. Read the Tier gate status above:
   - If Level 3 is signaled or `$ARGUMENTS` contains `opus`, dispatch `architect-opus` (Opus) to resolve deep architectural synthesis or deadlocks.
   - Otherwise, dispatch `architect` (Sonnet) to translate `.spec/SYSTEM_SPEC.md` into schemas, file boundaries, and atomic (<5 target files) risk-tagged tasks in `.spec/PROGRESS.md`.
2. Run `node "${CLAUDE_PROJECT_DIR:-.}/.harness/scripts/bundle-handoff.mjs" spec` to prepare `.spec/HANDOFF_PACKET.md`.
3. Do NOT print the packet in chat. Conclude with the `Needed from you:` steps for Gemini's `arch-auditor` skill.
