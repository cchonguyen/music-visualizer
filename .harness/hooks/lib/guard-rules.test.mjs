import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentsBlock, bashWriteReason, isEngineLocked, isHubOrigin, isProtectedPath, nextContent, sliceIdOf,
} from './guard-rules.mjs';
import {
  normalizeToolName, normalizeToolInput, normalizePayload
} from '../adapter.mjs';
import {
  checkFastPathBudget, checkSearchBudget, checkTargetFileScope, isSourceFile, resolveRole
} from '../pre-tool-guard.mjs';
import { ACTIVE_TASK } from './vibe.mjs';
import {
  validateProgressSlices
} from '../el-exit-gate.mjs';

test('engine lock covers hub-owned files and leaves spoke files alone', () => {
  for (const f of ['.harness/hooks/pre-tool-guard.mjs', '.harness-version', '.claude/settings.json', '.claude/agents/engineer.md',
    '.claude/commands/implement.md', '.claude/harness-rules.md', '.spec/EXTERNAL_AGENT_RULES.md', '.spec/harness.json']) {
    assert.equal(isEngineLocked(f), true, f);
  }
  for (const f of ['.claude/project-rules.md', '.claude/settings.spoke.json', 'CLAUDE.md', '.spec/PROGRESS.md', 'src/app.js']) {
    assert.equal(isEngineLocked(f), false, f);
  }
});

test('the AGENTS.md block is the text between the markers, markers included', () => {
  const text = 'My notes\n<!-- >>> harness >>> -->\nrule\n<!-- <<< harness <<< -->\nmore\n';
  assert.equal(agentsBlock(text), '<!-- >>> harness >>> -->\nrule\n<!-- <<< harness <<< -->');
  assert.equal(agentsBlock('no block here'), '');
});

test('slice identity is read from a slice line', () => {
  const line = '- [ ] **Slice 3.3** [IN_PROGRESS] `[YELLOW][CORE / DATA]`: guard';
  assert.equal(sliceIdOf(line), '3.3');
});

test('nextContent applies Write and Edit, including "$&" in replacement text', () => {
  assert.equal(nextContent('a b', 'Write', { content: 'new' }), 'new');
  assert.equal(nextContent('a b', 'Edit', { old_string: 'a', new_string: '$&$&' }), '$&$& b');
  assert.equal(nextContent('a a', 'Edit', { old_string: 'a', new_string: 'x', replace_all: true }), 'x x');
});

test('a Bash redirect into a protected path is caught, a redirect elsewhere is not', () => {
  assert.match(bashWriteReason('echo hi > .harness/hooks/x.mjs'), /redirects output into \.harness\/hooks\/x\.mjs/);
  assert.match(bashWriteReason('echo hi >> .claude/settings.json'), /settings\.json/);
  assert.equal(bashWriteReason('cat .harness/hooks/x.mjs > /tmp/out.txt'), null);
  assert.equal(bashWriteReason('npm test 2>&1 | tail -5'), null);
});

test('write verbs that name a protected path are caught', () => {
  assert.match(bashWriteReason('sed -i s/a/b/ AGENTS.md'), /sed/);
  assert.match(bashWriteReason('git checkout -- .claude/agents/engineer.md'), /git checkout/);
  assert.match(bashWriteReason('rm .harness-version'), /rm/);
});

test('reads and the harness restore command are not blocked', () => {
  assert.equal(bashWriteReason('ls .harness'), null);
  assert.equal(bashWriteReason('node .harness/hooks/pre-tool-guard.mjs --restore'), null);
  assert.equal(bashWriteReason('cp src/a.js src/b.js'), null);
});

test('protected path rule', () => {
  assert.equal(isProtectedPath('./.harness/x.mjs'), true);
  assert.equal(isProtectedPath('AGENTS.md'), true);
  assert.equal(isProtectedPath('.claude/project-rules.md'), false);
});

test('hub detection uses the origin URL only', () => {
  assert.equal(isHubOrigin('https://github.com/cchonguyen/claude-harness-hub.git'), true);
  assert.equal(isHubOrigin('git@github.com:cchonguyen/claude-harness-hub'), true);
  assert.equal(isHubOrigin('https://github.com/example-owner/example-site'), false);
  assert.equal(isHubOrigin(''), false);
});

test('sliceIdOf falls back to the trimmed line when there is no Slice label', () => {
  assert.equal(sliceIdOf('  plain line  '), 'plain line');
});

// --- Slice 4.3 Tests: Universal Adapter ---

