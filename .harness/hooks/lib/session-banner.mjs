// SessionStart banner helpers. Warning only: nothing here blocks a session.
import fs from 'node:fs';
import path from 'node:path';

export const REPO_PLUGIN_MANIFEST = path.join('plugins', 'harness', '.claude-plugin', 'plugin.json');

/** Reads the "version" field of a plugin manifest. Returns null when missing or unreadable. */
export function readManifestVersion(file) {
  try {
    const version = JSON.parse(fs.readFileSync(file, 'utf8')).version;
    return typeof version === 'string' && version.trim() ? version.trim() : null;
  } catch {
    return null;
  }
}

/** Installed manifest path under CLAUDE_PLUGIN_ROOT, or null when that variable is unset. */
export function installedManifestPath(pluginRoot) {
  if (!pluginRoot) return null;
  return path.join(pluginRoot, '.claude-plugin', 'plugin.json');
}

/** A mismatch needs both versions and a real difference. Unknown on either side is not a mismatch. */
export function checkPluginVersion({ installed, repo }) {
  const mismatch = Boolean(installed && repo && installed !== repo);
  return { mismatch, installed: installed ?? null, repo: repo ?? null };
}

/** One-line warning banner for a version mismatch. */
export function mismatchBanner({ installed, repo }) {
  return `⚠ HARNESS PLUGIN VERSION MISMATCH: installed plugin ${installed}, repo plugin ${repo}. Warning only; session continues.`;
}
