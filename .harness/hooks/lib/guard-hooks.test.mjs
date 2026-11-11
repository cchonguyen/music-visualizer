// End-to-end checks: run the real guard hooks against throwaway git repos, the way Claude Code runs them.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hooksDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = path.join(hooksDir, 'pre-tool-guard.mjs');
const BASH = path.join(hooksDir, 'bash-guard.mjs');
const dirs = [];

function makeRepo({ origin = 'https://github.com/example/my-spoke.git', files = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  dirs.push(dir);
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('remote', 'add', 'origin', origin);
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'base', '--allow-empty');
  return dir;
}

// Fixture repos run the live doctor gate too. Give each one a DOCTOR_PASS for its own HEAD so the
// existing guard rules are what each test exercises, not the doctor.
function doctorEnv(dir) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const file = path.join(os.tmpdir(), `doctor-pass-${path.basename(dir)}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ status: 'DOCTOR_PASS', head, failing: [] }));
  dirs.push(file);
  return { HARNESS_DOCTOR_STATE: file };
}

const SLICE = (targets, tag = 'YELLOW', type = 'CORE / DATA') =>
  `- [ ] **Slice 3.3** [IN_PROGRESS] \`[${tag}][${type}]\`: guard — Target files: ${targets}\n`;

function runHook(script, dir, event) {
  const res = spawnSync(process.execPath, [script], {
    cwd: dir,
    input: JSON.stringify(event),
    encoding: 'utf8',
    env: { ...process.env, ...doctorEnv(dir), CLAUDE_PROJECT_DIR: dir },
  });
  return { status: res.status, stderr: res.stderr };
}

const edit = (dir, rel, extra = {}) => ({
  session_id: 's1', tool_name: 'Edit', tool_input: { file_path: path.join(dir, rel), old_string: 'a', new_string: 'b', ...extra },
});

test('manager mode with no active slice warns but allows source edits (PLAN LOCK WARN)', () => {
  const dir = makeRepo({ files: { '.spec/harness.json': '{"workMode":"manager"}\n', '.spec/PROGRESS.md': '# Progress\n', 'src/app.js': 'a\n' } });
  const r = runHook(GUARD, dir, { ...edit(dir, 'src/app.js'), agent_type: 'gf-coder' });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /WARN: PLAN LOCK/);
  const events = fs.readFileSync(path.join(dir, '.spec', '.events', 's1.jsonl'), 'utf8');
  assert.match(events, /"kind":"plan_lock_warn"/);
});

test('a new active slice resets the coordinator edit budget (regression: slice name was never read)', () => {
  const dir = makeRepo({
    files: {
      '.spec/harness.json': '{"workMode":"manager"}\n',
      '.spec/PROGRESS.md': SLICE('src/app.js'),
      'src/app.js': 'a\n',
      '.spec/.session-telemetry.json': JSON.stringify({ sessionId: 's1', currentSlice: '3.2', coordinator_edits: 1 }),
    },
  });
  assert.equal(runHook(GUARD, dir, { ...edit(dir, 'src/app.js'), agent_type: 'gf-coder' }).status, 0);
});

test('manager mode with the file in an active slice is allowed', () => {
  const dir = makeRepo({
    files: { '.spec/harness.json': '{"workMode":"manager"}\n', '.spec/PROGRESS.md': SLICE('src/app.js'), 'src/app.js': 'a\n' },
  });
  // Coordinator counters (coordinator_edits) are only written for the coordinator role. gf-coder resolves to goldfish.
  assert.equal(runHook(GUARD, dir, { ...edit(dir, 'src/app.js'), agent_type: 'coordinator' }).status, 0);
  // The guard's telemetry write is atomic: the file parses after the run.
  const telemPath = path.join(dir, '.spec', '.session-telemetry.json');
  assert.equal(fs.existsSync(telemPath), true);
  assert.equal(JSON.parse(fs.readFileSync(telemPath, 'utf8')).coordinator_edits, 1);
});

test('vibe mode (no harness.json) keeps the v2.2 behavior: no plan lock', () => {
  const dir = makeRepo({ files: { '.spec/PROGRESS.md': '# Progress\n', 'src/app.js': 'a\n' } });
  assert.equal(runHook(GUARD, dir, { ...edit(dir, 'src/app.js'), agent_type: 'gf-coder' }).status, 0);
});

