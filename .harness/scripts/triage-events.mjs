#!/usr/bin/env node
/**
 * Triage the per-session event log at .spec/.events/*.jsonl.
 * Keeps failure kinds only (*_warn, hook_error, plugin_version_mismatch, hard_block),
 * groups them by kind with count, first/last ts and a sample detail.
 * Sessions with no heartbeat event are reported as "silent".
 * Usage: node .harness/scripts/triage-events.mjs [--session id] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { eventFile, readEvents, sessionId } from './lib/event-log.mjs';

const FAILURE_KINDS = new Set(['hook_error', 'plugin_version_mismatch', 'hard_block']);
const SAMPLE_CHARS = 200;

export const isFailureKind = (kind) => typeof kind === 'string' && (kind.endsWith('_warn') || FAILURE_KINDS.has(kind));

const sampleOf = (detail) => {
  let text;
  try {
    text = JSON.stringify(detail === undefined ? {} : detail);
  } catch {
    text = '{"unserializable":true}';
  }
  return (text ?? '{}').slice(0, SAMPLE_CHARS);
};

/**
 * Summarises one session's events. Pure: no file access.
 * Returns { session, silent, total, failures: [{ kind, count, first, last, sample }] }.
 */
export function summarise(session, events) {
  const silent = !events.some((e) => e.kind === 'heartbeat');
  const byKind = new Map();
  for (const e of events) {
    if (!isFailureKind(e.kind)) continue;
    const ts = typeof e.ts === 'string' ? e.ts : null;
    const entry = byKind.get(e.kind);
    if (!entry) {
      byKind.set(e.kind, { kind: e.kind, count: 1, first: ts, last: ts, sample: sampleOf(e.detail) });
      continue;
    }
    entry.count += 1;
    if (ts && (!entry.first || ts < entry.first)) entry.first = ts;
    if (ts && (!entry.last || ts > entry.last)) entry.last = ts;
  }
  const failures = [...byKind.values()].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  return { session, silent, total: events.length, failures };
}

/** Reads the requested session file, or every .jsonl file under .spec/.events. */
export function collect(root, sessionFilter) {
  if (sessionFilter) {
    const id = sessionId(sessionFilter);
    return [summarise(id, readEvents(eventFile(root, id)))];
  }
  const dir = path.join(root, '.spec', '.events');
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort();
  } catch {
    return [];
  }
  return names.map((n) => summarise(n.slice(0, -'.jsonl'.length), readEvents(path.join(dir, n))));
}

export function renderText(sessions) {
  if (sessions.length === 0) return 'No event files under .spec/.events.';
  const lines = [];
  for (const s of sessions) {
    const tag = s.silent ? ' [silent: no heartbeat]' : '';
    lines.push(`Session ${s.session}: ${s.total} event(s)${tag}`);
    if (s.failures.length === 0) lines.push('  no failure events');
    for (const f of s.failures) {
      lines.push(`  ${f.kind} x${f.count}  first=${f.first ?? '-'}  last=${f.last ?? '-'}`);
      lines.push(`    sample: ${f.sample}`);
    }
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const opts = { session: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--session') {
      opts.session = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith('--session=')) opts.session = arg.slice('--session='.length);
  }
  return opts;
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const opts = parseArgs(argv);
  const sessions = collect(root, opts.session);
  console.log(opts.json ? JSON.stringify(sessions, null, 2) : renderText(sessions));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
