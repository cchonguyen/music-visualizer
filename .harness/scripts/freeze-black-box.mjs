#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { appendBatchEvent, resolveRoot } from './status-batch.mjs';
import { ensureHarnessRoot, atomicWriteFileSync } from './lib/fs-atomic.mjs';

const gitIn = (cwd, args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    return (err.stdout || '').trim();
  }
};

export function freezeBlackBox(root, reason = 'Circuit breaker Strike 2 triggered.') {
  ensureHarnessRoot();
  const progressPath = path.join(root, '.spec', 'PROGRESS.md');
  const blackBoxPath = path.join(root, '.spec', 'BLACK_BOX.md');

  // 1. Identify active slice from .spec/PROGRESS.md
  let sliceId = 'unknown';
  let sliceLine = '';
  if (fs.existsSync(progressPath)) {
    const lines = fs.readFileSync(progressPath, 'utf8').split('\n');
    const active = lines.find((l) => /^\s*-\s*\[.\].*\[IN_PROGRESS\]/.test(l));
    if (active) {
      sliceLine = active.trim();
      const m = active.match(/\*\*Slice\s+([^*:]+)/i);
      if (m) {
        sliceId = m[1].trim();
      }
    }
  }

  // Clean sliceId for stash name (e.g. "5.1" or "slice-5.1")
  const cleanSliceId = sliceId.replace(/[^a-zA-Z0-9._-]/g, '-');
  const stashMessage = `black-box/${cleanSliceId}`;

  // 2. Capture git status, git diff, and suspect files BEFORE stashing
  const gitStatus = gitIn(root, ['status', '--short']);
  const gitDiff = gitIn(root, ['diff', 'HEAD']);
  const statusLines = gitStatus.split('\n').filter(Boolean);
  const suspectFiles = statusLines.map((l) => l.slice(2).trim().replace(/.* -> /, ''));

  // 3. Save git stash under black-box/<slice-id>
  let stashCreated = false;
  if (statusLines.length > 0) {
    try {
      execFileSync('git', ['stash', 'push', '-u', '-m', stashMessage], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe']
      });
      stashCreated = true;
    } catch {
      // If stash push -u failed, try without -u
      try {
        execFileSync('git', ['stash', 'push', '-m', stashMessage], {
          cwd: root, stdio: ['ignore', 'pipe', 'pipe']
        });
        stashCreated = true;
      } catch {}
    }
  }

  // Ensure working tree is reverted to slice commit anchor
  try {
    execFileSync('git', ['reset', '--hard', 'HEAD'], { cwd: root, stdio: 'ignore' });
  } catch {}

  // 4. Write .spec/BLACK_BOX.md (Atlas Sector 130) AFTER stash so it is preserved in working copy
  fs.mkdirSync(path.dirname(blackBoxPath), { recursive: true });
  const timestamp = new Date().toISOString();
  const suspectList = suspectFiles.length > 0
    ? suspectFiles.map((f) => `- \`${f}\``).join('\n')
    : '- (No dirty files found in working copy)';

  const blackBoxContent = `# Black Box Report (Atlas Sector 130)

- **Active Slice:** ${sliceId}
- **Timestamp:** ${timestamp}
- **Stash Reference:** ${stashCreated ? stashMessage : 'none (clean tree)'}
- **Reason:** ${reason}

## Blocker Summary
${reason}

## Active Slice Specification
\`\`\`markdown
${sliceLine || 'No active slice marked [IN_PROGRESS] in .spec/PROGRESS.md'}
\`\`\`

## Suspect Files
${suspectList}

## Git Status
\`\`\`
${gitStatus || '(clean)'}
\`\`\`

## Git Diff
\`\`\`diff
${gitDiff || '(no diff)'}
\`\`\`
`;

  atomicWriteFileSync(blackBoxPath, blackBoxContent, 'utf8');

  // Record batch event
  try {
    appendBatchEvent(root, {
      event: 'black_box_freeze',
      slice: `Slice ${sliceId}`,
      summary: reason,
      details: stashCreated ? stashMessage : ''
    });
  } catch {}

  // 5. Print escalation notice
  console.log('SLICE_ESCALATED: See .spec/BLACK_BOX.md');

  return {
    sliceId,
    cleanSliceId,
    stashMessage,
    stashCreated,
    blackBoxPath,
    reason,
  };
}

// Backward compatibility alias
export const freezeCrimeScene = freezeBlackBox;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureHarnessRoot();
  const root = resolveRoot();
  const reason = process.argv.slice(2).join(' ').trim() || 'Circuit breaker Strike 2 triggered.';
  try {
    freezeBlackBox(root, reason);
  } catch (err) {
    console.error(`Freeze failed: ${err.message}`);
    process.exit(1);
  }
}
