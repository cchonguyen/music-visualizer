import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSliceLine, validateSliceLine } from './slice-parser.mjs';
import { atomicWriteFileSync, ensureHarnessRoot } from './fs-atomic.mjs';

test('parseSliceLine parses active slice line with [IN_PROGRESS], [NEW], coords, and verify', () => {
  const line =
    '- [ ] **Slice 6.1: Atomic FS Helper, Root Resolver & Shared Slice Parser** [IN_PROGRESS] Target files: .harness/scripts/lib/fs-atomic.mjs [NEW], .harness/scripts/lib/slice-parser.mjs [NEW], .harness/scripts/lib/slice-parser.test.mjs [NEW], .harness/scripts/syntax-check.mjs [NEW], package.json | Coords: [110, 210, 305] | Verify: node --test .harness/scripts/lib/*.test.mjs';

  const parsed = parseSliceLine(line);

  assert.equal(parsed.id, '6.1');
  assert.equal(parsed.title, 'Atomic FS Helper, Root Resolver & Shared Slice Parser');
  assert.equal(parsed.status, '[IN_PROGRESS]');
  assert.deepEqual(parsed.targets, [
    '.harness/scripts/lib/fs-atomic.mjs',
    '.harness/scripts/lib/slice-parser.mjs',
    '.harness/scripts/lib/slice-parser.test.mjs',
    '.harness/scripts/syntax-check.mjs',
    'package.json',
  ]);
  assert.deepEqual(parsed.coords, ['110', '210', '305']);
  assert.equal(parsed.verify, 'node --test .harness/scripts/lib/*.test.mjs');
});

test('parseSliceLine parses completed slice with [x] and Refs format', () => {
  const line =
    '- [x] **Slice 4.1: Threshold Manifest & Spec Modularization**  Target files: .harness/config/thresholds.json, .spec/INDEX.md | Refs: [110, 120, 210] | Verify: node --test .harness/scripts/*.test.mjs';

  const parsed = parseSliceLine(line);

  assert.equal(parsed.id, '4.1');
  assert.equal(parsed.status, '[x]');
  assert.deepEqual(parsed.targets, ['.harness/config/thresholds.json', '.spec/INDEX.md']);
  assert.deepEqual(parsed.coords, ['110', '120', '210']);
  assert.equal(parsed.verify, 'node --test .harness/scripts/*.test.mjs');
});

test('parseSliceLine strips backticks, [DELETE], and normalizes relative paths', () => {
  const line =
    '- [ ] **Slice 5.1: Rename Scripts** [PENDING] | Target files: `src/old.mjs` [DELETE], ./src/new.mjs [NEW] | Coords: [305] | Verify: npm test';

  const parsed = parseSliceLine(line);

  assert.equal(parsed.id, '5.1');
  assert.equal(parsed.status, '[PENDING]');
  assert.deepEqual(parsed.targets, ['src/old.mjs', 'src/new.mjs']);
  assert.deepEqual(parsed.coords, ['305']);
  assert.equal(parsed.verify, 'npm test');
});

test('parseSliceLine handles empty or invalid lines gracefully', () => {
  assert.deepEqual(parseSliceLine(''), {
    id: null,
    title: null,
    fullTitle: null,
    status: '',
    targets: [],
    targetFiles: [],
    coords: [],
    verify: '',
  });

  assert.deepEqual(parseSliceLine(null), {
    id: null,
    title: null,
    fullTitle: null,
    status: '',
    targets: [],
    targetFiles: [],
    coords: [],
    verify: '',
  });
});

test('validateSliceLine flags error if .spec/PROGRESS.md is in Target files', () => {
  const line =
    '- [ ] **Slice 1.1: Feature** [IN_PROGRESS] Target files: src/app.js, .spec/PROGRESS.md | Coords: [110] | Verify: npm test';
  const result = validateSliceLine(line);

  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Target files must not include \.spec\/PROGRESS\.md/i);
});

test('validateSliceLine verifies coords against atlasContent', () => {
  const mockAtlas = `
# Context Atlas
## Sector 100 Work Dispatch
- \`110\` [.spec/PROGRESS.md]
- \`120\` [.spec/archive/HISTORY.md]
## Sector 200 Boundaries
- \`210\` [.spec/boundaries/locks.md]
`;

  const validLine =
    '- [ ] **Slice 2.1: Lock Check** [IN_PROGRESS] Target files: src/lock.js | Coords: [110, 210] | Verify: npm test';
  const validRes = validateSliceLine(validLine, mockAtlas);
  assert.equal(validRes.valid, true);
  assert.equal(validRes.errors.length, 0);

  const invalidLine =
    '- [ ] **Slice 2.2: Unknown Coord** [IN_PROGRESS] Target files: src/lock.js | Coords: [110, 999] | Verify: npm test';
  const invalidRes = validateSliceLine(invalidLine, mockAtlas);
  assert.equal(invalidRes.valid, false);
  assert.equal(invalidRes.errors.length, 1);
  assert.match(invalidRes.errors[0], /999/);
});

test('validateSliceLine passes when atlasContent is not provided and targets are valid', () => {
  const line =
    '- [ ] **Slice 3.1: Solo** [PENDING] Target files: src/solo.js | Coords: [999] | Verify: npm test';
  const res = validateSliceLine(line);
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
});

test('atomicWriteFileSync writes file safely and ensureHarnessRoot returns cwd', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-atomic-test-'));
  const testFile = path.join(tmpDir, 'test.txt');

  atomicWriteFileSync(testFile, 'initial content');
  assert.equal(fs.readFileSync(testFile, 'utf8'), 'initial content');

  atomicWriteFileSync(testFile, 'updated content');
  assert.equal(fs.readFileSync(testFile, 'utf8'), 'updated content');

  fs.rmSync(tmpDir, { recursive: true, force: true });

  const root = ensureHarnessRoot();
  assert.ok(typeof root === 'string' && root.length > 0);
});
