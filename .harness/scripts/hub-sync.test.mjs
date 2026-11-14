import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncAgents, pullFromHub, compileRuntimePayloads, mapAntigravityModel, parseFrontmatter } from './hub-sync.mjs';

function makeTempDir(prefix = 'hub-sync-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('syncAgents synchronizes all agent templates from .harness/agents to .claude/agents and .agents', () => {
  const root = makeTempDir();
  const harnessAgents = path.join(root, '.harness', 'agents');
  fs.mkdirSync(harnessAgents, { recursive: true });

  fs.writeFileSync(path.join(harnessAgents, 'elephant.md'), '# Elephant Agent\n');
  fs.writeFileSync(path.join(harnessAgents, 'goldfish-coder.md'), '# Goldfish Coder\n');

  const synced = syncAgents(root);
  assert.equal(synced.length, 4);
  assert.ok(synced.includes('.claude/agents/elephant.md'));
  assert.ok(synced.includes('.claude/agents/goldfish-coder.md'));
  assert.ok(synced.includes('.agents/elephant.md'));
  assert.ok(synced.includes('.agents/goldfish-coder.md'));

  assert.equal(fs.readFileSync(path.join(root, '.claude', 'agents', 'elephant.md'), 'utf8'), '# Elephant Agent\n');
  assert.equal(fs.readFileSync(path.join(root, '.agents', 'elephant.md'), 'utf8'), '# Elephant Agent\n');

  fs.rmSync(root, { recursive: true, force: true });
});

test('syncAgents is idempotent and returns empty array when files match', () => {
  const root = makeTempDir();
  const harnessAgents = path.join(root, '.harness', 'agents');
  fs.mkdirSync(harnessAgents, { recursive: true });
  fs.writeFileSync(path.join(harnessAgents, 'goldfish-verifier.md'), '# Goldfish Verifier\n');

  const firstSync = syncAgents(root);
  assert.equal(firstSync.length, 2);

  const secondSync = syncAgents(root);
  assert.deepEqual(secondSync, []);

  fs.rmSync(root, { recursive: true, force: true });
});

test('syncAgents updates target files when template content changes', () => {
  const root = makeTempDir();
  const harnessAgents = path.join(root, '.harness', 'agents');
  fs.mkdirSync(harnessAgents, { recursive: true });
  fs.writeFileSync(path.join(harnessAgents, 'librarian.md'), 'v1');

  syncAgents(root);

  fs.writeFileSync(path.join(harnessAgents, 'librarian.md'), 'v2');
  const updateSync = syncAgents(root);
  assert.equal(updateSync.length, 2);
  assert.equal(fs.readFileSync(path.join(root, '.claude', 'agents', 'librarian.md'), 'utf8'), 'v2');
  assert.equal(fs.readFileSync(path.join(root, '.agents', 'librarian.md'), 'utf8'), 'v2');

  fs.rmSync(root, { recursive: true, force: true });
});

test('syncAgents respects custom target directories passed as argument', () => {
  const root = makeTempDir();
  const harnessAgents = path.join(root, '.harness', 'agents');
  fs.mkdirSync(harnessAgents, { recursive: true });
  fs.writeFileSync(path.join(harnessAgents, 'git-clerk.md'), '# Clerk\n');

  const synced = syncAgents(root, ['.custom/agents']);
  assert.deepEqual(synced, ['.custom/agents/git-clerk.md']);
  assert.ok(fs.existsSync(path.join(root, '.custom', 'agents', 'git-clerk.md')));
  assert.ok(!fs.existsSync(path.join(root, '.claude', 'agents', 'git-clerk.md')));

  fs.rmSync(root, { recursive: true, force: true });
});

test('syncAgents respects agent_sync_dirs configured in thresholds.json', () => {
  const root = makeTempDir();
  const harnessAgents = path.join(root, '.harness', 'agents');
  fs.mkdirSync(harnessAgents, { recursive: true });
  fs.writeFileSync(path.join(harnessAgents, 'elephant.md'), '# Elephant\n');

  const configDir = path.join(root, '.harness', 'config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'thresholds.json'),
    JSON.stringify({ agent_sync_dirs: ['.configured/agents'] }),
    'utf8'
  );

  const synced = syncAgents(root);
  assert.deepEqual(synced, ['.configured/agents/elephant.md']);
  assert.ok(fs.existsSync(path.join(root, '.configured', 'agents', 'elephant.md')));
  assert.ok(!fs.existsSync(path.join(root, '.claude', 'agents', 'elephant.md')));

  fs.rmSync(root, { recursive: true, force: true });
});

