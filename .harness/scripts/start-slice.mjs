#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveRoot, appendBatchEvent } from './status-batch.mjs';
import { ensureHarnessRoot, atomicWriteFileSync } from './lib/fs-atomic.mjs';
import { parseSliceLine } from './lib/slice-parser.mjs';
import { TRIPWIRES, parseDiff } from './pr-scope-check.mjs';
import { isEngineLocked, isHubOrigin } from '../hooks/lib/guard-rules.mjs';

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

const SCOPE_FLAGS = new Set(['--from-scope', '--slice', '--targets', '--reason', '--title']);

const oneLine = (s) => !/[|\r\n]/.test(s);

function normalizeRepoPath(raw, label) {
  const input = String(raw ?? '').trim();
  if (!input) throw new Error(`${label} is empty.`);
  if (!oneLine(input)) throw new Error(`${label} must be one line with no "|": ${input}`);
  const slashed = input.replace(/\\/g, '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) {
    throw new Error(`${label} must be repo-relative, not absolute: ${input}`);
  }
  if (slashed.split('/').includes('..')) throw new Error(`${label} must not contain "..": ${input}`);
  const norm = path.posix.normalize(slashed).replace(/^\.\//, '');
  if (!norm || norm === '.') throw new Error(`${label} is empty.`);
  return norm;
}

function normalizeSliceId(raw) {
  const id = String(raw ?? '').replace(/^Slice\s+/i, '').trim();
  if (!/^[0-9]+(\.[0-9]+)*$/.test(id)) throw new Error('--slice must be a slice id such as 11.9.');
  return id;
}

function parseTargets(raw) {
  const text = String(raw ?? '');
  if (!text.trim()) throw new Error('--targets is required: comma-separated repo-relative paths.');
  const entries = text.split(',');
  if (entries.some((e) => !e.trim())) throw new Error('--targets has an empty entry.');
  return entries.map((e) => normalizeRepoPath(e, '--targets entry'));
}

function checkScopeDoc(root, raw, sliceId, title) {
  const doc = normalizeRepoPath(raw, '--from-scope');
  if (!doc.startsWith('.spec/') && !doc.startsWith('docs/')) {
    throw new Error(`--from-scope must be under .spec/ or docs/: ${doc}`);
  }
  const full = path.join(root, doc);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new Error(`Scope doc not found: ${doc}`);
  }
  const text = fs.readFileSync(full, 'utf8');
  const escaped = sliceId.replace(/\./g, '\\.');
  const idToken = new RegExp(`(?<![0-9.])${escaped}(?![0-9]|\\.[0-9])`);
  if (!idToken.test(text) && !(title && text.includes(title))) {
    throw new Error(`Scope doc ${doc} does not contain Slice ${sliceId} as a token or the --title text.`);
  }
  return doc;
}

/**
 * Anchors a slice that is already scoped in an existing doc, without /spec.
 * Hard refusals throw before any file is written.
 */
