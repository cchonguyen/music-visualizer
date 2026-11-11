import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendEvent, readEvents, eventFile, sessionId, buildLine, MAX_LINE_BYTES } from './event-log.mjs';

function makeRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-log-test-'));
  fs.mkdirSync(path.join(dir, '.spec'), { recursive: true });
  return dir;
}

test('appendEvent writes one JSONL line per call with the contract fields', () => {
  const root = makeRoot();
  assert.equal(appendEvent(root, { session: 'abc-123', kind: 'heartbeat', source: 'session-start', slice: '11.1', detail: { node: 'v22' } }), true);
  appendEvent(root, { session: 'abc-123', kind: 'hook_error', source: 'adapter' });
  const file = eventFile(root, 'abc-123');
  assert.equal(file, path.join(root, '.spec', '.events', 'abc-123.jsonl'));
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.split('\n').filter(Boolean).length, 2);
  const [first, second] = readEvents(file);
  assert.equal(first.v, 1);
  assert.equal(first.session, 'abc-123');
  assert.equal(first.kind, 'heartbeat');
  assert.equal(first.source, 'session-start');
  assert.equal(first.slice, '11.1');
  assert.deepEqual(first.detail, { node: 'v22' });
  assert.ok(!Number.isNaN(Date.parse(first.ts)));
  assert.equal(second.slice, null);
  assert.deepEqual(second.detail, {});
});

test('missing session id falls back to nosession', () => {
  const root = makeRoot();
  assert.equal(sessionId(undefined), 'nosession');
  assert.equal(sessionId('   '), 'nosession');
  appendEvent(root, { kind: 'k', source: 's' });
  assert.ok(fs.existsSync(path.join(root, '.spec', '.events', 'nosession.jsonl')));
});

test('session id is sanitised so it cannot escape the events directory', () => {
  const root = makeRoot();
  assert.equal(sessionId('../../etc/passwd'), '__.._etc_passwd');
  appendEvent(root, { session: '../../x', kind: 'k', source: 's' });
  const names = fs.readdirSync(path.join(root, '.spec', '.events'));
  assert.equal(names.length, 1);
  assert.ok(!names[0].includes('/'));
});

test('lines stay under 4096 bytes and oversized detail is truncated', () => {
  const root = makeRoot();
  const huge = { blob: 'x'.repeat(20000) };
  assert.equal(appendEvent(root, { session: 's1', kind: 'big', source: 'test', detail: huge }), true);
  const raw = fs.readFileSync(eventFile(root, 's1'), 'utf8');
  assert.ok(Buffer.byteLength(raw, 'utf8') <= MAX_LINE_BYTES);
  const [ev] = readEvents(eventFile(root, 's1'));
  assert.equal(ev.kind, 'big');
  assert.equal(ev.detail.truncated, true);
  assert.equal(typeof ev.detail.preview, 'string');
});

test('buildLine keeps every line within the byte limit even with huge fields', () => {
  const line = buildLine({ session: 's', kind: 'k'.repeat(5000), source: 'x', detail: { a: 'y'.repeat(9000) } });
  assert.ok(Buffer.byteLength(line, 'utf8') <= MAX_LINE_BYTES);
  assert.ok(JSON.parse(line).kind.length <= 200);
});

test('appendEvent never throws on unserialisable detail', () => {
  const root = makeRoot();
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => appendEvent(root, { session: 'c', kind: 'k', source: 's', detail: circular }));
  const [ev] = readEvents(eventFile(root, 'c'));
  assert.deepEqual(ev.detail, { unserializable: true });
});

test('appendEvent returns false instead of throwing when the path is unwritable', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, '.spec', '.events'), 'not a directory');
  assert.equal(appendEvent(root, { session: 'x', kind: 'k', source: 's' }), false);
});

test('readEvents skips malformed lines and returns [] for a missing file', () => {
  const root = makeRoot();
  const file = eventFile(root, 'mixed');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    '{"v":1,"kind":"ok"}',
    '{"v":1,"kind":',
    'not json at all',
    '',
    '[1,2,3]',
    '"just a string"',
    '{"v":1,"kind":"also-ok"}',
    '',
  ].join('\n'));
  const events = readEvents(file);
  assert.deepEqual(events.map((e) => e.kind), ['ok', 'also-ok']);
  assert.deepEqual(readEvents(path.join(root, '.spec', '.events', 'nope.jsonl')), []);
});

test('concurrent-style appends from separate processes all land as whole lines', async () => {
  const root = makeRoot();
  const { spawnSync } = await import('node:child_process');
  const modUrl = new URL('./event-log.mjs', import.meta.url).href;
  const script = `import(${JSON.stringify(modUrl)}).then((m) => { for (let i = 0; i < 25; i++) m.appendEvent(${JSON.stringify(root)}, { session: 'par', kind: 'tick', source: 'proc', detail: { i } }); });`;
  const procs = [0, 1, 2, 3].map(() => spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' }));
  for (const p of procs) assert.equal(p.status, 0, p.stderr);
  const events = readEvents(eventFile(root, 'par'));
  assert.equal(events.length, 100);
  assert.ok(events.every((e) => e.kind === 'tick'));
});