test('universal adapter normalizes platform tool names to canonical Claude names', () => {
  assert.equal(normalizeToolName('run_command'), 'Bash');
  assert.equal(normalizeToolName('view_file'), 'Read');
  assert.equal(normalizeToolName('read_file'), 'Read');
  assert.equal(normalizeToolName('edit_file'), 'Edit');
  assert.equal(normalizeToolName('write_file'), 'Write');
  assert.equal(normalizeToolName('notebook_edit'), 'NotebookEdit');
  assert.equal(normalizeToolName('send_message'), 'Agent');
  assert.equal(normalizeToolName('grep_search'), 'Grep');
  assert.equal(normalizeToolName('file_search'), 'Glob');
  assert.equal(normalizeToolName('search_web'), 'WebSearch');

  // Native names preserved
  assert.equal(normalizeToolName('Bash'), 'Bash');
  assert.equal(normalizeToolName('Edit'), 'Edit');
  assert.equal(normalizeToolName('Write'), 'Write');
  assert.equal(normalizeToolName('Read'), 'Read');
  assert.equal(normalizeToolName('Agent'), 'Agent');
});

test('universal adapter normalizes platform tool inputs to canonical fields', () => {
  const bashInput = normalizeToolInput('Bash', { CommandLine: 'npm test --silent' });
  assert.equal(bashInput.command, 'npm test --silent');

  const readInput = normalizeToolInput('Read', { AbsolutePath: '/repo/src/index.js' });
  assert.equal(readInput.file_path, '/repo/src/index.js');

  const editInput = normalizeToolInput('Edit', {
    Path: 'src/app.js',
    Target: 'oldVal',
    Replacement: 'newVal'
  });
  assert.equal(editInput.file_path, 'src/app.js');
  assert.equal(editInput.old_string, 'oldVal');
  assert.equal(editInput.new_string, 'newVal');

  const writeInput = normalizeToolInput('Write', {
    Path: 'src/app.js',
    Content: 'hello world'
  });
  assert.equal(writeInput.file_path, 'src/app.js');
  assert.equal(writeInput.content, 'hello world');

  const agentInput = normalizeToolInput('Agent', {
    Recipient: 'goldfish-coder',
    Message: 'implement slice'
  });
  assert.equal(agentInput.subagent_type, 'goldfish-coder');
  assert.equal(agentInput.prompt, 'implement slice');
});

test('universal adapter normalizePayload normalizes full event payload', () => {
  const rawEvent = {
    sessionId: 'session-xyz',
    agent: 'coordinator',
    tool: 'run_command',
    input: { CommandLine: 'pytest -q' }
  };
  const norm = normalizePayload(rawEvent);
  assert.equal(norm.tool_name, 'Bash');
  assert.equal(norm.tool_input.command, 'pytest -q');
  assert.equal(norm.session_id, 'session-xyz');
});

// --- Slice 4.3 Tests: Fast-Path Budget & Circuit Breakers ---

test('fast-path budget allows <= 3 coordinator source reads and blocks 4th', () => {
  const thresholds = { fast_path: { max_reads: 3, max_searches: 1, max_edits: 1, max_edit_lines: 25 } };

  // 1st, 2nd, 3rd source reads allowed
  assert.equal(checkFastPathBudget({ role: 'coordinator', toolName: 'Read', targetFile: 'src/a.js', telemetry: { coordinator_reads: 0 }, thresholds }).allowed, true);
  assert.equal(checkFastPathBudget({ role: 'coordinator', toolName: 'Read', targetFile: 'src/b.js', telemetry: { coordinator_reads: 2 }, thresholds }).allowed, true);

  // 4th source read blocked
  const blocked = checkFastPathBudget({ role: 'coordinator', toolName: 'Read', targetFile: 'src/d.js', telemetry: { coordinator_reads: 3 }, thresholds });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /FAST-PATH BUDGET EXCEEDED: Coordinator attempted 4 source reads/);

  // Spec/catalog files do not count as source reads
  assert.equal(isSourceFile('.spec/PROGRESS.md'), false);
  assert.equal(isSourceFile('AGENTS.md'), false);
  assert.equal(isSourceFile('CLAUDE.md'), false);
  assert.equal(isSourceFile('src/index.js'), true);
  assert.equal(checkFastPathBudget({ role: 'coordinator', toolName: 'Read', targetFile: '.spec/PROGRESS.md', telemetry: { coordinator_reads: 5 }, thresholds }).allowed, true);
});

test('fast-path budget allows 1 coordinator search and blocks 2nd', () => {
  const thresholds = { fast_path: { max_reads: 3, max_searches: 1, max_edits: 1, max_edit_lines: 25 } };

  assert.equal(checkFastPathBudget({ role: 'coordinator', toolName: 'Grep', telemetry: { coordinator_searches: 0 }, thresholds }).allowed, true);

  const blocked = checkFastPathBudget({ role: 'coordinator', toolName: 'Grep', telemetry: { coordinator_searches: 1 }, thresholds });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /FAST-PATH BUDGET EXCEEDED: Coordinator attempted 2 searches/);
});

