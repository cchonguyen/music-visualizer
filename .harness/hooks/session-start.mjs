#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { activeLines, ensureBaseline, resolveRoot } from './lib/vibe.mjs';
import { branchOwnerOf, mainRedState, MAIN_RED_TAG, whereWeLeftOff } from './lib/session-signals.mjs';
import { readBatchEvents } from '../scripts/status-batch.mjs';

const root = resolveRoot();
const handoffPath = path.join(root, '.spec', 'SESSION_HANDOFF.md');
const telemetryPath = path.join(root, '.spec', '.session-telemetry.json');

let event = {};
try { event = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}

// Reset session telemetry on session start / clear
try {
  fs.mkdirSync(path.dirname(telemetryPath), { recursive: true });
  fs.writeFileSync(
    telemetryPath,
    JSON.stringify({
      sessionId: event.session_id || 'default',
      startedAt: new Date().toISOString(),
      totalToolCalls: 0,
      mutatingCallsOnSlice: 0,
      currentSlice: '',
      slicesCommitted: 0
    }, null, 2),
    'utf8'
  );
} catch {}

// Vibe Mode baseline: snapshot the tree before any edit so --restore has something to go back to
try { ensureBaseline(root, event.session_id || 'default'); } catch {}

let version = '3.1.0';
try { version = fs.readFileSync(path.join(root, '.harness-version'), 'utf8').trim() || version; } catch {}
const batchCount = readBatchEvents(root).length;
let contextMsg = `✓ Harness v${version} active (Node ${process.version}, Model tier: Haiku baseline, Batch queue: ${batchCount} event(s)).`;

// Main-red (4.C.3): while the tag exists on origin, no new slices start. Fixing main is the only work.
const redState = mainRedState(root);
if (redState === 'red') {
  contextMsg += `\n\n⚠ MAIN IS RED: origin has the tag ${MAIN_RED_TAG}. Do not start new slices or quick fixes. Fix main first; the open issue "RED: main failed checks" names the commit.`;
} else if (redState === 'unknown') {
  contextMsg += `\n\nCould not check the ${MAIN_RED_TAG} tag on origin. Check it by hand before starting a slice.`;
}

// A live slice needs its handoff. In Vibe Mode a stale one would nudge /triage ceremony,
// so only a handoff left by Google AI Studio is injected (that baton pass is fresh by definition).
if (fs.existsSync(handoffPath)) {
  const handoff = fs.readFileSync(handoffPath, 'utf8').trim();
  const fromAiStudio = /Last Active Platform:\**\s*Google AI Studio/i.test(handoff);
  const owner = branchOwnerOf(handoff);
  const resume = whereWeLeftOff(handoff);
  if (resume) contextMsg += `\n${resume}`;
  if (owner) {
    contextMsg += `\n\nBranch Owner: ${owner}. ${owner === 'antigravity' ? 'Claude must not push to this branch; open a new branch or comment on the PR.' : 'Claude owns this branch.'}`;
  }
  if (handoff && (activeLines(root).length > 0 || fromAiStudio)) {
    contextMsg += `\n\n[AUTO-INJECTED SESSION HANDOFF]:\n${handoff}`;
  }
}

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: contextMsg
  }
}));
