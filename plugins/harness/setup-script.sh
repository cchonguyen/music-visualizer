#!/bin/bash
# Installs the harness plugin for every cloud thread in this environment.
# Claude Code loads any plugin folder under ~/.claude/skills/ as "<name>@skills-dir",
# with its agents (harness:gf-coder, harness:el-architect, ...) and its hooks.
# The hooks run each repo's own .harness/hooks/ and do nothing in repos without it.
set -u
DEST="$HOME/.claude/skills/harness"
TMP="$(mktemp -d)"
if curl -fsSL https://codeload.github.com/cchonguyen/claude-harness-hub/tar.gz/refs/heads/main \
     | tar -xz -C "$TMP" --strip-components=2 claude-harness-hub-main/plugins/harness 2>/dev/null \
   && [ -f "$TMP/harness/.claude-plugin/plugin.json" ]; then
  mkdir -p "$HOME/.claude/skills"
  rm -rf "$DEST"
  mv "$TMP/harness" "$DEST"
  echo "harness plugin installed at $DEST"
else
  echo "harness plugin download failed; threads will run without it" >&2
fi
rm -rf "$TMP"
exit 0
