#!/usr/bin/env node
// Accept the slices listed in a plan file by marking them [x] in .spec/PROGRESS.md.
// Usage: node .harness/scripts/accept-plan.mjs <planFile>
// Node built-ins only.

import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSliceLine } from './lib/slice-parser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Plan format:
//   # Plan: <id>
//   - slice: <id>
export function parsePlan(text) {
  const lines = String(text).split(/\r?\n/);
  const header = lines.find((line) => line.trim() !== '');
  const match = header ? header.match(/^# Plan:\s*(\S+)\s*$/) : null;
  if (!match) {
    throw new Error('plan file must start with "# Plan: <id>"');
  }
  const sliceIds = [];
  for (const line of lines) {
    const slice = line.match(/^- slice:\s*(\S+)\s*$/);
    if (slice && !sliceIds.includes(slice[1])) {
      sliceIds.push(slice[1]);
    }
  }
  if (sliceIds.length === 0) {
    throw new Error('plan lists zero slices');
  }
  return { id: match[1], sliceIds };
}

export function acceptSlices(progressText, sliceIds, planId) {
  const lines = String(progressText).split('\n');
  const accepted = [];
  const already = [];
  const missing = [];

  for (const id of sliceIds) {
    const openPrefix = `- [ ] **Slice ${id}:`;
    const donePrefix = `- [x] **Slice ${id}:`;
    const idx = lines.findIndex(
      (line) => line.startsWith(openPrefix) || line.startsWith(donePrefix),
    );
    if (idx === -1) {
      missing.push(id);
      continue;
    }
    const line = lines[idx];
    if (line.startsWith(donePrefix)) {
      already.push(id);
      continue;
    }
    const cr = line.endsWith('\r') ? '\r' : '';
    let body = cr ? line.slice(0, -1) : line;
    body = body.replace(/\s*\[IN_PROGRESS\]/g, '');
    body = '- [x]' + body.slice('- [ ]'.length);
    lines[idx] = `${body.replace(/\s+$/, '')} Accepted-by-plan: ${planId}${cr}`;
    accepted.push(id);
  }

  return { text: lines.join('\n'), accepted, already, missing };
}

// Target file paths of a slice line, with [NEW]/[DELETE]/[IN_PROGRESS] tags removed.
export function sliceTargets(line) {
  let parsed;
  try {
    parsed = parseSliceLine(line);
  } catch {
    return [];
  }
  if (!parsed || !Array.isArray(parsed.targets)) {
    return [];
  }
  return parsed.targets
    .map((t) => String(t).replace(/\[(NEW|DELETE|IN_PROGRESS)\]/g, '').trim())
    .filter((t) => t !== '');
}

function normalizePath(file) {
  return String(file).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

// Mark the single open [IN_PROGRESS] slice whose targets intersect changedFiles as merged.
export function reconcileMerge(progressText, { prNumber, login, changedFiles }) {
  const lines = String(progressText).split('\n');
  const changed = new Set((changedFiles || []).map(normalizePath).filter((f) => f !== ''));
  const candidates = [];

  lines.forEach((line, idx) => {
    if (!/^- \[ \] \*\*Slice /.test(line)) return;
    if (!/\[IN_PROGRESS\]/.test(line)) return;
    const targets = sliceTargets(line).map(normalizePath);
    if (!targets.some((t) => changed.has(t))) return;
    const id = line.match(/\*\*Slice ([^:\s]+):/)[1];
    candidates.push({ idx, id });
  });

  if (candidates.length === 0) {
    return { text: progressText, sliceIds: [], status: 'none' };
  }
  if (candidates.length > 1) {
    const ids = candidates.map((c) => c.id);
    throw new Error(`ambiguous merge: slices ${ids.join(', ')} match PR #${prNumber}`);
  }

  const { idx, id } = candidates[0];
  const line = lines[idx];
  const cr = line.endsWith('\r') ? '\r' : '';
  let body = cr ? line.slice(0, -1) : line;
  body = body.replace(/\s*\[IN_PROGRESS\]/g, '');
  body = '- [x]' + body.slice('- [ ]'.length);
  lines[idx] = `${body.replace(/\s+$/, '')} Merged: PR #${prNumber} by ${login}${cr}`;
  return { text: lines.join('\n'), sliceIds: [id], status: 'merged' };
}

function isInsidePlans(file) {
  const plansDir = resolve(ROOT, '.spec', 'plans');
  const rel = relative(plansDir, file);
  return rel !== '' && rel.split(sep)[0] !== '..' && !isAbsolute(rel);
}

// Usage: node .harness/scripts/accept-plan.mjs --merged <prNumber> <login> <changedFile...>
function runMerged(rest) {
  const [prNumber, login, ...changedFiles] = rest;
  if (!prNumber || !/^\d+$/.test(prNumber) || !login || login.trim() === '') {
    console.error('usage: node .harness/scripts/accept-plan.mjs --merged <prNumber> <login> <changedFile...>');
    return 1;
  }
  const progressPath = resolve(ROOT, '.spec', 'PROGRESS.md');
  try {
    const progress = readFileSync(progressPath, 'utf8');
    const result = reconcileMerge(progress, { prNumber, login, changedFiles });
    if (result.status === 'merged') {
      const tmp = `${progressPath}.tmp-${process.pid}`;
      writeFileSync(tmp, result.text, 'utf8');
      renameSync(tmp, progressPath);
      console.log(`reconciled: ${result.sliceIds[0]}`);
    } else {
      console.log('reconciled: none');
    }
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

function main(args) {
  const arg = args[0];
  if (!arg) {
    console.error('usage: node .harness/scripts/accept-plan.mjs <planFile>');
    return 1;
  }
  if (arg === '--merged') {
    return runMerged(args.slice(1));
  }
  const planPath = resolve(process.cwd(), arg);
  if (!isInsidePlans(planPath)) {
    console.error(`plan file must be inside .spec/plans/: ${arg}`);
    return 1;
  }
  const progressPath = resolve(ROOT, '.spec', 'PROGRESS.md');
  try {
    const plan = parsePlan(readFileSync(planPath, 'utf8'));
    const progress = readFileSync(progressPath, 'utf8');
    const result = acceptSlices(progress, plan.sliceIds, plan.id);
    if (result.missing.length > 0) {
      console.error(`missing slices: ${result.missing.join(', ')}`);
      return 1;
    }
    const tmp = `${progressPath}.tmp-${process.pid}`;
    writeFileSync(tmp, result.text, 'utf8');
    renameSync(tmp, progressPath);
    console.log(`accepted: ${result.accepted.length}, already: ${result.already.length}`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const isDirect =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirect) {
  process.exitCode = main(process.argv.slice(2));
}
