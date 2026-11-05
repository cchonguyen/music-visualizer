#!/usr/bin/env node
// Sync harness engine files from the hub into a spoke, respecting who owns each file.
// Usage:
//   node .harness/scripts/hub-sync.mjs pull            (default) refresh hub-owned files in this project
//   node .harness/scripts/hub-sync.mjs push            send a learned rule to the hub on a fresh branch
//   node .harness/scripts/hub-sync.mjs init --target D create a new spoke at D from the hub, then pull
//   node .harness/scripts/hub-sync.mjs sync-agents     synchronize agent templates from .harness/agents
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { atomicWriteFileSync, ensureHarnessRoot } from './lib/fs-atomic.mjs';
import {
  AGENTS_MARKERS, GITIGNORE_MARKERS, PROJECT_RULES, SETTINGS_SPOKE, TEMPLATE_ONLY,
  appendActiveRules, learnedRulesToKeep, listHubOwned, mergeBlock, mergeSettings,
  harvestSpokePermissions, readManifest, sha256, workflowDestination, writeManifest,
} from './lib/sync-core.mjs';

// execFileSync passes arguments without a shell, so quotes, $ and backticks in a rule are inert
export const gitIn = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export const gitRoot = () => { try { return gitIn(process.cwd(), 'rev-parse', '--show-toplevel'); } catch { return ''; } };

export const reason = (err) => String(err.stderr || err.stdout || err.message).trim().split('\n')[0];
export const readText = (file, fallback = '') => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fallback);
export const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

export const isGitCheckout = (dir) => { try { return gitIn(dir, 'rev-parse', '--show-toplevel') === fs.realpathSync(dir); } catch { return false; } };
export const originUrl = (dir) => { try { return gitIn(dir, 'remote', 'get-url', 'origin'); } catch { return ''; } };
// Hub detection uses the origin URL only: a folder name can be changed, and an agent can change hub.json
export const isHubCheckout = (dir, hubConfig = { repo: 'claude-harness-hub' }) =>
  isGitCheckout(dir) && new RegExp(`[/:]${hubConfig.repo}(\\.git)?$`).test(originUrl(dir));

export function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, systemPrompt: content.trim() };
  }
  const yamlBlock = match[1];
  const systemPrompt = match[2].trim();
  const frontmatter = {};

  const lines = yamlBlock.split(/\r?\n/);
  let currentKey = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;

    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(frontmatter[currentKey])) {
        frontmatter[currentKey] = [];
      }
      frontmatter[currentKey].push(listMatch[1].trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }

    const kvMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      let val = kvMatch[2].trim();
      if (val === '') {
        continue;
      }
      if (val.startsWith('[') && val.endsWith(']')) {
        frontmatter[currentKey] = val
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
      } else if (val === 'true') {
        frontmatter[currentKey] = true;
      } else if (val === 'false') {
        frontmatter[currentKey] = false;
      } else {
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        frontmatter[currentKey] = val;
      }
    }
  }

  return { frontmatter, systemPrompt };
}

export function mapAntigravityModel(model) {
  if (!model) return 'flash';
  const m = String(model).toLowerCase();
  if (m.includes('haiku') || m.includes('flash')) return 'flash';
  if (m.includes('opus') || m.includes('pro') || m.includes('sonnet')) return 'pro';
  return m;
}

