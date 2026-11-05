import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseRefereeTrailers, hasRefereeTrailer, addedSliceLines, checkPullRequest, commitsMissingTrailer } from './ci-gate.mjs';

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
  assert.deepEqual(checkPullRequest({ base: 'main', head: 'feature', cwd: dir }), []);
});

test('checkPullRequest fails when the PR adds no slice', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, 'app.txt'), 'v2\n');
  commitWithTrailers(dir, 'Quick fix');
  const problems = checkPullRequest({ base: 'main', head: 'feature', cwd: dir });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /No slice/);
});

test('checkPullRequest fails when the head commit has no Referee trailer', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, '.spec', 'PROGRESS.md'), '- [x] **Slice 1.1: First**\n');
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '-m', 'Hand edit']);
  const problems = checkPullRequest({ base: 'main', head: 'feature', cwd: dir });
  assert.ok(problems.some((p) => /No Referee trailer/.test(p)));
});

test('checkPullRequest fails when the commit changed after its verdict', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, '.spec', 'PROGRESS.md'), '- [x] **Slice 1.1: First**\n');
  commitWithTrailers(dir, 'Finish Slice 1.1', { tree: 'b'.repeat(40) });
  const problems = checkPullRequest({ base: 'main', head: 'feature', cwd: dir });
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
