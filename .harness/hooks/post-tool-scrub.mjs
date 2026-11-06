#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isTestOrBuild as matchRunner, advancesGreen } from './lib/runner-matcher.mjs';
import { modeOf, saveCheckpoint, resolveRoot } from './lib/vibe.mjs';
import { appendBatchEvent } from '../scripts/status-batch.mjs';
import { updateTelemetry } from '../scripts/lib/telemetry-store.mjs';

const root = resolveRoot();
const stateFile = path.join(root, '.spec', '.strike-counter.json');
const progressPath = path.join(root, '.spec', 'PROGRESS.md');

let event = {};
try { event = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const sessionId = event.session_id || 'default';
const toolName = event.tool_name || '';
const cmd = event.tool_input?.command || '';
// Only real test/build runners, so `cat test/x` or `git commit -m "build"` are never touched
const isTestOrBuild = matchRunner(cmd);

// 0. Update session telemetry & track mutating tool calls on active slice
const telemetryDefaults = {
  sessionId,
  startedAt: new Date().toISOString(),
  totalToolCalls: 0,
  mutatingCallsOnSlice: 0,
  currentSlice: '',
  slicesCommitted: 0
};

let activeSliceName = '';
if (fs.existsSync(progressPath)) {
  try {
    const lines = fs.readFileSync(progressPath, 'utf8').split('\n');
    const active = lines.find((l) => /^\s*-\s*\[.\].*\[IN_PROGRESS\]/.test(l));
    activeSliceName = active?.match(/\*\*Slice\s+([^*]+)\*\*/)?.[1]?.trim() || '';
  } catch {}
}

const isMutatingTool = ['Edit', 'Write', 'NotebookEdit'].includes(toolName) ||
  (toolName === 'Bash' && !/^\s*(cat|ls|git\s+status|git\s+diff|git\s+log|node\s+--test|npm\s+test|vitest|pytest)\b/.test(cmd));

// Counters are recomputed from the latest stored object under the lock, so this write never drops a call record.
const telemetry = updateTelemetry(root, (latest) => {
  const next = { ...telemetryDefaults, ...latest };
  next.totalToolCalls = (next.totalToolCalls || 0) + 1;
  if (activeSliceName && activeSliceName !== next.currentSlice) {
    next.currentSlice = activeSliceName;
    next.mutatingCallsOnSlice = 0;
  }
  if (activeSliceName && isMutatingTool) {
    next.mutatingCallsOnSlice = (next.mutatingCallsOnSlice || 0) + 1;
  }
  return next;
});

// 1. Reset strike counter for this session and queue batch telemetry when a test/build command succeeds
if (isTestOrBuild) {
  appendBatchEvent(root, {
    event: 'verify_pass',
    summary: `Verification passed: ${cmd.slice(0, 80)}`
  });
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (state[sessionId]?.strikes > 0) {
        state[sessionId] = { strikes: 0, lastSig: '' };
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      }
    } catch {}
  }
}

// 1b. Vibe Mode: a passing test or build advances the "last known green" checkpoint (PostToolUse only fires on success); lint/typecheck passes do not
if (advancesGreen(cmd) && modeOf(root) === 'vibe') saveCheckpoint(root, sessionId, true);

// 2. Output modifications
const response = event.tool_response;
let stdout = typeof response?.stdout === 'string' ? response.stdout : '';
const lines = stdout.split('\n');
let modified = false;

if (isTestOrBuild && lines.length > 40) {
  const scrubbed = [
    `[HARNESS LOG SCRUBBER: Truncated ${lines.length - 20} passing log lines to save tokens]`,
    ...lines.slice(-20)
  ].join('\n');
  stdout = scrubbed;
  modified = true;
}

// Mid-slice 15-mutating-call soft advisory nudge
if (activeSliceName && telemetry.mutatingCallsOnSlice === 15) {
  const nudge = `\n⚠ GOLDFISH ADVISORY: Slice ${activeSliceName} has used 15 mutating tool calls. Consider wrapping up with finish-slice.mjs or checkpointing if blocked.`;
  stdout = (stdout ? stdout + '\n' : '') + nudge;
  modified = true;
}

if (modified && response && typeof response === 'object') {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedToolOutput: { ...response, stdout }
    }
  }));
}

process.exit(0);
