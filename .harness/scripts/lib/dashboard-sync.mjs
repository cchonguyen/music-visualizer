import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Dashboard sync: every slice finish must push its state to .spec/STATE.json through bin/update-state.mjs.
// STATE.json is gitignored, so the CI gate cannot read it. Instead, finish-slice stamps a
// `Dashboard-Sync: Slice <id> <stage>` trailer only after this sync succeeds, and ci-gate.mjs requires that trailer.

export const DASHBOARD_STAGE = 'Claimed';
export const DASHBOARD_TRAILER_RE = /^Dashboard-Sync:[ \t]*Slice[ \t]+(\S+)[ \t]+(\S+)[ \t]*$/m;

export function dashboardTrailer(sliceId, stage = DASHBOARD_STAGE) {
  return `Dashboard-Sync: Slice ${sliceId} ${stage}`;
}

export function hasDashboardTrailer(message) {
  return DASHBOARD_TRAILER_RE.test(String(message));
}

// Runs bin/update-state.mjs for the slice, then reads STATE.json back and confirms the slice is recorded.
// Throws when the updater is missing, fails, or the slice is not recorded at the expected stage.
export function syncDashboard(root, { sliceId, title, stage = DASHBOARD_STAGE }) {
  const updater = path.join(root, 'bin', 'update-state.mjs');
  if (!fs.existsSync(updater)) {
    throw new Error('Dashboard sync failed: bin/update-state.mjs not found, so STATE.json cannot record this slice.');
  }
  try {
    execFileSync('node', [updater, '--slice-id', sliceId, '--slice-title', title || `Slice ${sliceId}`, '--stage', stage], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (err) {
    throw new Error(`Dashboard sync failed: update-state.mjs exited with an error:\n${(err.stderr || err.message || '').toString()}`);
  }

  const statePath = path.join(root, '.spec', 'STATE.json');
  let state = null;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    throw new Error('Dashboard sync failed: .spec/STATE.json is missing or unreadable after update.');
  }
  const entry = (Array.isArray(state.activeSlices) ? state.activeSlices : []).find((s) => String(s.id) === String(sliceId));
  if (!entry || entry.stage !== stage) {
    throw new Error(`Dashboard sync failed: .spec/STATE.json does not record Slice ${sliceId} at stage ${stage}.`);
  }
  return dashboardTrailer(sliceId, stage);
}
