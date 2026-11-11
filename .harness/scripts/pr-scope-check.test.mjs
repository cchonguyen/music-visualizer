import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, formatJsonVerdict, parseDiff, parseNameStatus, isCommentLine, ASSERTION, SKIP_MARK, isPackageJsonVersionOnly, isAdditiveSupabaseMigration, isTemplateCopy } from './pr-scope-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, 'pr-scope-check.mjs');

const ACTIVE = (type, targets) => `- [ ] **Slice X** [IN_PROGRESS] \`[GREEN][${type}]\`: thing — Target files: ${targets}\n`;
const testDiff = (file, added = [], removed = []) =>
  new Map([[file, { added, removed }]]);

test('parseNameStatus reports renames as a deletion plus a new file', () => {
  const out = parseNameStatus('M\tsrc/a.js\nD\told.js\nR086\tsrc/b.js\tsrc/c.js\n');
  assert.deepEqual(out.changed, ['src/a.js', 'src/c.js']);
  assert.deepEqual(out.deleted, ['old.js', 'src/b.js']);
});

test('parseDiff collects added and removed content lines per file', () => {
  const text = [
    'diff --git a/x.test.js b/x.test.js',
    '--- a/x.test.js',
    '+++ b/x.test.js',
    '@@ -1,2 +1,2 @@',
    '-  expect(a).toBe(1);',
    '+  expect(a).toBe(2);',
    '',
  ].join('\n');
  const files = parseDiff(text);
  assert.deepEqual(files.get('x.test.js'), { added: ['  expect(a).toBe(2);'], removed: ['  expect(a).toBe(1);'] });
});

test('a clean CORE / DATA slice with a new assertion passes', () => {
  const r = analyze({
    changed: ['.harness/scripts/foo.mjs', '.harness/scripts/foo.test.mjs'],
    diff: testDiff('.harness/scripts/foo.test.mjs', ['assert.equal(1, 1);']),
    progress: ACTIVE('CORE / DATA', '`.harness/scripts/`'),
  });
  assert.deepEqual(r.problems, []);
  assert.equal(r.sliceType, 'CORE / DATA');
});

test('CORE / DATA slice with no test file changed is a problem', () => {
  const r = analyze({
    changed: ['src/foo.js'],
    diff: new Map(),
    progress: ACTIVE('CORE / DATA', 'src/'),
  });
  assert.ok(r.problems.some((p) => p.includes('needs a test file change')));
});

test('CORE / DATA slice with a test file but no assertion added is a problem', () => {
  const r = analyze({
    changed: ['src/foo.test.js'],
    diff: testDiff('src/foo.test.js', ['// todo']),
    progress: ACTIVE('CORE / DATA', 'src/'),
  });
  assert.ok(r.problems.some((p) => p.includes('no assertion line was added')));
});

test('UI / VISUAL slice does not need a test file', () => {
  const r = analyze({ changed: ['src/view.css'], progress: ACTIVE('UI / VISUAL', 'src/') });
  assert.deepEqual(r.problems, []);
});

test('removing an assertion without a replacement is flagged as Yellow', () => {
  const r = analyze({
    changed: ['src/foo.test.js'],
    diff: testDiff('src/foo.test.js', ['// keep'], ['  expect(x).toEqual(3);']),
  });
  assert.ok(r.problems.some((p) => p.startsWith('Yellow:')));
});

test('a changed assertion (remove one, add one) is not flagged', () => {
  const r = analyze({
    changed: ['src/foo.test.js'],
    diff: testDiff('src/foo.test.js', ['  expect(x).toEqual(4);'], ['  expect(x).toEqual(3);']),
  });
  assert.deepEqual(r.problems, []);
});

test('an added skip or only in a test file is flagged', () => {
  const r = analyze({
    changed: ['src/foo.test.js'],
    diff: testDiff('src/foo.test.js', ["it.skip('later', () => {});", 'expect(1).toBe(1);']),
  });
  assert.ok(r.problems.some((p) => p.includes('skipped or focused')));
});

