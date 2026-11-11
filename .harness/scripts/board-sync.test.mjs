import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desiredStatus, itemStatusName, planBoard, runBoard } from './board-sync.mjs';

const options = {
  'status:backlog': 'Backlog',
  'status:ready': 'Ready',
  'status:in-progress': 'In progress',
  'status:blocked-on-operator': 'Needs you',
  'status:blocked': 'Blocked',
  done: 'Done',
  wontdo: "Won't do",
};
const ids = { Backlog: 'o1', Ready: 'o2', 'In progress': 'o3', 'Needs you': 'o4', Blocked: 'o5', Done: 'o6', "Won't do": 'o7' };
const cfg = { owner: 'me', projectNumber: 3, apiVersion: 'v', statusField: 'Status', repos: ['me/r'], statusOptions: options, closedWindowDays: 14 };

test('desiredStatus cases', () => {
  assert.equal(desiredStatus({ state: 'closed', state_reason: 'not_planned', labels: [] }, options), "Won't do");
  assert.equal(desiredStatus({ state: 'closed', state_reason: 'completed', labels: [] }, options), 'Done');
  assert.equal(desiredStatus({ state: 'open', labels: [{ name: 'slice' }, { name: 'status:ready' }] }, options), 'Ready');
  assert.equal(desiredStatus({ state: 'open', labels: ['slice'] }, options), 'Backlog');
});

test('itemStatusName shapes', () => {
  const names = { o2: 'Ready' };
  const mk = (value, extra = {}) => ({ fields: [{ id: 9, name: 'Status', value, ...extra }] });
  assert.equal(itemStatusName(mk('o2'), 9, names), 'Ready');
  assert.equal(itemStatusName(mk('Blocked'), 9, names), 'Blocked');
  assert.equal(itemStatusName(mk({ id: 'o2' }), 9, names), 'Ready');
  assert.equal(itemStatusName(mk({ name: 'Done' }), 9, names), 'Done');
  assert.equal(itemStatusName(mk({ name: { raw: 'Ready' } }), 9, names), 'Ready');
  assert.equal(itemStatusName({ fields: [{ id: 1, name: 'Status', value: 'o2' }] }, 9, names), 'Ready');
  assert.equal(itemStatusName({ fields: [] }, 9, names), null);
  assert.equal(itemStatusName(mk(null), 9, names), null);
});

const issue = (o = {}) => ({ repo: 'me/r', number: 1, state: 'open', labels: ['slice', 'status:ready'], updated_at: '2026-01-01T00:00:00Z', ...o });
const item = (o = {}) => ({ id: 100, content_type: 'Issue', content: { number: 1, repository_url: 'https://api.github.com/repos/me/r' }, updated_at: '2026-01-02T00:00:00Z', status: 'Ready', ...o });

test('planBoard: add, set, ignore', () => {
  assert.equal(planBoard({ issues: [issue()], items: [], options, optionIdsByName: ids }).add.length, 1);
  const p = planBoard({ issues: [issue()], items: [item({ status: 'Backlog', updated_at: '2025-01-01T00:00:00Z' })], options, optionIdsByName: ids });
  assert.deepEqual(p.set, [{ itemId: 100, optionId: 'o2', name: 'Ready' }]);
  const q = planBoard({ issues: [issue()], items: [item({ content_type: 'PullRequest', status: 'x' })], options, optionIdsByName: ids });
  assert.equal(q.add.length, 1);
  assert.equal(planBoard({ issues: [issue()], items: [item({ status: null, updated_at: '2026-02-01T00:00:00Z' })], options, optionIdsByName: ids }).set.length, 1);
});

test('planBoard: write-back rules', () => {
  const p = planBoard({ issues: [issue({ labels: ['slice', 'status:ready'] })], items: [item({ status: 'In progress' })], options, optionIdsByName: ids });
  assert.deepEqual(p.writeBack, [{ repo: 'me/r', number: 1, addLabel: 'status:in-progress', removeLabels: ['status:ready'], close: null }]);
  const w = planBoard({ issues: [issue()], items: [item({ status: "Won't do" })], options, optionIdsByName: ids });
  assert.equal(w.writeBack[0].close, 'not_planned');
  assert.deepEqual(w.writeBack[0].removeLabels, ['status:ready']);
  const d = planBoard({ issues: [issue()], items: [item({ status: 'Done' })], options, optionIdsByName: ids });
  assert.equal(d.writeBack.length, 0);
  assert.equal(d.set.length, 1);
  const c = planBoard({ issues: [issue({ state: 'closed', state_reason: 'completed' })], items: [item({ status: 'Ready' })], options, optionIdsByName: ids });
  assert.equal(c.writeBack.length, 0);
  assert.equal(c.set[0].name, 'Done');
});

function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined });
    for (const [m, re, resp] of routes) {
      if (m === method && re.test(url)) {
        const r = typeof resp === 'function' ? resp(url) : resp;
        return { ok: r.status ? r.status < 400 : true, status: r.status ?? 200, headers: new Map(Object.entries(r.headers ?? {})), json: async () => r.json };
      }
    }
    return { ok: false, status: 404, headers: new Map(), json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}
const fieldsResp = [{ id: 9, name: 'Status', data_type: 'single_select', options: Object.entries(ids).map(([n, id]) => ({ id, name: { raw: n } })) }];
const base = /\/users\/me\/projectsV2\/3/;
const quiet = () => {
  const lines = [];
  const log = (s) => lines.push(s);
  log.lines = lines;
  return log;
};

