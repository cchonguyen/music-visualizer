import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planLabelSync, syncLabels } from './sync-labels.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(HERE, '..', 'config', 'labels.json'), 'utf8'));

const L = (name, color = 'aaaaaa', description = 'd') => ({ name, color, description });

test('plan: new label is created', () => {
  const p = planLabelSync([], [L('a')]);
  assert.equal(p.create.length, 1);
});
test('plan: changed colour updates', () => {
  const p = planLabelSync([L('a', 'bbbbbb')], [L('a')]);
  assert.equal(p.update.length, 1);
});
test('plan: changed description updates', () => {
  const p = planLabelSync([L('a', 'aaaaaa', 'x')], [L('a')]);
  assert.equal(p.update.length, 1);
});
test('plan: identical is unchanged', () => {
  const p = planLabelSync([L('a')], [L('a')]);
  assert.equal(p.unchanged.length, 1);
  assert.equal(p.create.length + p.update.length, 0);
});
test('plan: name match is case-insensitive', () => {
  const p = planLabelSync([L('Slice')], [L('slice')]);
  assert.equal(p.create.length, 0);
  assert.equal(p.unchanged.length, 1);
});

function mockFetch(pages, { failOn } = {}) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body });
    if (failOn && opts.method === failOn) {
      return { status: 422, text: async () => 'bad things', headers: new Headers() };
    }
    if (opts.method === 'GET') {
      const page = url.includes('page=2') ? 1 : 0;
      const headers = new Headers();
      if (page === 0 && pages.length > 1) {
        headers.set('link', '<https://api.github.com/repos/o/claude-harness-hub/labels?per_page=100&page=2>; rel="next"');
      }
      return { status: 200, headers, json: async () => pages[page] };
    }
    return { status: 201, headers: new Headers(), text: async () => '', json: async () => ({}) };
  };
  return { impl, calls };
}

test('sync: never deletes, follows pagination, includes project label', async () => {
  const stale = { name: 'slice', color: '000000', description: 'old' };
  const { impl, calls } = mockFetch([[stale], [{ name: 'idea', color: '1d76db', description: 'A suggestion that is not yet a plan' }]]);
  const plan = await syncLabels({ repo: 'o/claude-harness-hub', token: 't', config, fetchImpl: impl });
  assert.ok(calls.every((c) => c.method !== 'DELETE'));
  assert.equal(calls.filter((c) => c.method === 'GET').length, 2);
  const created = calls.filter((c) => c.method === 'POST').map((c) => JSON.parse(c.body).name);
  assert.ok(created.includes('project:hub'));
  assert.ok(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/labels/slice')));
  assert.equal(plan.unchanged.length, 1);
});

test('sync: unknown repo gets lowercased project label', async () => {
  const { impl, calls } = mockFetch([[]]);
  await syncLabels({ repo: 'o/Some-Repo', token: 't', config, fetchImpl: impl });
  const created = calls.filter((c) => c.method === 'POST').map((c) => JSON.parse(c.body).name);
  assert.ok(created.includes('project:some-repo'));
});

test('sync: error status throws with status and body', async () => {
  const { impl } = mockFetch([[]], { failOn: 'POST' });
  await assert.rejects(
    syncLabels({ repo: 'o/claude-harness-hub', token: 't', config, fetchImpl: impl }),
    /422.*bad things/s,
  );
});

test('labels.json has 11 labels and 3 project mappings', () => {
  assert.equal(config.labels.length, 11);
  for (const l of config.labels) {
    assert.match(l.color, /^[0-9a-f]{6}$/);
    assert.ok(l.description.length > 0 && l.description.length <= 100);
  }
  assert.deepEqual(Object.keys(config.projects).sort(), ['Concert-Tracker', 'claude-harness-hub', 'music-visualizer']);
});
