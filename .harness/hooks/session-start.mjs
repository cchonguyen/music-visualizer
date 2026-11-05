#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ensureBaseline, resolveRoot } from './lib/vibe.mjs';
import { branchOwnerOf, mainRedState, MAIN_RED_TAG, whereWeLeftOff } from './lib/session-signals.mjs';
import { statePath, writeState } from './lib/doctor-state.mjs';
import { currentHead, runProbes } from '../scripts/doctor.mjs';
import { readBatchEvents } from '../scripts/status-batch.mjs';

const root = resolveRoot();
const handoffPath = path.join(root, '.spec', 'SESSION_HANDOFF.md');
const telemetryPath = path.join(root, '.spec', '.session-telemetry.json');

let event = {};
try { event = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}

// Create session telemetry only when missing. An existing file is left alone (never reset).
try {
  if (!fs.existsSync(telemetryPath)) {
    fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });
    fs.writeFileSync(telemetryPath, JSON.stringify({
      version: 1,
      sessionId: event.session_id || 'default',
      startedAt: new Date().toISOString(),
      totalToolCalls: 0,
      mutatingCallsOnSlice: 0,
      currentSlice: '',
      slicesCommitted: 0,
      calls: []
    }, null, 2), 'utf8');
  }
} catch {}

// Vibe Mode baseline: snapshot the tree before any edit so --restore has something to go back to
try { ensureBaseline(root, event.session_id || 'default'); } catch {}

let version = '3.1.0';
try { version = fs.readFileSync(path.join(root, '.harness-version'), 'utf8').trim() || version; } catch {}
const batchCount = readBatchEvents(root).length;
let contextMsg = `✓ Harness v${version} active (Node ${process.version}, Model tier: Haiku baseline, Batch queue: ${batchCount} event(s)).`;

// Live doctor: run the probes now and store the result for the PreToolUse gate.
try {
  const head = currentHead(root);
  const state = runProbes({ root, head });
  writeState(statePath(), state);
  contextMsg += state.status === 'DOCTOR_PASS'
    ? `\n✓ DOCTOR_PASS (${state.checks.length} checks, HEAD ${head.slice(0, 7)})`
    : `\n✖ DOCTOR_FAIL: ${state.failing.join(', ')}. Edits and non-allow-listed Bash are refused until fixed.`;
} catch {
  contextMsg += '\n✖ DOCTOR_FAIL: doctor probes could not run. Edits and non-allow-listed Bash are refused until fixed.';
}

// Main-red (4.C.3): while the tag exists on origin, no new slices start. Fixing main is the only work.
const redState = mainRedState(root);
if (redState === 'red') {
  contextMsg += `\n\n⚠ MAIN IS RED: origin has the tag ${MAIN_RED_TAG}. Do not start new slices or quick fixes. Fix main first; the open issue "RED: main failed checks" names the commit.`;
} else if (redState === 'unknown') {
  contextMsg += `\n\nCould not check the ${MAIN_RED_TAG} tag on origin. Check it by hand before starting a slice.`;
}

// The stale handoff text is not injected. Only the branch owner and resume pointer are kept.
if (fs.existsSync(handoffPath)) {
  const handoff = fs.readFileSync(handoffPath, 'utf8').trim();
  const owner = branchOwnerOf(handoff);
  const resume = whereWeLeftOff(handoff);
  if (resume) contextMsg += `\n${resume}`;
  if (owner) contextMsg += `\n\nBranch Owner: ${owner}.`;
}

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: contextMsg
  }
}));
