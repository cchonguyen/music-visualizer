#!/usr/bin/env node
// CI gate for spoke repos. Two modes, both exit 1 on failure so the Actions check goes red.
//   pr   <base> <head>     PR check. The PR must add a slice line to .spec/PROGRESS.md, and its head
//                          commit must carry Referee trailers whose Referee-Tree matches the commit tree,
//                          plus a Dashboard-Sync trailer proving STATE.json was updated for the slice.
//   push <before> <after>  Push watch. Lists non-merge commits in the push that lack a Referee-Verdict
//                          trailer. Exits 1 when any are listed.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { hasDashboardTrailer, dashboardTrailer } from './lib/dashboard-sync.mjs';

const ZERO_SHA = /^0+$/;
const SLICE_LINE = /^\s*-\s*\[[^\]]*\]\s*\*\*Slice\s+[0-9]/;
const TREE_SHA = /^[0-9a-f]{40,64}$/;

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Reads the Referee-Verdict and Referee-Tree trailers from a commit message. Missing keys come back ''.
export function parseRefereeTrailers(message) {
  const field = (key) => {
    const m = String(message).match(new RegExp(`^${key}:[ \\t]*(\\S+)[ \\t]*$`, 'm'));
    return m ? m[1] : '';
  };
  return { verdict: field('Referee-Verdict'), tree: field('Referee-Tree') };
}

export function hasRefereeTrailer(message) {
  const { verdict, tree } = parseRefereeTrailers(message);
  return verdict === 'VERIFIED' && TREE_SHA.test(tree);
}

// Slice lines added by a PROGRESS.md diff (the `+` lines, not the `+++` file header).
export function addedSliceLines(diffText) {
  return String(diffText)
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .filter((line) => SLICE_LINE.test(line));
}

export function checkPullRequest({ base, head, cwd = process.cwd() }) {
  const problems = [];
  const progressDiff = git(['diff', '-U0', `${base}...${head}`, '--', '.spec/PROGRESS.md'], cwd);
  if (addedSliceLines(progressDiff).length === 0) {
    problems.push('No slice: this PR adds no `- [x] **Slice N` line to .spec/PROGRESS.md. Finish a slice with finish-slice.mjs, or mark one in PROGRESS.md.');
  }

  const message = git(['log', '-1', '--format=%B', head], cwd);
  if (!hasDashboardTrailer(message)) {
    problems.push('No dashboard sync: the head commit lacks a `Dashboard-Sync: Slice <id> <stage>` trailer, so STATE.json was not updated for this slice. Finish the slice with finish-slice.mjs, which runs bin/update-state.mjs before it commits.');
  }
  if (!hasRefereeTrailer(message)) {
    problems.push('No Referee trailer: the head commit lacks `Referee-Verdict: VERIFIED` and `Referee-Tree`. Commit through finish-slice.mjs.');
  } else {
    const { tree } = parseRefereeTrailers(message);
    const actual = git(['rev-parse', `${head}^{tree}`], cwd).trim();
    if (actual !== tree) {
      problems.push(`Stale verdict: Referee-Tree ${tree} does not match the head commit tree ${actual}. The commit changed after it was verified.`);
    }
  }
  return problems;
}

// Non-merge commits in a push that carry no Referee-Verdict trailer, as "<sha> <subject>" strings.
export function commitsMissingTrailer({ before, after, cwd = process.cwd() }) {
  const range = !before || ZERO_SHA.test(before) ? ['--max-count=1', after] : [`${before}..${after}`];
  const shas = git(['rev-list', '--no-merges', '--reverse', ...range], cwd).split('\n').filter(Boolean);
  return shas
    .filter((sha) => !hasRefereeTrailer(git(['log', '-1', '--format=%B', sha], cwd)))
    .map((sha) => `${sha.slice(0, 12)} ${git(['log', '-1', '--format=%s', sha], cwd).trim()}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, first, second] = process.argv.slice(2);
  if (mode === 'pr' && first && second) {
    const problems = checkPullRequest({ base: first, head: second });
    if (problems.length === 0) {
      console.log('✓ Harness slice gate: slice present and head commit verified.');
    } else {
      console.log('✗ Harness slice gate failed:');
      for (const p of problems) console.log(`  - ${p}`);
      process.exitCode = 1;
    }
  } else if (mode === 'push' && first && second) {
    const missing = commitsMissingTrailer({ before: first, after: second });
    if (missing.length === 0) {
      console.log('✓ Every commit in this push carries a Referee trailer.');
    } else {
      console.log('✗ Commits without a Referee-Verdict trailer:');
      for (const line of missing) console.log(`  - ${line}`);
      process.exitCode = 1;
    }
  } else {
    console.log('Usage: node .harness/scripts/ci-gate.mjs pr <base> <head> | push <before> <after>');
    process.exitCode = 2;
  }
}
