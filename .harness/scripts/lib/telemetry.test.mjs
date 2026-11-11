import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  appendCall, readCalls, dispatchesFor, mainSourceWrites, currentSliceId, isSourceFile, resolveRole, telemetryPath,
  writeJsonAtomic,
} from './telemetry.mjs';

function makeRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-test-'));
  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  return dir;
}

const call = (over = {}) => ({
  ts: '2026-11-05T00:00:00.000Z', tool: 'Edit', agentType: '', role: 'coordinator', filePath: 'a.mjs', slice: '1', ...over,
});

test('appendCall creates the file with version 1 and appends without resetting', () => {
  const root = makeRoot();
  appendCall(root, call({ tool: 'Read' }));
  appendCall(root, call({ tool: 'Grep', filePath: '' }));
  const parsed = JSON.parse(fs.readFileSync(telemetryPath(root), 'utf8'));
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.calls.map((c) => c.tool), ['Read', 'Grep']);
  assert.deepEqual(readCalls(root).length, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('writeJsonAtomic leaves no .tmp file and the final content parses', () => {
  const root = makeRoot();
  writeJsonAtomic(telemetryPath(root), { version: 1, calls: [call()] });
  const leftovers = fs.readdirSync(path.join(root, '.spec')).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
  assert.equal(JSON.parse(fs.readFileSync(telemetryPath(root), 'utf8')).calls.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('appendCall on an empty existing file appends the call and makes no .bak', () => {
  const root = makeRoot();
  fs.writeFileSync(telemetryPath(root), '');
  appendCall(root, call({ tool: 'Read' }));
  assert.equal(fs.existsSync(`${telemetryPath(root)}.bak`), false);
  assert.deepEqual(readCalls(root).map((c) => c.tool), ['Read']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('readCalls returns [] when the file is missing', () => {
  const root = makeRoot();
  assert.deepEqual(readCalls(root), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('appendCall keeps the corrupt file as .bak and starts fresh', () => {
  const root = makeRoot();
  fs.writeFileSync(telemetryPath(root), '{not json');
  appendCall(root, call());
  assert.equal(fs.readFileSync(`${telemetryPath(root)}.bak`, 'utf8'), '{not json');
  assert.equal(readCalls(root).length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('dispatchesFor counts only gf-coder Agent/Task dispatches for the slice', () => {
  const calls = [
    call({ tool: 'Agent', agentType: 'harness:gf-coder', filePath: '' }),
    call({ tool: 'Task', agentType: 'harness:el-architect', filePath: '' }),
    call({ tool: 'Agent', agentType: 'harness:gf-verifier', filePath: '' }),
    call({ tool: 'Agent', agentType: 'harness:gf-navigator', filePath: '' }),
    call({ tool: 'Agent', agentType: '', dispatchedType: 'harness:gf-coder', filePath: '' }),
    call({ tool: 'Agent', agentType: '', dispatchedType: '', filePath: '' }),
    call({ tool: 'Agent', agentType: 'harness:gf-coder', slice: '2', filePath: '' }),
    call({ tool: 'Read', agentType: 'harness:gf-coder' }),
  ];
  assert.equal(dispatchesFor(calls, '1').length, 2);
});

test('a main-thread dispatch with no agent_type is recorded by the hook and counted by the gate', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, '.spec', 'PROGRESS.md'), '- [ ] **Slice 1: Demo** [IN_PROGRESS] Target files: a.mjs\n');
  const payload = {
    session_id: 's1',
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: 'harness:gf-coder', prompt: 'implement slice 1' },
  };
  const hook = fileURLToPath(new URL('../../hooks/post-tool-telemetry.mjs', import.meta.url));
  const res = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0);
  const calls = readCalls(root);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dispatchedType, 'harness:gf-coder');
  assert.equal(dispatchesFor(calls, '1').length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('mainSourceWrites counts main-thread Edit/Write of source files only', () => {
  const calls = [
    call({ filePath: 'src/app.mjs' }),
    call({ tool: 'Write', filePath: './lib/x.mjs' }),
    call({ tool: 'Edit', filePath: '.spec/PROGRESS.md' }),
    call({ tool: 'Edit', filePath: '.harness/hooks/x.mjs' }),
    call({ tool: 'Edit', filePath: 'README.md' }),
    call({ tool: 'Edit', filePath: 'src/app.mjs', agentType: 'harness:gf-coder' }),
    call({ tool: 'Bash', filePath: 'src/app.mjs' }),
    call({ tool: 'Edit', filePath: 'src/other.mjs', slice: '2' }),
  ];
  const writes = mainSourceWrites(calls, '1');
  assert.deepEqual(writes.map((c) => c.filePath), ['src/app.mjs', './lib/x.mjs']);
});

test('isSourceFile follows the pre-tool-guard rule', () => {
  assert.equal(isSourceFile('src/a.mjs'), true);
  assert.equal(isSourceFile('.spec/x.md'), false);
  assert.equal(isSourceFile('.claude/x.md'), false);
  assert.equal(isSourceFile('AGENTS.md'), false);
  assert.equal(isSourceFile(''), false);
});

test('resolveRole maps agent_type to a role', () => {
  assert.equal(resolveRole({ agent_type: 'harness:gf-coder' }), 'goldfish');
  assert.equal(resolveRole({ agent_type: 'harness:el-architect' }), 'elephant');
  assert.equal(resolveRole({ agent_type: 'harness:gf-navigator' }), 'goldfish');
});

test('currentSliceId returns the single IN_PROGRESS slice id or empty string', () => {
  const root = makeRoot();
  assert.equal(currentSliceId(root), '');
  fs.writeFileSync(path.join(root, '.spec', 'PROGRESS.md'),
    '# P\n- [x] **Slice 1** done\n- [ ] **Slice 2: Next** [IN_PROGRESS] Target files: a.mjs\n');
  assert.equal(currentSliceId(root), '2');
  fs.writeFileSync(path.join(root, '.spec', 'PROGRESS.md'),
    '- [ ] **Slice 2** [IN_PROGRESS]\n- [ ] **Slice 3** [IN_PROGRESS]\n');
  assert.equal(currentSliceId(root), '');
  fs.rmSync(root, { recursive: true, force: true });
});

test('currentSliceId reads the PROGRESS.md format where the status tag leads the line', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, '.spec', 'PROGRESS.md'),
    '# P\n- [x] **Slice 10.3: Done** [CORE / DATA] Target files: a.mjs\n'
    + '- [IN_PROGRESS] **Slice 10.4: Bot Merge Identity** [CORE / DATA] Target files: .github/workflows/automerge.yml [NEW]\n');
  assert.equal(currentSliceId(root), '10.4');
  fs.writeFileSync(path.join(root, '.spec', 'PROGRESS.md'),
    '- [IN_PROGRESS] **Slice 10.4: A**\n- [IN_PROGRESS] **Slice 10.5: B**\n');
  assert.equal(currentSliceId(root), '');
  fs.rmSync(root, { recursive: true, force: true });
});
