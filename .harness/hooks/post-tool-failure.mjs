#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { isTestOrBuild as matchRunner } from './lib/runner-matcher.mjs';
import { modeOf, resolveRoot } from './lib/vibe.mjs';
import { appendBatchEvent } from '../scripts/status-batch.mjs';

const root = resolveRoot();
const stateFile = path.join(root, '.spec', '.strike-counter.json');

let event = {};
try { event = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cmd = event.tool_input?.command || '';
if (!matchRunner(cmd)) process.exit(0);
const sessionId = event.session_id || 'default';
const errText = [event.error, event.tool_response?.stderr, event.tool_response?.stdout].filter((x) => typeof x === 'string').join('\n');

// Missing tools or dependencies on a fresh clone are setup problems, not code failures: no strike
const exitCode = Number(String(event.error || '').match(/^Exit code (\d+)/)?.[1]);
const ENV_ERROR = /command not found|: not found\b|No module named|ModuleNotFoundError|Cannot find module/i;
if ((exitCode === 127 || ENV_ERROR.test(errText)) && !/\bTS\d{4}\b/.test(errText)) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUseFailure',
      additionalContext: 'ENVIRONMENT ERROR (not counted as a strike): a tool or dependency is missing, which is normal on a fresh clone. Install the project dependencies first (npm ci / pnpm i / uv sync / pip install -r requirements.txt), then re-run the check.'
    }
  }));
  process.exit(0);
}

// Fingerprint the actual error lines, not the npm banner. Mask hex addresses before digits so memory addresses cannot hide a repeat
const allLines = errText.split('\n').map((l) => l.trim()).filter(Boolean);
const summaryLines = allLines.filter((l) => /^(FAILED|ERROR) /.test(l)); // pytest short summary
const errorLines = summaryLines.length
  ? summaryLines
  : allLines.filter((l) => /error|fail|✗|×|expected|cannot|not found|exception|\b[A-Z]{1,3}\d{3,4}\b/i.test(l));
const errorSig = (errorLines.length ? errorLines.slice(0, 6) : allLines.slice(-6))
  .join(' ')
  .replace(/0x[0-9a-f]+/gi, '0x#')
  .replace(/\d+/g, '#')
  .replace(/\s+/g, ' ')
  .slice(0, 240);

let allState = {};
if (fs.existsSync(stateFile)) {
  try { allState = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
}

const prev = allState[sessionId] || { strikes: 0, lastSig: '' };
const strikes = prev.lastSig === errorSig ? prev.strikes + 1 : 1;
allState[sessionId] = { strikes, lastSig: errorSig, updatedAt: new Date().toISOString() };

fs.mkdirSync(path.join(root, '.spec'), { recursive: true });
fs.writeFileSync(stateFile, JSON.stringify(allState, null, 2));

if (strikes >= 2) {
  appendBatchEvent(root, {
    event: 'circuit_breaker',
    summary: `2-Strike Circuit Breaker tripped on "${cmd.slice(0, 60)}"`,
    details: errorSig
  });
  const vibe = ['vibe', 'locked'].includes(modeOf(root)); // no active slice: the whole-tree restore applies
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUseFailure',
      additionalContext: `CIRCUIT BREAKER TRIGGERED (2 Consecutive Identical Test/Build Failures): Stop guessing immediately. Run node .harness/hooks/pre-tool-guard.mjs --restore (${vibe ? 'restores the last known green checkpoint, or lists changed files if nothing has passed yet' : 'restores ONLY the active slice target files to the slice-start checkpoint'}), then output a "Needed from you:" block offering: (1) Free Gemini audit via /prep-audit diff, or (2) Model upshift via /implement sonnet.`
    }
  }));
}
process.exit(0);
