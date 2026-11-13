import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { finishSlice, restampSlice, parseActiveTargets, bootstrapException, autoVerify, CI_VERIFIED_REASON } from './finish-slice.mjs';
import { startSlice, startFromScope, startAdhoc } from './start-slice.mjs';
import { verifyHeadTrust } from './referee.mjs';
import { appendCall, readCalls } from './lib/telemetry.mjs';

// Repo with committed harness stubs, a scope doc under .spec/, and a PROGRESS.md holding `progressBody`.
function makeScopeRepo(progressBody) {
  const dir = makeRepo();
  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.harness', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'scripts', 'referee.mjs'), '// referee');
  fs.writeFileSync(path.join(dir, '.spec', 'SESSION_HANDOFF.md'), '**Active Slice:** none\n**Verification Status:** pending\n');
  fs.writeFileSync(path.join(dir, '.spec', 'scope.md'), '# Scope\n\n## Slice 4\nSettled in review.\n');
  fs.writeFileSync(path.join(dir, '.spec', 'PROGRESS.md'), `# Progress\n${progressBody}`);
  fs.writeFileSync(path.join(dir, 'test.txt'), 'content');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

test('a scope-bypass anchor copies Spec-Bypass trailers onto the finish commit', () => {
  const dir = makeScopeRepo('');
  startFromScope(dir, { doc: '.spec/scope.md', slice: '4', targets: 'test.txt', reason: 'settled in review' });
  fs.writeFileSync(path.join(dir, 'test.txt'), 'changed');
  finishSlice(dir, 'feat: finish slice 4', { skipChecks: true, verify: () => ({ ran: false, reason: 'test' }) });

  const body = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' });
  assert.match(body, /^Spec-Bypass: \.spec\/scope\.md$/m);
  assert.match(body, /^Spec-Bypass-Reason: settled in review$/m);
  assert.match(body, /^Referee-Verdict: VERIFIED$/m);
});

test('an on-the-fly anchor copies Spec-Bypass trailers onto the finish commit and closes the line', () => {
  const dir = makeScopeRepo('- [x] **Slice 3.1: Old** Target files: test.txt\n');
  startAdhoc(dir, {
    title: 'Fix', tag: 'core', targets: 'test.txt', verify: 'node --test', issue: '77', reason: 'bug blocks work',
    originUrl: 'git@github.com:o/claude-harness-hub.git', lsRemote: () => '', mainProgress: null,
  });
  fs.writeFileSync(path.join(dir, 'test.txt'), 'changed');
  finishSlice(dir, 'fix: finish slice 3.2', { skipChecks: true, verify: () => ({ ran: false, reason: 'test' }) });

  const body = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' });
  assert.match(body, /^Spec-Bypass: on-the-fly Issue #77$/m);
  assert.match(body, /^Spec-Bypass-Reason: bug blocks work$/m);
  const line = fs.readFileSync(path.join(dir, '.spec', 'PROGRESS.md'), 'utf8').split('\n').find((l) => /Slice 3\.2:/.test(l));
  assert.match(line, /^- \[x\]/);
  assert.doesNotMatch(line, /\[IN_PROGRESS\]/);
});

test('a normal anchor produces no Spec-Bypass trailers on the finish commit', () => {
  const dir = makeScopeRepo('- [ ] **Slice 5: Normal** Target files: test.txt\n');
  startSlice(dir, '5');
  fs.writeFileSync(path.join(dir, 'test.txt'), 'changed');
  finishSlice(dir, 'feat: finish slice 5', { skipChecks: true, verify: () => ({ ran: false, reason: 'test' }) });

  const body = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' });
  assert.doesNotMatch(body, /Spec-Bypass/);
  assert.match(body, /^Referee-Verdict: VERIFIED$/m);
});

test('bootstrap exception is allowed only for slices 10.2 and 5.1 with a stated reason', () => {
  assert.deepEqual(bootstrapException('10.2', 'telemetry hook not yet live'), {
    allowed: true, reason: 'telemetry hook not yet live'
  });
  assert.deepEqual(bootstrapException('5.1', 'stamp of a merged slice; dispatch telemetry not recorded in cloud session'), {
    allowed: true, reason: 'stamp of a merged slice; dispatch telemetry not recorded in cloud session'
  });
  assert.equal(bootstrapException('5.1', '   ').allowed, false);
  assert.equal(bootstrapException('10.2', undefined).allowed, false);
  assert.equal(bootstrapException('5.2', 'any reason').allowed, false);
  assert.equal(bootstrapException('10.3', 'any reason').allowed, false);
  assert.equal(bootstrapException('9.9', 'any reason').allowed, false);
});

// Records one subagent dispatch for the slice, as the PostToolUse telemetry hook would.
function seedDispatch(dir, sliceId = '1') {
  appendCall(dir, { ts: new Date().toISOString(), tool: 'Agent', agentType: 'harness:gf-coder', role: 'goldfish', filePath: '', slice: sliceId });
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
  seedDispatch(dir);

  const result = finishSlice(dir, 'feat: finish slice 1', { skipChecks: true });
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

test('finishSlice warns and records Scope-Widened when a file outside Target files is modified', () => {
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

  finishSlice(dir, 'feat: finish slice 1', { skipChecks: true, verify: () => ({ ran: false, reason: 'test' }) });
  const body = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' });
  assert.match(body, /^Scope-Widened: unrelated\.txt$/m);
  assert.match(body, /^Referee-Verdict: VERIFIED$/m);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).trim(), '');

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
    () => finishSlice(dir, 'feat: finish slice 1', { skipChecks: false }),
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

  // Scope comes from HEAD, so widened.txt is out of scope: it is committed but listed in Scope-Widened
  finishSlice(dir, 'feat: attempt widened slice', { skipChecks: true, verify: () => ({ ran: false, reason: 'test' }) });
  const body = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' });
  assert.match(body, /^Scope-Widened: widened\.txt$/m);

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
    () => finishSlice(dir, 'feat: finish uncommitted slice', { skipChecks: true }),
    /Scope neutrality violation: Slice 2 does not exist in HEAD:\.spec\/PROGRESS\.md/
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('finishSlice does not auto-advance: next slice stays [PENDING] and no slice is [IN_PROGRESS]', () => {
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
  seedDispatch(dir);

  const res = finishSlice(dir, 'feat: finish slice 1 without auto-advance', { skipChecks: true });
  assert.equal(res.success, true);
  assert.equal(res.sliceId, '1');
  assert.equal(res.nextSliceId, null);

  // Verify PROGRESS.md in working tree & HEAD: slice 1 done, nothing promoted
  const progressText = fs.readFileSync(path.join(dir, '.spec', 'PROGRESS.md'), 'utf8');
  assert.match(progressText, /- \[x\] \*\*Slice 1: First\*\*/);
  assert.match(progressText, /- \[ \] \*\*Slice 2: Second\*\* \[PENDING\]/);
  assert.match(progressText, /- \[ \] \*\*Slice 3: Third\*\*/);
  assert.doesNotMatch(progressText, /\[IN_PROGRESS\]/);

  const headProgress = git('show', 'HEAD:.spec/PROGRESS.md');
  assert.match(headProgress, /- \[x\] \*\*Slice 1: First\*\*/);
  assert.match(headProgress, /- \[ \] \*\*Slice 2: Second\*\* \[PENDING\]/);
  assert.doesNotMatch(headProgress, /\[IN_PROGRESS\]/);

  // SESSION_HANDOFF.md must not name a next slice as active
  const handoffText = fs.readFileSync(path.join(dir, '.spec', 'SESSION_HANDOFF.md'), 'utf8');
  assert.match(handoffText, /\*\*Active Slice:\*\* none/);
  assert.doesNotMatch(handoffText, /\*\*Active Slice:\*\* Slice 2/);

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
  seedDispatch(dir);

  const res = finishSlice(dir, 'feat: finish final slice', { skipChecks: true });
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
  seedDispatch(dir);

  const res = finishSlice(dir, 'feat: finish with ignored telemetry', { skipChecks: true });
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

test('finishSlice logs that the dispatch gate is disabled when no subagent dispatch is recorded', () => {
  const dir = makeFinishableRepo();
  const logged = [];
  const originalLog = console.log;
  console.log = (...args) => { logged.push(args.join(' ')); };
  try {
    finishSlice(dir, 'feat: finish slice 1', { skipChecks: true });
  } finally {
    console.log = originalLog;
  }
  assert.ok(
    logged.some((line) => line.includes('Telemetry dispatch gate disabled (owner decision 2026-11-06). See .spec/post-mortems/dispatch-telemetry-2026-11-06.md')),
    `expected disabled-gate message, got: ${logged.join(' | ')}`
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('finishSlice warns and stamps Main-Thread-Writes when the main thread wrote a source file', () => {
  const dir = makeFinishableRepo();
  seedDispatch(dir);
  appendCall(dir, { ts: new Date().toISOString(), tool: 'Edit', agentType: '', role: 'coordinator', filePath: 'test.txt', slice: '1' });
  const res = finishSlice(dir, 'feat: finish slice 1', { skipChecks: true, verify: () => ({ ran: false, reason: 'test' }) });
  assert.equal(res.success, true);
  const body = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' });
  assert.match(body, /^Main-Thread-Writes: 1 \(test\.txt\)$/m);
  assert.match(body, /^Telemetry-Main-Source-Writes: 1$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('finishSlice passes with one dispatch and no main writes, and stamps telemetry trailers', () => {
  const dir = makeFinishableRepo();
  seedDispatch(dir);
  const res = finishSlice(dir, 'feat: finish slice 1', { skipChecks: true });
  assert.equal(res.success, true);
  assert.equal(readCalls(dir).length, 1);
  const body = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' });
  assert.match(body, /^Telemetry-Dispatches: 1$/m);
  assert.match(body, /^Telemetry-Main-Source-Writes: 0$/m);
  assert.match(body, /^Referee-Verdict: VERIFIED$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('finishSlice reports a passing auto-verify result', () => {
  const dir = makeFinishableRepo();
  seedDispatch(dir);
  const result = finishSlice(dir, 'feat: finish slice 1', {
    skipChecks: true,
    verify: () => ({ ran: true, passed: true }),
  });
  assert.equal(result.verification.passed, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

// Runs autoVerify with a fake HOME (no verify-secret file) and the given env, restoring both afterwards.
function withSecretEnv({ secret, home }, fn) {
  const saved = { HOME: process.env.HOME, HARNESS_VERIFY_SECRET: process.env.HARNESS_VERIFY_SECRET };
  process.env.HOME = home;
  if (secret === undefined) delete process.env.HARNESS_VERIFY_SECRET;
  else process.env.HARNESS_VERIFY_SECRET = secret;
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function makeVerifyRoot(scriptBody) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-slice-verify-'));
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'verify-slice.sh'), scriptBody);
  return root;
}

test('autoVerify without a verify secret reports CI as the verifier and never runs verify-slice.sh', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-slice-home-'));
  const marker = path.join(home, 'script-ran');
  const root = makeVerifyRoot(`#!/usr/bin/env bash\ntouch "${marker}"\n`);
  const result = withSecretEnv({ secret: undefined, home }, () => autoVerify(root));
  assert.equal(result.ran, false);
  assert.equal(result.verifier, 'ci');
  assert.equal(result.reason, CI_VERIFIED_REASON);
  assert.doesNotMatch(result.reason, /no verify secret/);
  assert.equal(fs.existsSync(marker), false);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

test('finishSlice without a verify secret records CI-verified and does not fail', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-slice-home-'));
  const dir = makeFinishableRepo();
  seedDispatch(dir);
  const result = withSecretEnv({ secret: undefined, home }, () =>
    finishSlice(dir, 'feat: finish slice 1', { skipChecks: true })
  );
  assert.equal(result.success, true);
  assert.equal(result.verification.ran, false);
  assert.equal(result.verification.verifier, 'ci');
  assert.equal(result.verification.reason, CI_VERIFIED_REASON);
  const body = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' });
  assert.match(body, /^Referee-Verdict: VERIFIED$/m);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

test('autoVerify with a verify secret present runs verify-slice.sh with that secret', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-slice-home-'));
  const root = makeVerifyRoot('#!/usr/bin/env bash\n[ "$HARNESS_VERIFY_SECRET" = "test-secret" ] || exit 1\n');
  const passed = withSecretEnv({ secret: 'test-secret', home }, () => autoVerify(root));
  assert.deepEqual(passed, { ran: true, passed: true });
  fs.writeFileSync(path.join(root, 'bin', 'verify-slice.sh'), '#!/usr/bin/env bash\nexit 1\n');
  const failed = withSecretEnv({ secret: 'test-secret', home }, () => autoVerify(root));
  assert.equal(failed.ran, true);
  assert.equal(failed.passed, false);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

test('finishSlice keeps the commit when auto-verify is skipped or fails', () => {
  const dir = makeFinishableRepo();
  seedDispatch(dir);
  const result = finishSlice(dir, 'feat: finish slice 1', {
    skipChecks: true,
    verify: () => ({ ran: false, reason: 'x' }),
  });
  assert.equal(result.success, true);
  const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: dir, encoding: 'utf8' }).trim();
  assert.equal(subject, 'feat: finish slice 1');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('finishSlice writes - [x] before **Slice when the active line has no checkbox', () => {
  const dir = makeScopeRepo('- **Slice 7** `[GREEN]`: No box — Target files: test.txt [IN_PROGRESS]\n');
  fs.writeFileSync(path.join(dir, 'test.txt'), 'changed');
  finishSlice(dir, 'feat: finish slice 7', { skipChecks: true, verify: () => ({ ran: false, reason: 'test' }) });
  const text = fs.readFileSync(path.join(dir, '.spec', 'PROGRESS.md'), 'utf8');
  assert.match(text, /^- \[x\] \*\*Slice 7\*\*/m);
  assert.doesNotMatch(text, /\[IN_PROGRESS\]/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--restamp re-stamps HEAD after an unstamped commit, and verifyHeadTrust passes', () => {
  const dir = makeScopeRepo('- [ ] **Slice 5: Normal** Target files: test.txt\n');
  startSlice(dir, '5');
  fs.writeFileSync(path.join(dir, 'test.txt'), 'changed');
  finishSlice(dir, 'feat: finish Slice 5', { skipChecks: true, verify: () => ({ ran: false, reason: 'test' }) });
  // An unstamped commit on top (like a merge of main) invalidates the stamp
  fs.writeFileSync(path.join(dir, 'other.txt'), 'from main');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '-m', 'merge main'], { cwd: dir, stdio: 'ignore' });
  const referee = path.join(dir, '.harness', 'scripts', 'referee.mjs');
  assert.equal(verifyHeadTrust(dir, referee).trusted, false);

  const res = restampSlice(dir, { skipChecks: true });
  assert.equal(res.sliceId, '5');
  const body = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' });
  assert.match(body, /^Referee-Verdict: VERIFIED$/m);
  assert.equal(verifyHeadTrust(dir, referee).trusted, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--restamp refuses and adds no commit when tests fail', () => {
  const dir = makeScopeRepo('- [ ] **Slice 5: Normal** Target files: test.txt\n');
  startSlice(dir, '5');
  fs.writeFileSync(path.join(dir, 'test.txt'), 'changed');
  finishSlice(dir, 'feat: finish Slice 5', { skipChecks: true, verify: () => ({ ran: false, reason: 'test' }) });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'exit 1' } }));
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '-m', 'add failing test'], { cwd: dir, stdio: 'ignore' });
  const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  assert.throws(() => restampSlice(dir), /Verification tests failed/);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }), before);
  fs.rmSync(dir, { recursive: true, force: true });
});
