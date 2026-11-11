import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendEvent } from './lib/event-log.mjs';
import { summarise, collect, isFailureKind, renderText } from './triage-events.mjs';

function makeRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-events-test-'));
  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  return dir;
}

test('isFailureKind keeps *_warn and the named failure kinds only', () => {
  for (const k of ['hook_warn', 'slice_warn', 'hook_error', 'plugin_version_mismatch', 'hard_block']) {
    assert.equal(isFailureKind(k), true, k);
  }
  for (const k of ['heartbeat', 'tool_use', 'warning', undefined]) {
    assert.equal(isFailureKind(k), false, String(k));
  }
});

test('summarise groups failures by kind with count, first/last ts and sample', () => {
  const events = [
    { kind: 'heartbeat', ts: '2026-11-06T01:00:00.000Z', detail: {} },
    { kind: 'hook_warn', ts: '2026-11-06T02:00:00.000Z', detail: { msg: 'first' } },
    { kind: 'hook_warn', ts: '2026-11-06T04:00:00.000Z', detail: { msg: 'last' } },
    { kind: 'hard_block', ts: '2026-11-06T03:00:00.000Z', detail: { reason: 'budget' } },
    { kind: 'tool_use', ts: '2026-11-06T05:00:00.000Z', detail: {} },
  ];
  const s = summarise('abc', events);
  assert.equal(s.silent, false);
  assert.equal(s.total, 5);
  assert.deepEqual(
    s.failures.map((f) => [f.kind, f.count]),
    [['hook_warn', 2], ['hard_block', 1]],
  );
  const warn = s.failures[0];
  assert.equal(warn.first, '2026-11-06T02:00:00.000Z');
  assert.equal(warn.last, '2026-11-06T04:00:00.000Z');
  assert.equal(warn.sample, '{"msg":"first"}');
});

test('summarise marks a session without heartbeat as silent', () => {
  const s = summarise('quiet', [{ kind: 'hook_error', ts: '2026-11-06T00:00:00.000Z', detail: {} }]);
  assert.equal(s.silent, true);
  assert.equal(s.failures.length, 1);
});

test('sample is clipped to 200 characters', () => {
  const s = summarise('big', [{ kind: 'hook_error', ts: 'x', detail: { text: 'a'.repeat(500) } }]);
  assert.equal(s.failures[0].sample.length, 200);
});

test('collect reads every session file and filters by --session', () => {
  const root = makeRoot();
  appendEvent(root, { session: 's-one', kind: 'heartbeat', source: 't' });
  appendEvent(root, { session: 's-one', kind: 'hook_error', source: 't', detail: { e: 1 } });
  appendEvent(root, { session: 's-two', kind: 'plugin_version_mismatch', source: 't' });

  const all = collect(root, null);
  assert.deepEqual(all.map((s) => s.session), ['s-one', 's-two']);
  assert.equal(all[0].silent, false);
  assert.equal(all[1].silent, true);

  const one = collect(root, 's-two');
  assert.equal(one.length, 1);
  assert.equal(one[0].failures[0].kind, 'plugin_version_mismatch');
});

test('collect returns [] when there is no events directory', () => {
  assert.deepEqual(collect(makeRoot(), null), []);
});

test('renderText reports silent sessions and an empty state', () => {
  assert.match(renderText([]), /No event files/);
  const text = renderText([summarise('q', [])]);
  assert.match(text, /silent: no heartbeat/);
  assert.match(text, /no failure events/);
});