export function compileRuntimePayloads(projectRoot = (process.env.CLAUDE_PROJECT_DIR || gitRoot() || process.cwd())) {
  const sourceDir = path.join(projectRoot, '.harness', 'agents');
  if (!fs.existsSync(sourceDir)) return {};
  const entries = fs.readdirSync(sourceDir).filter((file) => file.endsWith('.md')).sort();
  if (entries.length === 0) return {};

  const payloads = {};
  for (const file of entries) {
    const filePath = path.join(sourceDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const { frontmatter, systemPrompt } = parseFrontmatter(content);
    const fallbackName = path.basename(file, '.md');
    const name = frontmatter.name || fallbackName;
    const model = frontmatter.model || '';
    payloads[name] = {
      name,
      description: frontmatter.description || '',
      model,
      antigravity_model: mapAntigravityModel(model),
      tools: frontmatter.tools || '',
      systemPrompt,
    };
  }

  const outPath = path.join(sourceDir, 'runtime-payloads.json');
  atomicWriteFileSync(outPath, JSON.stringify(payloads, null, 2) + '\n', 'utf8');
  return payloads;
}

// Synchronize canonical subagent templates from .harness/agents/*.md to .claude/agents/ and .agents/
export function syncAgents(projectRoot = (process.env.CLAUDE_PROJECT_DIR || gitRoot() || process.cwd()), customDirs = null) {
  const sourceDir = path.join(projectRoot, '.harness', 'agents');
  if (!fs.existsSync(sourceDir)) return [];
  const entries = fs.readdirSync(sourceDir).filter((file) => file.endsWith('.md')).sort();
  if (entries.length === 0) return [];

  compileRuntimePayloads(projectRoot);

  let targetDirs;
  if (customDirs && Array.isArray(customDirs) && customDirs.length > 0) {
    targetDirs = customDirs.map((d) => (path.isAbsolute(d) ? d : path.join(projectRoot, d)));
  } else {
    let configured = null;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, '.harness', 'config', 'thresholds.json'), 'utf8'));
      if (Array.isArray(cfg.agent_sync_dirs) && cfg.agent_sync_dirs.length > 0) configured = cfg.agent_sync_dirs;
    } catch {}

    if (configured) {
      targetDirs = configured.map((d) => (path.isAbsolute(d) ? d : path.join(projectRoot, d)));
    } else {
      targetDirs = [
        path.join(projectRoot, '.claude', 'agents'),
        path.join(projectRoot, '.agents'),
      ];
    }
  }

  // Clean up deprecated v2.0 files not present in sourceDir
  const sourceEntries = new Set(entries);
  const deprecatedAgents = [
    'elephant.md',
    'goldfish-coder.md',
    'goldfish-verifier.md',
    'librarian.md',
    'git-clerk.md',
  ].filter((dep) => !sourceEntries.has(dep));

  const cleanupDirs = [
    ...targetDirs,
    path.join(projectRoot, '.agents', 'workflows'),
  ];

  for (const cDir of cleanupDirs) {
    if (fs.existsSync(cDir)) {
      for (const dep of deprecatedAgents) {
        const depPath = path.join(cDir, dep);
        if (fs.existsSync(depPath)) {
          fs.rmSync(depPath, { force: true });
        }
      }
    }
  }

  const synced = [];
  for (const targetDir of targetDirs) {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const file of entries) {
      const srcFile = path.join(sourceDir, file);
      const dstFile = path.join(targetDir, file);
      const content = fs.readFileSync(srcFile, 'utf8');
      if (!fs.existsSync(dstFile) || fs.readFileSync(dstFile, 'utf8') !== content) {
        atomicWriteFileSync(dstFile, content, 'utf8');
        synced.push(path.relative(projectRoot, dstFile));
      }
    }
  }
  return synced;
}

// Cloud sessions clone every attached repo side by side, so look next to (and one level around) the project
export function findSibling(root = (process.env.CLAUDE_PROJECT_DIR || gitRoot() || process.cwd()), hubConfig = { repo: 'claude-harness-hub' }) {
  const candidates = [process.env.HARNESS_HUB_DIR, path.join(root, '..', hubConfig.repo)].filter(Boolean);
  const parent = path.dirname(root);
  try {
    for (const d of fs.readdirSync(parent, { withFileTypes: true })) if (d.isDirectory()) candidates.push(path.join(parent, d.name));
  } catch {}
  return candidates.map((c) => path.resolve(c)).find((c) => c !== path.resolve(root) && fs.existsSync(path.join(c, '.harness')) && isHubCheckout(c, hubConfig));
}

