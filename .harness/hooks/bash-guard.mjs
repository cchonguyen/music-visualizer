#!/usr/bin/env node
// PreToolUse hook for Bash (SYSTEM_SPEC 4.A.5). In a spoke, blocks commands that write to engine paths or AGENTS.md.
// A speed bump only: it reads the command text, so a determined workaround can get past it. CI is the real wall.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { bashWriteReason, isHubOrigin } from './lib/guard-rules.mjs';
import { currentHead, ensureDoctorState } from '../scripts/doctor.mjs';
import { gateDecision } from './lib/doctor-state.mjs';

const gitIn = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();

let event = {};
try { event = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const command = event.tool_input?.command || '';
if (!command) process.exit(0);

// Live doctor gate: non-allow-listed Bash needs a DOCTOR_PASS for the current HEAD
const doctorRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const doctorHead = currentHead(doctorRoot);
const gate = gateDecision({
  state: ensureDoctorState({ root: doctorRoot, head: doctorHead }),
  head: doctorHead,
  toolName: event.tool_name || 'Bash',
  command,
});
if (!gate.allowed) {
  console.error(gate.reason);
  process.exit(2);
}

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let origin = '';
try { origin = gitIn(cwd, ['remote', 'get-url', 'origin']); } catch {}

// The hub is the source of these files, so ordinary hub work is not blocked
if (isHubOrigin(origin)) process.exit(0);

const reason = bashWriteReason(command);
if (reason) {
  console.error(`ENGINE LOCK: This command would change harness-owned files, because ${reason}. Harness files change only in claude-harness-hub. Use the Edit tool on spoke files, or ask the operator.`);
  process.exit(2);
}
process.exit(0);
