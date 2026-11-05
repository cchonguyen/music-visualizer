// Guards the wiring of the PostToolUse telemetry hook. Without it, no call records are written,
// so the finish-slice gate reports "no subagent dispatch recorded" even after a real dispatch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const TELEMETRY_HOOK = 'post-tool-telemetry.mjs';

function postToolUseHooks(relPath) {
  const file = fileURLToPath(new URL(relPath, import.meta.url));
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const groups = json.hooks?.PostToolUse || [];
  return groups.flatMap((g) => (g.hooks || []).map((h) => ({ matcher: g.matcher, command: h.command || '' })));
}

test('the engine settings register the telemetry hook on every tool call', () => {
  const hooks = postToolUseHooks('../../.claude/settings.json');
  const telemetry = hooks.filter((h) => h.command.includes(TELEMETRY_HOOK));
  assert.equal(telemetry.length, 1, 'expected exactly one telemetry hook in .claude/settings.json');
  assert.equal(telemetry[0].matcher, '*');
  assert.match(telemetry[0].command, /adapter\.mjs/, 'telemetry must run through the repo-pinned adapter');
});

test('the plugin hooks register the telemetry hook on every tool call', () => {
  const hooks = postToolUseHooks('../../plugins/harness/hooks/hooks.json');
  const telemetry = hooks.filter((h) => h.command.includes(TELEMETRY_HOOK));
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].matcher, '*');
});
