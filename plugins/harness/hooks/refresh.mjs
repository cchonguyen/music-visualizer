#!/usr/bin/env node
// SessionStart self-refresh (Slice 10.6). Copies the repo's plugins/harness over an older installed copy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_PLUGIN = path.join('plugins', 'harness');

export function readVersion(dir) {
  try {
    const text = fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8');
    return JSON.parse(text).version || '';
  } catch {
    return '';
  }
}

export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => Number(n) || 0);
  const pb = String(b).split('.').map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export function refreshPlugin({ repoRoot, installedDir }) {
  const source = path.join(repoRoot, REPO_PLUGIN);
  const repoVersion = readVersion(source);
  if (!repoVersion) return { action: 'skip', reason: 'repo has no plugins/harness' };
  if (path.resolve(source) === path.resolve(installedDir)) {
    return { action: 'skip', reason: 'same directory' };
  }
  const installed = readVersion(installedDir);
  if (installed && compareVersions(repoVersion, installed) <= 0) {
    return { action: 'skip', reason: 'installed copy is current', installed, repoVersion };
  }
  const staged = `${installedDir}.refresh-${process.pid}`;
  const backup = `${installedDir}.backup-${process.pid}`;
  fs.rmSync(staged, { recursive: true, force: true });
  fs.cpSync(source, staged, { recursive: true });
  fs.mkdirSync(path.dirname(installedDir), { recursive: true });
  if (fs.existsSync(installedDir)) fs.renameSync(installedDir, backup);
  fs.renameSync(staged, installedDir);
  fs.rmSync(backup, { recursive: true, force: true });
  return { action: 'refreshed', from: installed, to: repoVersion };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  const repoRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const installedDir = process.env.CLAUDE_PLUGIN_ROOT
    || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    refreshPlugin({ repoRoot, installedDir });
  } catch (err) {
    process.stderr.write(`harness refresh failed: ${err.message}\n`);
  }
  process.exit(0);
}
