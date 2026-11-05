import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProbes } from './doctor.mjs';

const HEAD = 'abc1234def5678';

function makeRoot({ spoke = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-spoke-'));
  fs.mkdirSync(path.join(root, '.spec'), { recursive: true });
  fs.writeFileSync(path.join(root, '.spec', 'SESSION_HANDOFF.md'), '# handoff\n');
  if (spoke) fs.writeFileSync(path.join(root, '.harness-version'), '3.2.0\n');
  return root;
}

const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });
const byName = (state, name) => state.checks.find((c) => c.name === name);

test('a spoke without the plugin folder passes and skips the gf-coder check', () => {
  const root = makeRoot({ spoke: true });
  try {
    const state = runProbes({ root, head: HEAD });
    assert.equal(state.status, 'DOCTOR_PASS');
    assert.deepEqual(state.failing, []);
    assert.equal(byName(state, 'gf-coder-registered').severity, 'skip');
  } finally {
    cleanup(root);
  }
});

test('a repo without .harness-version still fails when the plugin folder is missing', () => {
  const root = makeRoot({ spoke: false });
  try {
    const state = runProbes({ root, head: HEAD });
    assert.equal(state.status, 'DOCTOR_FAIL');
    assert.deepEqual(state.failing, ['gf-coder-registered']);
  } finally {
    cleanup(root);
  }
});
