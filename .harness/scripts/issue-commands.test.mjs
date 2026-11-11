import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, planCommand, applyCommand } from './issue-commands.mjs';

const REPO = 'o/r';
test('parseCommand: each command, alias, case, blanks, arg', () => {
  for (const n of ['ready', 'backlog', 'block', 'unblock', 'needs-me', 'wontdo']) {
    assert.deepEqual(parseCommand(`/${n}`), { name: n, arg: '' });
  }
  assert.deepEqual(parseCommand('/start'), { name: 'ready', arg: '' });
  assert.deepEqual(parseCommand('/READY'), { name: 'ready', arg: '' });
  assert.deepEqual(parseCommand('\n\n  /Block  waiting on API \nsecond line'), {
    name: 'block',
    arg: 'waiting on API',
  });
  assert.deepEqual(parseCommand('/needs-me which db?'), { name: 'needs-me', arg: 'which db?' });
});
test('parseCommand: unknown, no slash, empty', () => {
  assert.equal(parseCommand('/nope'), null);
  assert.equal(parseCommand('ready'), null);
  assert.equal(parseCommand('hello\n/ready'), null);
  assert.equal(parseCommand(''), null);
  assert.equal(parseCommand(null), null);
});

const labels = ['slice', 'status:backlog', 'status:blocked'];
const plan = (name, arg = '', issueLabels = labels, issueState = 'open') =>
  planCommand({ command: { name, arg }, issueLabels, issueState });

test('planCommand: status commands keep exactly one status', () => {
  const cases = [
    ['ready', 'status:ready', 'Status: ready.'],
    ['backlog', 'status:backlog', 'Status: backlog.'],
    ['unblock', 'status:ready', 'Status: ready.'],
    ['block', 'status:blocked', 'Status: blocked. Reason: why.'],
    ['needs-me', 'status:blocked-on-operator', 'Status: needs you. Question: why.'],
  ];
  for (const [name, add, reply] of cases) {
    const p = plan(name, 'why');
    assert.equal(p.add, add);
    assert.equal(p.close, null);
    assert.equal(p.reply, reply);
    const final = ['slice', ...labels.filter((l) => l === 'slice' || !p.remove.includes(l)), p.add].filter(
      (l, i, a) => a.indexOf(l) === i,
    );
    assert.equal(final.filter((l) => l.startsWith('status:')).length, 1);
    assert.ok(!p.remove.includes(add));
  }
});
test('planCommand: wontdo removes all status and closes', () => {
  const p = plan('wontdo');
  assert.deepEqual(p, {
    add: null,
    remove: ['status:backlog', 'status:blocked'],
    close: 'not_planned',
    reply: "Closed as won't do.",
  });
});
test('planCommand: closed issue', () => {
  const p = plan('ready', '', labels, 'closed');
  assert.equal(p.add, null);
  assert.deepEqual(p.remove, []);
  assert.equal(p.close, null);
  assert.match(p.reply, /closed/i);
  const w = plan('wontdo', '', labels, 'closed');
  assert.equal(w.close, null);
  assert.deepEqual(w.remove, ['status:backlog', 'status:blocked']);
});

const mkFetch = () => {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ method: opts.method, url, body: opts.body ? JSON.parse(opts.body) : null });
    return { status: 200, text: async () => '', json: async () => ({}) };
  };
  return { calls, fn };
};
const payload = (o = {}) => ({
  comment: { body: '/ready', author_association: 'OWNER', user: { type: 'User' }, ...o.comment },
  issue: { number: 7, state: 'open', labels: [{ name: 'status:backlog' }], ...o.issue },
});

test('guard: non-owner, bot, PR, no command make no calls', async () => {
  const cases = [
    payload({ comment: { author_association: 'MEMBER' } }),
    payload({ comment: { author_association: 'CONTRIBUTOR' } }),
    payload({ comment: { author_association: 'NONE' } }),
    payload({ comment: { user: { type: 'Bot' } } }),
    payload({ issue: { pull_request: {} } }),
    payload({ comment: { body: 'just talking' } }),
  ];
  for (const pl of cases) {
    const f = mkFetch();
    const r = await applyCommand({ payload: pl, repo: REPO, token: 't', fetchImpl: f.fn });
    assert.equal(r.acted, false);
    assert.equal(f.calls.length, 0);
  }
});
test('apply /block: exact calls', async () => {
  const f = mkFetch();
  await applyCommand({
    payload: payload({ comment: { body: '/block need keys' } }),
    repo: REPO,
    token: 't',
    fetchImpl: f.fn,
  });
  const base = 'https://api.github.com/repos/o/r/issues/7';
  assert.deepEqual(f.calls, [
    { method: 'POST', url: `${base}/labels`, body: { labels: ['status:blocked'] } },
    { method: 'DELETE', url: `${base}/labels/status%3Abacklog`, body: null },
    { method: 'POST', url: `${base}/comments`, body: { body: 'Status: blocked. Reason: need keys.' } },
  ]);
});
test('apply /wontdo: exact calls; closed issue skips PATCH', async () => {
  const base = 'https://api.github.com/repos/o/r/issues/7';
  const f = mkFetch();
  await applyCommand({
    payload: payload({ comment: { body: '/wontdo' } }),
    repo: REPO,
    token: 't',
    fetchImpl: f.fn,
  });
  assert.deepEqual(f.calls, [
    { method: 'DELETE', url: `${base}/labels/status%3Abacklog`, body: null },
    { method: 'PATCH', url: base, body: { state: 'closed', state_reason: 'not_planned' } },
    { method: 'POST', url: `${base}/comments`, body: { body: "Closed as won't do." } },
  ]);
  const g = mkFetch();
  await applyCommand({
    payload: payload({ comment: { body: '/wontdo' }, issue: { state: 'closed' } }),
    repo: REPO,
    token: 't',
    fetchImpl: g.fn,
  });
  assert.ok(!g.calls.some((c) => c.method === 'PATCH'));
});
test('apply: other command on closed issue only replies', async () => {
  const f = mkFetch();
  await applyCommand({ payload: payload({ issue: { state: 'closed' } }), repo: REPO, token: 't', fetchImpl: f.fn });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, 'POST');
  assert.match(f.calls[0].body.body, /closed/i);
});
