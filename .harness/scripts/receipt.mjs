#!/usr/bin/env node
// Baseline telemetry receipt (slice 19.3). Pure functions plus a small CLI. Node built-ins only.
// A receipt is a v1 JSON object. Every field is a real value or the string "unknown", and each unknown
// field has a reason in `unknowns`. Nothing is left blank, null or undefined.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const UNKNOWN = 'unknown';
export const BYPASS_LABEL = 'harness:bypass';
export const MIGRATION_LABEL = 'migration';
const NO_TRANSCRIPT = 'no transcript available (platform may not expose one)';
const DERIVED = ['session', 'models', 'tokens', 'apiMessages', 'toolCalls', 'toolErrors', 'subagentDispatches', 'subagentTokens', 'checksRun'];
const CHECK_PATTERN = /node --test|npm test|npm run lint|npm run typecheck/;
const SUBAGENT_PATTERN = /subagent_tokens:\s*(\d+)/g;
const RECEIPT_PATTERN = /<!--\s*harness-receipt:v1\s+(\{[\s\S]*?\})\s*-->/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');

function parseLines(transcriptText) {
  const out = [];
  for (const raw of transcriptText.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (isObj(obj)) out.push(obj);
    } catch {
      // Bad line: skip it.
    }
  }
  return out;
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (isObj(c) && typeof c.text === 'string' ? c.text : '')).join('\n');
  }
  return '';
}

// Derives the transcript fields. Returns { values, reasons } where reasons holds only the unknown fields.
function analyse(lines) {
  const reasons = {};
  let session = '';
  const models = new Set();
  const usageByMessage = new Map();
  const apiMessageKeys = new Set();
  const toolUses = new Map();
  const results = new Map();
  let anon = 0;
  const nextAnon = (prefix) => `${prefix}-${anon++}`;

  for (const obj of lines) {
    if (!session && text(obj.sessionId)) session = text(obj.sessionId);
    const msg = isObj(obj.message) ? obj.message : null;
    if (!msg) continue;
    if (obj.type === 'assistant') {
      const key = text(msg.id) || nextAnon('anon-message');
      apiMessageKeys.add(key);
      if (text(msg.model)) models.add(text(msg.model));
      if (isObj(msg.usage)) usageByMessage.set(key, msg.usage);
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (!isObj(block) || block.type !== 'tool_use') continue;
          const id = text(block.id) || nextAnon('anon-tool');
          const command = isObj(block.input) && typeof block.input.command === 'string' ? block.input.command : '';
          toolUses.set(id, { name: text(block.name) || UNKNOWN, command });
        }
      }
    }
    if (obj.type === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!isObj(block) || block.type !== 'tool_result') continue;
        const id = text(block.tool_use_id) || nextAnon('anon-result');
        results.set(id, { isError: block.is_error === true, text: resultText(block.content) });
      }
    }
  }

  const values = {};
  if (session) {
    values.session = session;
  } else {
    values.session = UNKNOWN;
    reasons.session = 'transcript had no sessionId';
  }

  if (models.size > 0) {
    values.models = Array.from(models);
  } else {
    values.models = UNKNOWN;
    reasons.models = 'transcript had no assistant model field';
  }

  if (usageByMessage.size > 0) {
    const sum = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
    for (const usage of usageByMessage.values()) {
      sum.input += Number(usage.input_tokens) || 0;
      sum.output += Number(usage.output_tokens) || 0;
      sum.cacheCreate += Number(usage.cache_creation_input_tokens) || 0;
      sum.cacheRead += Number(usage.cache_read_input_tokens) || 0;
    }
    values.tokens = sum;
  } else {
    values.tokens = UNKNOWN;
    reasons.tokens = 'transcript had no usage records';
  }

  values.apiMessages = apiMessageKeys.size;

  const byName = {};
  let agentDispatches = 0;
  let checksRun = 0;
  for (const tool of toolUses.values()) {
    byName[tool.name] = (byName[tool.name] || 0) + 1;
    if (tool.name === 'Agent' || tool.name === 'Task') agentDispatches += 1;
    if (tool.name === 'Bash' && CHECK_PATTERN.test(tool.command)) checksRun += 1;
  }
  values.toolCalls = { total: toolUses.size, byName };
  values.subagentDispatches = agentDispatches;
  values.checksRun = checksRun;

  let toolErrors = 0;
  let subagentTokens = 0;
  let subagentFound = false;
  for (const result of results.values()) {
    if (result.isError) toolErrors += 1;
    for (const match of result.text.matchAll(SUBAGENT_PATTERN)) {
      subagentTokens += Number(match[1]);
      subagentFound = true;
    }
  }
  values.toolErrors = toolErrors;
  if (subagentFound) {
    values.subagentTokens = subagentTokens;
  } else {
    values.subagentTokens = UNKNOWN;
    reasons.subagentTokens = agentDispatches > 0
      ? 'no Agent or Task result reported subagent_tokens'
      : 'no Agent or Task calls in transcript';
  }

  return { values, reasons };
}

