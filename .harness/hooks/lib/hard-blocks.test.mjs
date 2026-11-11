import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hardBlockReason, hardBlockSegmentReason, isHardBlockedSegment } from './hard-blocks.mjs';

const blocked = (command, spoke = false) => hardBlockReason({ command, spoke }) !== '';

test('force push is blocked in every form', () => {
  for (const c of [
    'git push --force origin main',
    'git push -f origin main',
    'git push --force-with-lease origin b',
    'git push origin +main',
    'git -C repo push --force origin b',
    'git push origin main && git push -fu origin b',
  ]) assert.equal(blocked(c), true, c);
});

test('plain push and pull are not hard-blocked', () => {
  assert.equal(blocked('git push origin claude/x'), false);
  assert.equal(blocked('git pull --force-rebase'), false);
});

test('branch delete with -D is blocked', () => {
  assert.equal(blocked('git branch -D old'), true);
  assert.equal(blocked('git -C repo branch -D old'), true);
  assert.equal(blocked('git branch -d old'), false);
});

test('hardBlockReason refuses force push and branch -D, and allows plain push and branch -d', () => {
  for (const c of [
    'git push -f origin x',
    'git push --force',
    'git push origin +main',
    'git branch -D foo',
  ]) assert.notEqual(hardBlockReason({ command: c, spoke: false }), '', c);
  for (const c of [
    'git push origin x',
    'git branch -d foo',
  ]) assert.equal(hardBlockReason({ command: c, spoke: false }), '', c);
});

test('deploy commands are blocked', () => {
  for (const c of [
    'npm run deploy',
    'npm run deploy:prod',
    'firebase deploy --only hosting',
    'wrangler deploy',
    'vercel --prod',
    'vercel deploy',
    'gcloud app deploy app.yaml',
    'gh workflow run deploy.yml',
  ]) assert.equal(blocked(c), true, c);
});

test('reads that mention deploy are not blocked', () => {
  assert.equal(blocked('grep -rn deploy .spec'), false);
  assert.equal(blocked('cat deploy.md'), false);
  assert.equal(blocked('npm run lint --silent'), false);
});

test('repo visibility change is blocked', () => {
  assert.equal(blocked('gh repo edit --visibility public'), true);
  assert.equal(blocked('gh repo edit owner/repo --visibility=private --accept-visibility-change-consequences'), true);
  assert.equal(blocked('gh repo edit --description x'), false);
});

test('hard blocks apply whatever the spoke flag, and the engine lock only in spokes', () => {
  assert.equal(blocked('git push --force', false), true);
  assert.equal(blocked('git push --force', true), true);
  assert.equal(blocked('echo {} > .claude/settings.json', false), false);
  assert.equal(blocked('echo {} > .claude/settings.json', true), true);
  assert.match(hardBlockReason({ command: 'echo {} > .claude/settings.json', spoke: true }), /^ENGINE LOCK/);
});

test('segment helpers agree with the full check', () => {
  assert.match(hardBlockSegmentReason('git branch -D x'), /Branch deletion/);
  assert.match(hardBlockSegmentReason('git push --force'), /Force push/);
  assert.match(hardBlockSegmentReason('gh repo edit --visibility public'), /visibility/);
  assert.equal(isHardBlockedSegment('git status'), false);
  assert.equal(isHardBlockedSegment('git push --force origin b'), true);
});