test('fast-path budget allows 1 coordinator edit (<= 25 lines) and blocks 2nd edit or > 25 lines', () => {
  const thresholds = { fast_path: { max_reads: 3, max_searches: 1, max_edits: 1, max_edit_lines: 25 } };

  // 1 edit with 10 lines allowed
  assert.equal(checkFastPathBudget({ role: 'coordinator', toolName: 'Edit', targetFile: 'src/a.js', editLines: 10, telemetry: { coordinator_edits: 0 }, thresholds }).allowed, true);

  // 2nd edit blocked
  const blockedCount = checkFastPathBudget({ role: 'coordinator', toolName: 'Edit', targetFile: 'src/b.js', editLines: 5, telemetry: { coordinator_edits: 1 }, thresholds });
  assert.equal(blockedCount.allowed, false);
  assert.match(blockedCount.reason, /FAST-PATH BUDGET EXCEEDED: Coordinator attempted 2 source edits/);

  // Edit with 30 lines blocked
  const blockedLines = checkFastPathBudget({ role: 'coordinator', toolName: 'Edit', targetFile: 'src/c.js', editLines: 30, telemetry: { coordinator_edits: 0 }, thresholds });
  assert.equal(blockedLines.allowed, false);
  assert.match(blockedLines.reason, /FAST-PATH BUDGET EXCEEDED: Coordinator edit has 30 lines/);
});

test('circuit breaker enforces 2-search limit for goldfish workers', () => {
  const thresholds = { circuit_breaker: { max_searches: 2 } };

  // 1st and 2nd searches allowed
  assert.equal(checkSearchBudget({ role: 'goldfish', telemetry: { goldfish_searches: 0 }, thresholds }).allowed, true);
  assert.equal(checkSearchBudget({ role: 'goldfish', telemetry: { goldfish_searches: 1 }, thresholds }).allowed, true);

  // 3rd search flagged as a warning: checkSearchBudget reports the overrun, but the hook
  // only warns on stderr and logs goldfish_breaker_warn (exit 0), and the counter still increments.
  const warned = checkSearchBudget({ role: 'goldfish', telemetry: { goldfish_searches: 2 }, thresholds });
  assert.equal(warned.allowed, false);
  assert.equal(warned.count, 3);
  assert.match(warned.reason, /CIRCUIT BREAKER: Goldfish search budget exceeded/);
});

test('goldfish target locks block editing files outside active slice Target files', () => {
  const allowed = ['.harness/hooks/adapter.mjs', '.harness/hooks/pre-tool-guard.mjs', 'src/'];

  // File in allowed list
  assert.equal(checkTargetFileScope({ relTarget: '.harness/hooks/adapter.mjs', allowedTargets: allowed, role: 'goldfish' }).allowed, true);

  // File inside allowed directory prefix
  assert.equal(checkTargetFileScope({ relTarget: 'src/components/button.jsx', allowedTargets: allowed, role: 'goldfish' }).allowed, true);

  // File outside allowed list blocked
  const blocked = checkTargetFileScope({ relTarget: 'unrelated/config.json', allowedTargets: allowed, role: 'goldfish' });
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /SCOPE LOCK/);

  // State-file lockout disabled (owner approval, 2026-11-06): gf-coder may edit PROGRESS.md, ATLAS.md, HISTORY.md
  // when they are in scope; the normal SCOPE LOCK still applies to files not listed.
  const progressAllowed = checkTargetFileScope({ relTarget: '.spec/PROGRESS.md', allowedTargets: allowed, role: 'goldfish' });
  assert.equal(progressAllowed.allowed, true);
  assert.doesNotMatch(progressAllowed.reason ?? '', /DENIED: gf-coder cannot modify/);

  const atlasAllowed = checkTargetFileScope({ relTarget: '.spec/ATLAS.md', allowedTargets: [...allowed, '.spec/ATLAS.md'], role: 'goldfish' });
  assert.equal(atlasAllowed.allowed, true);

  const historyAllowed = checkTargetFileScope({ relTarget: '.spec/archive/HISTORY.md', allowedTargets: [...allowed, '.spec/archive/HISTORY.md'], role: 'goldfish' });
  assert.equal(historyAllowed.allowed, true);

  const atlasOutOfScope = checkTargetFileScope({ relTarget: '.spec/ATLAS.md', allowedTargets: allowed, role: 'goldfish' });
  assert.equal(atlasOutOfScope.allowed, false);
  assert.match(atlasOutOfScope.reason, /SCOPE LOCK/);

  // Non-goldfish roles (e.g., coordinator) are permitted to update PROGRESS.md
  assert.equal(checkTargetFileScope({ relTarget: '.spec/PROGRESS.md', allowedTargets: allowed, role: 'coordinator' }).allowed, true);
});

