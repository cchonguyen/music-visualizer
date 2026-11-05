---
description: Package spec or git diff for zero-cost external Gemini review
argument-hint: [spec|audit|arch|overview|diff]
allowed-tools: Bash(node *), mcp__github__add_issue_comment
disable-model-invocation: true
---
Bundle status: !`node "${CLAUDE_PROJECT_DIR}/.harness/scripts/bundle-handoff.mjs" $ARGUMENTS`

Do NOT print `.spec/HANDOFF_PACKET.md` into the chat window (to save output tokens). Output the 1-line bundle status above exactly as printed, keeping any `⚠ Warning`. If it carries the stub warning, fill `.spec/SYSTEM_SPEC.md` (or link the real spec docs from it) and rerun before sending the packet.

Note: While `.spec/HANDOFF_PACKET.md` is copied to the clipboard for fast manual handoff, PR comment relay is the preferred cross-agent mechanism when a PR is open: the packet can be posted as a review comment or PR issue comment on GitHub using GitHub MCP.

Then output ONLY the following action block:

---
Needed from you:
1. **Preferred Cross-Agent Relay (when a PR is open):** PR comment relay is preferred: post `.spec/HANDOFF_PACKET.md` as a review comment or PR issue comment on GitHub using GitHub MCP (`mcp__github__add_issue_comment`).
2. **Manual Clipboard Relay (fallback):**
   - **Step 1 (macOS):** `.spec/HANDOFF_PACKET.md` is already copied to your clipboard. **(Cloud App):** Open `.spec/HANDOFF_PACKET.md` in the file explorer and click Copy.
   - **Step 2:** Switch to your Gemini tab, paste (`Cmd+V`), and press Enter (the `arch-auditor` or `code-reviewer` skill will trigger automatically from the header).
   - **Step 3:** Copy Gemini's verdict block and run `/ingest-feedback` (supports pasted text, `verdict` / `--from-file`, or `--from-pr [number]`).