export const notAttached = (hubConfig = { repo: 'claude-harness-hub' }) => {
  console.log([
    'HUB_NOT_ATTACHED: no checkout of the harness hub was found next to this project.',
    '---',
    'Needed from you:',
    `1. Step 1: In Claude Code on the web, open this session's repository picker (the repo chip above the prompt box) -> Step 2: Add "${hubConfig.owner ? `${hubConfig.owner}/` : ''}${hubConfig.repo}" and start a new session with both repos attached, then re-run the command.`,
    `   Last resort (only if attaching is impossible): in your own Terminal run \`git clone https://github.com/${hubConfig.owner || '<owner>'}/${hubConfig.repo} /tmp/${hubConfig.repo}\` and re-run with HARNESS_HUB_DIR=/tmp/${hubConfig.repo}.`,
  ].join('\n'));
};

// Merge the spoke's settings. settings.spoke.json is the source of truth for spoke permissions; settings.json is
// generated from it. Hub hooks win, and hub deny beats any allow.
export function syncSettings(hubRoot, extrasFile, previousGenerated, spokeRoot = (process.env.CLAUDE_PROJECT_DIR || gitRoot() || process.cwd())) {
  const hubSettings = readJson(path.join(hubRoot, '.claude', 'settings.json'));
  if (!hubSettings) return { note: 'hub settings missing', generated: previousGenerated };
  const spokeFile = path.join(spokeRoot, '.claude', 'settings.json');
  const spokeSettings = readJson(spokeFile) || {};
  const stored = readJson(extrasFile) || {};
  const storedPerm = { allow: stored.permissions?.allow || [], deny: stored.permissions?.deny || [] };

  // Hand-added permissions move into the spoke file; generated ones are never re-harvested
  const harvested = harvestSpokePermissions(spokeSettings, hubSettings, previousGenerated);
  const extras = {
    allow: [...new Set([...storedPerm.allow, ...harvested.allow])],
    deny: [...new Set([...storedPerm.deny, ...harvested.deny])],
  };
  if (extras.allow.length || extras.deny.length) {
    fs.mkdirSync(path.dirname(extrasFile), { recursive: true });
    atomicWriteFileSync(extrasFile, JSON.stringify({ permissions: extras }, null, 2) + '\n', 'utf8');
  }

  // Drop the old generated permissions from the base so removals in settings.spoke.json stick
  const next = mergeSettings(hubSettings, { ...spokeSettings, permissions: {} }, extras);
  fs.mkdirSync(path.dirname(spokeFile), { recursive: true });
  atomicWriteFileSync(spokeFile, JSON.stringify(next, null, 2) + '\n', 'utf8');
  const count = harvested.allow.length + harvested.deny.length;
  return {
    note: `${count} hand-added permission(s) moved to settings.spoke.json`,
    generated: next.permissions,
  };
}