test('a skip inside a string is not a skipped test, a real skip line is', () => {
  const inString = analyze({
    changed: ['src/foo.test.js'],
    diff: testDiff('src/foo.test.js', ["  const fixture = \"it.skip('x')\";", '  expect(1).toBe(1);']),
  });
  assert.deepEqual(inString.problems, []);

  const real = analyze({
    changed: ['src/foo.test.js'],
    diff: testDiff('src/foo.test.js', ["  it.skip('later', () => {});", '  expect(1).toBe(1);']),
  });
  assert.ok(real.problems.some((p) => p.includes('skipped or focused')));
});

test('each Red tripwire fires and marks the slice Red', () => {
  const files = [
    'package.json', 'requirements.txt', 'db/migrations/001.sql', 'src/schema.ts',
    'src/auth/login.js', '.env.local', 'AGENTS.md', '.github/workflows/ci.yml',
  ];
  const r = analyze({ changed: files, progress: '' });
  assert.equal(r.tripwireFired, true);
  for (const f of files) assert.ok(r.problems.some((p) => p.includes(f)), `missing tripwire for ${f}`);
});

test('package.json with only a version bump does not trip the dependency manifest wire', () => {
  const diff = testDiff('package.json', ['  "version": "0.8.3",'], ['  "version": "0.8.2",']);
  const r = analyze({ changed: ['package.json'], diff, progress: '' });
  assert.equal(r.tripwireFired, false);
  assert.equal(r.problems.length, 0);
});

test('package.json with dependency changes trips the dependency manifest wire', () => {
  const diff = testDiff('package.json', ['  "lodash": "^4.17.21"'], []);
  const r = analyze({ changed: ['package.json'], diff, progress: '' });
  assert.equal(r.tripwireFired, true);
  assert.ok(r.problems.some((p) => p.includes('package.json')));
});

test('package.json with only a version bump is allowed outside active slice Target files', () => {
  const diff = new Map([
    ['src/foo.js', { added: ['const x = 1;'], removed: [] }],
    ['package.json', { added: ['  "version": "1.0.1",'], removed: ['  "version": "1.0.0",'] }],
  ]);
  const progress = '- [ ] **Slice 1.1: Feature** [IN_PROGRESS] Target files: src/foo.js | Coords: [110] | Verify: npm test\n';
  const r = analyze({ changed: ['src/foo.js', 'package.json'], diff, progress });
  assert.equal(r.tripwireFired, false);
  assert.deepEqual(r.problems, []);
});

test('isPackageJsonVersionOnly identifies pure version bumps vs dependencies', () => {
  assert.equal(isPackageJsonVersionOnly(null), false);
  assert.equal(isPackageJsonVersionOnly({ added: [], removed: [] }), false);
  assert.equal(isPackageJsonVersionOnly({
    added: ['"version": "1.2.3"'],
    removed: ['"version": "1.2.2"'],
  }), true);
  assert.equal(isPackageJsonVersionOnly({
    added: ['  "version": "1.2.3",'],
    removed: ['  "version": "1.2.2",'],
  }), true);
  assert.equal(isPackageJsonVersionOnly({
    added: ['  "version": "1.2.3",', '  "dependencies": {}'],
    removed: ['  "version": "1.2.2",'],
  }), false);
});

test('a deleted file is a Red tripwire', () => {
  const r = analyze({ changed: ['src/a.js'], deleted: ['src/old.js'], progress: '' });
  assert.ok(r.problems.some((p) => p.includes('(file deleted): src/old.js')));
});

test('author.md does not trip the auth wire', () => {
  const r = analyze({ changed: ['docs/author.md'], progress: '' });
  assert.equal(r.tripwireFired, false);
});

test('engine files: a note in the hub, a problem in strict spoke mode', () => {
  const hub = analyze({ changed: ['.harness/hooks/x.mjs'], progress: '', strict: false });
  assert.deepEqual(hub.problems, []);
  assert.ok(hub.notes.some((n) => n.includes('Engine file changed')));

  const spoke = analyze({ changed: ['.harness/hooks/x.mjs'], progress: '', strict: true });
  assert.ok(spoke.problems.some((p) => p.includes('engine file')));
});

