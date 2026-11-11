import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const progressPath = fileURLToPath(new URL('../../../.spec/PROGRESS.md', import.meta.url));
const sliceLines = fs
  .readFileSync(progressPath, 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('- ') && l.includes('**Slice '));

test('every slice line has a [ ] or [x] box', () => {
  const bad = sliceLines.filter((l) => !/^- \[( |x)\] /.test(l));
  assert.deepEqual(bad.map((l) => l.slice(0, 60)), []);
});

test('slice IDs are unique', () => {
  const ids = sliceLines.map((l) => (l.match(/\*\*Slice ([0-9]+(?:\.[0-9]+)*[a-z]?)/) || [])[1]);
  assert.ok(ids.every(Boolean));
  const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dups, []);
});
