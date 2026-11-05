import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHubSync, analyze, outsideHarnessBlock } from '../../scripts/pr-scope-check.mjs';

const managed = { files: { '.harness/config/thresholds.json': 'aaa', '.claude/agents/auditor.md': 'bbb' } };
const hashOf = (hashes) => (file) => hashes[file] ?? null;
const sync = (over = {}) => ({
  changed: ['.harness/managed.json', '.harness/config/thresholds.json'],
  deleted: [],
  managed,
  hashOf: hashOf({ '.harness/config/thresholds.json': 'aaa' }),
  ...over,
});

test('a hub sync with matching hashes passes', () => {
  assert.equal(isHubSync(sync()), true);
});

test('an engine file whose hash does not match its manifest entry is a hand edit', () => {
  assert.equal(isHubSync(sync({ hashOf: hashOf({ '.harness/config/thresholds.json': 'zzz' }) })), false);
});

test('an engine file missing from the manifest is not a sync', () => {
  assert.equal(isHubSync(sync({ changed: ['.harness/managed.json', '.claude/new.md'], hashOf: hashOf({ '.claude/new.md': 'x' }) })), false);
});

test('a sync without a managed.json change is not a sync', () => {
  assert.equal(isHubSync(sync({ changed: ['.harness/config/thresholds.json'] })), false);
});

test('deleting an engine file is never a sync', () => {
  assert.equal(isHubSync(sync({ deleted: ['.harness/hooks/vibe.mjs'] })), false);
});

test('a PR with no engine files is not a hub sync', () => {
  assert.equal(isHubSync({ changed: ['src/app.ts'], managed, hashOf }), false);
});

test('analyze: hub sync clears the strict engine-file problem', () => {
  const r = analyze({ changed: ['.harness/config/thresholds.json'], strict: true, hubSync: true });
  assert.deepEqual(r.problems, []);
});

test('analyze: a non-sync engine change still blocks in strict mode', () => {
  const r = analyze({ changed: ['.harness/config/thresholds.json'], strict: true, hubSync: false });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /hub owns/);
});

test('settings.json passes a sync only when its permissions match the recorded generated block', () => {
  const base = sync({ changed: ['.harness/managed.json', '.claude/settings.json'], hashOf: hashOf({}) });
  assert.equal(isHubSync({ ...base, settingsMatches: true }), true);
  assert.equal(isHubSync({ ...base, settingsMatches: false }), false);
});

test('outsideHarnessBlock ignores the hub-written block and keeps the rest of the file', () => {
  const a = 'top\n<!-- >>> harness >>> -->\nhub v1\n<!-- <<< harness <<< -->\nbottom\n';
  const b = 'top\n<!-- >>> harness >>> -->\nhub v2 and more\n<!-- <<< harness <<< -->\nbottom\n';
  const c = 'top edited\n<!-- >>> harness >>> -->\nhub v2\n<!-- <<< harness <<< -->\nbottom\n';
  assert.equal(outsideHarnessBlock(a), outsideHarnessBlock(b));
  assert.notEqual(outsideHarnessBlock(a), outsideHarnessBlock(c));
  assert.equal(outsideHarnessBlock(null), null);
});

test('analyze: a sync that only rewrote the AGENTS.md harness block raises no tripwire or line budget', () => {
  const r = analyze({ changed: ['AGENTS.md'], strict: true, hubSync: true, agentsBlockOnly: true, thresholds: { line_budgets: { soft_caps: { 'AGENTS.md': 40 } } }, fileContents: new Map([['AGENTS.md', 'x\n'.repeat(62)]]) });
  assert.deepEqual(r.problems, []);
});

test('analyze: AGENTS.md edited outside the hub block still trips the tripwire', () => {
  const r = analyze({ changed: ['AGENTS.md'], strict: true, hubSync: true, agentsBlockOnly: false });
  assert.equal(r.tripwireFired, true);
});
