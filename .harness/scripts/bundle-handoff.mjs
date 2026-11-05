#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import os from 'node:os';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MODES = { spec: 'spec', audit: 'spec', arch: 'spec', overview: 'spec', diff: 'diff' };
const asked = (process.argv[2] || 'diff').toLowerCase();
let mode = MODES[asked];
const readSafe = (rel) => {
  const p = path.join(root, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '_Not yet created_';
};

if (!mode) {
  console.log(`✗ Unknown mode "${asked}". Use /prep-audit spec (or audit, arch, overview) or /prep-audit diff.`);
  process.exit(0);
}

const SOURCES = ['.spec/OVERVIEW.md', '.spec/SYSTEM_SPEC.md', '.spec/PROGRESS.md'];
const [overview, spec, progress] = SOURCES.map(readSafe);
const REF_EXT = 'md|mdx|sql|json|jsonc|toml|yaml|yml|txt';
const MAX_REF_LINES = 400;
const STUB_LINES = 60;

// Never inline secrets, dependencies, git internals or the packet itself
const blocked = (rel) => {
  const parts = rel.split('/');
  return rel === '.spec/HANDOFF_PACKET.md' || rel === '.spec/DEBUG_PACKET.md'
    || parts.some((p) => p === 'node_modules' || p === '.git' || p.startsWith('.env') || p.startsWith('.dev.vars'));
};

// Local files the spec docs point to: [text](path) links, `path.ext` code spans, bare REQUIREMENTS.md / ARCHITECTURE.md
const collectReferences = (sources) => {
  const realRoot = fs.realpathSync(root);
  const skip = new Set(sources.map(({ rel }) => rel));
  const found = new Map();
  const linkRe = new RegExp(`\\[[^\\]]*\\]\\(\\s*<?([^)\\s>#]+\\.(?:${REF_EXT}))(?:#[^)\\s>]*)?>?[^)]*\\)`, 'gi');
  const codeRe = new RegExp(`\`((?:\\.{0,2}/)?(?:[\\w.-]+/)*[\\w.-]+\\.(?:${REF_EXT}))\``, 'gi');
  for (const { rel, text } of sources) {
    const candidates = [];
    for (const m of text.matchAll(linkRe)) candidates.push(m[1]);
    for (const m of text.matchAll(codeRe)) candidates.push(m[1]);
    for (const m of text.matchAll(/[\w./-]*\b(?:REQUIREMENTS|ARCHITECTURE)\.md\b/g)) candidates.push(m[0]);
    for (const raw of candidates) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) continue;
      let ref = raw;
      try { ref = decodeURIComponent(raw); } catch { /* keep raw */ }
      const bases = [path.dirname(path.join(root, rel)), root];
      for (const base of bases) {
        const abs = ref.startsWith('/') ? path.join(root, ref) : path.resolve(base, ref);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
        const real = fs.realpathSync(abs);
        const relPath = path.relative(realRoot, real).split(path.sep).join('/');
        if (relPath.startsWith('..') || path.isAbsolute(relPath) || skip.has(relPath) || blocked(relPath)) continue;
        if (!found.has(relPath)) found.set(relPath, fs.readFileSync(real, 'utf8'));
        break;
      }
    }
  }
  return found;
};

const capLines = (text) => {
  const lines = text.replace(/\n$/, '').split('\n');
  if (lines.length <= MAX_REF_LINES) return lines.join('\n');
  return `${lines.slice(0, MAX_REF_LINES).join('\n')}\n\n_[Truncated: ${lines.length - MAX_REF_LINES} more lines in this file]_`;
};

const specPayload = () => {
  let out = `@arch-auditor Please conduct an adversarial architecture and scope audit on the following specification. Surface blind spots, edge cases, over-engineering, and verify [UI / VISUAL] vs [CORE / DATA] risk tags.\n\n# OVERVIEW\n${overview}\n\n# SYSTEM SPEC\n${spec}\n\n# PROGRESS & TASKS\n${progress}`;
  const refs = collectReferences(SOURCES.map((rel, i) => ({ rel, text: [overview, spec, progress][i] })));
  if (refs.size > 0) {
    out += '\n\n# APPENDED REFERENCES';
    for (const [rel, text] of refs) out += `\n\n## Reference: ${rel}\n${capLines(text)}`;
  }
  return { out, refCount: refs.size };
};

