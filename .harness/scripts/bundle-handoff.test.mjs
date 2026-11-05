// Run with: node --test .harness/scripts/bundle-handoff.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bundle-handoff.mjs');
const dirs = [];

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  dirs.push(dir);
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.spec', 'OVERVIEW.md'), '# Overview\n');
  fs.writeFileSync(path.join(dir, '.spec', 'SYSTEM_SPEC.md'), '# Spec\n');
  fs.writeFileSync(path.join(dir, '.spec', 'PROGRESS.md'), '# Progress\n');
  fs.writeFileSync(path.join(dir, 'src.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"lockfileVersion": 3}\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  return dir;
}

function runBundle(dir, mode = 'diff') {
  return spawnSync(process.execPath, [SCRIPT, mode], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
}

test('the diff keeps source changes and leaves the lockfile out with a one-line note', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, 'src.js'), 'const a = 2; // SOURCE_CHANGE\n');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"lockfileVersion": 3, "LOCK_MARKER": true}\n');
  const r = runBundle(dir);
  assert.equal(r.status, 0, r.stderr);
  const packet = fs.readFileSync(path.join(dir, '.spec', 'HANDOFF_PACKET.md'), 'utf8');
  assert.match(packet, /SOURCE_CHANGE/);
  assert.match(packet, /Lockfile changed, so the diff leaves it out: package-lock\.json/);
  assert.doesNotMatch(packet, /LOCK_MARKER/);
});

test('a lockfile-only change produces a note and no lockfile text', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"lockfileVersion": 3, "LOCK_MARKER": true}\n');
  const r = runBundle(dir);
  assert.equal(r.status, 0, r.stderr);
  const packet = fs.readFileSync(path.join(dir, '.spec', 'HANDOFF_PACKET.md'), 'utf8');
  assert.doesNotMatch(packet, /LOCK_MARKER/);
  assert.match(packet, /package-lock\.json/);
});

test('with no changes the packet falls back to the spec bundle', () => {
  const dir = makeRepo();
  const r = runBundle(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /No uncommitted changes/);
});

after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