test('spoke-owned project-rules.md is not an engine file', () => {
  const spoke = analyze({ changed: ['.claude/project-rules.md'], progress: '', strict: true });
  assert.deepEqual(spoke.problems, []);
});

test('two IN_PROGRESS slices is a problem', () => {
  const progress = ACTIVE('CORE / DATA', 'src/') + ACTIVE('UI / VISUAL', 'src/');
  const r = analyze({ changed: ['src/a.test.js'], diff: testDiff('src/a.test.js', ['expect(1).toBe(1);']), progress });
  assert.ok(r.problems.some((p) => p.includes('2 slices are [IN_PROGRESS]')));
});

test('a slice PR that marks its slice [x] still gets the scope and test checks', () => {
  // The PR diff adds the done line; the head PROGRESS has no [IN_PROGRESS] line
  const doneLine = '- [x] **Slice 9** `[YELLOW][CORE / DATA]`: thing — Target files: `src/foo.js`, `src/foo.test.js`';
  const diff = new Map([['.spec/PROGRESS.md', { added: [doneLine], removed: [] }]]);
  const outside = analyze({ changed: ['.spec/PROGRESS.md', 'src/bar.js'], diff, progress: doneLine });
  assert.equal(outside.sliceType, 'CORE / DATA');
  assert.ok(outside.problems.some((p) => p.includes("Outside the slice's Target files: src/bar.js")));
  assert.ok(outside.problems.some((p) => p.includes('needs a test file change')));

  const inside = analyze({
    changed: ['.spec/PROGRESS.md', 'src/foo.js', 'src/foo.test.js'],
    diff: new Map([...diff, ['src/foo.test.js', { added: ['expect(1).toBe(1);'], removed: [] }]]),
    progress: doneLine,
  });
  assert.deepEqual(inside.problems, []);
});

test('a deletion-only PR is not "empty" and deleted engine files are still caught', () => {
  const r = analyze({ changed: [], deleted: ['.harness/hooks/old.mjs'], progress: '', strict: true });
  assert.ok(!r.problems.some((p) => p.includes('diff is empty')));
  assert.ok(r.problems.some((p) => p.includes('engine file')));
  assert.ok(r.problems.some((p) => p.includes('(file deleted): .harness/hooks/old.mjs')));
});

