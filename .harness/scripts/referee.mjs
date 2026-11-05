#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveRoot } from './status-batch.mjs';
import { analyze, parseDiff, parseNameStatus } from './pr-scope-check.mjs';

export const gitSafe = (cwd, args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

export const getRefereeEngineHash = (scriptPath) => {
  if (!fs.existsSync(scriptPath)) return '';
  const code = fs.readFileSync(scriptPath, 'utf8');
  return crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
};

export function readHeadTrailers(root) {
  const verdict = gitSafe(root, ['log', '-1', '--format=%(trailers:key=Referee-Verdict,valueonly)']).trim();
  const tree = gitSafe(root, ['log', '-1', '--format=%(trailers:key=Referee-Tree,valueonly)']).trim();
  const engine = gitSafe(root, ['log', '-1', '--format=%(trailers:key=Referee-Engine,valueonly)']).trim();
  return { verdict, tree, engine };
}

// Verification Semantics: Referee trailers are deterministic audit markers and tree integrity fingerprints
// (binding HEAD^{tree} and referee.mjs SHA-256) within the repository workspace. They detect accidental drift,
// post-verification modifications, and engine mismatches; they are not cryptographic identity attestations.
export function verifyHeadTrust(root, scriptPath = path.join(root, '.harness', 'scripts', 'referee.mjs')) {
  const { verdict, tree, engine } = readHeadTrailers(root);
  if (verdict !== 'VERIFIED') return { trusted: false, reason: 'Referee-Verdict is missing or not VERIFIED on HEAD' };

  const currentTree = gitSafe(root, ['rev-parse', 'HEAD^{tree}']);
  if (!currentTree || currentTree !== tree) {
    return { trusted: false, reason: `HEAD tree (${currentTree}) does not match Referee-Tree trailer (${tree})` };
  }

  const dirty = gitSafe(root, ['status', '--porcelain']);
  if (dirty) {
    return { trusted: false, reason: 'Working tree is dirty' };
  }

  const expectedEngine = getRefereeEngineHash(scriptPath);
  if (expectedEngine && engine && expectedEngine !== engine) {
    return { trusted: false, reason: `Referee-Engine hash mismatch (expected ${expectedEngine}, got ${engine})` };
  }

  return { trusted: true, verdict, tree, engine };
}

export function checkScopeFromHead(root, base = 'origin/main', head = 'HEAD') {
  let nameStatus = '';
  let diffText = '';
  try {
    nameStatus = execFileSync('git', ['diff', '--name-status', '-M', `${base}...${head}`], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    diffText = execFileSync('git', ['diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '-U0', `${base}...${head}`], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    return { clean: false, problems: [`Could not diff ${base}...${head}: ${err.message}`] };
  }

  // Anti-tamper: read PROGRESS.md strictly from HEAD
  let progress = '';
  try {
    progress = execFileSync('git', ['show', `${head}:.spec/PROGRESS.md`], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {}

  const { changed, deleted } = parseNameStatus(nameStatus);
  const result = analyze({
    changed,
    deleted,
    diff: parseDiff(diffText),
    progress,
    strict: true
  });

  return { clean: result.problems.length === 0, ...result };
}

export function detectNaturalLull(root) {
  const telemetryPath = path.join(root, '.spec', '.session-telemetry.json');
  const progressPath = path.join(root, '.spec', 'PROGRESS.md');
  const strikePath = path.join(root, '.spec', '.strike-counter.json');

  const lulls = [];

  // Check 1: Session tool calls >= 40 or slices committed >= 3
  if (fs.existsSync(telemetryPath)) {
    try {
      const telem = JSON.parse(fs.readFileSync(telemetryPath, 'utf8'));
      if ((telem.totalToolCalls || 0) >= 40) {
        lulls.push(`Cumulative session tool calls reached ${telem.totalToolCalls} (>= 40 threshold)`);
      }
      if ((telem.slicesCommitted || 0) >= 3) {
        lulls.push(`Slices committed in this session reached ${telem.slicesCommitted} (>= 3 threshold)`);
      }
    } catch {}
  }

  // Check 2: 2-Strike restore was triggered
  if (fs.existsSync(strikePath)) {
    try {
      const strikes = JSON.parse(fs.readFileSync(strikePath, 'utf8'));
      const maxStrikes = Math.max(0, ...Object.values(strikes).map((s) => Number(s?.strikes || 0)));
      if (maxStrikes >= 2) {
        lulls.push(`2-Strike circuit breaker was active (${maxStrikes} consecutive failures)`);
      }
    } catch {}
  }

  // Check 3: Risk or domain shift ahead in PROGRESS.md
  if (fs.existsSync(progressPath)) {
    try {
      const lines = fs.readFileSync(progressPath, 'utf8').split('\n');
      const activeIdx = lines.findIndex((l) => /^\s*-\s*\[.\].*\[IN_PROGRESS\]/.test(l));
      const nextPending = lines.find((l) => /^\s*-\s*\[\s\]/.test(l) && !/\[IN_PROGRESS\]/.test(l));

      if (nextPending) {
        if (/\[RED\]/i.test(nextPending)) {
          lulls.push(`Upcoming slice is [RED]: ${nextPending.trim()}`);
        }
        if (activeIdx >= 0) {
          const activeLine = lines[activeIdx];
          const activeIsGreen = /\[GREEN\]/i.test(activeLine);
          const nextIsYellow = /\[YELLOW\]/i.test(nextPending);
          if (activeIsGreen && nextIsYellow) {
            lulls.push(`Risk escalation: transition from [GREEN] to [YELLOW] (${nextPending.trim()})`);
          }
          const activeIsCore = /\[CORE \/ DATA\]/i.test(activeLine);
          const nextIsUI = /\[UI \/ VISUAL\]/i.test(nextPending);
          const activeIsUI = /\[UI \/ VISUAL\]/i.test(activeLine);
          const nextIsCore = /\[CORE \/ DATA\]/i.test(nextPending);
          if ((activeIsCore && nextIsUI) || (activeIsUI && nextIsCore)) {
            lulls.push(`Domain transition between CORE / DATA and UI / VISUAL`);
          }
        }
      } else {
        lulls.push('All slices in PROGRESS.md are marked complete');
      }
    } catch {}
  }

  return {
    isLull: lulls.length > 0,
    reasons: lulls,
    recommendation: lulls.length > 0
      ? `🏁 REFEREE NATURAL LULL: ${lulls.join(' | ')}. Recommended stopping point: run /clear or switch platforms.`
      : ''
  };
}

export function evaluateRefereeState(root = resolveRoot()) {
  const trust = verifyHeadTrust(root);
  const lull = detectNaturalLull(root);
  return { trust, lull };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolveRoot();
  const subcmd = process.argv[2] || 'status';

  if (subcmd === 'trust') {
    const res = verifyHeadTrust(root);
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.trusted ? 0 : 1);
  }

  if (subcmd === 'lull') {
    const res = detectNaturalLull(root);
    if (res.isLull) {
      console.log(res.recommendation);
    } else {
      console.log('✓ No natural lull detected. Clear to continue.');
    }
    process.exit(0);
  }

  const { trust, lull } = evaluateRefereeState(root);
  console.log(`Referee Trust on HEAD: ${trust.trusted ? 'VERIFIED' : `UNVERIFIED (${trust.reason})`}`);
  if (lull.isLull) {
    console.log(lull.recommendation);
  }
}
