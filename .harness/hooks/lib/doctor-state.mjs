// Pure helpers for the live doctor gate (Slice 10.1). No probes run here.
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_STATE_PATH = '/tmp/harness-session-state.json';
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

// Each segment of a Bash command (split on && || ; & |) must match one of these.
const ALLOWED_SEGMENTS = [
  /^git (status|diff|log|rev-parse|show|branch|add|commit|push)(\s|$)/,
  /^node --test(\s|$)/,
  /^npm run (typecheck|lint|test)(\s|$)/,
  /^node \.harness\/scripts\/finish-slice\.mjs(\s|$)/,
  /^node \.harness\/scripts\/doctor\.mjs(\s|$)/,
  /^rm \.spec\/\.doctor-canary$/,
  /^gh pr (view|list)(\s|$)/,
  /^(ls|cat|grep|rg)(\s|$)/,
  /^sed -n(\s|$)/,
];

// Force-push and branch deletion stay refused even though `git push` and `git branch` are allowed.
const DESTRUCTIVE = [
  /^git push\b.*(\s--force(-with-lease)?(\s|=|$)|\s-f(\s|$))/,
  /^git branch\b.*\s-D(\s|$)/,
];

export function statePath() {
  return process.env.HARNESS_DOCTOR_STATE || DEFAULT_STATE_PATH;
}

export function readState(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

export function isAllowListed(command) {
  const cmd = String(command ?? '').trim();
  if (!cmd || /[`\n<>]|\$\(/.test(cmd)) return false;
  const parts = cmd.split(/\|\||&&|[;&|]/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return false;
  return parts.every((part) =>
    ALLOWED_SEGMENTS.some((re) => re.test(part)) && !DESTRUCTIVE.some((re) => re.test(part)));
}

const short = (h) => String(h || '').slice(0, 7) || 'unknown';

// Returns a block reason when a DOCTOR_PASS for this HEAD is missing, otherwise null.
function passBlock(state, head) {
  if (!state || typeof state !== 'object') return 'no doctor state';
  if (state.status !== 'DOCTOR_PASS') {
    const failing = Array.isArray(state.failing) && state.failing.length ? state.failing.join(', ') : 'unknown';
    return `DOCTOR_FAIL: failing checks: ${failing}`;
  }
  if (state.head !== head) {
    return `stale HEAD (doctor ran at ${short(state.head)}, HEAD is ${short(head)})`;
  }
  return null;
}

export function gateDecision({ state, head, toolName, command } = {}) {
  const isBash = toolName === 'Bash';
  const needsPass = WRITE_TOOLS.has(toolName) || (isBash && !isAllowListed(command));
  if (!needsPass) return { allowed: true, reason: '' };

  const blocked = passBlock(state, head);
  if (!blocked) return { allowed: true, reason: '' };

  const subject = isBash ? 'Bash command not on the doctor allow-list' : `${toolName} tool`;
  return {
    allowed: false,
    reason: `Doctor gate refused ${subject}: ${blocked}. Run node .harness/scripts/doctor.mjs and fix the failing checks.`,
  };
}
