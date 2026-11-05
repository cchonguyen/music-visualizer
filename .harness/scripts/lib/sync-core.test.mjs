import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AGENTS_MARKERS, GITIGNORE_MARKERS, appendActiveRules, isSpokeOwned, learnedRulesToKeep,
  harvestSpokePermissions, listHubOwned, mergeBlock, mergeSettings, spokeOnlyPermissions,
  workflowDestination,
} from './sync-core.mjs';

test('mergeBlock appends a block when markers are absent', () => {
  const out = mergeBlock('node_modules/\n', 'a\nb', GITIGNORE_MARKERS);
  assert.equal(out, 'node_modules/\n\n# >>> harness >>>\na\nb\n# <<< harness <<<\n');
});

test('mergeBlock replaces only the marked block and keeps spoke lines', () => {
  const before = 'mine/\n# >>> harness >>>\nold\n# <<< harness <<<\nalso-mine/\n';
  const out = mergeBlock(before, 'new', GITIGNORE_MARKERS);
  assert.equal(out, 'mine/\n# >>> harness >>>\nnew\n# <<< harness <<<\nalso-mine/\n');
});

test('mergeBlock works with HTML-style markers for AGENTS.md', () => {
  const out = mergeBlock('', 'rules', AGENTS_MARKERS);
  assert.equal(out, '<!-- >>> harness >>> -->\nrules\n<!-- <<< harness <<< -->\n');
});

test('mergeSettings: hub hooks win and hub deny beats spoke allow', () => {
  const hub = { hooks: { X: [1] }, permissions: { allow: ['Bash(a)'], deny: ['Bash(danger)'] } };
  const spoke = { hooks: { Y: [2] }, theme: 'dark', permissions: { allow: ['Bash(danger)', 'Bash(mine)'], deny: [] } };
  const out = mergeSettings(hub, spoke, { allow: ['Bash(danger)', 'Bash(extra)'], deny: [] });
  assert.deepEqual(out.hooks, { X: [1] });
  assert.equal(out.theme, 'dark');
  assert.deepEqual(out.permissions.allow.sort(), ['Bash(a)', 'Bash(extra)', 'Bash(mine)'].sort());
  assert.deepEqual(out.permissions.deny, ['Bash(danger)']);
});

test('spokeOnlyPermissions returns only entries the hub does not have', () => {
  const hub = { permissions: { allow: ['a'], deny: ['d'] } };
  const spoke = { permissions: { allow: ['a', 'mine'], deny: ['d', 'mine-deny'] } };
  assert.deepEqual(spokeOnlyPermissions(spoke, hub), { allow: ['mine'], deny: ['mine-deny'] });
});

test('learnedRulesToKeep returns only spoke rules missing from the hub copy', () => {
  const spoke = '# Rules\n\n## Learned Operator Rules\n- keep this\n- shared rule\n\n## Other\n- not a rule here\n';
  const hub = '## Learned Operator Rules\n- shared rule\n';
  assert.deepEqual(learnedRulesToKeep(spoke, hub), ['- keep this']);
});

test('appendActiveRules adds rules under the active header once', () => {
  const first = appendActiveRules('# Project Rules\n', ['- rule one']);
  assert.match(first, /## Active Project Rules\n\n- rule one\n$/);
  assert.equal(appendActiveRules(first, ['- rule one']), first);
});

test('isSpokeOwned protects spoke files and leaves hub files alone', () => {
  assert.equal(isSpokeOwned('CLAUDE.md'), true);
  assert.equal(isSpokeOwned('.claude/project-rules.md'), true);
  assert.equal(isSpokeOwned('.spec/PROGRESS.md'), true);
  assert.equal(isSpokeOwned('.claude/agents/engineer.md'), false);
  assert.equal(isSpokeOwned('.harness/hooks/pre-tool-guard.mjs'), false);
});

test('listHubOwned walks engine folders and skips spoke-owned files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-owned-'));
  const write = (rel) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), 'x'); };
  write('.harness/hooks/a.mjs');
  write('.harness/templates/spoke/CLAUDE.md');
  write('.claude/agents/engineer.md');
  write('.claude/commands/implement.md');
  write('plugins/harness/agents/gf-coder.md');
  write('.claude/harness-rules.md');
  write('.harness-version');
  write('.spec/EXTERNAL_AGENT_RULES.md');
  write('.spec/PROGRESS.md');
  write('CLAUDE.md');
  const files = listHubOwned(dir);
  assert.ok(files.includes('.harness/hooks/a.mjs'));
  assert.ok(files.includes('.harness/templates/spoke/CLAUDE.md'));
  assert.ok(files.includes('.spec/EXTERNAL_AGENT_RULES.md'));
  assert.ok(files.includes('plugins/harness/agents/gf-coder.md'));
  assert.ok(!files.includes('.spec/PROGRESS.md'));
  assert.ok(!files.includes('CLAUDE.md'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('learnedRulesToKeep reads rules under a second copy of the header', () => {
  const spoke = '## Learned Operator Rules\n- hub line\n\n## Learned Operator Rules\n- appended here\n';
  const hub = '## Learned Operator Rules\n- hub line\n';
  assert.deepEqual(learnedRulesToKeep(spoke, hub), ['- appended here']);
});

test('workflowDestination maps hub workflow templates to the spoke CI folder', () => {
  assert.equal(workflowDestination('.harness/templates/workflows/harness-pr-check.yml'), '.github/workflows/harness-pr-check.yml');
  assert.equal(workflowDestination('.harness/templates/spoke/CLAUDE.md'), null);
  assert.equal(workflowDestination('.harness/templates/workflows/notes.md'), null);
});

test('harvestSpokePermissions takes hand-added entries but not generated or hub ones', () => {
  const hub = { permissions: { allow: ['hub-a'], deny: [] } };
  const previous = { allow: ['gen-b'], deny: [] };
  const spoke = { permissions: { allow: ['hub-a', 'gen-b', 'hand-c'], deny: [] } };
  assert.deepEqual(harvestSpokePermissions(spoke, hub, previous), { allow: ['hand-c'], deny: [] });
});