test('syncAgents cleans up deprecated v2.0 files in .claude/agents and .agents/workflows', () => {
  const root = makeTempDir();
  const harnessAgents = path.join(root, '.harness', 'agents');
  fs.mkdirSync(harnessAgents, { recursive: true });
  fs.writeFileSync(path.join(harnessAgents, 'el-architect.md'), '# el-architect\n');
  fs.writeFileSync(path.join(harnessAgents, 'gf-coder.md'), '# gf-coder\n');

  // Pre-populate deprecated v2.0 files
  const claudeAgents = path.join(root, '.claude', 'agents');
  const workflowsDir = path.join(root, '.agents', 'workflows');
  fs.mkdirSync(claudeAgents, { recursive: true });
  fs.mkdirSync(workflowsDir, { recursive: true });

  fs.writeFileSync(path.join(claudeAgents, 'elephant.md'), 'deprecated');
  fs.writeFileSync(path.join(claudeAgents, 'librarian.md'), 'deprecated');
  fs.writeFileSync(path.join(workflowsDir, 'goldfish-coder.md'), 'deprecated');

  const synced = syncAgents(root);
  assert.ok(synced.includes('.claude/agents/el-architect.md'));
  assert.ok(synced.includes('.claude/agents/gf-coder.md'));

  // Deprecated files should be removed
  assert.ok(!fs.existsSync(path.join(claudeAgents, 'elephant.md')));
  assert.ok(!fs.existsSync(path.join(claudeAgents, 'librarian.md')));
  assert.ok(!fs.existsSync(path.join(workflowsDir, 'goldfish-coder.md')));

  fs.rmSync(root, { recursive: true, force: true });
});

