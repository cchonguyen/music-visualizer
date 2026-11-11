import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlan, checkSlices } from './accept-plan.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'accept-plan.mjs');

test('parsePlan reads the id and slice lines and ignores other lines', () => {
  const text = '# Plan: p-1\n\nSome note.\n- slice: 8.3\n- slice: 8.4\n';
  assert.deepEqual(parsePlan(text), { id: 'p-1', sliceIds: ['8.3', '8.4'] });
});

test('parsePlan throws when the header is missing', () => {
  assert.throws(() => parsePlan('- slice: 8.3\n'), /# Plan:/);
});

test('parsePlan throws when no slice is listed', () => {
  assert.throws(() => parsePlan('# Plan: p-2\nno slices here\n'), /zero slices/);
});

test('checkSlices finds open and done slices', () => {
  const progress = '- [ ] **Slice 8.3: Thing** Verify: x\n- [x] **Slice 8.2: Old**\n';
  assert.deepEqual(checkSlices(progress, ['8.3', '8.2']), { found: ['8.3', '8.2'], missing: [] });
});

test('checkSlices reports missing slices', () => {
  const progress = '- [ ] **Slice 8.3: Thing** Verify: x\n';
  assert.deepEqual(checkSlices(progress, ['8.3', '9.9']), { found: ['8.3'], missing: ['9.9'] });
});

test('checkSlices does not confuse 8.3 with 8.30', () => {
  const progress = '- [ ] **Slice 8.30: Other** Verify: x\n';
  assert.deepEqual(checkSlices(progress, ['8.3']), { found: [], missing: ['8.3'] });
});

// Build a sandbox repo layout so the CLI reads its own PROGRESS.md and plans.
function sandbox(progress, plan) {
  const root = mkdtempSync(join(tmpdir(), 'accept-plan-'));
  mkdirSync(join(root, '.harness', 'scripts'), { recursive: true });
  mkdirSync(join(root, '.spec', 'plans'), { recursive: true });
  copyFileSync(SCRIPT, join(root, '.harness', 'scripts', 'accept-plan.mjs'));
  const progressPath = join(root, '.spec', 'PROGRESS.md');
  const planPath = join(root, '.spec', 'plans', 'p.md');
  writeFileSync(progressPath, progress);
  writeFileSync(planPath, plan);
  return { root, progressPath, planPath };
}

function runCheck(sb) {
  return spawnSync(
    process.execPath,
    [join(sb.root, '.harness', 'scripts', 'accept-plan.mjs'), '--check', sb.planPath],
    { cwd: sb.root, encoding: 'utf8' },
  );
}

test('--check exits 0 when all slices are found and leaves files unchanged', () => {
  const progress = '- [ ] **Slice 1.1: A** [IN_PROGRESS] Verify: x\n- [x] **Slice 1.2: B**\n';
  const plan = '# Plan: p\n- slice: 1.1\n- slice: 1.2\n';
  const sb = sandbox(progress, plan);
  try {
    const r = runCheck(sb);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /slice 1\.1: found/);
    assert.match(r.stdout, /slice 1\.2: found/);
    assert.equal(readFileSync(sb.progressPath, 'utf8'), progress);
    assert.equal(readFileSync(sb.planPath, 'utf8'), plan);
  } finally {
    rmSync(sb.root, { recursive: true, force: true });
  }
});

test('--check exits 1 when a slice is missing and leaves files unchanged', () => {
  const progress = '- [ ] **Slice 1.1: A** Verify: x\n';
  const plan = '# Plan: p\n- slice: 1.1\n- slice: 2.2\n';
  const sb = sandbox(progress, plan);
  try {
    const r = runCheck(sb);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /slice 2\.2: missing/);
    assert.match(r.stderr, /missing slices: 2\.2/);
    assert.equal(readFileSync(sb.progressPath, 'utf8'), progress);
  } finally {
    rmSync(sb.root, { recursive: true, force: true });
  }
});

test('running without --check exits 1 and does not write', () => {
  const progress = '- [ ] **Slice 1.1: A** Verify: x\n';
  const sb = sandbox(progress, '# Plan: p\n- slice: 1.1\n');
  try {
    const r = spawnSync(
      process.execPath,
      [join(sb.root, '.harness', 'scripts', 'accept-plan.mjs'), sb.planPath],
      { cwd: sb.root, encoding: 'utf8' },
    );
    assert.equal(r.status, 1);
    assert.equal(readFileSync(sb.progressPath, 'utf8'), progress);
  } finally {
    rmSync(sb.root, { recursive: true, force: true });
  }
});
