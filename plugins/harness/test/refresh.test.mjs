import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareVersions, readVersion, refreshPlugin } from '../hooks/refresh.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-test-'));
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

function writePlugin(dir, version, marker) {
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'harness', version }));
  fs.writeFileSync(path.join(dir, 'marker.txt'), marker);
}

// repoRoot/plugins/harness is the source; installedDir sits outside the repo.
function setup({ repoVersion = '0.2.0', installed } = {}) {
  const base = tmp();
  const repoRoot = path.join(base, 'repo');
  const installedDir = path.join(base, 'home', '.claude', 'skills', 'harness');
  writePlugin(path.join(repoRoot, 'plugins', 'harness'), repoVersion, 'repo-content');
  if (installed) writePlugin(installedDir, installed, 'old-content');
  return { base, repoRoot, installedDir };
}

test('compareVersions orders dotted versions numerically', () => {
  assert.equal(compareVersions('0.2.0', '0.1.0'), 1);
  assert.equal(compareVersions('0.1.0', '0.2.0'), -1);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('3.2.0', '3.2'), 0);
});

test('readVersion returns empty string for a missing directory', () => {
  const base = tmp();
  try {
    assert.equal(readVersion(path.join(base, 'nope')), '');
  } finally {
    cleanup(base);
  }
});

test('refresh replaces an older installed copy and leaves no staging siblings', () => {
  const { base, repoRoot, installedDir } = setup({ installed: '0.1.0' });
  try {
    const result = refreshPlugin({ repoRoot, installedDir });
    assert.equal(result.action, 'refreshed');
    assert.equal(result.from, '0.1.0');
    assert.equal(result.to, '0.2.0');
    assert.equal(readVersion(installedDir), '0.2.0');
    assert.equal(fs.readFileSync(path.join(installedDir, 'marker.txt'), 'utf8'), 'repo-content');
    const leftovers = fs.readdirSync(path.dirname(installedDir))
      .filter((n) => n.includes('.refresh-') || n.includes('.backup-'));
    assert.deepEqual(leftovers, []);
  } finally {
    cleanup(base);
  }
});

test('refresh installs when nothing is installed', () => {
  const { base, repoRoot, installedDir } = setup();
  try {
    const result = refreshPlugin({ repoRoot, installedDir });
    assert.equal(result.action, 'refreshed');
    assert.equal(readVersion(installedDir), '0.2.0');
  } finally {
    cleanup(base);
  }
});

test('refresh skips when installed version equals or exceeds the repo', () => {
  for (const installed of ['0.2.0', '0.3.0']) {
    const { base, repoRoot, installedDir } = setup({ installed });
    try {
      const result = refreshPlugin({ repoRoot, installedDir });
      assert.equal(result.action, 'skip');
      assert.equal(result.reason, 'installed copy is current');
      assert.equal(fs.readFileSync(path.join(installedDir, 'marker.txt'), 'utf8'), 'old-content');
    } finally {
      cleanup(base);
    }
  }
});

test('refresh skips when the repo has no plugins/harness', () => {
  const base = tmp();
  try {
    const result = refreshPlugin({
      repoRoot: path.join(base, 'empty-repo'),
      installedDir: path.join(base, 'installed'),
    });
    assert.deepEqual(result, { action: 'skip', reason: 'repo has no plugins/harness' });
    assert.equal(fs.existsSync(path.join(base, 'installed')), false);
  } finally {
    cleanup(base);
  }
});

test('refresh skips when the repo plugin dir is the installed dir', () => {
  const base = tmp();
  try {
    const repoRoot = path.join(base, 'repo');
    const pluginDir = path.join(repoRoot, 'plugins', 'harness');
    writePlugin(pluginDir, '0.2.0', 'repo-content');
    const result = refreshPlugin({ repoRoot, installedDir: pluginDir });
    assert.equal(result.action, 'skip');
    assert.equal(result.reason, 'same directory');
  } finally {
    cleanup(base);
  }
});