// Pull every hub-owned file. Returns a receipt object; never throws on a single file conflict.
export function pullFromHub(hubRoot, spokeRoot = (process.env.CLAUDE_PROJECT_DIR || gitRoot() || process.cwd())) {
  const manifest = readManifest(spokeRoot);
  const migrating = manifest === null;
  const previous = manifest?.files || {};
  const hubFiles = listHubOwned(hubRoot);
  const hubSet = new Set(hubFiles);
  const files = {};
  const receipt = { written: [], conflicts: [], deleted: [], backedUp: [], notes: [] };
  let settingsGenerated = manifest?.settingsGenerated ?? null;
  const backupDir = path.join(spokeRoot, '.harness-backup', new Date().toISOString().replace(/[:.]/g, '-'));

  // First sync on a spoke with no manifest: keep spoke learned rules, back up anything that differs
  if (migrating) {
    const spokeRules = readText(path.join(spokeRoot, '.claude', 'harness-rules.md'));
    const hubRules = readText(path.join(hubRoot, '.claude', 'harness-rules.md'));
    const keep = learnedRulesToKeep(spokeRules, hubRules);
    if (keep.length) {
      const projectRulesPath = path.join(spokeRoot, PROJECT_RULES);
      fs.mkdirSync(path.dirname(projectRulesPath), { recursive: true });
      atomicWriteFileSync(projectRulesPath, appendActiveRules(readText(projectRulesPath), keep), 'utf8');
      receipt.notes.push(`moved ${keep.length} learned rule(s) from harness-rules.md to ${PROJECT_RULES}`);
    }
  }

  for (const rel of hubFiles) {
    const src = path.join(hubRoot, rel);
    const dest = path.join(spokeRoot, rel);
    const hubBuf = fs.readFileSync(src);
    const hubHash = sha256(hubBuf);
    const exists = fs.existsSync(dest);
    const localHash = exists ? sha256(fs.readFileSync(dest)) : null;

    if (exists && localHash === hubHash) { files[rel] = hubHash; continue; }

    if (exists && !migrating && localHash !== previous[rel]) {
      // The spoke edited this file, or it was never synced: keep the spoke copy and report it
      // Keep the last hash we wrote, so the file stays a conflict until someone resolves it
      if (previous[rel] !== undefined) files[rel] = previous[rel];
      receipt.conflicts.push(rel);
      continue;
    }
    if (exists && migrating) {
      fs.mkdirSync(path.join(backupDir, path.dirname(rel)), { recursive: true });
      fs.copyFileSync(dest, path.join(backupDir, rel));
      receipt.backedUp.push(rel);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    atomicWriteFileSync(dest, hubBuf);
    files[rel] = hubHash;
    receipt.written.push(rel);
  }

  // Files the hub removed: delete only if the spoke copy is still exactly what we last wrote
  for (const rel of Object.keys(previous)) {
    if (hubSet.has(rel)) continue;
    const dest = path.join(spokeRoot, rel);
    if (!fs.existsSync(dest)) continue;
    if (sha256(fs.readFileSync(dest)) === previous[rel]) {
      fs.rmSync(dest, { force: true });
      receipt.deleted.push(rel);
    } else {
      files[rel] = previous[rel];
      receipt.conflicts.push(`${rel} (removed in hub, but edited here)`);
    }
  }

  // Merged files: only the marked block (or the permission lists) is the hub's
  const hubGitignore = readText(path.join(hubRoot, '.harness', 'templates', 'gitignore.block'));
  const gitignorePath = path.join(spokeRoot, '.gitignore');
  atomicWriteFileSync(gitignorePath, mergeBlock(readText(gitignorePath), hubGitignore, GITIGNORE_MARKERS), 'utf8');
  const hubAgents = readText(path.join(hubRoot, '.harness', 'templates', 'AGENTS.block.md'));
  const agentsPath = path.join(spokeRoot, 'AGENTS.md');
  atomicWriteFileSync(agentsPath, mergeBlock(readText(agentsPath), hubAgents, AGENTS_MARKERS), 'utf8');
  compileRuntimePayloads(spokeRoot);
  const settingsResult = syncSettings(hubRoot, path.join(spokeRoot, SETTINGS_SPOKE), manifest?.settingsGenerated ?? null, spokeRoot);
  receipt.notes.push(settingsResult.note);
  settingsGenerated = settingsResult.generated;

  // Templates the spoke may customise: copied once, never overwritten
  for (const rel of TEMPLATE_ONLY) {
    const src = path.join(hubRoot, rel);
    const dest = path.join(spokeRoot, rel);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      receipt.written.push(`${rel} (template, first copy)`);
    }
  }

  // CI workflow templates: copied to .github/workflows once when missing, then the spoke owns them
  for (const rel of hubFiles) {
    const dest = workflowDestination(rel);
    if (!dest || fs.existsSync(path.join(spokeRoot, dest))) continue;
    fs.mkdirSync(path.join(spokeRoot, path.dirname(dest)), { recursive: true });
    fs.copyFileSync(path.join(hubRoot, rel), path.join(spokeRoot, dest));
    receipt.written.push(`${dest} (CI template, first copy)`);
  }

  // Synchronize canonical subagent templates from .harness/agents/ to .claude/agents/ and .agents/
  const syncedAgents = syncAgents(spokeRoot);
  if (syncedAgents.length) {
    receipt.written.push(...syncedAgents);
  }

  // Keep the old hash for conflicted files so they stay conflicted until resolved
  writeManifest(spokeRoot, files, readText(path.join(spokeRoot, '.harness-version'), '').trim() || 'unknown', settingsGenerated);
  return { receipt, migrating };
}

