import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseRefereeTrailers, hasRefereeTrailer, addedSliceLines, checkPullRequest, commitsMissingTrailer, isBookkeepingCommit } from './ci-gate.mjs';

const TREE = 'a'.repeat(40);

test('parseRefereeTrailers reads the two keys from a commit message', () => {
  const msg = `Finish Slice 7.1\n\nReferee-Verdict: VERIFIED\nReferee-Tree: ${TREE}\n`;
  assert.deepEqual(parseRefereeTrailers(msg), { verdict: 'VERIFIED', tree: TREE });
});

test('hasRefereeTrailer requires VERIFIED and a tree-shaped id', () => {
  assert.equal(hasRefereeTrailer(`x\n\nReferee-Verdict: VERIFIED\nReferee-Tree: ${TREE}`), true);
  assert.equal(hasRefereeTrailer(`x\n\nReferee-Verdict: FAILED\nReferee-Tree: ${TREE}`), false);
  assert.equal(hasRefereeTrailer('x\n\nReferee-Verdict: VERIFIED'), false);
  assert.equal(hasRefereeTrailer(`x\n\nReferee-Verdict: VERIFIED\nReferee-Tree: nope`), false);
  assert.equal(hasRefereeTrailer('plain commit'), false);
});

test('addedSliceLines counts only added slice lines', () => {
  const diff = [
    '+++ b/.spec/PROGRESS.md',
    '-- [ ] **Slice 7.1: Old**',
    '+- [x] **Slice 7.1: Gate**  Target files: a.mjs',
    '+- [x] Not a slice line',
    '+Some note about **Slice 9**',
  ].join('\n');
  assert.deepEqual(addedSliceLines(diff), ['- [x] **Slice 7.1: Gate**  Target files: a.mjs']);
});

function sh(cwd, args, env = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', ...env },
  }).trim();
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gate-'));
  sh(dir, ['init', '-q', '-b', 'main']);
  fs.mkdirSync(path.join(dir, '.spec'));
  fs.writeFileSync(path.join(dir, '.spec', 'PROGRESS.md'), '- [ ] **Slice 1.1: First**\n');
  fs.writeFileSync(path.join(dir, 'app.txt'), 'v1\n');
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '-m', 'base']);
  sh(dir, ['checkout', '-q', '-b', 'feature']);
  return dir;
}

function commitWithTrailers(dir, message, { tree } = {}) {
  sh(dir, ['add', '-A']);
  const treeId = tree || sh(dir, ['write-tree']);
  sh(dir, ['commit', '-q', '-m', message, '--trailer', 'Referee-Verdict: VERIFIED', '--trailer', `Referee-Tree: ${treeId}`]);
}

test('checkPullRequest passes for a slice commit with a matching verdict', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, '.spec', 'PROGRESS.md'), '- [x] **Slice 1.1: First**\n');
  fs.writeFileSync(path.join(dir, 'app.txt'), 'v2\n');
  commitWithTrailers(dir, 'Finish Slice 1.1');
  assert.deepEqual(checkPullRequest({ base: 'main', head: 'feature', cwd: dir }), { problems: [], warnings: [], notes: [] });
});

test('checkPullRequest warns, not fails, when the PR adds no slice', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, 'app.txt'), 'v2\n');
  commitWithTrailers(dir, 'Quick fix');
  const { problems, warnings } = checkPullRequest({ base: 'main', head: 'feature', cwd: dir });
  assert.equal(problems.some((p) => /No slice|Not in a slice/.test(p)), false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Not in a slice/);
});

test('checkPullRequest passes with one warning when the PR has no slice line but a valid Referee trailer', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, 'app.txt'), 'v2\n');
  commitWithTrailers(dir, 'Quick fix');
  const { problems, warnings } = checkPullRequest({ base: 'main', head: 'feature', cwd: dir });
  assert.equal(problems.length, 0);
  assert.equal(warnings.length, 1);
});

test('checkPullRequest fails when the head commit has no Referee trailer', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, '.spec', 'PROGRESS.md'), '- [x] **Slice 1.1: First**\n');
  fs.writeFileSync(path.join(dir, 'app.txt'), 'v2\n');
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '-m', 'Hand edit']);
  const { problems } = checkPullRequest({ base: 'main', head: 'feature', cwd: dir });
  assert.ok(problems.some((p) => /No Referee trailer/.test(p)));
});

