#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveRoot } from './status-batch.mjs';
import { ensureHarnessRoot, atomicWriteFileSync } from './lib/fs-atomic.mjs';
import { parseSliceLine } from './lib/slice-parser.mjs';

/**
 * Anchors the first slice of a milestone or specified slice in .spec/PROGRESS.md and commits to git.
 *
 * @param {string} [root] - Optional root directory path.
 * @param {string} [targetSliceId] - Optional slice ID (e.g. "6.1" or "Slice 6.1").
 * @returns {{
 *   success: boolean,
 *   sliceId: string,
 *   sliceLabel: string,
 *   commitSha: string,
 *   commitMsg: string
 * }}
 */
export function startSlice(root, targetSliceId) {
  ensureHarnessRoot();
  root = root || resolveRoot();

  const progressPath = path.join(root, '.spec', 'PROGRESS.md');
  if (!fs.existsSync(progressPath)) {
    throw new Error('.spec/PROGRESS.md not found.');
  }

  const progressText = fs.readFileSync(progressPath, 'utf8');
  const lines = progressText.split('\n');

  // Check if any slice is already [IN_PROGRESS]
  for (const line of lines) {
    const p = parseSliceLine(line);
    if (p.status === '[IN_PROGRESS]') {
      throw new Error(`Slice ${p.id || 'active'} is already [IN_PROGRESS]. Finish or unmark it before starting a new slice.`);
    }
  }

  let targetIdx = -1;
  let targetSlice = null;

  if (targetSliceId) {
    const cleanId = String(targetSliceId).replace(/^Slice\s+/i, '').trim();
    for (let i = 0; i < lines.length; i++) {
      const p = parseSliceLine(lines[i]);
      if (p.id === cleanId || p.id === targetSliceId) {
        targetIdx = i;
        targetSlice = p;
        break;
      }
    }
    if (targetIdx === -1) {
      throw new Error(`Slice ${targetSliceId} not found in .spec/PROGRESS.md.`);
    }
  } else {
    // Find first pending slice
    for (let i = 0; i < lines.length; i++) {
      const p = parseSliceLine(lines[i]);
      if (p.id && p.status === '[PENDING]') {
        targetIdx = i;
        targetSlice = p;
        break;
      }
    }
    if (targetIdx === -1) {
      throw new Error('No pending slice found in .spec/PROGRESS.md.');
    }
  }

  const line = lines[targetIdx];
  let newLine = '';
  if (/\[PENDING\]/i.test(line)) {
    newLine = line.replace(/\[PENDING\]/i, '[IN_PROGRESS]');
  } else {
    newLine = line.replace(/(\*\*[^*]+\*\*)/, '$1 [IN_PROGRESS]');
  }
  lines[targetIdx] = newLine;

  atomicWriteFileSync(progressPath, lines.join('\n'), 'utf8');

  // Stage .spec/PROGRESS.md and commit as docs(spec): anchor <Slice-ID> [IN_PROGRESS]
  const sliceId = targetSlice.id || String(targetSliceId || 'active');
  const sliceLabel = sliceId.startsWith('Slice') ? sliceId : `Slice ${sliceId}`;
  const commitMsg = `docs(spec): anchor ${sliceLabel} [IN_PROGRESS]`;

  execFileSync('git', ['add', '.spec/PROGRESS.md'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', commitMsg], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
  const commitSha = execFileSync('git', ['log', '-1', '--oneline'], { cwd: root, encoding: 'utf8' }).trim();

  return {
    success: true,
    sliceId,
    sliceLabel,
    commitSha,
    commitMsg
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureHarnessRoot();
  const root = resolveRoot();
  const targetSliceId = process.argv[2];
  try {
    const res = startSlice(root, targetSliceId);
    console.log(`✓ START SLICE: Anchored ${res.sliceLabel} [IN_PROGRESS] (${res.commitSha}).`);
  } catch (err) {
    console.error(`✗ START SLICE FAILED: ${err.message}`);
    process.exit(1);
  }
}