let payload = '';
let refCount = 0;
let note = '';
let lockNote = '';
if (mode === 'diff') {
  // Diff against HEAD through a throwaway copy of the index, so intent-to-add never touches the real one
  let diff = '';
  let diffFailed = false;
  const tmpIndex = path.join(os.tmpdir(), `harness-bundle-index-${process.pid}`);
  const run = (cmd, env = {}) => execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 10 * 1024 * 1024, env: { ...process.env, ...env } });
  // The packet itself and secret files never enter the diff, even when a repo forgot to ignore them
  // Lockfiles are machine output: left out of the diff, and named in a one-line note instead
  const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'uv.lock', 'poetry.lock', 'Pipfile.lock', 'Cargo.lock', 'go.sum', 'Gemfile.lock', 'composer.lock'];
  const lockPaths = LOCKFILES.map((f) => `':(glob)**/${f}'`).join(' ');
  const scope = `-- . ':(exclude).spec/HANDOFF_PACKET.md' ':(exclude).spec/DEBUG_PACKET.md' ':(exclude,glob)**/.env*' ':(exclude,glob)**/.dev.vars*' ${LOCKFILES.map((f) => `':(exclude,glob)**/${f}'`).join(' ')}`;
  try {
    const realIndex = path.resolve(root, run('git rev-parse --git-path index').trim());
    if (fs.existsSync(realIndex)) fs.copyFileSync(realIndex, tmpIndex);
    run(`git add -N ${scope}`, { GIT_INDEX_FILE: tmpIndex });
    diff = run(`git diff HEAD ${scope}`, { GIT_INDEX_FILE: tmpIndex });
    const locks = run(`git diff --name-only HEAD -- ${lockPaths}`, { GIT_INDEX_FILE: tmpIndex }).split('\n').filter(Boolean);
    if (locks.length) lockNote = `_Lockfile changed, so the diff leaves it out: ${locks.join(', ')}_\n\n`;
  } catch {
    diffFailed = true;
    diff = '_Unable to compute git diff (not a git repo, or no commits yet)_';
  } finally {
    fs.rmSync(tmpIndex, { force: true });
  }
  if (!diffFailed && diff.trim() === '' && !lockNote) {
    mode = 'spec';
    note = ' No uncommitted changes, so it holds the spec bundle instead of an empty diff.';
  } else {
    payload = `@code-reviewer Please audit this implementation diff against our System Spec and active task slice. Identify bugs, security flaws, scope breaches, or regressions.\n\n# SYSTEM SPEC\n${spec}\n\n# ACTIVE PROGRESS\n${progress}\n\n# GIT DIFF\n${lockNote}\`\`\`diff\n${diff}\n\`\`\``;
  }
}
if (mode === 'spec') ({ out: payload, refCount } = specPayload());

const outPath = path.join(root, '.spec', 'HANDOFF_PACKET.md');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, payload, 'utf8');

const lineCount = payload.split('\n').length;
const refsNote = mode === 'spec' ? `, ${refCount} reference${refCount === 1 ? '' : 's'} appended` : '';
const stub = mode === 'spec' && lineCount < STUB_LINES && refCount === 0
  ? ` ⚠ Warning: Spec bundle is under ${STUB_LINES} lines with 0 resolved references. Populate .spec/SYSTEM_SPEC.md before auditing.`
  : '';
let where = 'open it in the file panel to copy';
if (os.platform() === 'darwin') {
  where = spawnSync('pbcopy', { input: payload }).status === 0
    ? 'auto-copied to macOS Clipboard'
    : 'Clipboard unavailable; open file to copy';
}
console.log(`✓ ${mode === 'spec' ? 'Spec' : 'Diff'} packet saved to .spec/HANDOFF_PACKET.md (${lineCount} lines${refsNote}); ${where}.${note}${stub}`);
