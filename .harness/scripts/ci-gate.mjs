#!/usr/bin/env node
// CI gate for spoke repos. Two modes, both exit 1 on failure so the Actions check goes red.
//   pr   <base> <head>     PR check. Its head commit must carry Referee trailers whose Referee-Tree matches
//                          the commit tree. A PR with no slice line in .spec/PROGRESS.md gets a warning only.
//   push <before> <after>  Push watch. Lists non-merge commits in the push that lack a Referee-Verdict
//                          trailer. Exits 1 when any are listed. Skips bookkeeping
//                          commits: only .spec/ or engine sync files changed, or a sync subject.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

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

// Mirrors pr-scope-check isTemplateCopy: a workflow identical to its hub template is sync-delivered.
function isTemplateCopyAt(file, head, cwd) {
  if (!/^\.github\/workflows\/[^/]+\.yml$/.test(file)) return false;
  const show = (p) => { try { return git(['show', `${head}:${p}`], cwd); } catch { return null; } };
  const template = show(`.harness/templates/workflows/${file.split('/').pop()}`);
  return template !== null && template === show(file);
}

// True when package.json differs between the merge base and head only in its top-level `version`.
// Spokes that demand a version bump on every PR add this to engine sync PRs. Any error returns false.
export function isVersionOnlyPackageChange(file, base, head, cwd = process.cwd()) {
  if (file !== 'package.json') return false;
  try {
    const mergeBase = git(['merge-base', base, head], cwd).trim();
    const before = JSON.parse(git(['show', `${mergeBase}:package.json`], cwd));
    const after = JSON.parse(git(['show', `${head}:package.json`], cwd));
    if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return false;
    if (before.version === after.version) return false;
    const { version: _a, ...restBefore } = before;
    const { version: _b, ...restAfter } = after;
    return JSON.stringify(sortKeys(restBefore)) === JSON.stringify(sortKeys(restAfter));
  } catch {
    return false;
  }
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

export function checkPullRequest({ base, head, cwd = process.cwd() }) {
  const problems = [];
  const warnings = [];
  const notes = [];
  const changedFiles = git(['diff', '--name-only', `${base}...${head}`], cwd).split('\n').filter(Boolean);
  const isSyncFile = (f) => isBookkeepingCommit({ subject: '', files: [f] }) || isTemplateCopyAt(f, head, cwd);
  const versionBump = changedFiles.includes('package.json') && isVersionOnlyPackageChange('package.json', base, head, cwd);
  if (changedFiles.length > 0 && changedFiles.every((f) =>
    isSyncFile(f) || (f === 'package.json' && versionBump))
    && (!versionBump || changedFiles.some((f) => f !== 'package.json'))) {
    notes.push('Engine sync PR: no slice or Referee trailer needed.');
    if (versionBump) notes.push('package.json version bump allowed in an engine sync PR.');
    return { problems, warnings, notes };
  }
  if (changedFiles.length > 0 && changedFiles.every((f) => isDocFile(f) || isSyncFile(f))) {
    notes.push('Docs-only PR: no slice or Referee trailer needed.');
    return { problems, warnings, notes };
  }
  const progressDiff = git(['diff', '-U0', `${base}...${head}`, '--', '.spec/PROGRESS.md'], cwd);
  if (addedSliceLines(progressDiff).length === 0) {
    warnings.push('Not in a slice: this PR adds no `- [x] **Slice N` line to .spec/PROGRESS.md. Attach it to a slice by adding one, or finish a slice with finish-slice.mjs. The PR is allowed to merge without one.');
  }

  const message = git(['log', '-1', '--format=%B', head], cwd);
  if (!hasRefereeTrailer(message)) {
    problems.push('No Referee trailer: the head commit lacks `Referee-Verdict: VERIFIED` and `Referee-Tree`. Commit through finish-slice.mjs.');
  } else {
    const { tree } = parseRefereeTrailers(message);
    const actual = git(['rev-parse', `${head}^{tree}`], cwd).trim();
    if (actual !== tree) {
      problems.push(`Stale verdict: Referee-Tree ${tree} does not match the head commit tree ${actual}. The commit changed after it was verified.`);
    }
  }
  return { problems, warnings, notes };
}

const SPEC_FILE = /^\.spec\//;
const ENGINE_FILE = /^(\.harness\/|\.claude\/|\.harness-version$|AGENTS\.md$|plugins\/harness\/)/;
const DOC_FILE = /(^docs\/|\.md$)/;

// True for documentation: anything under docs/ or any Markdown file. A docs-only PR needs no Referee trailer.
export function isDocFile(file) {
  return DOC_FILE.test(String(file));
}
const SYNC_SUBJECT =/^(chore\(harness\): sync|Sync harness engine)/;

// True for commits that need no Referee trailer: sync subjects, commits with no changed files,
// and commits whose files are all under .spec/ or are engine sync files.
export function isBookkeepingCommit({ subject = '', files = [] }) {
  if (SYNC_SUBJECT.test(String(subject))) return true;
  return files.every((f) => SPEC_FILE.test(f) || ENGINE_FILE.test(f));
}

// Non-merge commits in a push that carry no Referee-Verdict trailer, as "<sha> <subject>" strings.
// Bookkeeping commits (see isBookkeepingCommit) are skipped.
export function commitsMissingTrailer({ before, after, cwd = process.cwd() }) {
  const range = !before || ZERO_SHA.test(before) ? ['--max-count=1', after] : [`${before}..${after}`];
  const shas = git(['rev-list', '--no-merges', '--reverse', ...range], cwd).split('\n').filter(Boolean);
  return shas
    .filter((sha) => !hasRefereeTrailer(git(['log', '-1', '--format=%B', sha], cwd)))
    .map((sha) => ({ sha, subject: git(['log', '-1', '--format=%s', sha], cwd).trim() }))
    .filter(({ sha, subject }) => {
      const files = git(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', sha], cwd).split('\n').filter(Boolean);
      return !isBookkeepingCommit({ subject, files });
    })
    .map(({ sha, subject }) => `${sha.slice(0, 12)} ${subject}`);
}

// Issue number from the first closing keyword (close/fix/resolve and forms) followed by `#N` or `owner/repo#N`.
// Returns the number, or null when the body links no issue.
const CLOSING_LINK = /\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)\b/i;
export function findIssueLink(body) {
  const m = String(body ?? '').match(CLOSING_LINK);
  return m ? Number(m[1]) : null;
}

// Slice ids used by more than one slice line in PROGRESS.md text, sorted numerically.
const SLICE_ID_LINE = /^\s*-\s*\[[^\]]*\]\s*\*\*Slice\s+([0-9]+(?:\.[0-9]+)*)\b/;
export function duplicateSliceIds(progressText) {
  const counts = new Map();
  for (const line of String(progressText ?? '').split('\n')) {
    const m = line.match(SLICE_ID_LINE);
    if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// Duplicated slice ids where at least one of the lines with that id is still open ([ ]).
// Old duplicates whose lines are all done do not block later PRs.
const OPEN_SLICE_LINE = /^\s*-\s*\[ \]/;
export function openDuplicateSliceIds(progressText) {
  const counts = new Map();
  const open = new Set();
  for (const line of String(progressText ?? '').split('\n')) {
    const m = line.match(SLICE_ID_LINE);
    if (!m) continue;
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    if (OPEN_SLICE_LINE.test(line)) open.add(m[1]);
  }
  return [...counts.entries()]
    .filter(([id, n]) => n > 1 && open.has(id))
    .map(([id]) => id)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// Pure PR gate. Returns { problems, warnings, notes }. Every problem tells the agent the exact fix.
export function gateCheck({ body, labels = [], progressText = '' } = {}) {
  const problems = [];
  const warnings = [];
  const notes = [];
  if (labels.includes('harness:bypass')) {
    notes.push('Bypass label present: gate skipped. Recorded for telemetry.');
    return { problems, warnings, notes };
  }
  if (labels.includes('migration')) {
    notes.push('Migration PR: slice checks skipped.');
    return { problems, warnings, notes };
  }
  if (findIssueLink(body) === null) {
    problems.push('No linked issue: add `Closes #N` to the PR body (the gate workflow normally adds one automatically).');
  }
  const dupes = openDuplicateSliceIds(progressText);
  if (dupes.length > 0) {
    problems.push(`Duplicate slice ids in .spec/PROGRESS.md: ${dupes.join(', ')}. Fix: renumber the later line of each pair to the next free id; \`node .harness/scripts/start-slice.mjs\` picks free ids.`);
  }
  const doneDupes = duplicateSliceIds(progressText).filter((id) => !dupes.includes(id));
  if (doneDupes.length > 0) {
    notes.push(`Old duplicate slice ids (all done, ignored): ${doneDupes.join(', ')}.`);
  }
  return { problems, warnings, notes };
}

function readOptional(file) {
  if (!file) return '';
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function flagValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, first, second] = process.argv.slice(2);
  if (mode === 'pr' && first && second) {
    const { problems, warnings, notes = [] } = checkPullRequest({ base: first, head: second });
    for (const w of warnings) console.log(`::warning::${w}`);
    for (const n of notes) console.log(`✓ Harness slice gate: ${n}`);
    if (problems.length === 0) {
      if (notes.length === 0) console.log('✓ Harness slice gate: slice present and head commit verified.');
    } else {
      console.log('✗ Harness slice gate failed:');
      for (const p of problems) console.log(`  - ${p}`);
      process.exitCode = 1;
    }
  } else if (mode === 'push' && first && second) {
    // Exit 1 means "commits found without a trailer" and nothing else. A git failure (bad sha,
    // shallow clone) exits 2, so the watch workflow does not open an issue for a scan that never ran.
    let missing;
    try {
      missing = commitsMissingTrailer({ before: first, after: second });
    } catch (err) {
      console.log(`✗ Referee scan could not run: ${String(err.message).split('\n')[0]}`);
      process.exitCode = 2;
    }
    if (missing && missing.length === 0) {
      console.log('✓ Every commit in this push carries a Referee trailer.');
    } else if (missing) {
      console.log('✗ Commits without a Referee-Verdict trailer:');
      for (const line of missing) console.log(`  - ${line}`);
      process.exitCode = 1;
    }
  } else if (mode === 'has-issue' && first) {
    // Exit 0 when the PR body links an issue, 1 when it does not, 2 when the body file cannot be read.
    let body;
    try {
      body = fs.readFileSync(first, 'utf8');
    } catch (err) {
      console.log(`✗ Cannot read body file: ${String(err.message).split('\n')[0]}`);
      process.exitCode = 2;
    }
    if (body !== undefined) {
      const issue = findIssueLink(body);
      if (issue === null) {
        console.log('No closing issue link found in the PR body.');
        process.exitCode = 1;
      } else {
        console.log(`Closing issue link found: #${issue}`);
      }
    }
  } else if (mode === 'gate') {
    const args = process.argv.slice(3);
    const bodyFile = flagValue(args, '--body-file');
    const labels = (flagValue(args, '--labels') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const progressFile = flagValue(args, '--progress');
    let body = '';
    if (bodyFile) {
      try {
        body = fs.readFileSync(bodyFile, 'utf8');
      } catch (err) {
        console.log(`✗ Cannot read body file: ${String(err.message).split('\n')[0]}`);
        process.exitCode = 2;
      }
    }
    if (process.exitCode !== 2) {
      const { problems, warnings, notes } = gateCheck({ body, labels, progressText: readOptional(progressFile) });
      for (const w of warnings) console.log(`::warning::${w}`);
      for (const n of notes) console.log(`✓ Harness gate: ${n}`);
      if (problems.length === 0) {
        if (notes.length === 0) console.log('✓ Harness gate: issue linked and no duplicate slice ids.');
      } else {
        console.log('✗ Harness gate failed:');
        for (const p of problems) console.log(`  - ${p}`);
        process.exitCode = 1;
      }
    }
  } else {
    console.log('Usage: node .harness/scripts/ci-gate.mjs pr <base> <head> | push <before> <after> | has-issue <bodyFile> | gate --body-file <f> --labels "<list>" [--progress <path>]');
    process.exitCode = 2;
  }
}
