import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getRefereeEngineHash,
  verifyHeadTrust,
  detectNaturalLull
} from './referee.mjs';

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'referee-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  return dir;
}

test('verifyHeadTrust requires clean working tree and matching tree trailer', () => {
  const dir = makeRepo();
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  // Commit with valid trailers
  fs.writeFileSync(path.join(dir, 'README.md'), '# Hello');
  const scriptPath = path.join(dir, 'referee.mjs');
  fs.writeFileSync(scriptPath, '// referee engine');
  git('add', '-A');
  const tree = git('write-tree');
  const engineHash = getRefereeEngineHash(scriptPath);

  git(
    'commit',
    '-m',
    'initial',
    '--trailer',
    'Referee-Verdict: VERIFIED',
    '--trailer',
    `Referee-Tree: ${tree}`,
    '--trailer',
    `Referee-Engine: ${engineHash}`
  );

  const res1 = verifyHeadTrust(dir, scriptPath);
  assert.equal(res1.trusted, true);

  // If working tree becomes dirty, trust fails
  fs.writeFileSync(path.join(dir, 'dirty.txt'), 'dirty');
  const resDirty = verifyHeadTrust(dir, scriptPath);
  assert.equal(resDirty.trusted, false);
  assert.match(resDirty.reason, /dirty/i);
  fs.rmSync(path.join(dir, 'dirty.txt'));

  // If commit trailer has mismatched tree, trust fails
  fs.writeFileSync(path.join(dir, 'other.txt'), 'other');
  git('add', '-A');
  git('commit', '-m', 'tampered', '--trailer', 'Referee-Verdict: VERIFIED', '--trailer', 'Referee-Tree: 000000000000');
  const resTampered = verifyHeadTrust(dir, scriptPath);
  assert.equal(resTampered.trusted, false);
  assert.match(resTampered.reason, /tree/i);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('detectNaturalLull flags >=40 tool calls, >=3 slices, 2-strike restore, or risk shift', () => {
  const dir = makeRepo();
  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });

  // 1. Clean state -> no lull
  const rClean = detectNaturalLull(dir);
  assert.equal(rClean.isLull, false);

  // 2. High tool call count -> lull
  fs.writeFileSync(
    path.join(dir, '.spec', '.session-telemetry.json'),
    JSON.stringify({ totalToolCalls: 42, slicesCommitted: 1 })
  );
  const rCalls = detectNaturalLull(dir);
  assert.equal(rCalls.isLull, true);
  assert.match(rCalls.recommendation, /42/);

  // 3. Risk shift ahead -> lull
  fs.writeFileSync(
    path.join(dir, '.spec', '.session-telemetry.json'),
    JSON.stringify({ totalToolCalls: 5, slicesCommitted: 1 })
  );
  fs.writeFileSync(
    path.join(dir, '.spec', 'PROGRESS.md'),
    [
      '- [ ] **Slice 1** [IN_PROGRESS] `[GREEN][CORE / DATA]`: current',
      '- [ ] **Slice 2** `[YELLOW][CORE / DATA]`: next'
    ].join('\n')
  );
  const rRisk = detectNaturalLull(dir);
  assert.equal(rRisk.isLull, true);
  assert.match(rRisk.recommendation, /YELLOW/);

  fs.rmSync(dir, { recursive: true, force: true });
});