test('spoke engine files are locked even in an active slice', () => {
  const dir = makeRepo({ files: { '.spec/PROGRESS.md': SLICE('.harness/hooks/'), '.harness/hooks/x.mjs': 'x\n' } });
  const r = runHook(GUARD, dir, { ...edit(dir, '.harness/hooks/x.mjs'), agent_type: 'gf-coder' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ENGINE LOCK/);
});

test('harness.json cannot be edited by the agent, which would switch the plan lock off', () => {
  const dir = makeRepo({ files: { '.spec/harness.json': '{"workMode":"manager"}\n', '.spec/PROGRESS.md': SLICE('src/') } });
  assert.equal(runHook(GUARD, dir, edit(dir, '.spec/harness.json')).status, 2);
});

test('spoke rules file stays editable', () => {
  const dir = makeRepo({ files: { '.spec/harness.json': '{"workMode":"manager"}\n', '.spec/PROGRESS.md': '# Progress\n', '.claude/project-rules.md': '# rules\n' } });
  assert.equal(runHook(GUARD, dir, { ...edit(dir, '.claude/project-rules.md'), agent_type: 'coordinator' }).status, 0);
});

test('AGENTS.md: text outside the harness block is editable, the block is locked', () => {
  const agents = 'My notes\n<!-- >>> harness >>> -->\nrule\n<!-- <<< harness <<< -->\n';
  const dir = makeRepo({ files: { '.spec/PROGRESS.md': SLICE('AGENTS.md'), 'AGENTS.md': agents } });
  const outside = runHook(GUARD, dir, { ...edit(dir, 'AGENTS.md', { old_string: 'My notes', new_string: 'My own notes' }), agent_type: 'gf-coder' });
  assert.equal(outside.status, 0);
  const inside = runHook(GUARD, dir, { ...edit(dir, 'AGENTS.md', { old_string: 'rule', new_string: 'changed rule' }), agent_type: 'gf-coder' });
  assert.equal(inside.status, 2);
  assert.match(inside.stderr, /AGENTS\.md is hub-owned/);
});

test('the colour tag of an active slice may change (colour lock removed)', () => {
  const dir = makeRepo({ files: { '.spec/PROGRESS.md': SLICE('src/', 'GREEN', 'UI / VISUAL') } });
  assert.equal(runHook(GUARD, dir, edit(dir, '.spec/PROGRESS.md', { old_string: '[GREEN]', new_string: '[RED]' })).status, 0);
});

test('an edit outside the active slice Target files warns and is allowed (scope lock warn)', () => {
  const dir = makeRepo({ files: { '.spec/PROGRESS.md': SLICE('src/app.js'), 'src/other.js': 'a\n' } });
  const r = runHook(GUARD, dir, { ...edit(dir, 'src/other.js'), agent_type: 'gf-coder' });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /WARN: SCOPE LOCK/);
  const events = fs.readFileSync(path.join(dir, '.spec', '.events', 's1.jsonl'), 'utf8');
  assert.match(events, /"kind":"scope_lock_warn"/);
});

test('a file in another attached repo is judged by that repo, not the session repo', () => {
  const spoke = makeRepo({ files: { '.spec/harness.json': '{"workMode":"manager"}\n', '.spec/PROGRESS.md': '# Progress\n' } });
  const other = makeRepo({ origin: 'https://github.com/example/other.git', files: { '.spec/PROGRESS.md': '# Progress\n', 'lib/x.js': 'x\n' } });
  // The session's first repo is in manager mode with no task, but the edited file lives in a vibe-mode repo
  assert.equal(runHook(GUARD, spoke, { ...edit(spoke, path.relative(spoke, path.join(other, 'lib/x.js'))), agent_type: 'gf-coder' }).status, 0);
});

