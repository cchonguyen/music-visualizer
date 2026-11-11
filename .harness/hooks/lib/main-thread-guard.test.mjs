import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mainThreadDecision } from './main-thread-guard.mjs';

const ROOT = '/home/user/spoke';
const bash = (command, agentType) => mainThreadDecision({ agentType, toolName: 'Bash', toolInput: { command }, root: ROOT });
const edit = (file_path, agentType, toolName = 'Edit') => mainThreadDecision({ agentType, toolName, toolInput: { file_path }, root: ROOT });

test('subagents (agent_type set) are not restricted for Edit or Bash', () => {
  assert.equal(edit('.harness/hooks/x.mjs', 'gf-coder').allowed, true);
  assert.equal(bash('npm install', 'gf-coder').allowed, true);
  assert.equal(bash('curl x', 'gf-coder').allowed, true);
});

test('main-thread Edit inside .spec is allowed', () => {
  assert.equal(edit('.spec/PROGRESS.md', undefined).allowed, true);
  assert.equal(edit(`${ROOT}/.spec/SESSION_HANDOFF.md`, undefined).allowed, true);
});

test('main-thread Edit of .harness/ is refused with the reason text', () => {
  const r = edit('.harness/hooks/x.mjs', undefined);
  assert.equal(r.allowed, false);
  assert.match(r.reason, /\.harness\/hooks\/x\.mjs/);
  assert.match(r.reason, /Main thread may edit only \.spec\/\. Dispatch harness:gf-coder for source edits\./);
});

test('main-thread Edit with a path outside root is refused', () => {
  assert.equal(edit('/etc/passwd', undefined).allowed, false);
  assert.equal(edit('../other/x.js', undefined).allowed, false);
  assert.equal(edit('.spec/../src/x.js', undefined).allowed, false);
});

test('Write and NotebookEdit follow the same .spec rule, using notebook_path and path', () => {
  assert.equal(mainThreadDecision({ toolName: 'Write', toolInput: { file_path: 'src/a.js' }, root: ROOT }).allowed, false);
  assert.equal(mainThreadDecision({ toolName: 'NotebookEdit', toolInput: { notebook_path: 'src/a.ipynb' }, root: ROOT }).allowed, false);
  assert.equal(mainThreadDecision({ toolName: 'NotebookEdit', toolInput: { notebook_path: '.spec/n.ipynb' }, root: ROOT }).allowed, true);
  assert.equal(mainThreadDecision({ toolName: 'Write', toolInput: { path: 'src/a.js' }, root: ROOT }).allowed, false);
});

test('main-thread Bash allow-list families are allowed', () => {
  const allowed = [
    'git status',
    'git commit -m "x"',
    'node --test x',
    'npm run lint',
    'node .harness/scripts/finish-slice.mjs "msg"',
    'node .harness/scripts/doctor.mjs',
    'gh pr view 1 --json state',
    'cat x',
    'sed -n 1,5p x',
    'cd dir && npm run typecheck',
    'node --test x 2>&1',
    'npm run test -- --silent',
    'rm .spec/.doctor-canary',
    'bin/restart-dashboard.sh --port 3000',
    'gh search issues foo',
    'git push origin feature-branch',
    'git restore --staged x',
    'git clean -n',
    'ls -la > /dev/null',
  ];
  for (const command of allowed) {
    assert.equal(bash(command).allowed, true, `expected allowed: ${command}`);
  }
});

test('main-thread Bash outside the allow-list is refused and the reason names the command', () => {
  const refusedCommands = [
    'node other.mjs',
    'npm install',
    'sed -i s/a/b/ x',
    'curl x',
    'kill 123',
    'rm -rf x',
    'git reset --hard',
    'git clean -fd',
    'git checkout -- x',
    'git restore x',
    'gh pr merge 1',
    'gh api repos/x',
    'echo $(whoami)',
    'cat x > y',
    'cat x >> y',
    'cat < x',
    'echo `whoami`',
    'mkdir d',
    'touch f',
    'cd dir && rm -rf x',
  ];
  for (const command of refusedCommands) {
    const r = bash(command);
    assert.equal(r.allowed, false, `expected refused: ${command}`);
    assert.match(r.reason, /Main thread Bash/, command);
    assert.match(r.reason, /Dispatch harness:gf-coder for other work\./, command);
  }
  assert.match(bash('node other.mjs').reason, /node other\.mjs/);
});

// Force push and branch -D are not refused here. hard-blocks.mjs refuses them for every Bash call,
// and bash-guard.mjs runs it first, so this allow-list does not repeat those rules.
test('main-thread Bash force push and branch -D are allowed by mainThreadDecision (hard-blocks.mjs refuses them)', () => {
  const allowed = [
    'git push --force origin b',
    'git push -fu origin x',
    'git push -uf origin x',
    'git push origin +main',
    'git push origin HEAD:+main',
    'git branch -D b',
    'git --git-dir=.git branch -D b',
  ];
  for (const command of allowed) {
    assert.equal(bash(command).allowed, true, `expected allowed here (hard-blocks.mjs refuses): ${command}`);
  }
});