test('checkPullRequest passes a docs-only PR with no Referee trailer', () => {
  const dir = makeRepo();
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'plan.md'), '# Plan\n');
  fs.writeFileSync(path.join(dir, 'docs', 'diagram.svg'), '<svg/>\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Readme\n');
  fs.writeFileSync(path.join(dir, '.spec', 'PROGRESS.md'), '- [ ] **Slice 1.1: First**\n- [ ] **Slice 1.2: Next**\n');
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '-m', 'Plan only']);
  const r = checkPullRequest({ base: 'main', head: 'feature', cwd: dir });
  assert.deepEqual(r, { problems: [], warnings: [], notes: ['Docs-only PR: no slice or Referee trailer needed.'] });
});

test('checkPullRequest still fails docs plus a source file with no Referee trailer', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, 'README.md'), '# Readme\n');
  fs.writeFileSync(path.join(dir, 'app.txt'), 'v2\n');
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '-m', 'Docs and code']);
  const { problems } = checkPullRequest({ base: 'main', head: 'feature', cwd: dir });
  assert.ok(problems.some((p) => /No Referee trailer/.test(p)));
});

test('checkPullRequest fails when the commit changed after its verdict', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, 'app.txt'), 'v2\n');
  fs.writeFileSync(path.join(dir, '.spec', 'PROGRESS.md'), '- [x] **Slice 1.1: First**\n');
  commitWithTrailers(dir, 'Finish Slice 1.1', { tree: 'b'.repeat(40) });
  const { problems } = checkPullRequest({ base: 'main', head: 'feature', cwd: dir });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Stale verdict/);
});

test('commitsMissingTrailer lists only the pushed commits without a verdict', () => {
  const dir = makeRepo();
  const before = sh(dir, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(dir, 'app.txt'), 'v2\n');
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '-m', 'Hand edit on main']);
  fs.writeFileSync(path.join(dir, 'app.txt'), 'v3\n');
  commitWithTrailers(dir, 'Finish Slice 1.1');
  const after = sh(dir, ['rev-parse', 'HEAD']);
  const missing = commitsMissingTrailer({ before, after, cwd: dir });
  assert.equal(missing.length, 1);
  assert.match(missing[0], /Hand edit on main/);
});

test('commitsMissingTrailer on a new branch checks only the tip commit', () => {
  const dir = makeRepo();
  const after = sh(dir, ['rev-parse', 'HEAD']);
  const missing = commitsMissingTrailer({ before: '0'.repeat(40), after, cwd: dir });
  assert.equal(missing.length, 1);
});

test('push mode exits 2, not 1, when git cannot scan the range', () => {
  const dir = makeRepo();
  const res = spawnSync(process.execPath, [path.join(import.meta.dirname, 'ci-gate.mjs'), 'push', 'f'.repeat(40), sh(dir, ['rev-parse', 'HEAD'])], { cwd: dir, encoding: 'utf8' });
  assert.equal(res.status, 2);
  assert.match(res.stdout, /could not run/);
});

test('isBookkeepingCommit skips spec-only, engine-only, mixed, sync and empty commits', () => {
  assert.equal(isBookkeepingCommit({ subject: 'anchor', files: ['.spec/PROGRESS.md', '.spec/plans/a.md'] }), true);
  assert.equal(isBookkeepingCommit({ subject: 'x', files: ['.harness/scripts/a.mjs', '.claude/b', '.harness-version', 'AGENTS.md', 'plugins/harness/c'] }), true);
  assert.equal(isBookkeepingCommit({ subject: 'x', files: ['.spec/PROGRESS.md', '.harness/a.mjs'] }), true);
  assert.equal(isBookkeepingCommit({ subject: 'x', files: ['.spec/PROGRESS.md', 'src/a.js'] }), false);
  assert.equal(isBookkeepingCommit({ subject: 'x', files: ['src/a.js'] }), false);
  assert.equal(isBookkeepingCommit({ subject: 'chore(harness): sync v2', files: ['src/a.js'] }), true);
  assert.equal(isBookkeepingCommit({ subject: 'Sync harness engine to v3', files: ['src/a.js'] }), true);
  assert.equal(isBookkeepingCommit({ subject: 'x', files: [] }), true);
});

