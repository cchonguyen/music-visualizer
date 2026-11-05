// Pure helpers for hub-sync: file ownership, manifest hashes, marker-block merges, settings merges.
// Zero dependencies. Nothing here touches git or the network.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MANAGED_FILE = '.harness/managed.json';
export const SETTINGS_SPOKE = '.claude/settings.spoke.json';
export const PROJECT_RULES = '.claude/project-rules.md';
export const RULES_HEADER = '## Learned Operator Rules';
export const ACTIVE_RULES_HEADER = '## Active Project Rules';

// Marker blocks: the hub owns only the text between the markers. Everything else in the file is the spoke's.
export const GITIGNORE_MARKERS = ['# >>> harness >>>', '# <<< harness <<<'];
export const AGENTS_MARKERS = ['<!-- >>> harness >>> -->', '<!-- <<< harness <<< -->'];

// Spoke-owned files that the hub may create once, but never overwrites afterwards
export const TEMPLATE_ONLY = ['.spec/AI_STUDIO_RULES.md'];

// CI workflow templates ship in the hub; a spoke gets its own copy once, in .github/workflows
export const WORKFLOW_TEMPLATE_DIR = '.harness/templates/workflows/';
export const SPOKE_WORKFLOW_DIR = '.github/workflows/';
export const workflowDestination = (rel) =>
  rel.startsWith(WORKFLOW_TEMPLATE_DIR) && rel.endsWith('.yml') ? SPOKE_WORKFLOW_DIR + path.basename(rel) : null;

const SPOKE_OWNED = [/^CLAUDE\.md$/, /^\.claude\/project-rules\.md$/, /^\.claude\/settings\.spoke\.json$/, /^\.spec\//];

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Walk the hub checkout and list every file the hub owns. Spoke-owned paths are excluded.
export function listHubOwned(hubRoot) {
  const out = [];
  const walk = (dirRel) => {
    const abs = path.join(hubRoot, dirRel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const rel = `${dirRel}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  walk('.harness');
  walk('.claude/agents');
  walk('.claude/commands');
  walk('plugins/harness');
  for (const rel of ['.claude/harness-rules.md', '.harness-version', '.spec/EXTERNAL_AGENT_RULES.md']) {
    if (fs.existsSync(path.join(hubRoot, rel))) out.push(rel);
  }
  return [...new Set(out)].filter((rel) => rel !== MANAGED_FILE).sort();
}

export const isSpokeOwned = (rel) => SPOKE_OWNED.some((re) => re.test(rel));

export function readManifest(root) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, MANAGED_FILE), 'utf8'));
    return data && typeof data.files === 'object' ? data : null;
  } catch {
    return null;
  }
}

// settingsGenerated: the permission lists last written into .claude/settings.json, so the next pull can tell
// a permission the spoke added by hand from one the harness generated.
export function writeManifest(root, files, version, settingsGenerated) {
  const abs = path.join(root, MANAGED_FILE);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const data = { version, files: sorted, settingsGenerated: settingsGenerated || null };
  fs.writeFileSync(abs, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// Permissions the spoke added by hand since the last pull: in settings.json, but neither in the hub
// nor in what the harness generated last time. Entries the spoke removed from settings.spoke.json stay removed.
export function harvestSpokePermissions(spokeSettings, hubSettings, previousGenerated) {
  const hubPerm = hubSettings.permissions || {};
  const prev = previousGenerated || { allow: [], deny: [] };
  const spokePerm = spokeSettings.permissions || {};
  const pick = (key) => {
    const skip = new Set([...(hubPerm[key] || []), ...(prev[key] || [])]);
    return (spokePerm[key] || []).filter((entry) => !skip.has(entry));
  };
  return { allow: pick('allow'), deny: pick('deny') };
}

// Replace the text between two markers, or append a fresh block if the markers are absent.
export function mergeBlock(text, body, [start, end]) {
  const block = `${start}\n${body.trimEnd()}\n${end}`;
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from !== -1 && to > from) {
    return text.slice(0, from) + block + text.slice(to + end.length);
  }
  const base = text.trimEnd();
  return (base ? base + '\n\n' : '') + block + '\n';
}

// Hub `deny` always wins: an allow entry that the hub denies is dropped.
export function mergeSettings(hub, spoke, spokeExtra) {
  const hubPerm = hub.permissions || {};
  const spokePerm = spoke.permissions || {};
  const extra = spokeExtra || {};
  const deny = unique([...(hubPerm.deny || []), ...(spokePerm.deny || []), ...(extra.deny || [])]);
  const denied = new Set(deny);
  const allow = unique([...(hubPerm.allow || []), ...(spokePerm.allow || []), ...(extra.allow || [])])
    .filter((entry) => !denied.has(entry));
  return {
    ...(hub.model ? { model: hub.model } : {}),
    ...spoke,
    hooks: hub.hooks ?? spoke.hooks,
    permissions: { ...(spoke.permissions || {}), allow, deny },
  };
}

// Permission entries the spoke has that the hub does not. These are kept in settings.spoke.json.
export function spokeOnlyPermissions(spoke, hub) {
  const hubPerm = hub.permissions || {};
  const spokePerm = spoke.permissions || {};
  const pick = (key) => {
    const hubSet = new Set(hubPerm[key] || []);
    return (spokePerm[key] || []).filter((entry) => !hubSet.has(entry));
  };
  return { allow: pick('allow'), deny: pick('deny') };
}

export function unique(list) {
  return [...new Set(list)];
}

// Lines under "## Learned Operator Rules" in the spoke that the hub copy does not already contain.
export function learnedRulesToKeep(spokeRules, hubRules) {
  const hubLines = new Set(hubRules.split('\n').map((line) => line.trim()));
  const kept = [];
  let inSection = false;
  // Walk every line: a spoke may have appended rules under a second copy of the header
  for (const raw of spokeRules.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) { inSection = line === RULES_HEADER; continue; }
    if (inSection && line.startsWith('- ') && !hubLines.has(line) && !kept.includes(line)) kept.push(line);
  }
  return kept;
}

// Add rule lines under "## Active Project Rules" in project-rules.md, skipping duplicates.
export function appendActiveRules(projectRulesText, lines) {
  const existing = new Set(projectRulesText.split('\n').map((line) => line.trim()));
  const fresh = lines.filter((line) => !existing.has(line));
  if (fresh.length === 0) return projectRulesText;
  let text = projectRulesText.trimEnd();
  if (!text.includes(ACTIVE_RULES_HEADER)) {
    text = (text ? text + '\n\n' : '# Project Rules\n\n') + ACTIVE_RULES_HEADER + '\n';
  }
  return text + '\n' + fresh.join('\n') + '\n';
}