test('main-thread Bash may run the --restore recovery command, with optional trailing args', () => {
  assert.equal(bash('node .harness/hooks/pre-tool-guard.mjs --restore').allowed, true);
  assert.equal(bash('node .harness/hooks/pre-tool-guard.mjs --restore --verbose').allowed, true);
  assert.equal(bash('node .harness/hooks/pre-tool-guard.mjs').allowed, false);
  assert.equal(bash('echo x > .harness/x.mjs').allowed, false);
});

test('main-thread Bash ignores operator characters inside quoted arguments', () => {
  const allowed = [
    'node .harness/scripts/finish-slice.mjs "feat: x <a@b> done"',
    'grep -E "^# (a|b)" file.txt',
    'node --test x 2>&1 | tail -9',
    'npm run lint --silent',
    'git commit -m "msg with > and | inside quotes"',
  ];
  for (const command of allowed) {
    assert.equal(bash(command).allowed, true, `expected allowed: ${command}`);
  }
});

test('main-thread Bash still refuses operators and substitution outside quotes or inside double quotes', () => {
  const refusedCommands = [
    'cat x > y',
    'echo x > .harness/x.mjs',
    'node --test x && echo ok > out.txt',
    'cat "a" > b',
    'node other.mjs "arg"',
    'echo $(whoami)',
    'echo "$(whoami)"',
    'echo `id`',
    'git commit -m "oops',
  ];
  for (const command of refusedCommands) {
    const r = bash(command);
    assert.equal(r.allowed, false, `expected refused: ${command}`);
    assert.match(r.reason, /Main thread Bash/, command);
  }
});

test('audit: main-thread Bash bypasses are refused and the reason names the command', () => {
  const refusedCommands = [
    ['ls\nrm -rf src', 'rm -rf src'],
    ['git -C . reset --hard', 'git -C . reset --hard'],
    ['git -c core.x=1 clean -fd', 'git -c core.x=1 clean -fd'],
    ['git --work-tree=. reset --hard', 'git --work-tree=. reset --hard'],
    ['git checkout .', 'git checkout .'],
    ['git checkout -- .', 'git checkout -- .'],
    ['git restore .', 'git restore .'],
    ['git restore --staged --worktree .', 'git restore --staged --worktree .'],
    ["sed -n '1w /tmp/zz' package.json", "sed -n '1w /tmp/zz' package.json"],
    ["sed -n '1e date' f", "sed -n '1e date' f"],
    ["sed -n -e 1p -e 2W f", "sed -n -e 1p -e 2W f"],
    ['sed -n -f s.sed f', 'sed -n -f s.sed f'],
    ['sed -n -i 1p f', 'sed -n -i 1p f'],
    ['rg --pre cat pattern', 'rg --pre cat pattern'],
    ['rg --pre-glob "*.gz" pattern file', 'rg --pre-glob "*.gz" pattern file'],
  ];
  for (const [command, named] of refusedCommands) {
    const r = bash(command);
    assert.equal(r.allowed, false, `expected refused: ${JSON.stringify(command)}`);
    assert.match(r.reason, /Main thread Bash/, command);
    assert.ok(r.reason.includes(named), `reason should name "${named}": ${r.reason}`);
  }
});

test('audit: normal main-thread Bash commands stay allowed', () => {
  const allowed = [
    'git status',
    'git -C . status',
    'git push origin branch',
    'git checkout main',
    'git checkout -b claude/x',
    'sed -n 1,5p file',
    'rg -n pattern file',
  ];
  for (const command of allowed) {
    assert.equal(bash(command).allowed, true, `expected allowed: ${command}`);
  }
});

test('audit: a disallowed segment is refused for every compound operator, and subagents are never refused', () => {
  const refusedCommands = [
    'npm run lint || rm -rf x',
    'git status || curl x',
    'ls; rm -rf x',
    'git status; curl x',
    'git status | curl x',
    'cat x |rm y',
    'git status & rm -rf x',
    'npm run lint && $(rm -rf x)',
    'git status && `rm -rf x`',
    'gh pr view 1 && gh api x',
  ];
  for (const command of refusedCommands) {
    const r = bash(command);
    assert.equal(r.allowed, false, `expected refused: ${command}`);
    assert.match(r.reason, /Main thread Bash/, command);
  }
  assert.equal(bash('cd dir && git status && npm run test').allowed, true);
  assert.equal(bash('git log | head -3').allowed, true);
  for (const command of refusedCommands) {
    assert.equal(bash(command, 'gf-coder').allowed, true, `subagent must not be refused: ${command}`);
  }
});

test('other tools are always allowed for the main thread', () => {
  for (const toolName of ['Read', 'Grep', 'Glob', 'Agent', 'Task', 'WebSearch', 'mcp__x__y']) {
    assert.equal(mainThreadDecision({ toolName, toolInput: { file_path: 'src/a.js' }, root: ROOT }).allowed, true, toolName);
  }
});
