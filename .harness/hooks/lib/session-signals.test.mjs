import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { branchOwnerOf, mainRedState, whereWeLeftOff } from './session-signals.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });

// A local bare repo stands in for origin, so the tests need no network
function makeOrigin() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'signals-'));
  const origin = path.join(base, 'origin.git');
  const work = path.join(base, 'work');
  fs.mkdirSync(work);
  git(base, 'init', '-q', '--bare', origin);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'user.name', 'test');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'base');
  git(work, 'remote', 'add', 'origin', origin);
  git(work, 'push', '-q', 'origin', 'main');
  return { base, work, origin };
}

test('main-red is green when origin has no tag, red when it has the tag', () => {
  const { base, work } = makeOrigin();
  try {
    assert.equal(mainRedState(work), 'green');
    git(work, 'tag', 'harness-main-red');
    git(work, 'push', '-q', 'origin', 'harness-main-red');
    assert.equal(mainRedState(work), 'red');
    git(work, 'push', '-q', 'origin', '--delete', 'harness-main-red');
    assert.equal(mainRedState(work), 'green');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('main-red is unknown when there is no origin to check', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signals-none-'));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    assert.equal(mainRedState(dir), 'unknown');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('branchOwnerOf reads the handoff field, and returns null when it is absent', () => {
  assert.equal(branchOwnerOf('- **Branch Owner:** antigravity'), 'antigravity');
  assert.equal(branchOwnerOf('Branch Owner: Claude'), 'claude');
  assert.equal(branchOwnerOf('Last Active Platform: Claude'), null);
  assert.equal(branchOwnerOf(''), null);
});

test('whereWeLeftOff reads the Immediate Next Step and strips markdown', () => {
  const handoff = [
    '# SESSION HANDOFF',
    '- **Active Branch / State:** `main` (v3 slices done).',
    '- **Immediate Next Step for Claude:** Run `/clear` then `/pickup`.',
  ].join('\n');
  assert.equal(whereWeLeftOff(handoff), 'Where we left off: Run /clear then /pickup.');
});

test('whereWeLeftOff falls back to Active Branch / State when there is no next step', () => {
  assert.equal(
    whereWeLeftOff('- **Active Branch / State:** main\n'),
    'Where we left off: main',
  );
});

test('whereWeLeftOff returns null for an empty or unrelated handoff', () => {
  assert.equal(whereWeLeftOff(''), null);
  assert.equal(whereWeLeftOff(undefined), null);
  assert.equal(whereWeLeftOff('just some prose'), null);
});

test('whereWeLeftOff is always one line, even when the field wraps', () => {
  const long = 'word '.repeat(80);
  const line = whereWeLeftOff(`- **Immediate Next Step for Claude:** ${long}\nnext paragraph`);
  assert.ok(!line.includes('\n'));
  assert.ok(line.length <= 'Where we left off: '.length + 160);
  assert.ok(line.endsWith('...'));
});