test('bash guard blocks a redirect into an engine path in a spoke', () => {
  const dir = makeRepo({ files: { '.claude/settings.json': '{}\n' } });
  const r = spawnSync(process.execPath, [BASH], {
    cwd: dir, input: JSON.stringify({ agent_type: 'gf-coder', tool_input: { command: 'echo {} > .claude/settings.json' } }),
    encoding: 'utf8', env: { ...process.env, ...doctorEnv(dir), CLAUDE_PROJECT_DIR: dir },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ENGINE LOCK/);
});

test('bash guard lets reads and the restore command through, and ignores the hub', () => {
  const dir = makeRepo({ files: { '.claude/settings.json': '{}\n' } });
  const run = (repoDir, command, agent_type) => spawnSync(process.execPath, [BASH], {
    cwd: repoDir, input: JSON.stringify({ agent_type, tool_input: { command } }), encoding: 'utf8',
    env: { ...process.env, ...doctorEnv(repoDir), CLAUDE_PROJECT_DIR: repoDir },
  }).status;
  assert.equal(run(dir, 'cat .claude/settings.json'), 0);
  assert.equal(run(dir, 'node .harness/hooks/pre-tool-guard.mjs --restore'), 0);
  const hub = makeRepo({ origin: 'https://github.com/cchonguyen/claude-harness-hub.git', files: { '.harness/x.mjs': 'x\n' } });
  assert.equal(run(hub, 'echo x > .harness/x.mjs', 'gf-coder'), 0);
});

test('SCOUT level routing maps facts deterministically to levels and agents', () => {
  const dir = makeRepo();
  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  const scoutPath = path.join(dir, '.spec', 'SCOUT.md');
  const EVAL = path.join(hooksDir, '..', 'scripts', 'evaluate-upshift.mjs');

  // Level 1: <3 files, no contract change
  fs.writeFileSync(scoutPath, 'Scout-Level: 1\nFiles-Touched: 2\nContract-Change: no\nCross-Module: no\n');
  const r1 = spawnSync(process.execPath, [EVAL, 'spec'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, ...doctorEnv(dir), CLAUDE_PROJECT_DIR: dir },
  });
  assert.equal(r1.status, 0);
  assert.match(r1.stdout, /Level 1/);

  // Level 3: Cross module -> Opus
  fs.writeFileSync(scoutPath, 'Files-Touched: 8\nContract-Change: yes\nCross-Module: yes\n');
  const r3 = spawnSync(process.execPath, [EVAL, 'spec'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, ...doctorEnv(dir), CLAUDE_PROJECT_DIR: dir },
  });
  assert.equal(r3.status, 0);
  assert.match(r3.stdout, /architect-opus/);
});

test('session-start resets session telemetry and post-tool-scrub tracks mutating calls', () => {
  const dir = makeRepo({ files: { '.spec/PROGRESS.md': SLICE('src/app.js') } });
  const START = path.join(hooksDir, 'session-start.mjs');
  const SCRUB = path.join(hooksDir, 'post-tool-scrub.mjs');
  
  // 1. Session start initializes telemetry
  const rStart = spawnSync(process.execPath, [START], {
    cwd: dir, input: JSON.stringify({ session_id: 'test-sess' }), encoding: 'utf8',
    env: { ...process.env, ...doctorEnv(dir), CLAUDE_PROJECT_DIR: dir },
  });
  assert.equal(rStart.status, 0);
  const telemPath = path.join(dir, '.spec', '.session-telemetry.json');
  assert.equal(fs.existsSync(telemPath), true);
  const telem = JSON.parse(fs.readFileSync(telemPath, 'utf8'));
  assert.equal(telem.sessionId, 'test-sess');
  assert.equal(telem.totalToolCalls, 0);

  // 2. Post tool scrub increments telemetry and mutating calls
  const rScrub = spawnSync(process.execPath, [SCRUB], {
    cwd: dir,
    input: JSON.stringify({
      session_id: 'test-sess',
      tool_name: 'Edit',
      tool_input: { file_path: path.join(dir, 'src/app.js') },
      tool_response: { stdout: 'ok' }
    }),
    encoding: 'utf8',
    env: { ...process.env, ...doctorEnv(dir), CLAUDE_PROJECT_DIR: dir },
  });
  assert.equal(rScrub.status, 0);
  const updated = JSON.parse(fs.readFileSync(telemPath, 'utf8'));
  assert.equal(updated.totalToolCalls, 1);
  assert.equal(updated.mutatingCallsOnSlice, 1);
  assert.equal(updated.currentSlice, '3.3');
});

test('pre-tool-guard no longer locks architect-opus dispatch (upshift lock removed)', () => {
  const dir = makeRepo();
  assert.equal(runHook(GUARD, dir, { tool_name: 'Agent', tool_input: { subagent_type: 'architect-opus' } }).status, 0);
});

