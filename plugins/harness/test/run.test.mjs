import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findHarnessRoot, parsePayload, run, ADAPTER } from '../hooks/run.mjs';
import { STANDING_RULES, sessionStartOutput } from '../hooks/standing-rules.mjs';

function tmpRepo(adapterBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-run-'));
  if (adapterBody !== undefined) {
    fs.mkdirSync(path.join(dir, '.harness', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, ADAPTER), adapterBody);
  }
  return dir;
}

test('finds the harness root by walking up from a subdirectory', () => {
  const repo = tmpRepo('');
  const sub = path.join(repo, 'src', 'deep');
  fs.mkdirSync(sub, { recursive: true });
  assert.equal(findHarnessRoot([sub]), repo);
});

test('skips empty candidates and falls through to the next one', () => {
  const repo = tmpRepo('');
  assert.equal(findHarnessRoot([undefined, '', repo]), repo);
});

test('returns null when no candidate has .harness', () => {
  assert.equal(findHarnessRoot([tmpRepo()]), null);
});

test('bad JSON payload parses to an empty object', () => {
  assert.deepEqual(parsePayload('{nope'), {});
  assert.deepEqual(parsePayload(''), {});
});

test('repo without .harness is a silent no-op with exit 0', () => {
  const r = run('pre-tool-guard.mjs', '{}', { env: { CLAUDE_PROJECT_DIR: tmpRepo() }, cwd: tmpRepo() });
  assert.equal(r.status, 0);
  assert.equal(r.skipped, 'no .harness');
});

test('passes the adapter exit code through, so exit 2 still blocks', () => {
  const repo = tmpRepo('process.exit(2)');
  const r = run('pre-tool-guard.mjs', '{}', { env: { CLAUDE_PROJECT_DIR: repo }, cwd: os.tmpdir() });
  assert.equal(r.status, 2);
  assert.equal(r.root, repo);
});

test('uses payload cwd when CLAUDE_PROJECT_DIR is unset, and forwards stdin and script name', () => {
  const repo = tmpRepo(`import fs from 'node:fs';
const input = fs.readFileSync(0, 'utf8');
fs.writeFileSync(process.env.CLAUDE_PROJECT_DIR + '/seen.json', JSON.stringify({ script: process.argv[2], input }));`);
  const raw = JSON.stringify({ cwd: repo, agent_type: 'harness:gf-coder' });
  const r = run('bash-guard.mjs', raw, { env: {}, cwd: os.tmpdir() });
  assert.equal(r.status, 0);
  const seen = JSON.parse(fs.readFileSync(path.join(repo, 'seen.json'), 'utf8'));
  assert.equal(seen.script, 'bash-guard.mjs');
  assert.equal(seen.input, raw);
});

test('payload cwd repo wins over CLAUDE_PROJECT_DIR when both repos have a harness', () => {
  const spoke = tmpRepo('');
  const hub = tmpRepo('');
  const sub = path.join(spoke, 'src');
  fs.mkdirSync(sub, { recursive: true });
  const r = run('post-tool-telemetry.mjs', JSON.stringify({ cwd: sub }), {
    env: { CLAUDE_PROJECT_DIR: hub }, cwd: os.tmpdir(), spawn: () => ({ status: 0 }),
  });
  assert.equal(r.root, spoke);
});

test('hooks.json routes every event through run.mjs', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'));
  const cmds = Object.values(cfg.hooks).flat().flatMap((m) => m.hooks.map((h) => h.command));
  assert.ok(cmds.length >= 6);
  // refresh.mjs runs before the repo adapter exists (it installs the plugin the adapter comes from), so it is exempt.
  // standing-rules.mjs is exempt too: it runs without .harness so the rules reach projects that have no engine.
  for (const c of cmds) {
    if (c.includes('/hooks/refresh.mjs"') || c.includes('/hooks/standing-rules.mjs"')) continue;
    assert.match(c, /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/run\.mjs" \S+\.mjs$/);
  }
});

test('standing rules hook emits SessionStart context with the auto-merge rule', () => {
  const out = JSON.parse(sessionStartOutput());
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /Auto-merge: when a pull request is green/);
  assert.equal(STANDING_RULES.length, 3);
});

test('standing rules hook is registered as its own SessionStart command, outside run.mjs', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'));
  const cmds = cfg.hooks.SessionStart.flatMap((m) => m.hooks.map((h) => h.command));
  assert.ok(cmds.some((c) => c.endsWith('/hooks/standing-rules.mjs"')));
});
