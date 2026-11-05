#!/usr/bin/env node
// Harness plugin hook runner. Finds the repo's own .harness/hooks/adapter.mjs and
// forwards the hook payload to it, so each repo runs its own pinned hook version.
// A repo without .harness/ is left alone: the runner exits 0 and prints nothing.
// The adapter's exit code is passed through, so exit 2 still blocks the tool call.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ADAPTER = path.join('.harness', 'hooks', 'adapter.mjs');

// Walk up from each candidate start directory until a .harness/hooks/adapter.mjs is found.
export function findHarnessRoot(starts = [], exists = fs.existsSync) {
  for (const start of starts) {
    if (!start) continue;
    let dir = path.resolve(start);
    for (;;) {
      if (exists(path.join(dir, ADAPTER))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

export function parsePayload(raw) {
  try { return raw && raw.trim() ? JSON.parse(raw) : {}; } catch { return {}; }
}

export function run(script, raw, { env = process.env, cwd = process.cwd(), spawn = spawnSync, exists = fs.existsSync } = {}) {
  if (!script) return { status: 0, skipped: 'no script' };
  const payload = parsePayload(raw);
  const root = findHarnessRoot([env.CLAUDE_PROJECT_DIR, payload.cwd, cwd], exists);
  if (!root) return { status: 0, skipped: 'no .harness' };
  const child = spawn(process.execPath, [path.join(root, ADAPTER), script], {
    input: raw,
    cwd: root,
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...env, CLAUDE_PROJECT_DIR: root }
  });
  return { status: child.status ?? (child.error ? 1 : 0), root };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch {}
  process.exit(run(process.argv[2], raw).status);
}
