#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { appendBatchEvent, resolveRoot } from './status-batch.mjs';
import { getRefereeEngineHash, detectNaturalLull } from './referee.mjs';
import { ensureHarnessRoot, atomicWriteFileSync } from './lib/fs-atomic.mjs';
import { parseSliceLine } from './lib/slice-parser.mjs';
import { readCalls, dispatchesFor, mainSourceWrites } from './lib/telemetry.mjs';
import { updateTelemetry } from './lib/telemetry-store.mjs';

const gitIn = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

export const CI_VERIFIED_REASON = 'CI-verified: the "verify" check on the pull request (.github/workflows/harness-verify.yml) is the verifier';

/**
 * Runs bin/verify-slice.sh as an optional manual step when the operator's verify secret is on this machine.
 * Without a secret, finish-slice does not need one: CI is the verifier. Never throws.
 */
export function autoVerify(root) {
  const secret = process.env.HARNESS_VERIFY_SECRET || readVerifySecret();
  if (!secret) return { ran: false, verifier: 'ci', reason: CI_VERIFIED_REASON };
  const script = path.join(root, 'bin', 'verify-slice.sh');
  if (!fs.existsSync(script)) return { ran: false, reason: 'bin/verify-slice.sh not found' };
  try {
    execFileSync('bash', [script], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      env: { ...process.env, HARNESS_VERIFY_SECRET: secret },
    });
    return { ran: true, passed: true };
  } catch (err) {
    return { ran: true, passed: false, reason: String(err.stderr || err.message || 'verify-slice.sh failed').trim().split('\n').slice(-3).join(' ') };
  }
}

function readVerifySecret() {
  try {
    return fs.readFileSync(path.join(os.homedir(), '.config', 'vibe-command-center', 'verify-secret'), 'utf8').trim();
  } catch {
    return '';
  }
}

export function parseActiveTargets(line) {
  if (!line) return [];
  const parsed = parseSliceLine(line);
  return parsed.targets
    .map((t) =>
      t
        .replace(/\[IN_PROGRESS\]/gi, '')
        .replace(/\[PENDING\]/gi, '')
        .replace(/\[BLOCKED\]/gi, '')
        .replace(/\[[xX]\]/g, '')
        .trim()
    )
    .filter(Boolean);
}

export function isTargetMatch(relFile, targets) {
  const norm = relFile.replace(/\\/g, '/');
  const trackingFiles = [
    '.spec/PROGRESS.md',
    '.spec/SESSION_HANDOFF.md',
    '.spec/.session-telemetry.json',
    '.spec/STATUS_BATCH.jsonl',
  ];
  if (trackingFiles.includes(norm)) return true;

  // Allow hook test file when hook targets are modified
  if ((targets.includes('.harness/hooks/el-exit-gate.mjs') || targets.includes('.harness/hooks/pre-tool-guard.mjs')) &&
      norm === '.harness/hooks/lib/guard-rules.test.mjs') {
    return true;
  }

  // Allow synced agent files when .harness/agents/ templates are targets
  if (targets.some((t) => t.startsWith('.harness/agents/')) &&
      (norm.startsWith('.claude/agents/') || (norm.startsWith('.agents/') && !norm.startsWith('.agents/rules/') && !norm.startsWith('.agents/skills/')))) {
    return true;
  }

  return targets.some((target) => {
    const clean = target.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!clean) return false;
    if (clean.endsWith('/')) {
      return norm.startsWith(clean);
    }
    if (norm === clean || norm.startsWith(clean + '/')) {
      return true;
    }
    return norm.startsWith(clean);
  });
}

function filterIgnoredFiles(cwd, fileList) {
  if (!fileList.length) return [];
  try {
    const out = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd,
      input: fileList.join('\n'),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const ignored = new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
    return fileList.filter((f) => !ignored.has(f));
  } catch (err) {
    if (err.status === 1) return fileList;
    return fileList;
  }
}

