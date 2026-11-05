#!/usr/bin/env node
// Live doctor (Slice 10.1). Runs probes, writes the session state the hooks gate on.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkFastPathBudget } from '../hooks/pre-tool-guard.mjs';
import { isHubOrigin } from '../hooks/lib/guard-rules.mjs';
import { readState, statePath, writeState } from '../hooks/lib/doctor-state.mjs';

const CANARY_FILE = path.join('.spec', '.doctor-canary');

const gitOut = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();

export function currentHead(root) {
  try { return gitOut(root, ['rev-parse', 'HEAD']); } catch { return ''; }
}

const check = (name, severity, ok, detail) => ({ name, severity, ok, detail });

function probeFastPathBudget() {
  const r = checkFastPathBudget({
    role: 'coordinator',
    toolName: 'Read',
    targetFile: 'src/x.ts',
    telemetry: { coordinator_reads: 3 },
    thresholds: {},
  });
  const enforced = r.allowed === false;
  return check('fast-path-budget', 'fail', enforced,
    enforced ? 'coordinator source-read budget enforced' : 'coordinator source-read budget NOT enforced');
}

function probeGfCoder(root) {
  const ok = fs.existsSync(path.join(root, 'plugins', 'harness', 'agents', 'gf-coder.md'));
  return check('gf-coder-registered', 'fail', ok,
    ok ? 'plugins/harness/agents/gf-coder.md present' : 'plugins/harness/agents/gf-coder.md missing');
}

function probeHandoff(root) {
  const ok = fs.existsSync(path.join(root, '.spec', 'SESSION_HANDOFF.md'));
  return check('handoff-fresh', 'warn', ok,
    ok ? '.spec/SESSION_HANDOFF.md present' : '.spec/SESSION_HANDOFF.md missing');
}

function probeTelemetry(root) {
  const dir = path.join(root, '.spec');
  const tmp = path.join(dir, `.doctor-write-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, 'ok', 'utf8');
    fs.rmSync(tmp, { force: true });
    return check('telemetry-writable', 'fail', true, '.spec is writable');
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    return check('telemetry-writable', 'fail', false, `cannot write under .spec: ${err.message}`);
  }
}

function probeEngineHash(root) {
  let origin = '';
  try { origin = gitOut(root, ['remote', 'get-url', 'origin']); } catch {}
  const isSpoke = fs.existsSync(path.join(root, '.harness-version')) && !isHubOrigin(origin);
  return check('spoke-engine-hash', 'skip', true,
    isSpoke ? 'engine hash check not implemented yet' : 'not a spoke (no .harness-version or hub origin)');
}

// Canary: a file naming probes forces those probes to fail. Operator deletes it after the live test.
function applyCanary(root, checks) {
  let text = '';
  try { text = fs.readFileSync(path.join(root, CANARY_FILE), 'utf8'); } catch { return checks; }
  const named = checks.filter((c) => text.includes(c.name));
  const forced = checks.map((c) => (text.includes(c.name)
    ? { ...c, ok: false, detail: 'CANARY: forced failure' }
    : c));
  const note = named.length
    ? `forced failure: ${named.map((c) => c.name).join(', ')}`
    : 'canary file present, names no probe';
  return [...forced, check('canary', 'skip', true, note)];
}

export function runProbes({ root, head = '', env = process.env } = {}) {
  const dir = root || process.cwd();
  void env;
  const base = [
    probeFastPathBudget(),
    probeGfCoder(dir),
    probeHandoff(dir),
    probeTelemetry(dir),
    probeEngineHash(dir),
  ];
  const checks = applyCanary(dir, base);
  const failing = checks.filter((c) => c.severity === 'fail' && !c.ok).map((c) => c.name);
  const warnings = checks.filter((c) => c.severity === 'warn' && !c.ok).map((c) => c.name);
  return {
    status: failing.length ? 'DOCTOR_FAIL' : 'DOCTOR_PASS',
    failing,
    warnings,
    checks,
    head,
    at: new Date().toISOString(),
  };
}

// Reuses the stored state when it was written for this HEAD. Otherwise probes and stores fresh state.
export function ensureDoctorState({ root, head }) {
  const file = statePath();
  const existing = readState(file);
  if (existing && existing.head === head) return existing;
  let fresh;
  try {
    fresh = runProbes({ root, head });
  } catch {
    return existing;
  }
  try { writeState(file, fresh); } catch {}
  return fresh;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  let root = process.cwd();
  try { root = gitOut(process.cwd(), ['rev-parse', '--show-toplevel']); } catch {}
  const head = currentHead(root);
  const state = runProbes({ root, head });
  writeState(statePath(), state);
  for (const c of state.checks) {
    const mark = c.severity === 'skip' ? '-' : c.ok ? 'OK' : c.severity === 'warn' ? 'WARN' : 'FAIL';
    console.log(`${mark.padEnd(4)} ${c.name.padEnd(22)} ${c.detail}`);
  }
  const suffix = state.failing.length ? `: ${state.failing.join(', ')}` : '';
  console.log(`${state.status}${suffix} (HEAD ${head.slice(0, 7) || 'unknown'})`);
  process.exit(state.status === 'DOCTOR_PASS' ? 0 : 1);
}