test('role resolution identifies subagents vs coordinator', () => {
  assert.equal(resolveRole({ agent: 'goldfish-coder' }), 'goldfish');
  assert.equal(resolveRole({ tool_input: { subagent_type: 'elephant' } }), 'elephant');
  assert.equal(resolveRole({ subagent: 'librarian' }), 'librarian');
  assert.equal(resolveRole({ agent: 'git-clerk' }), 'git-clerk');
  assert.equal(resolveRole({}), 'coordinator');
  assert.equal(resolveRole({ agent_type: 'el-architect' }), 'elephant');
  assert.equal(resolveRole({ agent_type: 'gf-coder' }), 'goldfish');
});

// --- Slice 4.3 Tests: el-architect Exit Gate ---

test('el exit gate passes when all slices have valid Target files, Coords, and Verify', () => {
  const validProgress = `# Active Slice Queue
- [x] **Slice 1.1: Spec Base** Target files: src/a.js, src/b.js | Coords: [110, 210] | Verify: npm test
- [ ] **Slice 1.2: Implementation** [IN_PROGRESS] Target files: src/c.js | Coords: [210, 305] | Verify: node --test test/*.js
`;
  const result = validateProgressSlices(validProgress);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.slicesCount, 2);
});

test('el exit gate blocks slices missing Target files, Coords, or Verify', () => {
  const missingTargets = `- [ ] **Slice 2.1: Bad** | Coords: [110] | Verify: npm test\n`;
  const r1 = validateProgressSlices(missingTargets);
  assert.equal(r1.valid, false);
  assert.match(r1.errors[0], /Missing "Target files:" declaration/);

  const emptyTargets = `- [ ] **Slice 2.2: Bad** Target files: | Coords: [110] | Verify: npm test\n`;
  const r2 = validateProgressSlices(emptyTargets);
  assert.equal(r2.valid, false);
  assert.match(r2.errors[0], /"Target files:" declaration is empty/);

  const missingCoords = `- [ ] **Slice 2.3: Bad** Target files: src/a.js | Verify: npm test\n`;
  const r3 = validateProgressSlices(missingCoords);
  assert.equal(r3.valid, false);
  assert.match(r3.errors[0], /Missing "Coords:" declaration/);

  const missingVerify = `- [ ] **Slice 2.4: Bad** Target files: src/a.js | Coords: [110]\n`;
  const r4 = validateProgressSlices(missingVerify);
  assert.equal(r4.valid, false);
  assert.match(r4.errors[0], /Missing "Verify:" command/);
});

test('el exit gate blocks progress file with no declared slices', () => {
  const emptyProgress = `# Active Slice Queue\nNo slices yet.\n`;
  const result = validateProgressSlices(emptyProgress);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /No declared slices found/);
});

test('el exit gate blocks slices targeting .spec/PROGRESS.md via canonical validator', () => {
  const badTargetProgress = `- [ ] **Slice 3.1: Hack** Target files: src/app.js, .spec/PROGRESS.md | Coords: [110] | Verify: npm test\n`;
  const result = validateProgressSlices(badTargetProgress);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('Coding slice target files must not include .spec/PROGRESS.md')));
});

test('el exit gate blocks slices citing invalid Coords when Context Atlas content is provided', () => {
  const badCoordsProgress = `- [ ] **Slice 3.2: Bad Coords** Target files: src/app.js | Coords: [999] | Verify: npm test\n`;
  const atlas = `# Context Atlas\n- \`110\` [.spec/PROGRESS.md](.spec/PROGRESS.md)\n`;
  const result = validateProgressSlices(badCoordsProgress, atlas);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('Coordinate 999 does not exist in Context Atlas')));
});


test('el exit gate open-only mode ignores completed slices', () => {
  const doneBad = '- [x] **Slice 9.9: Old** Target files: `a.mjs` | Coords: [1] | Verify: `npm test`\n- [ ] **Slice 9.10: Open** Target files: `b.mjs` | Coords: [1] | Verify: `npm test`\n';
  const atlas = '| Coords: [1] |';
  assert.equal(validateProgressSlices(doneBad, atlas, { openOnly: true }).valid, validateProgressSlices(doneBad.split('\n')[1] + '\n', atlas).valid);
  assert.equal(validateProgressSlices(doneBad, atlas, { openOnly: true }).slicesCount, 1);
});

test('ACTIVE_TASK counts a marker only after the bold title or at line end', () => {
  assert.equal(ACTIVE_TASK.test('- [ ] **Slice 1** [IN_PROGRESS] `[GREEN]`: x'), true);
  assert.equal(ACTIVE_TASK.test('- [ ] **Slice 1** `[GREEN]`: x [IN_PROGRESS]'), true);
  assert.equal(ACTIVE_TASK.test('- [ ] **Slice 2** [PENDING] `[GREEN]`: the parser counts [IN_PROGRESS] only after the title'), false);
});