test('pullFromHub pulls .harness/agents and synchronizes into .claude/agents and .agents', () => {
  const hubRoot = makeTempDir('hub-');
  const spokeRoot = makeTempDir('spoke-');

  // Set up hub skeleton
  const hubAgentsDir = path.join(hubRoot, '.harness', 'agents');
  fs.mkdirSync(hubAgentsDir, { recursive: true });
  fs.writeFileSync(path.join(hubAgentsDir, 'elephant.md'), '# Elephant Template\n');
  fs.writeFileSync(path.join(hubAgentsDir, 'goldfish-coder.md'), '# Goldfish Template\n');

  const hubTemplates = path.join(hubRoot, '.harness', 'templates');
  fs.mkdirSync(hubTemplates, { recursive: true });
  fs.writeFileSync(path.join(hubTemplates, 'gitignore.block'), '# gitignore block\n');
  fs.writeFileSync(path.join(hubTemplates, 'AGENTS.block.md'), '## Card Catalog block\n');

  const hubClaude = path.join(hubRoot, '.claude');
  fs.mkdirSync(hubClaude, { recursive: true });
  fs.writeFileSync(path.join(hubClaude, 'settings.json'), JSON.stringify({ permissions: { allow: [], deny: [] } }));

  fs.writeFileSync(path.join(hubRoot, '.harness-version'), '4.0.0\n');

  // Spoke pre-existing files
  fs.writeFileSync(path.join(spokeRoot, '.gitignore'), '# user gitignore\n');
  fs.writeFileSync(path.join(spokeRoot, 'AGENTS.md'), '# Spoke AGENTS\n');

  const result = pullFromHub(hubRoot, spokeRoot);
  assert.ok(result.receipt.written.length > 0);

  // Assert spoke received the files
  assert.ok(fs.existsSync(path.join(spokeRoot, '.harness', 'agents', 'elephant.md')));
  assert.ok(fs.existsSync(path.join(spokeRoot, '.claude', 'agents', 'elephant.md')));
  assert.ok(fs.existsSync(path.join(spokeRoot, '.agents', 'elephant.md')));
  assert.ok(fs.existsSync(path.join(spokeRoot, '.claude', 'agents', 'goldfish-coder.md')));
  assert.ok(fs.existsSync(path.join(spokeRoot, '.agents', 'goldfish-coder.md')));

  // Assert AGENTS.md was merged with markers
  const agentsContent = fs.readFileSync(path.join(spokeRoot, 'AGENTS.md'), 'utf8');
  assert.match(agentsContent, /<!-- >>> harness >>> -->/);
  assert.match(agentsContent, /## Card Catalog block/);
  assert.match(agentsContent, /<!-- <<< harness <<< -->/);

  fs.rmSync(hubRoot, { recursive: true, force: true });
  fs.rmSync(spokeRoot, { recursive: true, force: true });
});

test('mapAntigravityModel maps model strings accurately', () => {
  assert.equal(mapAntigravityModel('haiku'), 'inherit');
  assert.equal(mapAntigravityModel('claude-3-5-haiku-20241022'), 'inherit');
  assert.equal(mapAntigravityModel('hydrogen'), 'inherit');
  assert.equal(mapAntigravityModel('inherit'), 'inherit');
  assert.equal(mapAntigravityModel('flash'), 'flash');
  assert.equal(mapAntigravityModel('gemini-2.5-flash'), 'flash');
  assert.equal(mapAntigravityModel('flash_lite'), 'flash_lite');
  assert.equal(mapAntigravityModel('gemini-2.5-flash-lite'), 'flash_lite');
  assert.equal(mapAntigravityModel('opus'), 'pro');
  assert.equal(mapAntigravityModel('claude-3-opus-20240229'), 'pro');
  assert.equal(mapAntigravityModel('pro'), 'pro');
  assert.equal(mapAntigravityModel('gemini-2.5-pro'), 'pro');
  assert.equal(mapAntigravityModel('sonnet'), 'pro');
  assert.equal(mapAntigravityModel('claude-3-7-sonnet'), 'pro');
  assert.equal(mapAntigravityModel(''), 'inherit');
  assert.equal(mapAntigravityModel(null), 'inherit');
  assert.equal(mapAntigravityModel('custom-model'), 'custom-model');
});

test('parseFrontmatter extracts YAML frontmatter and system prompt', () => {
  const content = `---
name: sample-agent
description: A sample test agent.
model: haiku
tools: Read, Edit, Bash
---
You are a test agent.
Do your job well.
`;
  const { frontmatter, systemPrompt } = parseFrontmatter(content);
  assert.equal(frontmatter.name, 'sample-agent');
  assert.equal(frontmatter.description, 'A sample test agent.');
  assert.equal(frontmatter.model, 'haiku');
  assert.equal(frontmatter.tools, 'Read, Edit, Bash');
  assert.equal(systemPrompt, 'You are a test agent.\nDo your job well.');
});

test('compileRuntimePayloads compiles agent files into runtime-payloads.json', () => {
  const root = makeTempDir();
  const harnessAgents = path.join(root, '.harness', 'agents');
  fs.mkdirSync(harnessAgents, { recursive: true });

  fs.writeFileSync(
    path.join(harnessAgents, 'el-architect.md'),
    `---
name: el-architect
description: Tier 1 Spec Architect
model: opus
tools: Read, Edit, Write
---
You are Tier 1 Architect.
`
  );

  fs.writeFileSync(
    path.join(harnessAgents, 'gf-coder.md'),
    `---
name: gf-coder
description: Tier 3 Code Implementer
model: haiku
tools: [Read, Edit, Write, Bash]
---
You are Tier 3 Coder.
`
  );

  fs.writeFileSync(
    path.join(harnessAgents, 'gf-flash.md'),
    `---
name: gf-flash
description: Explicit Flash override
model: haiku
antigravity_model: flash
tools: Read
---
You use Flash explicitly.
`
  );

  const payloads = compileRuntimePayloads(root);

  const expectedPayloadsPath = path.join(harnessAgents, 'runtime-payloads.json');
  assert.ok(fs.existsSync(expectedPayloadsPath));

  const savedJson = JSON.parse(fs.readFileSync(expectedPayloadsPath, 'utf8'));
  assert.deepEqual(payloads, savedJson);

  assert.ok(payloads['el-architect']);
  assert.equal(payloads['el-architect'].name, 'el-architect');
  assert.equal(payloads['el-architect'].description, 'Tier 1 Spec Architect');
  assert.equal(payloads['el-architect'].model, 'opus');
  assert.equal(payloads['el-architect'].antigravity_model, 'pro');
  assert.equal(payloads['el-architect'].tools, 'Read, Edit, Write');
  assert.equal(payloads['el-architect'].systemPrompt, 'You are Tier 1 Architect.');

  assert.ok(payloads['gf-coder']);
  assert.equal(payloads['gf-coder'].name, 'gf-coder');
  assert.equal(payloads['gf-coder'].description, 'Tier 3 Code Implementer');
  assert.equal(payloads['gf-coder'].model, 'haiku');
  assert.equal(payloads['gf-coder'].antigravity_model, 'inherit');
  assert.deepEqual(payloads['gf-coder'].tools, ['Read', 'Edit', 'Write', 'Bash']);
  assert.equal(payloads['gf-coder'].systemPrompt, 'You are Tier 3 Coder.');

  assert.ok(payloads['gf-flash']);
  assert.equal(payloads['gf-flash'].model, 'haiku');
  assert.equal(payloads['gf-flash'].antigravity_model, 'flash');

  fs.rmSync(root, { recursive: true, force: true });
});

test('syncAgents generates runtime-payloads.json alongside copied templates', () => {
  const root = makeTempDir();
  const harnessAgents = path.join(root, '.harness', 'agents');
  fs.mkdirSync(harnessAgents, { recursive: true });

  fs.writeFileSync(
    path.join(harnessAgents, 'gf-verifier.md'),
    `---
name: gf-verifier
description: Ephemeral Verifier
model: haiku
tools: Read, Bash
---
You are Verifier.
`
  );

  fs.writeFileSync(
    path.join(harnessAgents, 'gf-flash-verifier.md'),
    `---
name: gf-flash-verifier
description: Explicit Flash Verifier
model: flash
tools: Read, Bash
---
You are Flash Verifier.
`
  );

  syncAgents(root);

  const payloadsFile = path.join(harnessAgents, 'runtime-payloads.json');
  assert.ok(fs.existsSync(payloadsFile));
  const data = JSON.parse(fs.readFileSync(payloadsFile, 'utf8'));
  assert.equal(data['gf-verifier'].antigravity_model, 'inherit');
  assert.equal(data['gf-flash-verifier'].antigravity_model, 'flash');

  fs.rmSync(root, { recursive: true, force: true });
});
