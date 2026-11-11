#!/usr/bin/env node
// Validate that every slice listed in a plan file exists in .spec/PROGRESS.md.
// Usage: node .harness/scripts/accept-plan.mjs --check <planFile>
// Read-only: never writes files. A plan merge records approval only.
// Node built-ins only.

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

// Report which slice ids exist in PROGRESS.md (open or done). Pure; no writes.
export function checkSlices(progressText, sliceIds) {
  const lines = String(progressText).split('\n');
  const found = [];
  const missing = [];
  for (const id of sliceIds) {
    const openPrefix = `- [ ] **Slice ${id}:`;
    const donePrefix = `- [x] **Slice ${id}:`;
    const exists = lines.some(
      (line) => line.startsWith(openPrefix) || line.startsWith(donePrefix),
    );
    (exists ? found : missing).push(id);
  }
  return { found, missing };
}

function isInsidePlans(file) {
  const plansDir = resolve(ROOT, '.spec', 'plans');
  const rel = relative(plansDir, file);
  return rel !== '' && rel.split(sep)[0] !== '..' && !isAbsolute(rel);
}

const USAGE = 'usage: node .harness/scripts/accept-plan.mjs --check <planFile>';

function main(args) {
  if (args[0] !== '--check' || !args[1]) {
    console.error(USAGE);
    return 1;
  }
  const arg = args[1];
  const planPath = resolve(process.cwd(), arg);
  if (!isInsidePlans(planPath)) {
    console.error(`plan file must be inside .spec/plans/: ${arg}`);
    return 1;
  }
  const progressPath = resolve(ROOT, '.spec', 'PROGRESS.md');
  try {
    const plan = parsePlan(readFileSync(planPath, 'utf8'));
    const progress = readFileSync(progressPath, 'utf8');
    const result = checkSlices(progress, plan.sliceIds);
    console.log(`Plan ${plan.id}`);
    for (const id of result.found) {
      console.log(`- slice ${id}: found`);
    }
    for (const id of result.missing) {
      console.log(`- slice ${id}: missing`);
    }
    if (result.missing.length > 0) {
      console.error(`missing slices: ${result.missing.join(', ')}`);
      return 1;
    }
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
