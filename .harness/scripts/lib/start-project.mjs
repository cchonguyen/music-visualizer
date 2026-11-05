// Cold-start project setup: inspect which harness files exist, plan the missing ones, and write only those.
// Zero dependencies. Nothing here overwrites a file: every write uses the 'wx' flag, which fails if the file exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'spoke',
);

// Template file -> where it lands in the project, and the plain-English name shown to the owner.
export const SCAFFOLD = [
  { template: 'CLAUDE.md', dest: 'CLAUDE.md', label: 'project brief for Claude' },
  { template: 'OVERVIEW.md', dest: '.spec/OVERVIEW.md', label: 'plain-English overview' },
  { template: 'SYSTEM_SPEC.md', dest: '.spec/SYSTEM_SPEC.md', label: 'scope and contracts' },
  { template: 'PROGRESS.md', dest: '.spec/PROGRESS.md', label: 'slice queue' },
  { template: 'DECISIONS.md', dest: '.spec/DECISIONS.md', label: 'decision log' },
  { template: 'SESSION_HANDOFF.md', dest: '.spec/SESSION_HANDOFF.md', label: 'handoff note' },
  { template: 'harness.json', dest: '.spec/harness.json', label: 'work mode setting' },
  { template: 'project-rules.md', dest: '.claude/project-rules.md', label: 'project rules' },
];

// Top-level names that do not count as "the project already has files"
const IGNORED_TOP_LEVEL = /^(readme|license|licence|\.)/i;

export function inspectProject(root, { templatesDir = DEFAULT_TEMPLATES_DIR } = {}) {
  const topLevel = fs.existsSync(root) ? fs.readdirSync(root) : [];
  const hasProjectFiles = topLevel.some((name) => !IGNORED_TOP_LEVEL.test(name));

  const files = SCAFFOLD.map((entry) => ({
    ...entry,
    present: fs.existsSync(path.join(root, entry.dest)),
  }));
  const present = files.filter((f) => f.present);
  const missing = files.filter((f) => !f.present);
  const missingTemplates = missing
    .filter((f) => !fs.existsSync(path.join(templatesDir, f.template)))
    .map((f) => f.template);

  let state;
  if (missing.length === 0) state = 'complete';
  else if (present.length > 0) state = 'partial';
  else state = hasProjectFiles ? 'existing' : 'empty';

  return { root, templatesDir, state, hasProjectFiles, files, present, missing, missingTemplates };
}

export function workModeOf(root) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, '.spec', 'harness.json'), 'utf8'));
    return data.workMode === 'manager' ? 'manager' : 'vibe';
  } catch {
    return null;
  }
}

const STATE_TITLE = {
  empty: 'Empty folder. Nothing set up yet.',
  existing: 'Existing project with no harness setup yet. Your code will not be touched.',
  partial: 'Harness partly set up. Existing files will be left alone.',
  complete: 'Already set up. Nothing needs writing.',
};

// Plain-English lines for the owner. No file contents, only names and purposes.
export function summarize(state) {
  const lines = [`Project state: ${STATE_TITLE[state.state]}`];

  if (state.missingTemplates.length > 0) {
    lines.push(`Cannot write yet: this copy of the harness has no spoke templates for ${state.missingTemplates.join(', ')}. Run hub-sync from the hub first.`);
    return lines;
  }

  if (state.present.length > 0) {
    lines.push('Already in place (left alone):');
    for (const f of state.present) lines.push(`  - ${f.dest} (${f.label})`);
  }
  if (state.missing.length > 0) {
    lines.push(`Will create (${state.missing.length}):`);
    for (const f of state.missing) lines.push(`  - ${f.dest} (${f.label})`);
  }

  const mode = workModeOf(state.root);
  if (mode === 'manager') {
    lines.push('Work mode: Manager Mode. Source edits wait until a task is planned.');
  } else if (mode === 'vibe') {
    lines.push('Work mode: Vibe Mode. Edits are allowed without a planned task.');
  } else if (state.missing.some((f) => f.dest === '.spec/harness.json')) {
    lines.push('Work mode: will start as Manager Mode. Source edits wait until a task is planned.');
  }
  return lines;
}

// Writes only the missing files. A file that appears between inspection and write is skipped, never replaced.
export function applyScaffold(root, { templatesDir = DEFAULT_TEMPLATES_DIR } = {}) {
  const state = inspectProject(root, { templatesDir });
  if (state.missingTemplates.length > 0) {
    throw new Error(`Missing spoke templates: ${state.missingTemplates.join(', ')} in ${templatesDir}`);
  }

  const created = [];
  const skipped = [];
  for (const f of state.files) {
    if (f.present) {
      skipped.push(f.dest);
      continue;
    }
    const target = path.join(root, f.dest);
    const body = fs.readFileSync(path.join(templatesDir, f.template), 'utf8');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.writeFileSync(target, body, { encoding: 'utf8', flag: 'wx' });
      created.push(f.dest);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      skipped.push(f.dest);
    }
  }
  return { created, skipped };
}

export function receiptOf({ created, skipped }) {
  const made = created.length === 0
    ? 'No new files were needed'
    : `Created ${created.length} file(s): ${created.join(', ')}`;
  const kept = skipped.length === 0 ? '' : `. Left ${skipped.length} existing file(s) untouched`;
  return `✓ ${made}${kept}.`;
}