export function describe(hubRoot, { receipt, migrating }, spokeRoot = (process.env.CLAUDE_PROJECT_DIR || gitRoot() || process.cwd())) {
  const version = readText(path.join(spokeRoot, '.harness-version'), '').trim() || 'unknown';
  const lines = [`✓ Pulled hub-owned files from ${path.relative(spokeRoot, hubRoot) || hubRoot} (harness v${version}).`];
  if (migrating) lines.push('First sync on this project: manifest created.');
  if (receipt.written.length) lines.push(`Updated ${receipt.written.length}: ${receipt.written.join(', ')}`);
  if (receipt.deleted.length) lines.push(`Removed ${receipt.deleted.length} file(s) the hub deleted: ${receipt.deleted.join(', ')}`);
  if (receipt.backedUp.length) lines.push(`Backed up ${receipt.backedUp.length} differing file(s) to .harness-backup/: ${receipt.backedUp.join(', ')}`);
  if (receipt.conflicts.length) lines.push(`⚠ Not overwritten (edited here or never synced): ${receipt.conflicts.join(', ')}. Review them, then delete the local copy to take the hub version.`);
  for (const note of receipt.notes) lines.push(`- ${note}`);
  lines.push('Spoke-owned files (CLAUDE.md, .spec/ except templates, project-rules.md) were not touched.');
  console.log(lines.join('\n'));
}

// init: create the spoke skeleton where files are missing, then pull the engine
export function init(hubRoot, spokeRoot = (process.env.CLAUDE_PROJECT_DIR || gitRoot() || process.cwd())) {
  fs.mkdirSync(spokeRoot, { recursive: true });
  const skeleton = path.join(hubRoot, '.harness', 'templates', 'spoke');
  const created = [];
  const place = (rel, from) => {
    const dest = path.join(spokeRoot, rel);
    if (fs.existsSync(dest)) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(from, dest);
    created.push(rel);
  };
  place('CLAUDE.md', path.join(skeleton, 'CLAUDE.md'));
  place('.claude/project-rules.md', path.join(skeleton, 'project-rules.md'));
  for (const name of ['PROGRESS.md', 'SYSTEM_SPEC.md', 'OVERVIEW.md', 'DECISIONS.md', 'SESSION_HANDOFF.md']) {
    place(`.spec/${name}`, path.join(skeleton, name));
  }
  place('.spec/harness.json', path.join(skeleton, 'harness.json'));
  if (!fs.existsSync(path.join(spokeRoot, '.harness-version'))) {
    fs.copyFileSync(path.join(hubRoot, '.harness-version'), path.join(spokeRoot, '.harness-version'));
  }
  return created;
}

