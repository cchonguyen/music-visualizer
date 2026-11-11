import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFromScope, startSlice } from './start-slice.mjs';
import { readBatchEvents } from './status-batch.mjs';
import { parseSliceLine } from './lib/slice-parser.mjs';

const BASE_PROGRESS = [
  '# Progress',
  '- [x] **Slice 1: Old work** Target files: a.txt',
  '- [ ] **Slice 2: Pending work** [CORE / DATA] Target files: b.txt | Verify: node --test',
  '',
].join('\n');

function makeRepo({ progress = BASE_PROGRESS } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-slice-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.spec', 'PROGRESS.md'), progress);
  fs.writeFileSync(
    path.join(dir, '.spec', 'scope.md'),
    '# Scope\n\n## Slice 3: Scope thing\nDo the settled work. Slices 1 and 2 are done.\n'
  );
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return dir;
}

const head = (dir) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
const progressText = (dir) => fs.readFileSync(path.join(dir, '.spec', 'PROGRESS.md'), 'utf8');

const GOOD = {
  doc: '.spec/scope.md',
  slice: '3',
  targets: '.harness/x.mjs, .harness/x.test.mjs',
  reason: 'scope settled in review',
  title: 'Scope thing',
};

// Each refusal must throw, write nothing, and leave HEAD untouched.
function assertRefused(dir, overrides, pattern) {
  const before = head(dir);
  const progressBefore = progressText(dir);
  assert.throws(() => startFromScope(dir, { ...GOOD, ...overrides }), pattern);
  assert.equal(head(dir), before, 'HEAD must not move on refusal');
  assert.equal(progressText(dir), progressBefore, 'PROGRESS.md must not change on refusal');
}

test('scope bypass happy path writes an IN_PROGRESS line, anchor trailers and a batch event', () => {
  const dir = makeRepo();
  const res = startFromScope(dir, GOOD);

  assert.equal(res.sliceId, '3');
  const line = progressText(dir).split('\n').find((l) => /Slice 3:/.test(l));
  const parsed = parseSliceLine(line);
  assert.equal(parsed.status, '[IN_PROGRESS]');
  assert.equal(parsed.id, '3');
  assert.deepEqual(parsed.targets, ['.harness/x.mjs', '.harness/x.test.mjs']);

  const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: dir, encoding: 'utf8' }).trim();
  assert.equal(subject, 'docs(spec): anchor Slice 3 [IN_PROGRESS]');
  const body = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' });
  assert.match(body, /^Spec-Bypass: \.spec\/scope\.md$/m);
  assert.match(body, /^Spec-Bypass-Reason: scope settled in review$/m);

  const events = readBatchEvents(dir);
  assert.ok(
    events.some((e) => e.event === 'spec_bypass' && e.slice === 'Slice 3'),
    'spec_bypass batch event must be recorded'
  );
});

test('plain start-slice <id> still anchors a pending slice unchanged', () => {
  const dir = makeRepo();
  const res = startSlice(dir, '2');
  assert.equal(res.sliceId, '2');
  const line = progressText(dir).split('\n').find((l) => /Slice 2:/.test(l));
  assert.equal(parseSliceLine(line).status, '[IN_PROGRESS]');
  const body = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' });
  assert.doesNotMatch(body, /Spec-Bypass/);
});

test('refuses a missing or empty reason', () => {
  const dir = makeRepo();
  assertRefused(dir, { reason: undefined }, /--reason is required/);
  assertRefused(dir, { reason: '   ' }, /--reason is required/);
});

test('refuses a scope doc that does not mention the slice id or title', () => {
  const dir = makeRepo();
  assertRefused(dir, { slice: '9', title: undefined }, /does not contain Slice 9/);
  // "3" must match as a whole token only: "13" and "3.1" do not count.
  fs.writeFileSync(path.join(dir, '.spec', 'other.md'), 'Slice 13 and Slice 3.1 only\n');
  assertRefused(dir, { doc: '.spec/other.md' }, /does not contain Slice 3/);
});

test('refuses absolute and parent-traversal doc paths', () => {
  const dir = makeRepo();
  assertRefused(dir, { doc: '/etc/passwd' }, /must be repo-relative, not absolute/);
  assertRefused(dir, { doc: '.spec/../scope.md' }, /must not contain "\.\."/);
  assertRefused(dir, { doc: 'docs/../.spec/scope.md' }, /must not contain "\.\."/);
});

test('refuses a doc outside .spec/ and docs/', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, 'notes.md'), 'Slice 3 here\n');
  assertRefused(dir, { doc: 'notes.md' }, /must be under \.spec\/ or docs\//);
});

test('refuses an id that already exists in PROGRESS.md', () => {
  const dir = makeRepo();
  assertRefused(dir, { slice: '1' }, /already exists/);
});

test('refuses when another slice is already IN_PROGRESS', () => {
  const dir = makeRepo({
    progress: `${BASE_PROGRESS}- [ ] **Slice 2: Active** Target files: b.txt [IN_PROGRESS]\n`,
  });
  assertRefused(dir, {}, /already \[IN_PROGRESS\]/);
});

test('refuses empty targets and empty entries', () => {
  const dir = makeRepo();
  assertRefused(dir, { targets: undefined }, /--targets is required/);
  assertRefused(dir, { targets: '   ' }, /--targets is required/);
  assertRefused(dir, { targets: '.harness/x.mjs,, .harness/y.mjs' }, /empty entry/);
  assertRefused(dir, { targets: '.harness/x.mjs,' }, /empty entry/);
});

test('refuses absolute and parent-traversal target paths', () => {
  const dir = makeRepo();
  assertRefused(dir, { targets: '/abs/x.mjs' }, /must be repo-relative, not absolute/);
  assertRefused(dir, { targets: '.harness/../../escape.mjs' }, /must not contain "\.\."/);
});
