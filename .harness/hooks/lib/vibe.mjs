// Vibe Mode helpers: whole-tree snapshots through a throwaway index, keyed by session_id
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const gitIn = (cwd, args, env = {}) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } }).trim();

export const resolveRoot = () => {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  try { return gitIn(process.cwd(), ['rev-parse', '--show-toplevel']); } catch { return process.cwd(); }
};

// Marker counts only right after the bold title or at line end (same rule as slice-parser).
export const ACTIVE_TASK = /^\s*-\s*\[.\][^*]*\*\*[^*]+\*\*(?: \[IN_PROGRESS\]|.* \[IN_PROGRESS\]\s*$)/;
export const VIBE_EXCLUDES = ['.spec/', '.claude/', '.harness/'];

export const activeLines = (root) => {
  const p = path.join(root, '.spec', 'PROGRESS.md');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter((l) => ACTIVE_TASK.test(l));
};
// Spoke-owned work mode from .spec/harness.json. A missing or unreadable file keeps 'vibe' (v2.2 behavior).
export const workModeOf = (root) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, '.spec', 'harness.json'), 'utf8'));
    return data.workMode === 'manager' ? 'manager' : 'vibe';
  } catch {
    return 'vibe';
  }
};

// 0 active + vibe -> 'vibe'; 0 active + manager -> 'locked' (plan first); 1 -> 'slice'; 2+ -> 'conflict'
export const modeOf = (root) => {
  const n = activeLines(root).length;
  if (n === 0) return workModeOf(root) === 'manager' ? 'locked' : 'vibe';
  return n === 1 ? 'slice' : 'conflict';
};

const checkpointPath = (root) => path.join(root, '.spec', '.vibe-checkpoint.json');
export const readCheckpoints = (root) => {
  try { return JSON.parse(fs.readFileSync(checkpointPath(root), 'utf8')); } catch { return {}; }
};
const writeCheckpoints = (root, all) => {
  // Keep only the 20 most recent sessions so the file cannot grow without bound
  const keep = Object.entries(all).sort((a, b) => String(b[1].updatedAt).localeCompare(String(a[1].updatedAt))).slice(0, 20);
  fs.mkdirSync(path.dirname(checkpointPath(root)), { recursive: true });
  fs.writeFileSync(checkpointPath(root), JSON.stringify(Object.fromEntries(keep), null, 2));
};

const IDENTITY = { GIT_AUTHOR_NAME: 'claude-harness', GIT_AUTHOR_EMAIL: 'harness@localhost', GIT_COMMITTER_NAME: 'claude-harness', GIT_COMMITTER_EMAIL: 'harness@localhost' };

// Commit-object snapshot of the working tree (tracked + untracked, minus .gitignore). Real index and files untouched.
export function snapshotTree(root, message = 'harness: vibe checkpoint') {
  const tmpIndex = path.join(os.tmpdir(), `harness-vibe-index-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    let head = '';
    try { head = gitIn(root, ['rev-parse', '--verify', 'HEAD']); } catch {}
    if (head) gitIn(root, ['read-tree', head], env);
    gitIn(root, ['add', '-A', '--', '.'], env);
    const tree = gitIn(root, ['write-tree'], env);
    return gitIn(root, ['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', message], IDENTITY);
  } catch {
    return ''; // not a git repo, or git missing: Vibe Mode runs without checkpoints
  } finally {
    fs.rmSync(tmpIndex, { force: true });
  }
}

export function saveCheckpoint(root, sessionId, green) {
  const sha = snapshotTree(root, `harness: vibe checkpoint (${green ? 'green' : 'baseline'})`);
  if (!sha) return '';
  try { gitIn(root, ['update-ref', `refs/harness/vibe/${sessionId.replace(/[^\w.-]/g, '_')}`, sha]); } catch {}
  const all = readCheckpoints(root);
  all[sessionId] = { sha, green, updatedAt: new Date().toISOString() };
  writeCheckpoints(root, all);
  return sha;
}

export const ensureBaseline = (root, sessionId) => {
  if (!readCheckpoints(root)[sessionId]) saveCheckpoint(root, sessionId, false);
};

// Files that differ from a checkpoint: { restore: [...present in ckpt], remove: [...created since] }
export function diffSince(root, sha) {
  const cur = snapshotTree(root, 'harness: vibe diff probe');
  if (!cur) return { restore: [], remove: [] };
  const out = gitIn(root, ['diff', '--name-status', '--no-renames', '-z', sha, cur, '--', '.', ...VIBE_EXCLUDES.map((d) => `:(exclude)${d}`)]);
  const parts = out.split('\0').filter(Boolean);
  const restore = [];
  const remove = [];
  for (let i = 0; i + 1 < parts.length; i += 2) (parts[i] === 'A' ? remove : restore).push(parts[i + 1]);
  return { restore, remove };
}
