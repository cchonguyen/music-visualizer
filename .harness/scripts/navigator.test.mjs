import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseAtlasIndex,
  extractAtlasCoords,
  checkAtlasReferences,
  checkLineBudgets,
  archiveCompletedSlices,
  navigatorCheck,
  countLines
} from './navigator.mjs';
import { freezeBlackBox } from './freeze-black-box.mjs';
import { parseActiveTargets as parseTargetsFinish, finishSlice } from './finish-slice.mjs';
import { parseActiveTargets as parseTargetsScope, analyze as analyzeScope } from './pr-scope-check.mjs';
import { appendCall } from './lib/telemetry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, 'navigator.mjs');

function makeTempSpecRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navigator-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');

  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.spec', 'boundaries'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.spec', 'contracts'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.spec', 'archive'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness', 'config'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness', 'scripts'), { recursive: true });

  fs.writeFileSync(path.join(dir, '.harness', 'scripts', 'referee.mjs'), '// referee\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'initial b\n');

  // Create sample ATLAS.md
  fs.writeFileSync(
    path.join(dir, '.spec', 'ATLAS.md'),
    `# Context Atlas

## Sector 000 Card Catalog
- \`000\` [CLAUDE.md](CLAUDE.md) — 5-line pointer
- \`010\` [AGENTS.md](AGENTS.md) — Universal catalog

## Sector 100 Work Dispatch
- \`110\` [.spec/PROGRESS.md](.spec/PROGRESS.md) — Active slice queue
- \`120\` [.spec/archive/HISTORY.md](.spec/archive/HISTORY.md) — Archive
- \`130\` \`.spec/BLACK_BOX.md\` — Incident post-mortem

## Sector 200 Boundaries
- \`210\` [.spec/boundaries/locks.md](.spec/boundaries/locks.md) — File locks
`
  );

  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'CLAUDE.md content\n');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'AGENTS.md content\n');
  fs.writeFileSync(
    path.join(dir, '.spec', 'PROGRESS.md'),
    `# Progress (Atlas Sector 110)\n- [x] **Slice 1** Target files: a.txt | Coords: [110, 210]\n- [ ] **Slice 2** [IN_PROGRESS] Target files: b.txt | Coords: [000, 110]\n`
  );
  fs.writeFileSync(path.join(dir, '.spec', 'archive', 'HISTORY.md'), '# Completed Archive (Atlas Sector 120)\n');
  fs.writeFileSync(path.join(dir, '.spec', 'boundaries', 'locks.md'), '# Locks (Atlas Sector 210)\n');

  fs.writeFileSync(
    path.join(dir, '.harness', 'config', 'thresholds.json'),
    JSON.stringify({
      line_budgets: {
        soft_caps: {
          'CLAUDE.md': 5,
          'AGENTS.md': 40,
          '.spec/PROGRESS.md': 60,
          '.spec/ATLAS.md': 50
        }
      }
    }, null, 2)
  );

  git('add', '-A');
  git('commit', '-m', 'init spec test repo');

  return dir;
}

