import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readManifestVersion, installedManifestPath, checkPluginVersion, mismatchBanner } from './session-banner.mjs';

function tempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-banner-test-'));
  const file = path.join(dir, 'plugin.json');
  if (content !== undefined) fs.writeFileSync(file, content, 'utf8');
  return file;
}

test('readManifestVersion returns the trimmed version field', () => {
  assert.equal(readManifestVersion(tempFile('{"name":"harness","version":" 0.3.0 "}')), '0.3.0');
});

test('readManifestVersion returns null for a missing file, bad JSON or no version', () => {
  assert.equal(readManifestVersion(tempFile()), null);
  assert.equal(readManifestVersion(tempFile('{not json')), null);
  assert.equal(readManifestVersion(tempFile('{"name":"harness"}')), null);
});

test('installedManifestPath is null without CLAUDE_PLUGIN_ROOT', () => {
  assert.equal(installedManifestPath(undefined), null);
  assert.equal(installedManifestPath(''), null);
  assert.equal(installedManifestPath('/plugin'), path.join('/plugin', '.claude-plugin', 'plugin.json'));
});

test('checkPluginVersion flags only a real difference', () => {
  assert.deepEqual(checkPluginVersion({ installed: '0.2.0', repo: '0.3.0' }), { mismatch: true, installed: '0.2.0', repo: '0.3.0' });
  assert.equal(checkPluginVersion({ installed: '0.3.0', repo: '0.3.0' }).mismatch, false);
  assert.equal(checkPluginVersion({ installed: null, repo: '0.3.0' }).mismatch, false);
  assert.equal(checkPluginVersion({ installed: '0.3.0', repo: null }).mismatch, false);
});

test('mismatchBanner names both versions and is a warning, not a block', () => {
  const line = mismatchBanner({ installed: '0.2.0', repo: '0.3.0' });
  assert.ok(line.includes('0.2.0') && line.includes('0.3.0'));
  assert.ok(line.includes('Warning only'));
  assert.equal(line.includes('\n'), false);
});
