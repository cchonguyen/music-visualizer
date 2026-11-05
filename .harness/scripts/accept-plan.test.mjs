import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan, acceptSlices, sliceTargets, reconcileMerge } from './accept-plan.mjs';

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

test('acceptSlices marks an open line [x] with the plan suffix', () => {
  const progress = '- [ ] **Slice 8.3: Thing**  Target files: a.mjs | Verify: x\n- [x] **Slice 8.2: Old**\n';
  const r = acceptSlices(progress, ['8.3'], 'p-1');
  assert.equal(
    r.text,
    '- [x] **Slice 8.3: Thing**  Target files: a.mjs | Verify: x Accepted-by-plan: p-1\n- [x] **Slice 8.2: Old**\n',
  );
  assert.deepEqual(r.accepted, ['8.3']);
  assert.deepEqual(r.already, []);
  assert.deepEqual(r.missing, []);
});

test('acceptSlices treats an [IN_PROGRESS] line as open and removes the token', () => {
  const progress = '- [ ] **Slice 8.3: Thing** [IN_PROGRESS] [CORE / DATA] Verify: x\n';
  const r = acceptSlices(progress, ['8.3'], 'p-1');
  assert.equal(
    r.text,
    '- [x] **Slice 8.3: Thing** [CORE / DATA] Verify: x Accepted-by-plan: p-1\n',
  );
  assert.deepEqual(r.accepted, ['8.3']);
});

test('acceptSlices reports already-accepted slices and leaves them unchanged', () => {
  const progress = '- [x] **Slice 8.2: Old** Verify: x\n';
  const r = acceptSlices(progress, ['8.2'], 'p-1');
  assert.equal(r.text, progress);
  assert.deepEqual(r.already, ['8.2']);
  assert.deepEqual(r.accepted, []);
});

test('acceptSlices reports missing slices and leaves the text unchanged', () => {
  const progress = '- [ ] **Slice 8.3: Thing** Verify: x\n';
  const r = acceptSlices(progress, ['9.9'], 'p-1');
  assert.equal(r.text, progress);
  assert.deepEqual(r.missing, ['9.9']);
  assert.deepEqual(r.accepted, []);
});

test('acceptSlices does not confuse 8.3 with 8.30', () => {
  const progress = '- [ ] **Slice 8.30: Other** Verify: x\n';
  const r = acceptSlices(progress, ['8.3'], 'p-1');
  assert.equal(r.text, progress);
  assert.deepEqual(r.missing, ['8.3']);
});

test('sliceTargets strips [NEW] from target paths', () => {
  const line = '- [ ] **Slice 9.9: X** [IN_PROGRESS] Target files: a.mjs [NEW], b.mjs | Verify: x';
  assert.deepEqual(sliceTargets(line), ['a.mjs', 'b.mjs']);
});

test('reconcileMerge marks a single matching IN_PROGRESS slice with the Merged suffix', () => {
  const progress = [
    '- [x] **Slice 8.1: Old** Target files: a.mjs | Verify: x',
    '- [ ] **Slice 9.1: New** [IN_PROGRESS] [CORE / DATA] Target files: a.mjs, b.mjs | Verify: x',
    '',
  ].join('\n');
  const r = reconcileMerge(progress, { prNumber: 60, login: 'alice', changedFiles: ['b.mjs'] });
  assert.equal(
    r.text,
    [
      '- [x] **Slice 8.1: Old** Target files: a.mjs | Verify: x',
      '- [x] **Slice 9.1: New** [CORE / DATA] Target files: a.mjs, b.mjs | Verify: x Merged: PR #60 by alice',
      '',
    ].join('\n'),
  );
  assert.deepEqual(r.sliceIds, ['9.1']);
  assert.equal(r.status, 'merged');
});

test('reconcileMerge with no matching file returns status none and unchanged text', () => {
  const progress = '- [ ] **Slice 9.1: New** [IN_PROGRESS] Target files: a.mjs | Verify: x\n';
  const r = reconcileMerge(progress, { prNumber: 60, login: 'alice', changedFiles: ['z.mjs'] });
  assert.equal(r.text, progress);
  assert.deepEqual(r.sliceIds, []);
  assert.equal(r.status, 'none');
});

test('reconcileMerge does not touch an already [x] matching slice', () => {
  const progress = '- [x] **Slice 9.1: Done** Target files: a.mjs | Verify: x\n';
  const r = reconcileMerge(progress, { prNumber: 60, login: 'alice', changedFiles: ['a.mjs'] });
  assert.equal(r.text, progress);
  assert.equal(r.status, 'none');
});

test('reconcileMerge throws ambiguous when two IN_PROGRESS slices match', () => {
  const progress = [
    '- [ ] **Slice 9.1: A** [IN_PROGRESS] Target files: a.mjs | Verify: x',
    '- [ ] **Slice 9.2: B** [IN_PROGRESS] Target files: a.mjs | Verify: x',
    '',
  ].join('\n');
  assert.throws(
    () => reconcileMerge(progress, { prNumber: 60, login: 'alice', changedFiles: ['a.mjs'] }),
    /ambiguous/,
  );
});

test('reconcileMerge matches a changed file given as ./x', () => {
  const progress = '- [ ] **Slice 9.1: A** [IN_PROGRESS] Target files: x.mjs | Verify: x\n';
  const r = reconcileMerge(progress, { prNumber: 61, login: 'bob', changedFiles: ['./x.mjs'] });
  assert.equal(r.status, 'merged');
  assert.deepEqual(r.sliceIds, ['9.1']);
});