test('strict CLI exits 1 on a deletion, advisory CLI exits 0 for the same diff', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-cli-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'gone.js'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'feature');
  fs.rmSync(path.join(dir, 'gone.js'));
  git('add', '-A');
  git('commit', '-q', '-m', 'delete');

  const run = (flag) => spawnSync(process.execPath, [SCRIPT, 'main', 'HEAD', ...(flag ? [flag] : [])], {
    cwd: dir, encoding: 'utf8',
  });
  const strict = run('--strict');
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /PR SCOPE: PROBLEMS/);
  assert.match(strict.stdout, /Red tripwire \(file deleted\)/);

  const advisory = run(null);
  assert.equal(advisory.status, 0);
  assert.match(advisory.stdout, /advisory/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('formatJsonVerdict returns CLEAN verdict and valid schema when no problems exist', () => {
  const verdict = formatJsonVerdict({
    changed: ['src/app.js'],
    deleted: [],
    strict: false,
    base: 'origin/main',
    head: 'HEAD',
    problems: [],
    notes: ['Vibe Mode: no slice is in progress'],
    tripwireFired: false,
    sliceType: 'UI / VISUAL',
  });

  assert.equal(verdict.schemaVersion, '1.0.0');
  assert.equal(typeof verdict.timestamp, 'string');
  assert.ok(!isNaN(Date.parse(verdict.timestamp)));
  assert.equal(verdict.verdict, 'CLEAN');
  assert.equal(verdict.mode, 'advisory');
  assert.deepEqual(verdict.target, { base: 'origin/main', head: 'HEAD' });
  assert.deepEqual(verdict.summary, {
    changedFiles: 1,
    deletedFiles: 0,
    problemCount: 0,
    tripwireFired: false,
    noteCount: 1,
  });
  assert.equal(verdict.sliceType, 'UI / VISUAL');
  assert.deepEqual(verdict.findings, []);
  assert.deepEqual(verdict.notes, ['Vibe Mode: no slice is in progress']);
});

test('formatJsonVerdict categorizes problems, generates finding IDs, sets severities, and summarizes counts', () => {
  const problems = [
    'Red tripwire (schema file): src/schema.sql',
    "Outside the slice's Target files: src/other.js",
    '2 slices are [IN_PROGRESS]. The harness allows only one.',
    'CORE / DATA slice needs a test file change',
    'Yellow: 2 assertion line(s) removed from tests with no replacement.',
    'Spoke changed an engine file, which the hub owns: .harness/hooks/x.mjs',
    'The diff is empty. There is nothing to review.',
  ];

  // Advisory mode with tripwire fired -> severity error
  const v1 = formatJsonVerdict({
    changed: ['src/schema.sql', 'src/other.js'],
    deleted: ['old.js'],
    strict: false,
    base: 'main',
    head: 'feat',
    problems,
    notes: ['note1', 'note2'],
    tripwireFired: true,
    sliceType: 'CORE / DATA',
  });

  assert.equal(v1.verdict, 'NEEDS_CHANGES');
  assert.equal(v1.mode, 'advisory');
  assert.deepEqual(v1.summary, {
    changedFiles: 2,
    deletedFiles: 1,
    problemCount: 7,
    tripwireFired: true,
    noteCount: 2,
  });
  assert.equal(v1.findings.length, 7);
  assert.deepEqual(v1.findings.map((f) => f.id), [
    'REV-001', 'REV-002', 'REV-003', 'REV-004', 'REV-005', 'REV-006', 'REV-007',
  ]);
  assert.deepEqual(v1.findings.map((f) => f.type), [
    'tripwire', 'scope', 'scope', 'test', 'test', 'engine', 'other',
  ]);
  assert.ok(v1.findings.every((f) => f.severity === 'error'));
  assert.ok(v1.findings.every((f) => f.status === 'open'));

  // Advisory mode with no tripwire -> severity warning
  const v2 = formatJsonVerdict({
    problems: ['Outside the slice\'s Target files: src/other.js'],
    strict: false,
    tripwireFired: false,
  });
  assert.equal(v2.findings[0].severity, 'warning');

  // Strict mode with no tripwire -> severity error
  const v3 = formatJsonVerdict({
    problems: ['Outside the slice\'s Target files: src/other.js'],
    strict: true,
    tripwireFired: false,
  });
  assert.equal(v3.findings[0].severity, 'error');
  assert.equal(v3.mode, 'strict');
});

test('CLI --output-verdict writes valid JSON to disk while preserving text report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-verdict-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'file.txt'), 'hello\n');
  git('add', '.');
  git('commit', '-q', '-m', 'initial');
  git('checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(dir, 'file.txt'), 'hello world\n');
  git('add', '.');
  git('commit', '-q', '-m', 'update');

  const verdictPath = path.join(dir, '.spec', 'AUDIT_VERDICT.json');
  const res = spawnSync(process.execPath, [SCRIPT, 'main', 'HEAD', '--output-verdict', verdictPath], {
    cwd: dir, encoding: 'utf8',
  });

  assert.equal(res.status, 0);
  assert.match(res.stdout, /PR SCOPE: CLEAN/);
  assert.ok(fs.existsSync(verdictPath), 'verdict file should exist');

  const parsed = JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
  assert.equal(parsed.schemaVersion, '1.0.0');
  assert.equal(parsed.verdict, 'CLEAN');
  assert.deepEqual(parsed.target, { base: 'main', head: 'HEAD' });
  assert.equal(parsed.summary.changedFiles, 1);
  assert.equal(parsed.summary.problemCount, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI --json prints valid JSON verdict to stdout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-json-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'file.txt'), 'initial\n');
  git('add', '.');
  git('commit', '-q', '-m', 'initial');
  git('checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(dir, 'file.txt'), 'updated\n');
  git('add', '.');
  git('commit', '-q', '-m', 'updated');

  const res = spawnSync(process.execPath, [SCRIPT, 'main', 'HEAD', '--json'], {
    cwd: dir, encoding: 'utf8',
  });

  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.schemaVersion, '1.0.0');
  assert.equal(parsed.verdict, 'CLEAN');
  assert.equal(parsed.summary.changedFiles, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('comment lines containing assert do not count as added assertions', () => {
  const r = analyze({
    changed: ['src/foo.test.js'],
    diff: testDiff('src/foo.test.js', [
      '// assert(something)',
      '  # assert x == 1',
      '/* assert.equal(1, 1) */',
      ' * assert(y)',
      '-- assert this',
    ]),
    progress: ACTIVE('CORE / DATA', 'src/'),
  });
  assert.ok(r.problems.some((p) => p.includes('no assertion line was added')));

  const r2 = analyze({
    changed: ['src/foo.test.js'],
    diff: testDiff('src/foo.test.js', ['// assert(replacement)'], ['assert(original);']),
  });
  assert.ok(r2.problems.some((p) => p.startsWith('Yellow: 1 assertion line(s) removed')));
});

test('comment lines with test.skip or skip marks are not flagged as skipped tests', () => {
  const r = analyze({
    changed: ['src/foo.test.js'],
    diff: testDiff('src/foo.test.js', [
      "// test.skip('disabled test', () => {});",
      "// it.skip('skip me', () => {});",
      '# @pytest.mark.skip',
      '# pytest.skip("skip reason")',
      '// test.todo("later")',
      '/* describe.skip("suite", () => {}) */',
      'expect(1).toBe(1);',
    ]),
  });
  assert.deepEqual(r.problems, []);
});

test('modern assertions across frameworks are recognized as assertions', () => {
  const assertions = [
    { file: 'src/foo.test.js', line: 't.is(a, b);' },
    { file: 'src/foo.test.js', line: 't.true(val);' },
    { file: 'src/foo.test.js', line: 't.false(val);' },
    { file: 'src/foo.test.js', line: 't.assert(val);' },
    { file: 'src/foo.test.js', line: 'item.should.equal(1);' },
    { file: 'src/foo.test.js', line: 'expect(val).to.be.true;' },
    { file: 'src/foo.test.js', line: 'expect(val).toMatch(/regex/);' },
    { file: 'src/foo.test.js', line: 'expect(fn).toThrow();' },
    { file: 'tests/test_foo.py', line: 'self.assertEqual(a, b)' },
    { file: 'tests/test_foo.py', line: 'assert a == b' },
    { file: 'tests/test_foo.py', line: 'pytest.raises(ValueError)' },
    { file: 'tests/test_foo.py', line: 'self.assertRaises(KeyError)' },
    { file: 'tests/foo.test.rs', line: 'assert_eq!(a, b);' },
    { file: 'tests/foo.test.rs', line: 'assert_ne!(a, b);' },
    { file: 'tests/foo.test.rs', line: 'assert!(condition);' },
    { file: 'pkg/foo_test.go', line: 'require.NoError(t, err)' },
    { file: 'pkg/foo_test.go', line: 't.Error("failed")' },
    { file: 'pkg/foo_test.go', line: 't.Fatal("failed")' },
  ];

  for (const { file, line } of assertions) {
    const dir = file.split('/')[0];
    const r = analyze({
      changed: [file],
      diff: testDiff(file, [line]),
      progress: ACTIVE('CORE / DATA', `${dir}/`),
    });
    assert.deepEqual(r.problems, [], `Assertion line not recognized: ${line}`);
  }
});

test('SKIP_MARK matches modern framework skip patterns when uncommented', () => {
  const skipPatterns = [
    "it.skip('later', () => {})",
    "test.skip('later', () => {})",
    "describe.skip('suite', () => {})",
    "it.only('focus', () => {})",
    "test.only('focus', () => {})",
    "describe.only('focus', () => {})",
    "xit('skip', () => {})",
    "xdescribe('skip', () => {})",
    "test.todo('todo test')",
    "@pytest.mark.skip(reason='temp')",
    "@skip('temp')",
    "@unittest.skip('broken')",
    "pytest.skip('skipping')",
    "t.Skip('skip go test')",
    "t.skip('skip go test')",
  ];

  for (const line of skipPatterns) {
    assert.ok(SKIP_MARK.test(line), `Expected SKIP_MARK to match: ${line}`);
  }
});

test('an additive Supabase migration does not trip the migrations wire; other migration edits still do', () => {
  const added = testDiff('supabase/migrations/0034_edition_fact_sources.sql', ['alter table event_editions add column if not exists fact_source_note text;']);
  const r = analyze({ changed: ['supabase/migrations/0034_edition_fact_sources.sql'], diff: added, progress: '' });
  assert.equal(r.tripwireFired, false);
  assert.equal(isAdditiveSupabaseMigration('supabase/migrations/0034_edition_fact_sources.sql', added), true);

  const rewritten = testDiff('supabase/migrations/0030_performance_set.sql', ['select 1;'], ['select 0;']);
  const r2 = analyze({ changed: ['supabase/migrations/0030_performance_set.sql'], diff: rewritten, progress: '' });
  assert.equal(r2.tripwireFired, true);

  const other = testDiff('db/migrations/001.sql', ['select 1;']);
  assert.equal(isAdditiveSupabaseMigration('db/migrations/001.sql', other), false);
});

test('strict: the four sync-delivered gate files raise no tripwire or engine problem', () => {
  const changed = [
    '.github/workflows/harness-slice-gate.yml',
    '.github/workflows/harness-referee-watch.yml',
    '.harness/scripts/ci-gate.mjs',
    '.harness/scripts/ci-gate.test.mjs',
  ];
  const r = analyze({ changed, strict: true, hubSync: false });
  assert.deepEqual(r.problems, []);
  assert.ok(r.notes.some((n) => n.includes('.harness/scripts/ci-gate.mjs') && n.includes('not verified against the hub')));
});

test('strict: other workflow files still trip the CI workflow tripwire', () => {
  const r = analyze({ changed: ['.github/workflows/ci.yml'], strict: true, hubSync: false });
  assert.ok(r.problems.some((p) => p.includes('Red tripwire (CI workflow): .github/workflows/ci.yml')));
});

test('strict: other engine files still count as spoke changes to the hub-owned engine', () => {
  const r = analyze({ changed: ['.harness/scripts/pr-scope-check.mjs'], strict: true, hubSync: false });
  assert.ok(r.problems.some((p) => p.includes('Spoke changed an engine file') && p.includes('pr-scope-check.mjs')));
});

test('a stale [IN_PROGRESS] placeholder with no changed targets does not block a done slice in the PR', () => {
  // finish-slice promoted the next slice (targets src/next/). This PR finishes Slice 9 (targets src/foo.js).
  const doneLine = '- [x] **Slice 9** `[YELLOW][CORE / DATA]`: thing — Target files: `src/foo.js`, `src/foo.test.js`';
  const nextLine = '- [ ] **Slice 10** [IN_PROGRESS] `[GREEN][CORE / DATA]`: next — Target files: `src/next/x.js`';
  const diff = new Map([['.spec/PROGRESS.md', { added: [doneLine, nextLine], removed: [] }]]);
  const r = analyze({
    changed: ['.spec/PROGRESS.md', 'src/foo.js', 'src/foo.test.js'],
    diff: new Map([...diff, ['src/foo.js', { added: [], removed: [] }], ['src/foo.test.js', { added: ['expect(1).toBe(1);'], removed: [] }]]),
    progress: doneLine + '\n' + nextLine + '\n',
  });
  assert.equal(r.sliceType, 'CORE / DATA');
  assert.ok(!r.problems.some((p) => p.includes("Outside the slice's Target files")), r.problems.join('; '));
  assert.ok(r.notes.some((n) => n.includes('no changed Target files')));
});

test('a placeholder that lists .spec/PROGRESS.md is not taken as touched by a done slice PR', () => {
  // Concert-Tracker PR #262: the promoted next slice lists .spec/PROGRESS.md, which every slice PR changes.
  const doneLine = '- [x] **Slice 9.1** `[CORE / DATA]` : thing. Target files: `src/foo.js`, `src/foo.test.js`, `.spec/PROGRESS.md`';
  const nextLine = '- [ ] **Slice 9.2** [IN_PROGRESS] `[UI / VISUAL]` : next. Target files: `src/next/x.tsx`, `.spec/PROGRESS.md`';
  const r = analyze({
    changed: ['.spec/PROGRESS.md', 'src/foo.js', 'src/foo.test.js'],
    diff: new Map([
      ['.spec/PROGRESS.md', { added: [doneLine, nextLine], removed: [] }],
      ['src/foo.js', { added: [], removed: [] }],
      ['src/foo.test.js', { added: ['assert.equal(1, 1);'], removed: [] }],
    ]),
    progress: doneLine + '\n' + nextLine + '\n',
  });
  assert.equal(r.sliceType, 'CORE / DATA');
  assert.ok(!r.problems.some((p) => p.includes("Outside the slice's Target files")), r.problems.join('; '));
});

test('an [IN_PROGRESS] slice whose targets this PR changes still blocks out-of-scope files', () => {
  const activeLine = '- [ ] **Slice 10** [IN_PROGRESS] `[GREEN][CORE / DATA]`: next — Target files: `src/next/x.js`';
  const r = analyze({
    changed: ['src/next/x.js', 'src/other.js'],
    diff: new Map([['src/next/x.js', { added: ['expect(1).toBe(1);'], removed: [] }], ['src/other.js', { added: [], removed: [] }]]),
    progress: activeLine + '\n',
  });
  assert.ok(r.problems.some((p) => p.includes("Outside the slice's Target files: src/other.js")));
});

test('a verified hub sync is not flagged as outside an [IN_PROGRESS] slice targets', () => {
  const activeLine = '- [ ] **Slice 8.7** [IN_PROGRESS] `[GREEN][CORE / DATA]`: next — Target files: `src/next/x.js`';
  const changed = ['.harness/scripts/pr-scope-check.mjs', '.harness/managed.json'];
  const r = analyze({
    changed,
    diff: new Map(changed.map((f) => [f, { added: [], removed: [] }])),
    progress: activeLine + '\n',
    strict: true,
    hubSync: true,
  });
  assert.ok(!r.problems.some((p) => p.includes("Outside the slice's Target files")), r.problems.join('; '));
});

test('a hub-sync PR that also changes a non-engine file is still flagged outside the slice targets', () => {
  const activeLine = '- [ ] **Slice 8.7** [IN_PROGRESS] `[GREEN][CORE / DATA]`: next — Target files: `src/next/x.js`';
  const changed = ['.harness/scripts/pr-scope-check.mjs', '.harness/managed.json', 'src/other.js'];
  const r = analyze({
    changed,
    diff: new Map(changed.map((f) => [f, { added: [], removed: [] }])),
    progress: activeLine + '\n',
    strict: true,
    hubSync: true,
  });
  assert.ok(r.problems.some((p) => p.includes("Outside the slice's Target files: src/other.js")));
});

test('isTemplateCopy is true only for a workflow identical to its hub template', () => {
  const WF = '.github/workflows/harness-labels.yml';
  const TPL = '.harness/templates/workflows/harness-labels.yml';
  const files = (m) => (p) => (p in m ? m[p] : null);
  assert.equal(isTemplateCopy(WF, files({ [WF]: 'a', [TPL]: 'a' })), true);
  assert.equal(isTemplateCopy(WF, files({ [WF]: 'a', [TPL]: 'b' })), false);
  assert.equal(isTemplateCopy(WF, files({ [WF]: 'a' })), false);
  assert.equal(isTemplateCopy('src/app.ts', files({ 'src/app.ts': 'a', '.harness/templates/workflows/app.ts': 'a' })), false);
  assert.equal(isTemplateCopy(WF, null), false);
});

test('analyze: template-copy workflow is not a tripwire; a differing workflow is', () => {
  const WF = '.github/workflows/harness-labels.yml';
  const TPL = '.harness/templates/workflows/harness-labels.yml';
  const run = (text) => analyze({ changed: [WF], readHead: (p) => ({ [WF]: text, [TPL]: 'a' })[p] ?? null });
  const same = run('a');
  assert.equal(same.tripwireFired, false);
  assert.ok(same.notes.some((n) => n.includes('Sync-delivered harness file')));
  assert.equal(run('b').tripwireFired, true);
});
