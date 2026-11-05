#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { appendBatchEvent, readBatchEvents, resolveRoot } from './status-batch.mjs';
import { verifyHeadTrust } from './referee.mjs';

const gitSafe = (cwd, args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const root = resolveRoot();
const handoffPath = path.join(root, '.spec', 'SESSION_HANDOFF.md');
const progressPath = path.join(root, '.spec', 'PROGRESS.md');

const branch = gitSafe(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown';
const dirty = gitSafe(root, ['status', '--porcelain']);
const dirtyCount = dirty ? dirty.split('\n').filter(Boolean).length : 0;
const headCommit = gitSafe(root, ['log', '-n', '1', '--oneline']) || 'none';

const handoffLines = fs.existsSync(handoffPath) ? fs.readFileSync(handoffPath, 'utf8').split('\n') : [];
const extractField = (label) => {
  const line = handoffLines.find((l) => l.toLowerCase().includes(label.toLowerCase()));
  return line ? line.replace(/^.*?\*\*[^*]+\*\*\s*:?\s*/, '').trim() : 'N/A';
};

const lastPlatform = extractField('Last Active Platform');
const verifyStatus = extractField('Verification Status');
const nextStep = extractField('Immediate Next Step') || extractField('Exact Next Step');

const progressLines = fs.existsSync(progressPath) ? fs.readFileSync(progressPath, 'utf8').split('\n') : [];
const activeSlice = progressLines.find((l) => /^\s*-\s*\[.\].*\[IN_PROGRESS\]/.test(l))?.trim() || 'None';
const nextPendingSlice = progressLines.find((l) => /^\s*-\s*\[\s\]/.test(l) && !/\[IN_PROGRESS\]/.test(l))?.trim() || 'None';
const batchCount = readBatchEvents(root).length;

// Referee Trust Verification
const trust = verifyHeadTrust(root);

appendBatchEvent(root, {
  actor: 'claude-pickup',
  event: 'baton_pickup',
  summary: `Picked up baton from ${lastPlatform} on ${branch} (${headCommit}) - Trust: ${trust.trusted ? 'VERIFIED' : 'UNVERIFIED'}`,
  details: `Next: ${nextStep}`
});

console.log([
  `✓ BATON PICKUP | Branch: ${branch} (${headCommit}) | Working tree: ${dirtyCount ? `${dirtyCount} modified` : 'clean'} | Batch queue: ${batchCount + 1} event(s)`,
  `  Referee Trust: ${trust.trusted ? 'VERIFIED (Commit Trailer Matches HEAD Tree)' : `UNVERIFIED (${trust.reason})`}`,
  `  Last Platform: ${lastPlatform} | Recorded Status: ${verifyStatus}`,
  `  Active Slice:  ${activeSlice}`,
  `  Next Pending:  ${nextPendingSlice}`,
  `  Directive:     ${nextStep}`
].join('\n'));