test('run: missing token and missing project make no calls', async () => {
  const f = mockFetch([]);
  assert.equal(await runBoard({ env: {}, fetchImpl: f, config: cfg, log: quiet() }), 0);
  assert.equal(await runBoard({ env: { PROJECT_BOARD_TOKEN: 't' }, fetchImpl: f, config: { ...cfg, projectNumber: null }, log: quiet() }), 0);
  assert.equal(f.calls.length, 0);
});

test('run: add then set', async () => {
  const f = mockFetch([
    ['GET', /projectsV2\/3\/fields/, { json: fieldsResp }],
    ['GET', /projectsV2\/3\/items/, { json: [] }],
    ['GET', /state=open/, { json: [{ number: 1, state: 'open', labels: [{ name: 'status:ready' }], updated_at: '2026-01-01T00:00:00Z' }, { number: 2, pull_request: {} }] }],
    ['GET', /state=closed/, { json: [] }],
    ['POST', /projectsV2\/3\/items/, { status: 201, json: { id: 55 } }],
    ['PATCH', /items\/55/, { json: {} }],
  ]);
  const log = quiet();
  assert.equal(await runBoard({ env: { PROJECT_BOARD_TOKEN: 't' }, fetchImpl: f, config: cfg, log }), 0);
  const post = f.calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body, { type: 'Issue', owner: 'me', repo: 'r', number: 1 });
  const patch = f.calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(patch.body, { fields: [{ id: 9, value: 'o2' }] });
});

test('run: set path and Link pagination', async () => {
  const f = mockFetch([
    ['GET', /projectsV2\/3\/fields/, { json: fieldsResp }],
    ['GET', /projectsV2\/3\/items\?per_page/, { json: [], headers: { link: '<https://api.github.com/page2>; rel="next"' } }],
    ['GET', /page2/, { json: [{ id: 7, content_type: 'Issue', content: { number: 1, repository: { full_name: 'me/r' } }, updated_at: '2025-01-01T00:00:00Z', fields: [{ id: 9, value: 'o1' }] }] }],
    ['GET', /state=open/, { json: [{ number: 1, state: 'open', labels: ['status:ready'], updated_at: '2026-01-01T00:00:00Z' }] }],
    ['GET', /state=closed/, { json: [] }],
    ['PATCH', /items\/7/, { json: {} }],
  ]);
  assert.equal(await runBoard({ env: { PROJECT_BOARD_TOKEN: 't' }, fetchImpl: f, config: cfg, log: quiet() }), 0);
  assert.ok(f.calls.some((c) => /page2/.test(c.url)));
  assert.deepEqual(f.calls.find((c) => c.method === 'PATCH').body, { fields: [{ id: 9, value: 'o2' }] });
});

function writeBackRun(status) {
  return mockFetch([
    ['GET', /projectsV2\/3\/fields/, { json: fieldsResp }],
    ['GET', /projectsV2\/3\/items/, { json: [{ id: 7, content_type: 'Issue', content: { number: 1, repository_url: 'https://api.github.com/repos/me/r' }, updated_at: '2026-02-01T00:00:00Z', fields: [{ id: 9, value: status }] }] }],
    ['GET', /state=open/, { json: [{ number: 1, state: 'open', labels: ['status:ready'], updated_at: '2026-01-01T00:00:00Z' }] }],
    ['GET', /state=closed/, { json: [] }],
    ['POST', /labels/, { json: [] }],
    ['DELETE', /labels/, { json: [] }],
    ['PATCH', /issues\/1$/, { json: {} }],
    ['PATCH', /items\/7/, { json: {} }],
  ]);
}

test('run: write-back label', async () => {
  const f = writeBackRun('o3');
  assert.equal(await runBoard({ env: { PROJECT_BOARD_TOKEN: 't' }, fetchImpl: f, config: cfg, log: quiet() }), 0);
  assert.deepEqual(f.calls.find((c) => c.method === 'POST').body, { labels: ['status:in-progress'] });
  assert.ok(f.calls.some((c) => c.method === 'DELETE' && /status%3Aready/.test(c.url)));
});

test("run: Won't do closes as not planned", async () => {
  const f = writeBackRun('o7');
  assert.equal(await runBoard({ env: { PROJECT_BOARD_TOKEN: 't' }, fetchImpl: f, config: cfg, log: quiet() }), 0);
  assert.deepEqual(f.calls.find((c) => c.method === 'PATCH').body, { state: 'closed', state_reason: 'not_planned' });
});

test('run: Done is never written back', async () => {
  const f = writeBackRun('o6');
  assert.equal(await runBoard({ env: { PROJECT_BOARD_TOKEN: 't' }, fetchImpl: f, config: cfg, log: quiet() }), 0);
  assert.ok(!f.calls.some((c) => c.method === 'POST' || c.method === 'DELETE' || /issues\/1$/.test(c.url)));
  assert.deepEqual(f.calls.find((c) => c.method === 'PATCH').body, { fields: [{ id: 9, value: 'o2' }] });
});

test('run: repo 404 warns and continues; API error exits 1', async () => {
  const f = mockFetch([
    ['GET', /projectsV2\/3\/fields/, { json: fieldsResp }],
    ['GET', /projectsV2\/3\/items/, { json: [] }],
  ]);
  const log = quiet();
  assert.equal(await runBoard({ env: { PROJECT_BOARD_TOKEN: 't' }, fetchImpl: f, config: cfg, log }), 0);
  assert.ok(log.lines.some((l) => l.startsWith('::warning::')));
  const bad = mockFetch([]);
  assert.equal(await runBoard({ env: { PROJECT_BOARD_TOKEN: 't' }, fetchImpl: bad, config: cfg, log: quiet() }), 1);
});
