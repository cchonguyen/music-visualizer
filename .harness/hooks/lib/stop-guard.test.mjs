import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stopDecision, hasUnfinishedSlice } from '../stop-guard.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'stop-guard.mjs');

const makeRoot = (progress) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-guard-'));
  if (progress !== undefined) {
    fs.mkdirSync(path.join(root, '.spec'), { recursive: true });
    fs.writeFileSync(path.join(root, '.spec', 'PROGRESS.md'), progress);
  }
  return root;
};

const IN_PROGRESS = '- [ ] **Slice 1: Demo** [IN_PROGRESS] [CORE / DATA] Target files: a.mjs\n';
const DONE_ONLY = '- [x] **Slice 1: Demo** [CORE / DATA] Target files: a.mjs\n';

test('hasUnfinishedSlice detects IN_PROGRESS and unchecked slices only', () => {
  assert.equal(hasUnfinishedSlice(IN_PROGRESS), true);
  assert.equal(hasUnfinishedSlice('- [ ] **Slice 2: Next** Target files: b.mjs\n'), true);
  assert.equal(hasUnfinishedSlice(DONE_ONLY), false);
  assert.equal(hasUnfinishedSlice(''), false);
});

test('no IN_PROGRESS slice allows stop', () => {
  const root = makeRoot(DONE_ONLY);
  try {
    assert.equal(stopDecision({ root, env: {} }), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing PROGRESS.md allows stop', () => {
  const root = makeRoot();
  try {
    assert.equal(stopDecision({ root, env: {} }), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('IN_PROGRESS slice with no escape blocks stop', () => {
  const root = makeRoot(IN_PROGRESS);
  try {
    const reason = stopDecision({ root, env: {} });
    assert.ok(reason.length > 0);
    assert.match(reason, /unfinished slices/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('IN_PROGRESS slice with the wake escape allows stop', () => {
  const root = makeRoot(IN_PROGRESS);
  try {
    assert.equal(stopDecision({ root, env: { CLAUDE_WAKE_SCHEDULED: '1' } }), '');
    assert.equal(stopDecision({ root, env: { CLAUDE_PR_SUBSCRIBED: '1' } }), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stop_hook_active allows stop so the hook cannot loop', () => {
  const root = makeRoot(IN_PROGRESS);
  try {
    assert.equal(stopDecision({ root, env: {}, payload: { stop_hook_active: true } }), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('malformed stdin does not throw and allows stop', () => {
  const root = makeRoot(IN_PROGRESS);
  try {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
    delete env.CLAUDE_WAKE_SCHEDULED;
    delete env.CLAUDE_PR_SUBSCRIBED;
    const res = spawnSync(process.execPath, [HOOK], { input: '{not json', encoding: 'utf8', env });
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('blocking run emits a Stop block decision on stdout', () => {
  const root = makeRoot(IN_PROGRESS);
  try {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
    delete env.CLAUDE_WAKE_SCHEDULED;
    delete env.CLAUDE_PR_SUBSCRIBED;
    const res = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: root }), encoding: 'utf8', env });
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.equal(out.decision, 'block');
    assert.ok(out.reason.length > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
