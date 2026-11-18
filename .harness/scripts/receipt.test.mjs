import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReceipt,
  receiptBlock,
  extractReceipt,
  telemetryRecord,
  summarize,
} from './receipt.mjs';

const jsonl = (objects) => objects.map((o) => JSON.stringify(o)).join('\n');

const assistant = (id, usage, content = [], extra = {}) => ({
  type: 'assistant',
  sessionId: 'sess-1',
  message: { id, model: 'claude-test-model', usage, content, ...extra },
});

const toolResult = (toolUseId, content, isError = false) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content }] },
});

const usage = (input, output, cacheCreate = 0, cacheRead = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_creation_input_tokens: cacheCreate,
  cache_read_input_tokens: cacheRead,
});

// Walks a receipt and fails if any value is null, undefined or an empty string.
function assertNoBlanks(value, where = 'receipt') {
  assert.notEqual(value, undefined, `${where} is undefined`);
  assert.notEqual(value, null, `${where} is null`);
  if (typeof value === 'string') assert.notEqual(value, '', `${where} is empty`);
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) assertNoBlanks(child, `${where}.${key}`);
  }
}

test('usage is counted once per message id even when the message spans several lines', () => {
  const transcript = jsonl([
    { type: 'user', sessionId: 'sess-1', message: { content: 'hello' } },
    assistant('msg_1', usage(10, 5, 2, 3), [{ type: 'text', text: 'a' }]),
    assistant('msg_1', usage(10, 5, 2, 3), [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }]),
    assistant('msg_2', usage(4, 7, 0, 1), [{ type: 'text', text: 'b' }]),
  ]);
  const r = buildReceipt(transcript, { slice: '19.3', branch: 'b', head: 'abc', now: '2026-11-17T00:00:00Z' });
  assert.equal(r.apiMessages, 2);
  assert.deepEqual(r.tokens, { input: 14, output: 12, cacheCreate: 2, cacheRead: 4 });
  assert.equal(r.session, 'sess-1');
  assert.deepEqual(r.models, ['claude-test-model']);
  assert.equal(r.writtenAt, '2026-11-17T00:00:00.000Z');
  assert.equal(r.slice, '19.3');
});

test('tool calls are counted by name and tool errors are counted', () => {
  const transcript = jsonl([
    assistant('msg_1', usage(1, 1), [
      { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/x' } },
      { type: 'tool_use', id: 'tu_2', name: 'Bash', input: { command: 'node --test x.mjs' } },
      { type: 'tool_use', id: 'tu_3', name: 'Bash', input: { command: 'ls' } },
    ]),
    assistant('msg_2', usage(1, 1), [{ type: 'tool_use', id: 'tu_4', name: 'Edit', input: {} }]),
    toolResult('tu_1', 'ok'),
    toolResult('tu_2', 'fail', true),
    toolResult('tu_4', 'boom', true),
  ]);
  const r = buildReceipt(transcript);
  assert.equal(r.toolCalls.total, 4);
  assert.deepEqual(r.toolCalls.byName, { Read: 1, Bash: 2, Edit: 1 });
  assert.equal(r.toolErrors, 2);
  assert.equal(r.checksRun, 1);
});

test('checksRun counts only Bash commands that run a check', () => {
  const transcript = jsonl([
    assistant('msg_1', usage(1, 1), [
      { type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'npm test --silent' } },
      { type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'npm run lint --silent' } },
      { type: 'tool_use', id: 'c', name: 'Read', input: { command: 'npm test' } },
    ]),
  ]);
  assert.equal(buildReceipt(transcript).checksRun, 2);
});

test('subagent_tokens is summed from tool results and dispatches are counted', () => {
  const transcript = jsonl([
    assistant('msg_1', usage(1, 1), [
      { type: 'tool_use', id: 'ag_1', name: 'Agent', input: {} },
      { type: 'tool_use', id: 'ag_2', name: 'Task', input: {} },
    ]),
    toolResult('ag_1', 'done\nsubagent_tokens: 1234'),
    toolResult('ag_2', [{ type: 'text', text: 'done subagent_tokens: 66' }]),
  ]);
  const r = buildReceipt(transcript);
  assert.equal(r.subagentDispatches, 2);
  assert.equal(r.subagentTokens, 1300);
});

test('subagentTokens is unknown with a reason when no result reported it', () => {
  const transcript = jsonl([
    assistant('msg_1', usage(1, 1), [{ type: 'tool_use', id: 'ag_1', name: 'Agent', input: {} }]),
    toolResult('ag_1', 'done with no count'),
  ]);
  const r = buildReceipt(transcript);
  assert.equal(r.subagentTokens, 'unknown');
  assert.equal(typeof r.unknowns.subagentTokens, 'string');
  assert.ok(r.unknowns.subagentTokens.length > 0);
});

