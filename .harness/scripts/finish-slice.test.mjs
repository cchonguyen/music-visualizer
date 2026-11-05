import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { finishSlice, parseActiveTargets } from './finish-slice.mjs';
import { startSlice } from './start-slice.mjs';
import { verifyHeadTrust } from './referee.mjs';
import { dashboardTrailer, hasDashboardTrailer } from './lib/dashboard-sync.mjs';

// Stands in for bin/update-state.mjs: records the slice in .spec/STATE.json the way the updater does.
function fakeDashboardSync(root, { sliceId, title, stage }) {
  fs.mkdirSync(path.join(root, '.spec'), { recursive: true });
  fs.writeFileSync(path.join(root, '.spec', 'STATE.json'), JSON.stringify({ activeSlices: [{ id: sliceId, title, stage }] }));
  return dashboardTrailer(sliceId, stage);
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-slice-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  // STATE.json is machine-local and gitignored in real repos; mirror that here.
  fs.writeFileSync(path.join(dir, '.gitignore'), '.spec/STATE.json\n');
  return dir;
}

test('finishSlice updates PROGRESS.md, commits with Referee trailers, and verifyHeadTrust passes', () => {
  const dir = makeRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'scripts', 'referee.mjs'), '// referee');
  fs.writeFileSync(path.join(dir, '.spec', 'SESSION_HANDOFF.md'), '**Active Slice:** Slice 1\n**Verification Status:** pending\n');
  fs.writeFileSync(
    path.join(dir, '.spec', 'PROGRESS.md'),
    '# Progress\n- [ ] **Slice 1** `[GREEN][CORE / DATA]`: Test slice — Target files: test.txt [IN_PROGRESS]\n'
  );
  fs.writeFileSync(path.join(dir, 'test.txt'), 'content');

  // Initial commit
  git('add', '-A');
  git('commit', '-m', 'init');

  // Modify test.txt as part of the slice
  fs.writeFileSync(path.join(dir, 'test.txt'), 'updated content');

  const result = finishSlice(dir, 'feat: finish slice 1', { skipChecks: true, dashboardSync: fakeDashboardSync });
  assert.equal(result.success, true);
  assert.equal(result.sliceId, '1');

  // Check PROGRESS.md was marked [x]
  const progressText = fs.readFileSync(path.join(dir, '.spec', 'PROGRESS.md'), 'utf8');
  assert.match(progressText, /- \[x\] \*\*Slice 1\*\*/);
  assert.doesNotMatch(progressText, /\[IN_PROGRESS\]/);

  // Check trailers via verifyHeadTrust
  const trust = verifyHeadTrust(dir, path.join(dir, '.harness', 'scripts', 'referee.mjs'));
  assert.equal(trust.trusted, true);
  assert.equal(trust.verdict, 'VERIFIED');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('finishSlice throws when a file outside Target files is modified (scope enforcement)', () => {
  const dir = makeRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'scripts', 'referee.mjs'), '// referee');
  fs.writeFileSync(path.join(dir, '.spec', 'SESSION_HANDOFF.md'), '**Active Slice:** Slice 1\n');
  fs.writeFileSync(
    path.join(dir, '.spec', 'PROGRESS.md'),
    '# Progress\n- [ ] **Slice 1** `[GREEN][CORE / DATA]`: Test slice — Target files: test.txt [IN_PROGRESS]\n'
  );
  fs.writeFileSync(path.join(dir, 'test.txt'), 'content');
  fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'content');

  git('add', '-A');
  git('commit', '-m', 'init');

  // Modify target file AND an unrelated out-of-scope file
  fs.writeFileSync(path.join(dir, 'test.txt'), 'updated');
  fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'sneaky edit');

  assert.throws(
    () => finishSlice(dir, 'feat: finish slice 1', { skipChecks: true, dashboardSync: fakeDashboardSync }),
    /Scope check failed: unrelated\.txt/
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('finishSlice throws and fails to commit when verification tests fail', () => {
  const dir = makeRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'scripts', 'referee.mjs'), '// referee');
  fs.writeFileSync(path.join(dir, '.spec', 'SESSION_HANDOFF.md'), '**Active Slice:** Slice 1\n');
  fs.writeFileSync(
    path.join(dir, '.spec', 'PROGRESS.md'),
    '# Progress\n- [ ] **Slice 1** `[GREEN][CORE / DATA]`: Test slice — Target files: test.txt [IN_PROGRESS]\n'
  );
  fs.writeFileSync(path.join(dir, 'test.txt'), 'content');
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'test', scripts: { test: 'node -e "process.exit(1)"' } })
  );

  git('add', '-A');
  git('commit', '-m', 'init');

  fs.writeFileSync(path.join(dir, 'test.txt'), 'updated');

  assert.throws(
    () => finishSlice(dir, 'feat: finish slice 1', { skipChecks: false, dashboardSync: fakeDashboardSync }),
    /Verification tests failed/
  );

  // Verify slice was NOT marked [x]
  const progressText = fs.readFileSync(path.join(dir, '.spec', 'PROGRESS.md'), 'utf8');
  assert.match(progressText, /\[IN_PROGRESS\]/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('finishSlice enforces scope neutrality from HEAD to prevent working-copy target widening', () => {
  const dir = makeRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'scripts', 'referee.mjs'), '// referee');
  fs.writeFileSync(path.join(dir, '.spec', 'SESSION_HANDOFF.md'), '**Active Slice:** Slice 1\n');
  fs.writeFileSync(
    path.join(dir, '.spec', 'PROGRESS.md'),
    '# Progress\n- [ ] **Slice 1** `[GREEN][CORE / DATA]`: Test slice — Target files: test.txt\n'
  );
  fs.writeFileSync(path.join(dir, 'test.txt'), 'content');
  fs.writeFileSync(path.join(dir, 'widened.txt'), 'content');

  git('add', '-A');
  git('commit', '-m', 'init');

  // Worker retroactively widens Target files in working copy of PROGRESS.md to include widened.txt
  fs.writeFileSync(
    path.join(dir, '.spec', 'PROGRESS.md'),
    '# Progress\n- [ ] **Slice 1** `[GREEN][CORE / DATA]`: Test slice — Target files: test.txt, widened.txt [IN_PROGRESS]\n'
  );
  fs.writeFileSync(path.join(dir, 'test.txt'), 'updated');
  fs.writeFileSync(path.join(dir, 'widened.txt'), 'unauthorized edit');

  // Must reject despite working-copy PROGRESS.md claiming widened.txt is in scope
  assert.throws(
    () => finishSlice(dir, 'feat: attempt widened slice', { skipChecks: true, dashboardSync: fakeDashboardSync }),
    /Scope check failed: widened\.txt modified outside Target files for Slice 1/
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('finishSlice fails closed when slice exists only in working copy and not in HEAD', () => {
  const dir = makeRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'scripts', 'referee.mjs'), '// referee');
  fs.writeFileSync(path.join(dir, '.spec', 'SESSION_HANDOFF.md'), '**Active Slice:** Slice 2\n');
  fs.writeFileSync(
    path.join(dir, '.spec', 'PROGRESS.md'),
    '# Progress\n- [ ] **Slice 1** `[GREEN][CORE / DATA]`: Committed slice — Target files: test.txt\n'
  );
  fs.writeFileSync(path.join(dir, 'test.txt'), 'content');

  git('add', '-A');
  git('commit', '-m', 'init');

  // Working copy invents an uncommitted Slice 2
  fs.writeFileSync(
    path.join(dir, '.spec', 'PROGRESS.md'),
    '# Progress\n- [ ] **Slice 1** `[GREEN][CORE / DATA]`: Committed slice — Target files: test.txt\n- [ ] **Slice 2** `[GREEN][CORE / DATA]`: Uncommitted slice — Target files: test.txt [IN_PROGRESS]\n'
  );
  fs.writeFileSync(path.join(dir, 'test.txt'), 'updated');

  assert.throws(
    () => finishSlice(dir, 'feat: finish uncommitted slice', { skipChecks: true, dashboardSync: fakeDashboardSync }),
    /Scope neutrality violation: Slice 2 does not exist in HEAD:\.spec\/PROGRESS\.md/
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('finishSlice single-commit auto-advance promotes next pending slice to [IN_PROGRESS]', () => {
  const dir = makeRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'scripts', 'referee.mjs'), '// referee');
  fs.writeFileSync(path.join(dir, '.spec', 'SESSION_HANDOFF.md'), '**Active Slice:** Slice 1\n**Verification Status:** pending\n');
  fs.writeFileSync(
    path.join(dir, '.spec', 'PROGRESS.md'),
    '# Progress\n' +
    '- [ ] **Slice 1: First** [IN_PROGRESS] Target files: a.txt | Coords: [110] | Verify: npm test\n' +
    '- [ ] **Slice 2: Second** [PENDING] Target files: b.txt | Coords: [110] | Verify: npm test\n' +
    '- [ ] **Slice 3: Third** Target files: c.txt | Coords: [110] | Verify: npm test\n'
  );
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a content');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b content');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c content');

  git('add', '-A');
  git('commit', '-m', 'init slices');

  // Modify a.txt for slice 1
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a updated');

  const res = finishSlice(dir, 'feat: finish slice 1 with auto-advance', { skipChecks: true, dashboardSync: fakeDashboardSync });
  assert.equal(res.success, true);
  assert.equal(res.sliceId, '1');
  assert.equal(res.nextSliceId, '2');

  // Verify PROGRESS.md in working tree & HEAD
  const progressText = fs.readFileSync(path.join(dir, '.spec', 'PROGRESS.md'), 'utf8');
  assert.match(progressText, /- \[x\] \*\*Slice 1: First\*\*/);
  assert.match(progressText, /- \[ \] \*\*Slice 2: Second\*\* \[IN_PROGRESS\]/);
  assert.match(progressText, /- \[ \] \*\*Slice 3: Third\*\*/);
  assert.doesNotMatch(progressText, /\*\*Slice 3: Third\*\* \[IN_PROGRESS\]/);

  // Check HEAD commit has both changes
  const headProgress = git('show', 'HEAD:.spec/PROGRESS.md');
  assert.match(headProgress, /- \[x\] \*\*Slice 1: First\*\*/);
  assert.match(headProgress, /- \[ \] \*\*Slice 2: Second\*\* \[IN_PROGRESS\]/);

  // Check SESSION_HANDOFF.md
  const handoffText = fs.readFileSync(path.join(dir, '.spec', 'SESSION_HANDOFF.md'), 'utf8');
  assert.match(handoffText, /\*\*Active Slice:\*\* Slice 2/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('finishSlice handles last slice completion without auto-advance', () => {
  const dir = makeRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'scripts', 'referee.mjs'), '// referee');
  fs.writeFileSync(path.join(dir, '.spec', 'SESSION_HANDOFF.md'), '**Active Slice:** Slice 1\n');
  fs.writeFileSync(
    path.join(dir, '.spec', 'PROGRESS.md'),
    '# Progress\n- [ ] **Slice 1: Final** [IN_PROGRESS] Target files: a.txt | Coords: [110] | Verify: npm test\n'
  );
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a content');

  git('add', '-A');
  git('commit', '-m', 'init last slice');

  fs.writeFileSync(path.join(dir, 'a.txt'), 'a finished');

  const res = finishSlice(dir, 'feat: finish final slice', { skipChecks: true, dashboardSync: fakeDashboardSync });
  assert.equal(res.success, true);
  assert.equal(res.sliceId, '1');
  assert.equal(res.nextSliceId, null);

  const progressText = fs.readFileSync(path.join(dir, '.spec', 'PROGRESS.md'), 'utf8');
  assert.match(progressText, /- \[x\] \*\*Slice 1: Final\*\*/);
  assert.doesNotMatch(progressText, /\[IN_PROGRESS\]/);

  const handoffText = fs.readFileSync(path.join(dir, '.spec', 'SESSION_HANDOFF.md'), 'utf8');
  assert.match(handoffText, /\*\*Active Slice:\*\* none/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('finishSlice git staging filters gitignored tracking files and succeeds', () => {
  const dir = makeRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'scripts', 'referee.mjs'), '// referee');
  fs.writeFileSync(path.join(dir, '.spec', 'SESSION_HANDOFF.md'), '**Active Slice:** Slice 1\n');
  fs.writeFileSync(
    path.join(dir, '.spec', 'PROGRESS.md'),
    '# Progress\n- [ ] **Slice 1** [IN_PROGRESS] Target files: a.txt | Coords: [110] | Verify: npm test\n'
  );
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a initial');

  // Gitignore tracking files
  fs.writeFileSync(path.join(dir, '.gitignore'), '.spec/.session-telemetry.json\n.spec/STATUS_BATCH.jsonl\n.spec/STATE.json\n');

  git('add', '-A');
  git('commit', '-m', 'init with gitignore');

  // Modify a.txt and write telemetry file that matches .gitignore
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a modified');
  fs.writeFileSync(path.join(dir, '.spec', '.session-telemetry.json'), JSON.stringify({ slicesCommitted: 0 }));

  const res = finishSlice(dir, 'feat: finish with ignored telemetry', { skipChecks: true, dashboardSync: fakeDashboardSync });
  assert.equal(res.success, true);
  assert.equal(res.sliceId, '1');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseActiveTargets extracts targets using shared slice parser', () => {
  const line = '- [ ] **Slice 6.1: Test** [IN_PROGRESS] Target files: `foo.js`, `[NEW] bar.js`, `[DELETE] baz.js` | Coords: [110] | Verify: npm test';
  const targets = parseActiveTargets(line);
  assert.deepEqual(targets, ['foo.js', 'bar.js', 'baz.js']);
});

test('startSlice anchors the first pending slice or specified slice in HEAD', () => {
  const dir = makeRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.spec', 'PROGRESS.md'),
    '# Progress\n' +
    '- [ ] **Slice 6.1: First Slice** [PENDING] Target files: a.txt | Coords: [110] | Verify: npm test\n' +
    '- [ ] **Slice 6.2: Second Slice** Target files: b.txt | Coords: [110] | Verify: npm test\n'
  );
  git('add', '-A');
  git('commit', '-m', 'plan milestone 6');

  // Anchor first pending slice
  const res = startSlice(dir, '6.1');
  assert.equal(res.success, true);
  assert.equal(res.sliceId, '6.1');
  assert.equal(res.sliceLabel, 'Slice 6.1');
  assert.equal(res.commitMsg, 'docs(spec): anchor Slice 6.1 [IN_PROGRESS]');

  // Verify PROGRESS.md was updated
  const progressText = fs.readFileSync(path.join(dir, '.spec', 'PROGRESS.md'), 'utf8');
  assert.match(progressText, /- \[ \] \*\*Slice 6.1: First Slice\*\* \[IN_PROGRESS\]/);

  // Verify HEAD commit
  const headCommit = git('log', '-1', '--pretty=%B');
  assert.match(headCommit, /docs\(spec\): anchor Slice 6.1 \[IN_PROGRESS\]/);

  // Calling startSlice again while a slice is [IN_PROGRESS] throws
  assert.throws(
    () => startSlice(dir, '6.2'),
    /is already \[IN_PROGRESS\]/
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('finishSlice stamps a Dashboard-Sync trailer after STATE.json records the slice', () => {
  const dir = makeRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'scripts', 'referee.mjs'), '// referee');
  fs.writeFileSync(path.join(dir, '.spec', 'PROGRESS.md'), '# Progress\n- [ ] **Slice 1** `[GREEN][CORE / DATA]`: Test — Target files: test.txt [IN_PROGRESS]\n');
  fs.writeFileSync(path.join(dir, 'test.txt'), 'content');
  git('add', '-A');
  git('commit', '-m', 'init');
  fs.writeFileSync(path.join(dir, 'test.txt'), 'updated');

  finishSlice(dir, 'feat: finish slice 1', { skipChecks: true, dashboardSync: fakeDashboardSync });
  const message = git('log', '-1', '--format=%B');
  assert.equal(hasDashboardTrailer(message), true);
  assert.match(message, /Dashboard-Sync: Slice 1 Claimed/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('finishSlice refuses to commit when the dashboard sync fails, and keeps [IN_PROGRESS]', () => {
  const dir = makeRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'scripts', 'referee.mjs'), '// referee');
  fs.writeFileSync(path.join(dir, '.spec', 'PROGRESS.md'), '# Progress\n- [ ] **Slice 1** `[GREEN][CORE / DATA]`: Test — Target files: test.txt [IN_PROGRESS]\n');
  fs.writeFileSync(path.join(dir, 'test.txt'), 'content');
  git('add', '-A');
  git('commit', '-m', 'init');
  const headBefore = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 'test.txt'), 'updated');

  const failingSync = () => { throw new Error('Dashboard sync failed: simulated'); };
  assert.throws(
    () => finishSlice(dir, 'feat: finish slice 1', { skipChecks: true, dashboardSync: failingSync }),
    /Dashboard sync failed/
  );
  assert.equal(git('rev-parse', 'HEAD'), headBefore);
  const progressText = fs.readFileSync(path.join(dir, '.spec', 'PROGRESS.md'), 'utf8');
  assert.match(progressText, /\[IN_PROGRESS\]/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('finishSlice fails with a clear error when bin/update-state.mjs is absent (no silent skip)', () => {
  const dir = makeRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'scripts', 'referee.mjs'), '// referee');
  fs.writeFileSync(path.join(dir, '.spec', 'PROGRESS.md'), '# Progress\n- [ ] **Slice 1** `[GREEN][CORE / DATA]`: Test — Target files: test.txt [IN_PROGRESS]\n');
  fs.writeFileSync(path.join(dir, 'test.txt'), 'content');
  git('add', '-A');
  git('commit', '-m', 'init');
  fs.writeFileSync(path.join(dir, 'test.txt'), 'updated');

  assert.throws(
    () => finishSlice(dir, 'feat: finish slice 1', { skipChecks: true }),
    /bin\/update-state\.mjs not found/
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeFinishableRepo() {
  const dir = makeRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'scripts', 'referee.mjs'), '// referee');
  fs.writeFileSync(path.join(dir, '.spec', 'PROGRESS.md'), '# Progress\n- [ ] **Slice 1** `[GREEN][CORE / DATA]`: Test — Target files: test.txt [IN_PROGRESS]\n');
  fs.writeFileSync(path.join(dir, 'test.txt'), 'content');
  git('add', '-A');
  git('commit', '-m', 'init');
  fs.writeFileSync(path.join(dir, 'test.txt'), 'updated');
  return dir;
}

test('finishSlice reports a passing auto-verify result', () => {
  const dir = makeFinishableRepo();
  const result = finishSlice(dir, 'feat: finish slice 1', {
    skipChecks: true,
    dashboardSync: fakeDashboardSync,
    verify: () => ({ ran: true, passed: true }),
  });
  assert.equal(result.verification.passed, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('finishSlice keeps the commit when auto-verify is skipped or fails', () => {
  const dir = makeFinishableRepo();
  const result = finishSlice(dir, 'feat: finish slice 1', {
    skipChecks: true,
    dashboardSync: fakeDashboardSync,
    verify: () => ({ ran: false, reason: 'x' }),
  });
  assert.equal(result.success, true);
  const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: dir, encoding: 'utf8' }).trim();
  assert.equal(subject, 'feat: finish slice 1');
  fs.rmSync(dir, { recursive: true, force: true });
});