export function main(argv = process.argv.slice(2)) {
  ensureHarnessRoot();
  const action = (argv[0] || 'pull').toLowerCase();
  const targetFlag = argv.indexOf('--target');
  const targetArg = targetFlag !== -1 ? argv[targetFlag + 1] : '';
  const root = targetArg ? path.resolve(targetArg) : (process.env.CLAUDE_PROJECT_DIR || gitRoot() || process.cwd());
  const stagingFile = path.join(root, '.spec', '.learn-staging.txt');
  const hub = (() => {
    try { return { repo: 'claude-harness-hub', branch: 'main', ...JSON.parse(fs.readFileSync(path.join(root, '.harness', 'hub.json'), 'utf8')) }; } catch { return { repo: 'claude-harness-hub', branch: 'main' }; }
  })();

  if (!['pull', 'push', 'init', 'sync-agents'].includes(action)) {
    console.log(`✗ Unknown action "${action}". Use pull, push, init --target <dir>, or sync-agents.`);
    process.exit(0);
  }

  if (action === 'sync-agents') {
    compileRuntimePayloads(root);
    const synced = syncAgents(root);
    console.log(`✓ Synchronized ${synced.length} agent template(s): ${synced.join(', ') || 'already up to date'}.`);
    process.exit(0);
  }

  let note = 'Sync harness engine files';
  if (action === 'push' && fs.existsSync(stagingFile)) {
    note = fs.readFileSync(stagingFile, 'utf8').trim().split('\n')[0] || note;
    fs.unlinkSync(stagingFile);
  }

  // Running inside the hub repo itself: commit engine files on the current branch
  if (action !== 'init' && isHubCheckout(root, hub)) {
    if (action === 'pull') {
      compileRuntimePayloads(root);
      syncAgents(root);
      console.log(`✓ This is the ${hub.repo} repo itself; engine files are already the source of truth.`);
    } else {
      try {
        gitIn(root, 'add', '--', '.claude', '.harness', '.harness-version');
        gitIn(root, 'commit', '-m', `chore(harness): ${note}`, '--', '.claude', '.harness', '.harness-version');
        console.log(`✓ Committed rule in the hub repo on ${gitIn(root, 'branch', '--show-current')} ("${note}"). Push the branch and open a PR via GitHub MCP.`);
      } catch (err) {
        console.log(`✓ Rule saved in .claude/harness-rules.md, but nothing was committed. Git said: ${reason(err)}`);
      }
    }
    process.exit(0);
  }

  const sibling = findSibling(root, hub);
  if (!sibling) {
    if (action === 'push') {
      console.log('✓ Local rule saved to .claude/harness-rules.md (not synced to hub).');
      notAttached(hub);
      process.exit(0);
    }
    if (action === 'init') {
      console.log('✗ init needs the hub checkout next to the target. Attach the hub repo, or set HARNESS_HUB_DIR, then re-run.');
    } else {
      notAttached(hub);
    }
    process.exit(0);
  }

  if (action === 'push') {
    // push: add the learned rule to the hub's rules file on a fresh claude/learn-* branch, then push it
    const slug = note.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'rule';
    const branch = `claude/learn-${slug}-${Date.now().toString(36)}`;
    try {
      if (gitIn(sibling, 'status', '--porcelain')) throw new Error(`hub checkout ${sibling} has uncommitted changes; commit or stash them first`);
      let base = hub.branch;
      try { gitIn(sibling, 'fetch', 'origin', hub.branch); base = `origin/${hub.branch}`; } catch {}
      gitIn(sibling, 'checkout', '-b', branch, base);
      const rulesPath = path.join(sibling, '.claude', 'harness-rules.md');
      const rules = fs.readFileSync(rulesPath, 'utf8');
      const line = `- ${note}`;
      if (!rules.includes(line)) {
        const header = '## Learned Operator Rules';
        const next = rules.includes(header) ? rules.replace(/\s*$/, `\n${line}\n`) : `${rules.trimEnd()}\n\n${header} (Synced via \`/learn\`)\n${line}\n`;
        atomicWriteFileSync(rulesPath, next);
      }
      gitIn(sibling, 'add', '--', '.claude/harness-rules.md');
      gitIn(sibling, 'commit', '-m', `chore(harness): learn "${note}"`);
      gitIn(sibling, 'push', '-u', 'origin', branch);
      console.log(`HUB_BRANCH_PUSHED repo=${hub.owner ? `${hub.owner}/` : ''}${hub.repo} branch=${branch} base=${hub.branch}: open a PR for this branch via GitHub MCP, then report "PR opened".`);
    } catch (err) {
      console.log(`✓ Local rule saved to .claude/harness-rules.md, but the hub push failed. Git said: ${reason(err)}`);
    }
    process.exit(0);
  }

  if (action === 'init') {
    const created = init(sibling, root);
    console.log(`✓ Created ${created.length} starter file(s): ${created.join(', ') || 'none (all existed)'}. Spoke mode set to manager in .spec/harness.json.`);
  }
  try { gitIn(sibling, 'pull', '--ff-only', '--quiet'); } catch {} // best effort; offline copy still works
  describe(sibling, pullFromHub(sibling, root), root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