export function startFromScope(root, { doc, slice, targets, reason, title } = {}) {
  const reasonText = typeof reason === 'string' ? reason.trim() : '';
  if (!reasonText) throw new Error('--reason is required: say why the scope is already settled.');
  if (!oneLine(reasonText)) throw new Error('--reason must be one line with no "|".');
  const titleText = title == null ? '' : String(title).trim();
  if (title != null && (!titleText || !oneLine(titleText))) {
    throw new Error('--title must be non-empty, one line, with no "|".');
  }
  const sliceId = normalizeSliceId(slice);
  const docPath = checkScopeDoc(root, doc, sliceId, titleText);
  const targetList = parseTargets(targets);

  const progressPath = path.join(root, '.spec', 'PROGRESS.md');
  if (!fs.existsSync(progressPath)) throw new Error('.spec/PROGRESS.md not found.');
  const original = fs.readFileSync(progressPath, 'utf8');
  for (const line of original.split('\n')) {
    if (!/^\s*-\s*\[/.test(line)) continue;
    const p = parseSliceLine(line);
    if (p.status === '[IN_PROGRESS]') {
      throw new Error(`Slice ${p.id || 'active'} is already [IN_PROGRESS]. Finish it before starting a new slice.`);
    }
    if (p.id === sliceId) {
      throw new Error(`Slice ${sliceId} already exists in .spec/PROGRESS.md; use start-slice.mjs ${sliceId} instead.`);
    }
  }

  const label = titleText || sliceId;
  const line = `- [ ] **Slice ${sliceId}: ${label}** [IN_PROGRESS] Scope bypass from ${docPath}. Target files: ${targetList.join(', ')}`;
  const body = original.endsWith('\n') ? `${original}${line}\n` : `${original}\n${line}\n`;
  atomicWriteFileSync(progressPath, body, 'utf8');

  const subject = `docs(spec): anchor Slice ${sliceId} [IN_PROGRESS]`;
  try {
    execFileSync(
      'git',
      [
        'commit', '--only', '-q', '-m', subject,
        '--trailer', `Spec-Bypass: ${docPath}`,
        '--trailer', `Spec-Bypass-Reason: ${reasonText}`,
        '--', '.spec/PROGRESS.md',
      ],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    atomicWriteFileSync(progressPath, original, 'utf8');
    throw new Error(`git commit failed, PROGRESS.md restored: ${String(err.stderr || err.message).trim()}`);
  }
  const commitSha = execFileSync('git', ['log', '-1', '--format=%h'], { cwd: root, encoding: 'utf8' }).trim();

  appendBatchEvent(root, {
    event: 'spec_bypass',
    slice: `Slice ${sliceId}`,
    summary: `Scope bypass from ${docPath}: ${reasonText}`,
  });

  return {
    success: true,
    sliceId,
    sliceLabel: `Slice ${sliceId}`,
    commitSha,
    commitMsg: subject,
    scopeDoc: docPath,
    reason: reasonText,
    targets: targetList,
  };
}

const defaultLsRemote = (root) => {
  try {
    return execFileSync('git', ['ls-remote', '--tags', 'origin', 'harness-main-red'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
};

const gitText = (root, args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

const sliceIdsOf = (text) =>
  String(text || '').split('\n').map((l) => parseSliceLine(l).id).filter(Boolean);

/**
 * Opens a slice on the fly (SYSTEM_SPEC 4.A.6, ADR-012) without /spec or a plan file.
 * Every refusal throws before any file is written.
 *
 * opts: title, tag ('core'|'ui'), targets, verify, issue, reason, id, gateChange,
 *   lsRemote(root) -> string, originUrl, mainProgress (string|null) for tests.
 */
export function startAdhoc(root, opts = {}) {
  const need = (value, label) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) throw new Error(`${label} is required.`);
    if (!oneLine(text)) throw new Error(`${label} must be one line with no "|".`);
    return text;
  };
  const titleText = need(opts.title, '--title');
  const reasonText = need(opts.reason, '--reason');
  const verifyText = need(opts.verify, '--verify');
  const tagKey = String(opts.tag ?? '').trim().toLowerCase();
  if (tagKey !== 'core' && tagKey !== 'ui') throw new Error('--tag must be core or ui.');
  const tag = tagKey === 'core' ? '[CORE / DATA]' : '[UI / VISUAL]';
  const issueRaw = String(opts.issue ?? '').trim();
  if (!/^[1-9][0-9]*$/.test(issueRaw)) throw new Error('--issue must be a positive integer.');
  const issue = Number(issueRaw);

  const rawTargets = String(opts.targets ?? '');
  if (!rawTargets.trim()) throw new Error('--targets is required: comma-separated repo-relative paths.');
  if (!oneLine(rawTargets)) throw new Error('--targets must be one line with no "|".');
  const entries = rawTargets.split(',');
  if (entries.some((e) => !e.trim())) throw new Error('--targets has an empty entry.');
  if (entries.length >= 5) throw new Error('--targets has 5 or more files; use /spec for work this large.');
  const targetList = entries.map((e) => normalizeRepoPath(e, '--targets entry'));
  if (targetList.includes('.spec/PROGRESS.md')) throw new Error('--targets must not include .spec/PROGRESS.md.');

  const noDiff = parseDiff('');
  for (const t of targetList) {
    const hit = TRIPWIRES.find((w) => w.test(t, noDiff, () => null));
    if (hit) throw new Error(`Target ${t} matches a Red tripwire (${hit.name}); use /spec.`);
  }

  const originUrl = opts.originUrl ?? gitText(root, ['remote', 'get-url', 'origin']).trim();
  if (!isHubOrigin(originUrl)) {
    for (const t of targetList) {
      if (isEngineLocked(t)) throw new Error(`Target ${t} is engine-locked in this repo; change it in claude-harness-hub.`);
    }
  }

  let explicitId = null;
  if (opts.id != null && String(opts.id).trim() !== '') {
    explicitId = String(opts.id).replace(/^Slice\s+/i, '').trim();
    if (!/^[0-9]+\.[0-9]+$/.test(explicitId)) throw new Error('--id must look like 18.2.');
  }

  const progressPath = path.join(root, '.spec', 'PROGRESS.md');
  if (!fs.existsSync(progressPath)) throw new Error('.spec/PROGRESS.md not found.');
  const original = fs.readFileSync(progressPath, 'utf8');
  for (const line of original.split('\n')) {
    if (!/^\s*-\s*\[/.test(line)) continue;
    if (parseSliceLine(line).status === '[IN_PROGRESS]') {
      throw new Error(`Slice ${parseSliceLine(line).id || 'active'} is already [IN_PROGRESS]. Finish it before starting a new slice.`);
    }
  }

  const lsRemote = typeof opts.lsRemote === 'function' ? opts.lsRemote : defaultLsRemote;
  let redOut = '';
  try { redOut = String(lsRemote(root) ?? ''); } catch { redOut = ''; }
  if (redOut.trim()) throw new Error('main is red (tag harness-main-red exists on origin). Fix main first.');

  const mainText = opts.mainProgress !== undefined
    ? opts.mainProgress
    : gitText(root, ['show', 'origin/main:.spec/PROGRESS.md']);
  const ids = [...sliceIdsOf(original), ...sliceIdsOf(mainText)];

  let sliceId;
  if (explicitId) {
    sliceId = explicitId;
  } else {
    const major = ids.reduce((m, id) => Math.max(m, parseInt(id, 10)), 0);
    let maxMinor = 0;
    for (const id of ids) {
      const m = id.match(/^([0-9]+)\.([0-9]+)/);
      if (m && Number(m[1]) === major) maxMinor = Math.max(maxMinor, Number(m[2]));
    }
    sliceId = `${major}.${maxMinor + 1}`;
  }
  if (ids.includes(sliceId)) throw new Error(`Slice ${sliceId} already exists in PROGRESS.md.`);

  const gate = opts.gateChange ? 'GATE CHANGE. ' : '';
  const line =
    `- [ ] **Slice ${sliceId}: ${titleText}** [IN_PROGRESS] ${tag} ${gate}On-the-fly: ${reasonText} ` +
    `Target files: ${targetList.join(', ')} | Issue: #${issue} | Verify: ${verifyText}`;
  const body = original.endsWith('\n') ? `${original}${line}\n` : `${original}\n${line}\n`;
  atomicWriteFileSync(progressPath, body, 'utf8');

  const subject = `docs(spec): anchor Slice ${sliceId} [IN_PROGRESS]`;
  try {
    execFileSync(
      'git',
      [
        'commit', '--only', '-q', '-m', subject,
        '--trailer', `Spec-Bypass: on-the-fly Issue #${issue}`,
        '--trailer', `Spec-Bypass-Reason: ${reasonText}`,
        '--', '.spec/PROGRESS.md',
      ],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    atomicWriteFileSync(progressPath, original, 'utf8');
    throw new Error(`git commit failed, PROGRESS.md restored: ${String(err.stderr || err.message).trim()}`);
  }
  const commitSha = execFileSync('git', ['log', '-1', '--format=%h'], { cwd: root, encoding: 'utf8' }).trim();

  appendBatchEvent(root, {
    event: 'adhoc_slice_start',
    slice: `Slice ${sliceId}`,
    summary: `On-the-fly slice for Issue #${issue}: ${reasonText}`,
  });

  return {
    success: true,
    sliceId,
    sliceLabel: `Slice ${sliceId}`,
    commitSha,
    commitMsg: subject,
    issue,
    reason: reasonText,
    targets: targetList,
  };
}

const ADHOC_VALUE_FLAGS = new Set(['--title', '--tag', '--targets', '--verify', '--issue', '--reason', '--id']);

function parseAdhocFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--adhoc') continue;
    if (flag === '--gate-change') { out.gateChange = true; continue; }
    if (!ADHOC_VALUE_FLAGS.has(flag)) throw new Error(`Unknown argument: ${flag}`);
    if (i + 1 >= argv.length) throw new Error(`${flag} needs a value.`);
    out[flag.slice(2)] = argv[++i];
  }
  return out;
}

if (process.argv.includes('--adhoc') && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureHarnessRoot();
  const root = resolveRoot();
  try {
    const res = startAdhoc(root, parseAdhocFlags(process.argv.slice(2)));
    console.log(`✓ START SLICE (on-the-fly): Anchored ${res.sliceLabel} [IN_PROGRESS] (${res.commitSha}). Issue #${res.issue}.`);
  } catch (err) {
    console.error(`✗ START SLICE FAILED: ${err.message}`);
    process.exit(1);
  }
}

function parseScopeFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!SCOPE_FLAGS.has(flag)) throw new Error(`Unknown argument: ${flag}`);
    if (i + 1 >= argv.length) throw new Error(`${flag} needs a value.`);
    out[flag.slice(2)] = argv[i + 1];
  }
  return out;
}

if (process.argv.includes('--from-scope') && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureHarnessRoot();
  const root = resolveRoot();
  try {
    const flags = parseScopeFlags(process.argv.slice(2));
    const res = startFromScope(root, {
      doc: flags['from-scope'],
      slice: flags.slice,
      targets: flags.targets,
      reason: flags.reason,
      title: flags.title,
    });
    console.log(`✓ START SLICE (scope bypass): Anchored ${res.sliceLabel} [IN_PROGRESS] (${res.commitSha}). Scope source: ${res.scopeDoc}.`);
  } catch (err) {
    console.error(`✗ START SLICE FAILED: ${err.message}`);
    process.exit(1);
  }
}

if (!process.argv.includes('--from-scope') && !process.argv.includes('--adhoc') && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
