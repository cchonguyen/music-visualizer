#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendEvent, readEvents } from './lib/event-log.mjs';

const gitSafe = (cwd, args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

export const resolveRoot = () =>
  process.env.CLAUDE_PROJECT_DIR || gitSafe(process.cwd(), ['rev-parse', '--show-toplevel']) || process.cwd();

export const activeSliceLabel = (root) => {
  const progressPath = path.join(root, '.spec', 'PROGRESS.md');
  if (!fs.existsSync(progressPath)) return 'none';
  const line = fs.readFileSync(progressPath, 'utf8').split('\n').find((l) => /^\s*-\s*\[.\].*\[IN_PROGRESS\]/.test(l));
  if (!line) return 'none';
  const m = line.match(/\*\*Slice\s+([^*]+)\*\*/);
  return m ? `Slice ${m[1].trim()}` : line.trim().slice(0, 60);
};

const eventsDir = (root) => path.join(root, '.spec', '.events');

/**
 * Records a harness event in the one event store, .spec/.events/<session>.jsonl (Slice 20.10).
 * The old .spec/STATUS_BATCH.jsonl queue is retired. Never throws; returns the entry or null.
 */
export function appendBatchEvent(root, { event, summary, slice, details = '', actor = 'harness' }) {
  const entry = {
    ts: new Date().toISOString(),
    actor,
    branch: gitSafe(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown',
    slice: slice || activeSliceLabel(root),
    event: String(event || 'info'),
    summary: String(summary || '').trim(),
    ...(details ? { details: String(details).trim() } : {}),
  };
  const ok = appendEvent(root, {
    session: process.env.CLAUDE_SESSION_ID || 'harness',
    kind: entry.event,
    source: entry.actor,
    slice: entry.slice,
    detail: { summary: entry.summary, branch: entry.branch, ...(entry.details ? { details: entry.details } : {}) },
  });
  return ok ? entry : null;
}

/** Reads every event recorded by appendBatchEvent, in the same shape it returned. */
export function readBatchEvents(root) {
  let files = [];
  try {
    files = fs.readdirSync(eventsDir(root)).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  return files
    .flatMap((f) => readEvents(path.join(eventsDir(root), f)))
    .filter((e) => e.detail && typeof e.detail.summary === 'string')
    .map((e) => ({
      ts: e.ts,
      actor: e.source,
      branch: e.detail.branch,
      slice: e.slice,
      event: e.kind,
      summary: e.detail.summary,
      ...(e.detail.details ? { details: e.detail.details } : {}),
    }));
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const cmd = (process.argv[2] || '').toLowerCase();
  if (cmd === 'append') {
    const event = process.argv[3] || 'note';
    const summary = process.argv[4] || 'Status update recorded';
    const details = process.argv.slice(5).join(' ');
    appendBatchEvent(resolveRoot(), { event, summary, details, actor: process.env.HARNESS_ACTOR || 'agent' });
    console.log(`✓ Recorded [${event}] in .spec/.events/.`);
    process.exit(0);
  }
  console.log('✗ Use: append <event> <summary> [details]. The digest, bundle and clear commands were retired with /brief.');
  process.exit(1);
}