function unknownAnalysis() {
  const values = {};
  const reasons = {};
  for (const field of DERIVED) {
    values[field] = UNKNOWN;
    reasons[field] = NO_TRANSCRIPT;
  }
  return { values, reasons };
}

/**
 * Builds a v1 receipt from a session JSONL transcript. meta: { slice, branch, head, now }.
 * Never throws. Missing data is "unknown" with a reason in `unknowns`.
 */
export function buildReceipt(transcriptText, meta = {}) {
  const m = isObj(meta) ? meta : {};
  const unknowns = {};
  const pick = (field, value, reason) => {
    const v = text(value);
    if (v) return v;
    unknowns[field] = reason;
    return UNKNOWN;
  };

  const hasTranscript = typeof transcriptText === 'string' && transcriptText.trim() !== '';
  const { values, reasons } = hasTranscript ? analyse(parseLines(transcriptText)) : unknownAnalysis();
  Object.assign(unknowns, reasons);

  let writtenAt = UNKNOWN;
  const when = m.now !== undefined ? new Date(m.now) : new Date();
  if (Number.isNaN(when.getTime())) {
    unknowns.writtenAt = 'meta.now was not a valid date';
  } else {
    writtenAt = when.toISOString();
  }

  return {
    v: 1,
    platform: 'claude-code',
    session: values.session,
    models: values.models,
    tokens: values.tokens,
    apiMessages: values.apiMessages,
    toolCalls: values.toolCalls,
    toolErrors: values.toolErrors,
    subagentDispatches: values.subagentDispatches,
    subagentTokens: values.subagentTokens,
    checksRun: values.checksRun,
    slice: pick('slice', m.slice, 'no slice was in progress'),
    branch: pick('branch', m.branch, 'branch not given or git unavailable'),
    head: pick('head', m.head, 'head not given or git unavailable'),
    writtenAt,
    unknowns,
  };
}

/** The PR-body block that carries a receipt. */
export function receiptBlock(receipt) {
  // Escape < and > so the JSON can never close the HTML comment early. The escapes decode on parse.
  const json = JSON.stringify(receipt).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `<!-- harness-receipt:v1 ${json} -->`;
}

/** Parses a receipt block back out of a PR body. Returns the receipt object, or null. */
export function extractReceipt(prBody) {
  if (typeof prBody !== 'string') return null;
  const match = RECEIPT_PATTERN.exec(prBody);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[1]);
    return isObj(obj) ? obj : null;
  } catch {
    return null;
  }
}

const first = (...values) => {
  for (const v of values) {
    if (Number.isFinite(v)) return v;
    if (text(v)) return text(v);
  }
  return UNKNOWN;
};

/** One JSONL record for the telemetry branch. receipt: an extracted receipt object, or null. */
export function telemetryRecord({ receipt = null, pr = {}, repo = '', now } = {}) {
  const p = isObj(pr) ? pr : {};
  const when = now !== undefined ? new Date(now) : new Date();
  const labels = Array.isArray(p.labels)
    ? p.labels.map((l) => (typeof l === 'string' ? l : isObj(l) ? text(l.name) : '')).filter(Boolean)
    : UNKNOWN;
  const author = first(p.author, isObj(p.author) ? p.author.login : '', isObj(p.user) ? p.user.login : '');
  return {
    v: 1,
    recordedAt: Number.isNaN(when.getTime()) ? UNKNOWN : when.toISOString(),
    repo: text(repo) || UNKNOWN,
    pr: {
      number: first(p.number, p.pr_number),
      title: first(p.title),
      mergedAt: first(p.mergedAt, p.merged_at),
      labels,
      headSha: first(p.headSha, p.head_sha, isObj(p.head) ? p.head.sha : ''),
      author,
    },
    receipt: isObj(receipt) ? receipt : { receipt: UNKNOWN, reason: 'PR body had no harness receipt' },
  };
}