test('navigatorCheck passes on clean repository with valid Atlas coords and line limits', () => {
  const dir = makeTempSpecRepo();
  try {
    const res = navigatorCheck(dir);
    assert.equal(res.ok, true);
    assert.equal(res.errors.length, 0);
    assert.equal(res.budgetViolations.length, 0);
    assert.equal(res.brokenRefs.length, 0);
    assert.equal(res.brokenLinks.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('extractAtlasCoords correctly extracts codes from Coords:, Refs:, brackets, and headers', () => {
  const text = `
# Spec (Atlas Sector 110)
Reference to [210] and [305].
- [ ] Slice 1 | Coords: [000, 010, 120]
- [ ] Slice 2 | Refs: [210, 220]
Some note about Sector 320.
Invalid ref [1] should not match 3-digit pattern.
`;
  const coords = extractAtlasCoords(text);
  assert.ok(coords.has('110'));
  assert.ok(coords.has('210'));
  assert.ok(coords.has('220'));
  assert.ok(coords.has('305'));
  assert.ok(coords.has('000'));
  assert.ok(coords.has('010'));
  assert.ok(coords.has('120'));
  assert.ok(coords.has('320'));
  assert.equal(coords.has('1'), false);
});

test('checkAtlasReferences detects broken/unregistered Atlas coordinate codes', () => {
  const dir = makeTempSpecRepo();
  try {
    // Add invalid reference [999] in PROGRESS.md
    fs.appendFileSync(
      path.join(dir, '.spec', 'PROGRESS.md'),
      '- [ ] **Slice 3** Target files: c.txt | Coords: [999]\n'
    );

    const { brokenRefs } = checkAtlasReferences(dir);
    assert.equal(brokenRefs.length, 1);
    assert.equal(brokenRefs[0].code, '999');
    assert.match(brokenRefs[0].reason, /not found in \.spec\/ATLAS\.md/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkAtlasReferences detects broken links in ATLAS.md', () => {
  const dir = makeTempSpecRepo();
  try {
    // Add reference to non-existent file in ATLAS.md
    fs.appendFileSync(
      path.join(dir, '.spec', 'ATLAS.md'),
      '- `950` [.spec/missing.md](.spec/missing.md) — Missing file\n'
    );

    const { brokenLinks } = checkAtlasReferences(dir);
    assert.equal(brokenLinks.length, 1);
    assert.equal(brokenLinks[0].code, '950');
    assert.match(brokenLinks[0].reason, /Target file not found on disk/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkAtlasReferences flags a .spec/ file that has no coordinate in ATLAS.md', () => {
  const dir = makeTempSpecRepo();
  try {
    fs.writeFileSync(path.join(dir, '.spec', 'NEW_NOTES.md'), '# Notes\n');
    const { unindexedSpecFiles } = checkAtlasReferences(dir);
    assert.equal(unindexedSpecFiles.length, 1);
    assert.equal(unindexedSpecFiles[0].file, '.spec/NEW_NOTES.md');

    const result = navigatorCheck(dir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('Unindexed spec file: .spec/NEW_NOTES.md')));

    fs.appendFileSync(
      path.join(dir, '.spec', 'ATLAS.md'),
      '- `950` [.spec/NEW_NOTES.md](.spec/NEW_NOTES.md) — Notes\n'
    );
    assert.equal(checkAtlasReferences(dir).unindexedSpecFiles.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkLineBudgets detects files exceeding soft caps', () => {
  const dir = makeTempSpecRepo();
  try {
    // Exceed CLAUDE.md soft cap (5 lines)
    fs.writeFileSync(
      path.join(dir, 'CLAUDE.md'),
      'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\n'
    );

    const thresholds = JSON.parse(fs.readFileSync(path.join(dir, '.harness', 'config', 'thresholds.json'), 'utf8'));
    const violations = checkLineBudgets(dir, thresholds);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].file, 'CLAUDE.md');
    assert.equal(violations[0].lines, 7);
    assert.equal(violations[0].cap, 5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('archiveCompletedSlices archives completed slices to HISTORY.md and preserves active slices', () => {
  const dir = makeTempSpecRepo();
  try {
    const progressPath = path.join(dir, '.spec', 'PROGRESS.md');
    const historyPath = path.join(dir, '.spec', 'archive', 'HISTORY.md');

    const result = archiveCompletedSlices(dir);
    assert.equal(result.archived, 1);

    const progressAfter = fs.readFileSync(progressPath, 'utf8');
    assert.doesNotMatch(progressAfter, /\*\*Slice 1\*\*/);
    assert.match(progressAfter, /\*\*Slice 2\*\* \[IN_PROGRESS\]/);

    const historyAfter = fs.readFileSync(historyPath, 'utf8');
    assert.match(historyAfter, /\*\*Slice 1\*\*/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI navigator.mjs --check exits 0 on valid repository and 1 on violations', () => {
  const dir = makeTempSpecRepo();
  try {
    // 1. Clean repo should exit 0
    const pass = spawnSync(process.execPath, [SCRIPT, '--check'], { cwd: dir, encoding: 'utf8' });
    assert.equal(pass.status, 0);
    assert.match(pass.stdout, /NAVIGATOR CHECK: PASS/);

    // 2. Introduce violation: broken ref
    fs.appendFileSync(path.join(dir, '.spec', 'PROGRESS.md'), '- [ ] Invalid slice | Coords: [999]\n');
    const fail = spawnSync(process.execPath, [SCRIPT, '--check'], { cwd: dir, encoding: 'utf8' });
    assert.equal(fail.status, 1);
    assert.match(fail.stderr, /NAVIGATOR CHECK FAILED/);
    assert.match(fail.stderr, /\[999\]/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('freezeBlackBox captures active slice, git status, diff, stashes, and creates BLACK_BOX.md', () => {
  const dir = makeTempSpecRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  try {
    // Make a dirty edit on slice 2
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'dirty edit in slice 2');

    const res = freezeBlackBox(dir, 'Circuit breaker Strike 2 triggered in test.');
    assert.equal(res.sliceId, '2');
    assert.equal(res.stashCreated, true);
    assert.match(res.stashMessage, /black-box\/2/);

    // Check BLACK_BOX.md was created
    const blackBoxPath = path.join(dir, '.spec', 'BLACK_BOX.md');
    assert.ok(fs.existsSync(blackBoxPath));
    const content = fs.readFileSync(blackBoxPath, 'utf8');
    assert.match(content, /Atlas Sector 130/);
    assert.match(content, /Active Slice:\*\* 2/);
    assert.match(content, /black-box\/2/);
    assert.match(content, /dirty edit in slice 2/);

    // Working directory should have dirty edits stashed (AGENTS.md no longer modified)
    const status = git('status', '--porcelain');
    const statusLines = status.split('\n').filter(Boolean);
    assert.ok(!statusLines.some((l) => l.includes('AGENTS.md')));
    assert.ok(statusLines.some((l) => l.includes('.spec/BLACK_BOX.md')));

    // Stash should exist
    const stashList = git('stash', 'list');
    assert.match(stashList, /black-box\/2/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseActiveTargets robustly strips | Coords, | Refs, | Verify, [NEW], [DELETE], and backticks', () => {
  const line = '- [ ] **Slice 5.1: Engine** [IN_PROGRESS] Target files: `a.mjs`, `[NEW] b.mjs`, `[DELETE] c.mjs`, d.mjs | Coords: [110, 120] | Verify: npm test';
  const finishTargets = parseTargetsFinish(line);
  const scopeTargets = parseTargetsScope(line);

  assert.deepEqual(finishTargets, ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs']);
  assert.deepEqual(scopeTargets, ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs']);
});

test('pr-scope-check analyze verifies line budgets against soft caps', () => {
  const thresholds = {
    line_budgets: {
      soft_caps: {
        'CLAUDE.md': 5,
      }
    }
  };

  // 1. Within budget
  const pass = analyzeScope({
    changed: ['CLAUDE.md'],
    fileContents: { 'CLAUDE.md': '1\n2\n3\n' },
    thresholds,
  });
  assert.ok(!pass.problems.some((p) => p.includes('Line budget exceeded')));

  // 2. Exceeding budget
  const fail = analyzeScope({
    changed: ['CLAUDE.md'],
    fileContents: { 'CLAUDE.md': '1\n2\n3\n4\n5\n6\n7\n' },
    thresholds,
  });
  assert.ok(fail.problems.some((p) => p.includes('Line budget exceeded: CLAUDE.md has 7 lines (soft cap: 5)')));
});

test('finishSlice commits untracked files outside scope and records them in Scope-Widened', () => {
  const dir = makeTempSpecRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  try {
    fs.writeFileSync(path.join(dir, '.spec', 'SESSION_HANDOFF.md'), '**Active Slice:** Slice 2\n');

    // Make an allowed target change
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b content');
    // Also create an untracked dirty file outside scope
    fs.writeFileSync(path.join(dir, 'untracked-rogue.txt'), 'rogue');

    finishSlice(dir, 'feat: attempt finish', { skipChecks: true, verify: () => ({ ran: false, reason: 'test' }) });

    const body = git('log', '-1', '--format=%B');
    assert.match(body, /^Scope-Widened: untracked-rogue\.txt$/m);
    const progress = fs.readFileSync(path.join(dir, '.spec', 'PROGRESS.md'), 'utf8');
    assert.match(progress, /- \[x\] \*\*Slice 2\*\*/);
    assert.doesNotMatch(progress, /\[IN_PROGRESS\]/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('finishSlice git staging does not crash when tracking files are ignored by git', () => {
  const dir = makeTempSpecRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  try {
    fs.writeFileSync(path.join(dir, '.spec', 'SESSION_HANDOFF.md'), '**Active Slice:** Slice 2\n');

    // Add .gitignore ignoring .spec/STATUS_BATCH.jsonl
    fs.writeFileSync(path.join(dir, '.gitignore'), '.spec/STATUS_BATCH.jsonl\n');
    git('add', '.gitignore');
    git('commit', '-m', 'add gitignore');

    // Create target file change
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b content updated');

    // The telemetry gate needs a subagent dispatch for slice 2 before it will finish.
    appendCall(dir, { ts: new Date().toISOString(), tool: 'Agent', agentType: 'harness:gf-coder', role: 'goldfish', filePath: '', slice: '2' });

    // finishSlice should stage and commit without crashing on ignored tracking file
    const res = finishSlice(dir, 'feat: finish with gitignored tracking file', { skipChecks: true });
    assert.equal(res.success, true);
    assert.equal(res.sliceId, '2');

    const progress = fs.readFileSync(path.join(dir, '.spec', 'PROGRESS.md'), 'utf8');
    assert.match(progress, /- \[x\] \*\*Slice 2\*\*/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