test('main-thread Bash outside the allow-list is refused; the same command from a subagent is not', () => {
  const dir = makeRepo({ files: { 'src/app.js': 'a\n' } });
  const run = (event) => spawnSync(process.execPath, [BASH], {
    cwd: dir, input: JSON.stringify(event), encoding: 'utf8',
    env: { ...process.env, ...doctorEnv(dir), CLAUDE_PROJECT_DIR: dir },
  });
  const command = 'npm install left-pad';
  const main = run({ tool_name: 'Bash', tool_input: { command } });
  assert.equal(main.status, 0, main.stderr);
  assert.match(main.stderr, /WARN:/);
  const eventsDir = path.join(dir, '.spec', '.events');
  const mainEvents = fs.readdirSync(eventsDir).flatMap((f) => fs.readFileSync(path.join(eventsDir, f), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  assert.ok(mainEvents.some((e) => e.kind === 'main_thread_warn'));
  const sub = run({ agent_type: 'gf-coder', tool_name: 'Bash', tool_input: { command } });
  assert.equal(sub.status, 0);
});

test('main-thread Edit outside .spec is refused; the same edit from a subagent is not', () => {
  const dir = makeRepo({ files: { 'src/app.js': 'a\n' } });
  const main = runHook(GUARD, dir, edit(dir, 'src/app.js'));
  assert.equal(main.status, 0, main.stderr);
  assert.match(main.stderr, /WARN:/);
  const mainEvents = fs.readFileSync(path.join(dir, '.spec', '.events', 's1.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(mainEvents.some((e) => e.kind === 'main_thread_warn'));
  const sub = runHook(GUARD, dir, { ...edit(dir, 'src/app.js'), agent_type: 'gf-coder' });
  assert.equal(sub.status, 0);
});

after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });

test('a stale doctor state warns and logs doctor_stale but never refuses the edit', () => {
  const dir = makeRepo({ files: { 'src/app.js': 'a\n' } });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const file = path.join(os.tmpdir(), `doctor-fail-${path.basename(dir)}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ status: 'DOCTOR_FAIL', head, failing: ['gf-coder-registered'] }));
  const res = spawnSync(process.execPath, [GUARD], {
    cwd: dir,
    input: JSON.stringify({ ...edit(dir, 'src/app.js'), agent_type: 'gf-coder' }),
    encoding: 'utf8',
    env: { ...process.env, HARNESS_DOCTOR_STATE: file, CLAUDE_PROJECT_DIR: dir },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /doctor not current for this HEAD/);
  const events = fs.readFileSync(path.join(dir, '.spec', '.events', 's1.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.kind === 'doctor_stale'));
  fs.rmSync(file, { force: true });
});

test('a coordinator edit over the fast-path budget warns, logs fast_path_warn and proceeds (exit 0)', () => {
  const dir = makeRepo({
    files: {
      '.spec/harness.json': '{"workMode":"manager"}\n',
      '.spec/PROGRESS.md': SLICE('src/app.js'),
      'src/app.js': 'a\n',
      '.spec/.session-telemetry.json': JSON.stringify({ sessionId: 's1', currentSlice: '3.3', coordinator_edits: 1 }),
    },
  });
  const r = runHook(GUARD, dir, { ...edit(dir, 'src/app.js'), agent_type: 'coordinator' });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /WARN: FAST-PATH BUDGET EXCEEDED/);
  const events = fs.readFileSync(path.join(dir, '.spec', '.events', 's1.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.kind === 'fast_path_warn' && e.source === 'pre-tool-guard'));
});

test('bash-guard warn events carry the session_id and land in that session file', () => {
  const dir = makeRepo({ files: { 'src/app.js': 'a\n' } });
  const res = spawnSync(process.execPath, [BASH], {
    cwd: dir,
    input: JSON.stringify({ session_id: 'sess-bash-14', tool_name: 'Bash', tool_input: { command: 'npm install left-pad' } }),
    encoding: 'utf8',
    env: { ...process.env, ...doctorEnv(dir), CLAUDE_PROJECT_DIR: dir },
  });
  assert.equal(res.status, 0, res.stderr);
  const file = path.join(dir, '.spec', '.events', 'sess-bash-14.jsonl');
  assert.equal(fs.existsSync(file), true);
  const events = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const warn = events.find((e) => e.kind === 'main_thread_warn');
  assert.ok(warn, 'main_thread_warn event written');
  assert.equal(warn.session, 'sess-bash-14');
  assert.equal(warn.source, 'bash-guard');
});