/** Counts per repo: PRs, with and without a receipt, bypass and migration labels, output tokens. */
export function summarize(records = []) {
  const repos = {};
  for (const rec of Array.isArray(records) ? records : []) {
    if (!isObj(rec)) continue;
    const repo = text(rec.repo) || UNKNOWN;
    const r = repos[repo] || (repos[repo] = {
      prs: 0, withReceipt: 0, withoutReceipt: 0, bypass: 0, migration: 0, outputTokens: 0, outputTokensUnknown: 0,
    });
    r.prs += 1;
    const receipt = rec.receipt;
    if (isObj(receipt) && receipt.v === 1) {
      r.withReceipt += 1;
      if (isObj(receipt.tokens) && Number.isFinite(receipt.tokens.output)) {
        r.outputTokens += receipt.tokens.output;
      } else {
        r.outputTokensUnknown += 1;
      }
    } else {
      r.withoutReceipt += 1;
    }
    const labels = isObj(rec.pr) && Array.isArray(rec.pr.labels) ? rec.pr.labels : [];
    if (labels.includes(BYPASS_LABEL)) r.bypass += 1;
    if (labels.includes(MIGRATION_LABEL)) r.migration += 1;
  }
  return repos;
}

/** A short aligned table for summarize() output. */
export function formatSummary(summary = {}) {
  const head = ['repo', 'PRs', 'receipt', 'no receipt', 'bypass', 'migration', 'output tokens', 'tokens unknown'];
  const rows = Object.entries(summary).map(([repo, r]) => [
    repo, r.prs, r.withReceipt, r.withoutReceipt, r.bypass, r.migration, r.outputTokens, r.outputTokensUnknown,
  ].map(String));
  if (rows.length === 0) return 'no telemetry records';
  const all = [head, ...rows];
  const widths = head.map((_, i) => Math.max(...all.map((row) => row[i].length)));
  return all.map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = value;
      i++;
    }
  }
  return { flags, positional };
}

function readOptional(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readJsonl(file) {
  const out = [];
  for (const raw of readOptional(file).split('\n')) {
    try {
      const obj = JSON.parse(raw);
      if (isObj(obj)) out.push(obj);
    } catch {
      // Skip bad lines.
    }
  }
  return out;
}

function writeText(file, content) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, content);
}

const USAGE = [
  'Usage:',
  '  receipt.mjs write --transcript <path> --out <file> [--slice <id>] [--branch <b>] [--head <sha>]',
  '  receipt.mjs block --in <file>',
  '  receipt.mjs record --body-file <f> --pr-json <f> --out-append <jsonl> [--repo <owner/name>]',
  '  receipt.mjs view <jsonl...>',
].join('\n');

/** Runs one CLI command. Returns the exit code. */
export function runCli(argv, io = { out: console.log, err: console.error }) {
  const [cmd, ...rest] = argv;
  const { flags, positional } = parseFlags(rest);
  const str = (v) => (typeof v === 'string' ? v : '');

  if (cmd === 'write') {
    if (!str(flags.out)) {
      io.err('write needs --out <file>');
      return 1;
    }
    const transcript = str(flags.transcript) ? readOptional(flags.transcript) : '';
    const receipt = buildReceipt(transcript, { slice: flags.slice, branch: flags.branch, head: flags.head });
    writeText(flags.out, `${JSON.stringify(receipt, null, 2)}\n`);
    io.out(`wrote ${flags.out}`);
    return 0;
  }
  if (cmd === 'block') {
    const receipt = JSON.parse(readOptional(str(flags.in)) || 'null');
    if (!isObj(receipt)) {
      io.err('block needs --in <file> holding a receipt JSON object');
      return 1;
    }
    io.out(receiptBlock(receipt));
    return 0;
  }
  if (cmd === 'record') {
    if (!str(flags['out-append'])) {
      io.err('record needs --out-append <jsonl>');
      return 1;
    }
    let pr = {};
    try {
      pr = JSON.parse(readOptional(str(flags['pr-json'])) || '{}');
    } catch {
      pr = {};
    }
    const receipt = extractReceipt(readOptional(str(flags['body-file'])));
    const repo = str(flags.repo) || process.env.GITHUB_REPOSITORY || '';
    const record = telemetryRecord({ receipt, pr, repo });
    const file = flags['out-append'];
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
    io.out(`appended 1 record to ${file}`);
    return 0;
  }
  if (cmd === 'view') {
    const records = positional.flatMap(readJsonl);
    io.out(formatSummary(summarize(records)));
    return 0;
  }
  io.err(USAGE);
  return 1;
}

// Run only when executed directly, so tests can import the functions without side effects.
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (err) {
    console.error(`receipt: ${err.message}`);
    process.exitCode = 1;
  }
}