test('commitsMissingTrailer skips an anchor-style .spec commit and reports a src commit', () => {
  const dir = makeRepo();
  const before = sh(dir, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(dir, '.spec', 'PROGRESS.md'), '- [ ] **Slice 1.1: First**\nanchor\n');
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '-m', 'anchor progress']);
  fs.writeFileSync(path.join(dir, 'app.txt'), 'v2\n');
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '-m', 'Hand edit src']);
  const after = sh(dir, ['rev-parse', 'HEAD']);
  const missing = commitsMissingTrailer({ before, after, cwd: dir });
  assert.equal(missing.length, 1);
  assert.match(missing[0], /Hand edit src/);
});

const WF = '.github/workflows/harness-labels.yml';
const TPL = '.harness/templates/workflows/harness-labels.yml';
function writeEngine(dir, workflowText) {
  fs.mkdirSync(path.join(dir, '.harness', 'templates', 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, TPL), 'name: labels\n');
  fs.writeFileSync(path.join(dir, WF), workflowText);
}
function commitPlain(dir) {
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '-m', 'Sync']);
}

test('checkPullRequest passes an engine-only PR with a template-copy workflow and no trailer', () => {
  const dir = makeRepo();
  writeEngine(dir, 'name: labels\n');
  commitPlain(dir);
  const r = checkPullRequest({ base: 'main', head: 'feature', cwd: dir });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.notes, ['Engine sync PR: no slice or Referee trailer needed.']);
});

test('checkPullRequest still fails an engine PR that also changes a source file without a trailer', () => {
  const dir = makeRepo();
  writeEngine(dir, 'name: labels\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'export {};\n');
  commitPlain(dir);
  const { problems } = checkPullRequest({ base: 'main', head: 'feature', cwd: dir });
  assert.ok(problems.some((p) => /No Referee trailer/.test(p)));
});

test('checkPullRequest treats a workflow that differs from its template as a real file', () => {
  const dir = makeRepo();
  writeEngine(dir, 'name: changed\n');
  commitPlain(dir);
  const { problems } = checkPullRequest({ base: 'main', head: 'feature', cwd: dir });
  assert.ok(problems.some((p) => /No Referee trailer/.test(p)));
});

function writePkg(dir, obj) {
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(obj, null, 2)}\n`);
}

function makePkgRepo() {
  const dir = makeRepo();
  sh(dir, ['checkout', '-q', 'main']);
  writePkg(dir, { name: 'x', version: '0.2.0', dependencies: { a: '1.0.0' } });
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '-m', 'add package.json']);
  sh(dir, ['checkout', '-q', '-b', 'sync']);
  return dir;
}

test('checkPullRequest passes engine files plus a version-only package.json bump', () => {
  const dir = makePkgRepo();
  writeEngine(dir, 'name: labels\n');
  writePkg(dir, { name: 'x', version: '0.2.1', dependencies: { a: '1.0.0' } });
  commitPlain(dir);
  const r = checkPullRequest({ base: 'main', head: 'sync', cwd: dir });
  assert.deepEqual(r.problems, []);
  assert.match(r.notes[0], /Engine sync PR/);
  assert.equal(r.notes.length, 2);
});

test('checkPullRequest still fails engine files plus a package.json dependency change', () => {
  const dir = makePkgRepo();
  writeEngine(dir, 'name: labels\n');
  writePkg(dir, { name: 'x', version: '0.2.1', dependencies: { a: '2.0.0' } });
  commitPlain(dir);
  const { problems } = checkPullRequest({ base: 'main', head: 'sync', cwd: dir });
  assert.ok(problems.some((p) => /No Referee trailer/.test(p)));
});

test('checkPullRequest still fails a package.json version bump alone', () => {
  const dir = makePkgRepo();
  writePkg(dir, { name: 'x', version: '0.2.1', dependencies: { a: '1.0.0' } });
  commitPlain(dir);
  const { problems } = checkPullRequest({ base: 'main', head: 'sync', cwd: dir });
  assert.ok(problems.some((p) => /No Referee trailer/.test(p)));
});
