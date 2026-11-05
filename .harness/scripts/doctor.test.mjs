import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProbes, ensureDoctorState } from './doctor.mjs';
import { gateDecision } from '../hooks/lib/doctor-state.mjs';

const HEAD = 'abc1234def5678';

function makeRoot({ agent = true, handoff = true, spoke = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-root-'));
  fs.mkdirSync(path.join(root, '.spec'), { recursive: true });
  if (handoff) fs.writeFileSync(path.join(root, '.spec', 'SESSION_HANDOFF.md'), '# handoff\n');
  if (spoke) fs.writeFileSync(path.join(root, '.harness-version'), '3.2.0\n');
  if (agent) {
    fs.mkdirSync(path.join(root, 'plugins', 'harness', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(root, 'plugins', 'harness', 'agents', 'gf-coder.md'), '# gf-coder\n');
  }
  return root;
}

const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });
const byName = (state, name) => state.checks.find((c) => c.name === name);

test('a clean run yields DOCTOR_PASS', () => {
  const root = makeRoot();
  try {
    const state = runProbes({ root, head: HEAD });
    assert.equal(state.status, 'DOCTOR_PASS');
    assert.deepEqual(state.failing, []);
    assert.deepEqual(state.warnings, []);
    assert.equal(state.head, HEAD);
    assert.equal(typeof state.at, 'string');
    assert.equal(byName(state, 'fast-path-budget').ok, true);
    assert.equal(byName(state, 'spoke-engine-hash').severity, 'skip');
  } finally {
    cleanup(root);
  }
});

test('a missing gf-coder agent makes the status DOCTOR_FAIL and names the check', () => {
  const root = makeRoot({ agent: false });
  try {
    const state = runProbes({ root, head: HEAD });
    assert.equal(state.status, 'DOCTOR_FAIL');
    assert.deepEqual(state.failing, ['gf-coder-registered']);
  } finally {
    cleanup(root);
  }
});

test('a spoke without a synced plugin/harness directory passes the gf-coder check', () => {
  const root = makeRoot({ agent: false, spoke: true });
  try {
    const state = runProbes({ root, head: HEAD });
    assert.equal(state.status, 'DOCTOR_PASS');
    assert.equal(byName(state, 'gf-coder-registered').ok, true);
  } finally {
    cleanup(root);
  }
});

test('a spoke that has plugins/harness but no gf-coder agent still fails', () => {
  const root = makeRoot({ agent: false, spoke: true });
  try {
    fs.mkdirSync(path.join(root, 'plugins', 'harness', 'agents'), { recursive: true });
    const state = runProbes({ root, head: HEAD });
    assert.equal(state.status, 'DOCTOR_FAIL');
    assert.deepEqual(state.failing, ['gf-coder-registered']);
  } finally {
    cleanup(root);
  }
});

test('a missing handoff is only a warning and does not halt', () => {
  const root = makeRoot({ handoff: false });
  try {
    const state = runProbes({ root, head: HEAD });
    assert.equal(state.status, 'DOCTOR_PASS');
    assert.deepEqual(state.warnings, ['handoff-fresh']);
  } finally {
    cleanup(root);
  }
});

test('canary file forces the named probe to fail and status becomes DOCTOR_FAIL', () => {
  const root = makeRoot();
  try {
    fs.writeFileSync(path.join(root, '.spec', '.doctor-canary'), 'telemetry-writable\n');
    const state = runProbes({ root, head: HEAD });
    assert.equal(state.status, 'DOCTOR_FAIL');
    assert.deepEqual(state.failing, ['telemetry-writable']);
    const probe = byName(state, 'telemetry-writable');
    assert.equal(probe.ok, false);
    assert.equal(probe.detail, 'CANARY: forced failure');
  } finally {
    cleanup(root);
  }
});

test('a canary naming only a warn probe does not halt the doctor', () => {
  const root = makeRoot();
  try {
    fs.writeFileSync(path.join(root, '.spec', '.doctor-canary'), 'handoff-fresh');
    const state = runProbes({ root, head: HEAD });
    assert.equal(state.status, 'DOCTOR_PASS');
    assert.deepEqual(state.warnings, ['handoff-fresh']);
  } finally {
    cleanup(root);
  }
});

test('an installed plugin older than the repo warns without halting', () => {
  const root = makeRoot();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-home-'));
  const prevHome = process.env.HOME;
  try {
    fs.mkdirSync(path.join(root, 'plugins', 'harness', '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'plugins', 'harness', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'harness', version: '0.2.0' }));
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'harness', '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'skills', 'harness', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'harness', version: '0.1.0' }));
    process.env.HOME = home;
    const state = runProbes({ root, head: HEAD });
    const probe = byName(state, 'plugin-current');
    assert.equal(probe.ok, false);
    assert.equal(probe.severity, 'warn');
    assert.equal(state.status, 'DOCTOR_PASS');
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    cleanup(root);
    cleanup(home);
  }
});

test('the gate refuses Edit after a failing run and names the failing check', () => {
  const root = makeRoot({ agent: false });
  try {
    const state = runProbes({ root, head: HEAD });
    const d = gateDecision({ state, head: HEAD, toolName: 'Edit' });
    assert.equal(d.allowed, false);
    assert.match(d.reason, /gf-coder-registered/);
  } finally {
    cleanup(root);
  }
});

test('the gate allows Edit after a clean run at the same HEAD', () => {
  const root = makeRoot();
  try {
    const state = runProbes({ root, head: HEAD });
    assert.equal(gateDecision({ state, head: HEAD, toolName: 'Edit' }).allowed, true);
  } finally {
    cleanup(root);
  }
});

test('ensureDoctorState reuses state for the same HEAD and re-probes on a new HEAD', () => {
  const root = makeRoot();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-hook-'));
  const prev = process.env.HARNESS_DOCTOR_STATE;
  process.env.HARNESS_DOCTOR_STATE = path.join(stateDir, 'state.json');
  try {
    assert.equal(ensureDoctorState({ root, head: 'h1' }).status, 'DOCTOR_PASS');
    fs.rmSync(path.join(root, 'plugins'), { recursive: true, force: true });
    assert.equal(ensureDoctorState({ root, head: 'h1' }).status, 'DOCTOR_PASS', 'same HEAD reuses state');
    const fresh = ensureDoctorState({ root, head: 'h2' });
    assert.equal(fresh.status, 'DOCTOR_FAIL', 'new HEAD re-probes');
    assert.equal(fresh.head, 'h2');
  } finally {
    if (prev === undefined) delete process.env.HARNESS_DOCTOR_STATE;
    else process.env.HARNESS_DOCTOR_STATE = prev;
    cleanup(root);
    cleanup(stateDir);
  }
});