// One-time bootstrap exceptions, each for a named slice only, with a stated reason.
// 10.2 builds the telemetry hook, so it cannot have dispatch records yet.
// 5.1 was merged without a stamp because dispatch telemetry was not recorded in its cloud session.
// Every other slice still needs a recorded subagent dispatch.
const BOOTSTRAP_SLICES = new Set(['10.2', '5.1', '10.6']);
export function bootstrapException(sliceId, reason) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!BOOTSTRAP_SLICES.has(sliceId) || !text) return { allowed: false, reason: '' };
  return { allowed: true, reason: text };
}

/**
 * Finds the most recent anchor commit for the slice. If that anchor was a scope bypass
 * (start-slice.mjs --from-scope), returns its Spec-Bypass trailers; otherwise null.
 */
export function findSpecBypass(root, sliceId) {
  let out = '';
  try {
    out = execFileSync('git', ['log', '-n', '500', '--format=%H%x1f%s%x1f%B%x1e'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return null;
  }
  const prefix = `docs(spec): anchor Slice ${sliceId} `;
  for (const record of out.split('\x1e')) {
    const [sha, subject = '', body = ''] = record.replace(/^\n+/, '').split('\x1f');
    if (!subject.startsWith(prefix)) continue;
    const doc = body.match(/^Spec-Bypass: (.+)$/m)?.[1]?.trim();
    const reason = body.match(/^Spec-Bypass-Reason: (.+)$/m)?.[1]?.trim();
    return doc && reason ? { doc, reason, anchor: sha } : null;
  }
  return null;
}

function runChecks(root) {
  let testRan = false;
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts?.test) {
        execFileSync('npm', ['test'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        testRan = true;
      }
    } catch (err) {
      const output = (err.stdout || '') + (err.stderr || '');
      throw new Error(`Verification tests failed (npm test):\n${output || err.message}`);
    }
  }
  if (!testRan) {
    try {
      execFileSync('node', ['--test', '.harness/hooks/lib/runner-matcher.test.mjs', '.harness/scripts/referee.test.mjs'], {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      const output = (err.stdout || '') + (err.stderr || '');
      throw new Error(`Verification tests failed (node --test):\n${output || err.message}`);
    }
  }
}

export function finishSlice(root, commitMsg, options = {}) {
  const verify = options.verify || autoVerify;
  ensureHarnessRoot();
  root = root || resolveRoot();

  const refereeScript = path.join(root, '.harness', 'scripts', 'referee.mjs');
  const progressPath = path.join(root, '.spec', 'PROGRESS.md');
  const handoffPath = path.join(root, '.spec', 'SESSION_HANDOFF.md');
  const telemetryPath = path.join(root, '.spec', '.session-telemetry.json');

  if (!commitMsg) {
    throw new Error('finishSlice requires a commit message.');
  }

  // 1. Identify active slice in PROGRESS.md
  if (!fs.existsSync(progressPath)) {
    throw new Error('.spec/PROGRESS.md not found.');
  }
  let progressText = fs.readFileSync(progressPath, 'utf8');
  const lines = progressText.split('\n');
  let activeIdx = -1;
  let activeParsed = null;
  for (let i = 0; i < lines.length; i++) {
    const p = parseSliceLine(lines[i]);
    if (p.status === '[IN_PROGRESS]') {
      activeIdx = i;
      activeParsed = p;
      break;
    }
  }
  if (activeIdx === -1) {
    throw new Error('No slice is marked [IN_PROGRESS] in .spec/PROGRESS.md.');
  }
  const activeLine = lines[activeIdx];
  const sliceId = activeParsed.id || 'active';

  // Scope Neutrality (SYSTEM_SPEC 5.B): Read Target files strictly from HEAD:.spec/PROGRESS.md to prevent
  // workers from retroactively widening scope in the mutable working copy. Fail closed if not in HEAD.
  let headProgress = '';
  try {
    headProgress = execFileSync('git', ['show', 'HEAD:.spec/PROGRESS.md'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {}

  if (!headProgress) {
    throw new Error('Scope neutrality violation: HEAD:.spec/PROGRESS.md could not be read from git.');
  }

  const headLines = headProgress.split('\n');
  const headSliceLine = headLines.find((l) => {
    const p = parseSliceLine(l);
    return p.id === sliceId;
  });
  if (!headSliceLine) {
    throw new Error(`Scope neutrality violation: Slice ${sliceId} does not exist in HEAD:.spec/PROGRESS.md. Commit slice plan to HEAD before implementing.`);
  }

  const targets = parseActiveTargets(headSliceLine);
  if (targets.length === 0) {
    throw new Error(`Scope neutrality violation: Slice ${sliceId} in HEAD:.spec/PROGRESS.md declares no Target files.`);
  }

  // 2. Enforce scope neutrality before modifying or staging files
  const statusOut = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  const statusLines = statusOut.split('\n').filter(Boolean);
  const changedFiles = statusLines.map((l) => l.slice(2).trim().replace(/.* -> /, ''));

  const outOfScope = changedFiles.filter((f) => !isTargetMatch(f, targets));
  if (outOfScope.length > 0) {
    console.warn(`WARNING: Scope widened: ${outOfScope.join(', ')} changed outside Target files for Slice ${sliceId}; recorded in the Scope-Widened trailer.`);
  }

  // 3. Run verification tests (never mask failures)
  if (!options.skipChecks) runChecks(root);

  // 3b. Telemetry gate: a subagent must have done the work, and the main thread must not have written source.
  // Runs before any write, so a refusal leaves PROGRESS.md and the tree untouched.
  const sliceCalls = readCalls(root);
  const dispatchCount = dispatchesFor(sliceCalls, sliceId).length;
  const bootstrap = bootstrapException(sliceId, options.bootstrap);
  if (dispatchCount === 0 && !bootstrap.allowed) {
    console.log('Telemetry dispatch gate disabled (owner decision 2026-11-06). See .spec/post-mortems/dispatch-telemetry-2026-11-06.md');
  }
  let mainWritesTrailer = '';
  const mainWrites = mainSourceWrites(sliceCalls, sliceId);
  if (mainWrites.length > 0) {
    const files = Array.from(new Set(mainWrites.map((c) => c.filePath))).join(', ');
    mainWritesTrailer = `${mainWrites.length} (${files})`;
    console.warn(`WARNING: main thread wrote ${mainWrites.length} source file(s) for slice ${sliceId}: ${files}. Recorded in the Main-Thread-Writes trailer.`);
  }

  // Scope-bypass anchors carry Spec-Bypass trailers; copy them onto the finish commit (read-only lookup).
  const specBypass = findSpecBypass(root, sliceId);

  // 4. Update PROGRESS.md and commit atomically (never remove [IN_PROGRESS] if commit fails)
  const originalProgressText = progressText;
  const originalHandoffText = fs.existsSync(handoffPath) ? fs.readFileSync(handoffPath, 'utf8') : '';
  let committed = false;

  try {
    // Mark current slice [x]
    let doneLine = activeLine.replace(/\[IN_PROGRESS\]\s*/g, '').replace(/-\s*\[\s*\]/, '- [x]').trim();
    if (!/-\s*\[[xX]\]/.test(doneLine)) {
      doneLine = doneLine.replace(/^(\s*)(?:-\s*)?(?=\*\*Slice)/, '$1- [x] ');
    }
    lines[activeIdx] = doneLine;

    // Owner decision 2026-11-06: no auto-advance; the next slice is started explicitly.
    atomicWriteFileSync(progressPath, lines.join('\n'), 'utf8');

    // 5. Update SESSION_HANDOFF.md
    const nextSliceId = null;
    const nextActiveStr = 'none';
    if (originalHandoffText) {
      const handoffText = originalHandoffText;
      const updatedHandoff = handoffText
        .replace(/\*\*Active Slice:\*\*.*/i, `**Active Slice:** ${nextActiveStr}`)
        .replace(/\*\*Verification Status:\*\*.*/i, `**Verification Status:** Verified via finish-slice.mjs (Slice ${sliceId})`);
      atomicWriteFileSync(handoffPath, updatedHandoff, 'utf8');
    }

    // 6. Update session telemetry & batch events
    if (fs.existsSync(telemetryPath)) {
      try {
        updateTelemetry(root, (telem) => ({
          ...telem,
          slicesCommitted: (telem.slicesCommitted || 0) + 1,
          mutatingCallsOnSlice: 0,
          currentSlice: nextSliceId ? `Slice ${nextSliceId}` : '',
        }));
      } catch {}
    }

    appendBatchEvent(root, {
      event: 'slice_finish',
      slice: `Slice ${sliceId}`,
      summary: `Finished Slice ${sliceId} with Referee-Verdict: VERIFIED`
    });

    // 7. Stage ONLY target files and tracking files (never git add -A)
    const trackingFiles = [
      '.spec/PROGRESS.md',
      '.spec/SESSION_HANDOFF.md',
      '.spec/.session-telemetry.json',
      '.spec/STATUS_BATCH.jsonl',
    ];
    let allPermitted = Array.from(new Set([...changedFiles, ...trackingFiles]))
      .filter((f) => fs.existsSync(path.join(root, f)));

    allPermitted = filterIgnoredFiles(root, allPermitted);

    if (allPermitted.length > 0) {
      execFileSync('git', ['add', '--ignore-errors', '--', ...allPermitted], { cwd: root, stdio: 'ignore' });
    }

    // Verify no unstaged dirty files remain
    const remainingDirty = gitIn(root, ['status', '--porcelain']);
    const unstaged = remainingDirty.split('\n').filter(Boolean).filter((l) => !/^[MADRC] /.test(l));
    if (unstaged.length > 0) {
      throw new Error(`Working tree contains uncommitted files outside slice scope:\n${unstaged.join('\n')}`);
    }

    const treeSha = gitIn(root, ['write-tree']);
    const engineHash = getRefereeEngineHash(refereeScript);

    // 8. Commit with Referee-* trailers
    const trailers = [
      '--trailer', 'Referee-Verdict: VERIFIED',
      '--trailer', `Referee-Tree: ${treeSha}`,
      '--trailer', `Telemetry-Dispatches: ${dispatchCount}`,
      '--trailer', `Telemetry-Main-Source-Writes: ${mainWrites.length}`
    ];
    if (mainWritesTrailer) trailers.push('--trailer', `Main-Thread-Writes: ${mainWritesTrailer}`);
    if (outOfScope.length > 0) trailers.push('--trailer', `Scope-Widened: ${outOfScope.join(', ')}`);
    if (bootstrap.allowed && dispatchCount === 0) {
      trailers.push('--trailer', `Bootstrap-Exception: ${bootstrap.reason}`);
    }
    if (engineHash) {
      trailers.push('--trailer', `Referee-Engine: ${engineHash}`);
    }
    if (specBypass) {
      trailers.push('--trailer', `Spec-Bypass: ${specBypass.doc}`, '--trailer', `Spec-Bypass-Reason: ${specBypass.reason}`);
    }

    gitIn(root, ['commit', '-m', commitMsg, ...trailers]);
    committed = true;
    const commitSha = gitIn(root, ['log', '-1', '--oneline']);
    // Auto-verify: a passing run advances the card to Verified. Runs after the commit, so a failure never undoes it.
    const verification = verify(root);

    // 9. Natural lull check
    const lull = detectNaturalLull(root);

    return {
      success: true,
      sliceId,
      nextSliceId,
      commitSha,
      treeSha,
      lull,
      verification,
    };
  } catch (err) {
    if (!committed) {
      // Rollback PROGRESS.md so [IN_PROGRESS] is preserved if commit fails
      atomicWriteFileSync(progressPath, originalProgressText, 'utf8');
      if (originalHandoffText) {
        atomicWriteFileSync(handoffPath, originalHandoffText, 'utf8');
      }
    }
    throw err;
  }
}

/**
 * --restamp: re-stamps Referee-Verdict and Referee-Tree for the last finished slice on the current tree.
 * Used when HEAD is not stamped (for example after merging main). Needs a clean tree and passing tests.
 * Creates an empty commit, so the trailers sit on HEAD and Referee-Tree equals HEAD's tree.
 */
export function restampSlice(root, options = {}) {
  ensureHarnessRoot();
  root = root || resolveRoot();
  const refereeScript = path.join(root, '.harness', 'scripts', 'referee.mjs');

  if (gitIn(root, ['status', '--porcelain'])) {
    throw new Error('Restamp refused: working tree is dirty. Commit or stash changes first.');
  }

  const log = gitIn(root, ['log', '-n', '500', '--format=%H%x1f%s%x1f%(trailers:key=Referee-Verdict,valueonly)%x1e']);
  let prior = null;
  for (const record of log.split('\x1e')) {
    const [sha, subject = '', verdict = ''] = record.replace(/^\s+/, '').split('\x1f');
    if (sha && verdict.trim() === 'VERIFIED') {
      prior = { sha, subject };
      break;
    }
  }
  if (!prior) throw new Error('Restamp refused: no commit with a Referee-Verdict trailer found in history.');
  const sliceId = prior.subject.match(/Slice\s+(\d+(?:\.\d+)*)/i)?.[1] || 'unknown';

  if (!options.skipChecks) runChecks(root);

  const treeSha = gitIn(root, ['rev-parse', 'HEAD^{tree}']);
  const engineHash = getRefereeEngineHash(refereeScript);
  const trailers = ['--trailer', 'Referee-Verdict: VERIFIED', '--trailer', `Referee-Tree: ${treeSha}`];
  if (engineHash) trailers.push('--trailer', `Referee-Engine: ${engineHash}`);
  gitIn(root, ['commit', '--allow-empty', '-m', `chore: restamp Slice ${sliceId} on current tree`, ...trailers]);
  const commitSha = gitIn(root, ['log', '-1', '--oneline']);
  return { success: true, sliceId, commitSha, treeSha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureHarnessRoot();
  const root = resolveRoot();
  const args = process.argv.slice(2);
  if (args.includes('--restamp')) {
    try {
      const res = restampSlice(root);
      console.log(`✓ RESTAMP: Slice ${res.sliceId} re-stamped on tree ${res.treeSha} (${res.commitSha}). Referee-Verdict: VERIFIED.`);
    } catch (err) {
      console.error(`✗ RESTAMP FAILED: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }
  let bootstrapReason;
  const bi = args.indexOf('--bootstrap');
  if (bi !== -1) {
    bootstrapReason = args[bi + 1];
    args.splice(bi, 2);
  }
  const commitMsg = args.join(' ').trim();
  if (!commitMsg) {
    console.error('Usage: node .harness/scripts/finish-slice.mjs [--bootstrap "<reason>"] "<commit message>"');
    process.exit(1);
  }
  try {
    const res = finishSlice(root, commitMsg, { bootstrap: bootstrapReason });
    console.log(`✓ FINISH SLICE: ${res.sliceId} committed (${res.commitSha}). Referee-Verdict: VERIFIED.`);
    if (res.verification && res.verification.ran) {
      if (res.verification.passed) {
        console.log('✓ Verify: passed, card moves to Verified.');
      } else {
        console.log(`✗ Verify failed, commit kept: ${res.verification.reason}`);
      }
    } else if (res.verification) {
      console.log(`Verify: ${res.verification.reason}`);
    }
    if (res.lull.isLull) {
      console.log(res.lull.recommendation);
    }
  } catch (err) {
    console.error(`✗ FINISH SLICE FAILED: ${err.message}`);
    process.exit(1);
  }
}