test('an empty transcript gives every derived field unknown with a reason and no blanks', () => {
  const r = buildReceipt('');
  for (const field of ['session', 'models', 'tokens', 'apiMessages', 'toolCalls', 'toolErrors', 'subagentDispatches', 'subagentTokens', 'checksRun']) {
    assert.equal(r[field], 'unknown', field);
    assert.equal(r.unknowns[field], 'no transcript available (platform may not expose one)', field);
  }
  assert.equal(r.slice, 'unknown');
  assert.equal(r.branch, 'unknown');
  assert.equal(r.head, 'unknown');
  assertNoBlanks(r);
  assertNoBlanks(buildReceipt(undefined));
});

test('a transcript with no usage records gives tokens unknown with the reason', () => {
  const transcript = jsonl([
    { type: 'user', sessionId: 'sess-2', message: { content: 'hi' } },
    assistant('msg_1', undefined, [{ type: 'text', text: 'no usage here' }]),
  ]);
  const r = buildReceipt(transcript);
  assert.equal(r.tokens, 'unknown');
  assert.equal(r.unknowns.tokens, 'transcript had no usage records');
  assert.equal(r.session, 'sess-2');
  assertNoBlanks(r);
});

test('bad JSON lines are skipped', () => {
  const transcript = `not json\n${JSON.stringify(assistant('msg_1', usage(2, 3)))}\n{broken\n`;
  const r = buildReceipt(transcript);
  assert.equal(r.apiMessages, 1);
  assert.equal(r.tokens.output, 3);
});

test('a receipt block round-trips through extractReceipt', () => {
  const r = buildReceipt(jsonl([assistant('msg_1', usage(1, 2), [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'node --test' } }])]), {
    slice: '19.3', branch: 'claude/x', head: 'deadbeef', now: '2026-11-17T00:00:00Z',
  });
  const body = `Closes #176\n\n${receiptBlock(r)}\n`;
  assert.deepEqual(extractReceipt(body), r);
  assert.ok(receiptBlock(r).startsWith('<!-- harness-receipt:v1 {'));
});

test('extractReceipt returns null when there is no block or the body is not text', () => {
  assert.equal(extractReceipt('Closes #1, no receipt here'), null);
  assert.equal(extractReceipt(undefined), null);
  assert.equal(extractReceipt('<!-- harness-receipt:v1 {not json} -->'), null);
});

test('telemetryRecord keeps the receipt when the PR body has one', () => {
  const receipt = buildReceipt('');
  const rec = telemetryRecord({
    receipt,
    repo: 'cchonguyen/claude-harness-hub',
    now: '2026-11-17T01:00:00Z',
    pr: {
      number: 176,
      title: 'Slice 19.3',
      merged_at: '2026-11-17T00:59:00Z',
      labels: [{ name: 'slice' }, 'harness:bypass'],
      head_sha: 'abc123',
      user: { login: 'someone' },
    },
  });
  assert.equal(rec.v, 1);
  assert.equal(rec.recordedAt, '2026-11-17T01:00:00.000Z');
  assert.equal(rec.repo, 'cchonguyen/claude-harness-hub');
  assert.deepEqual(rec.pr, {
    number: 176,
    title: 'Slice 19.3',
    mergedAt: '2026-11-17T00:59:00Z',
    labels: ['slice', 'harness:bypass'],
    headSha: 'abc123',
    author: 'someone',
  });
  assert.deepEqual(rec.receipt, receipt);
});

test('telemetryRecord without a receipt says so and fills missing PR fields with unknown', () => {
  const rec = telemetryRecord({ receipt: extractReceipt('no block'), pr: {}, repo: '' });
  assert.deepEqual(rec.receipt, { receipt: 'unknown', reason: 'PR body had no harness receipt' });
  assert.equal(rec.repo, 'unknown');
  assert.equal(rec.pr.number, 'unknown');
  assert.equal(rec.pr.title, 'unknown');
  assert.equal(rec.pr.mergedAt, 'unknown');
  assert.equal(rec.pr.headSha, 'unknown');
  assert.equal(rec.pr.author, 'unknown');
  assert.deepEqual(rec.pr.labels, 'unknown');
  assertNoBlanks(rec);
});

test('summarize counts PRs, receipts, labels and known output tokens per repo', () => {
  const withReceipt = (output, labels = []) => telemetryRecord({
    receipt: buildReceipt(jsonl([assistant('m', usage(1, output))])),
    repo: 'o/a',
    pr: { number: 1, labels },
  });
  const records = [
    withReceipt(10, ['harness:bypass']),
    withReceipt(5, ['migration', 'harness:bypass']),
    telemetryRecord({ receipt: null, repo: 'o/a', pr: { number: 2, labels: [] } }),
    telemetryRecord({ receipt: buildReceipt(''), repo: 'o/b', pr: { number: 3, labels: [] } }),
  ];
  const s = summarize(records);
  assert.deepEqual(s['o/a'], {
    prs: 3, withReceipt: 2, withoutReceipt: 1, bypass: 2, migration: 1, outputTokens: 15, outputTokensUnknown: 0,
  });
  assert.deepEqual(s['o/b'], {
    prs: 1, withReceipt: 1, withoutReceipt: 0, bypass: 0, migration: 0, outputTokens: 0, outputTokensUnknown: 1,
  });
});
