import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkedIssues, statusFor, planForEvent, applyEvent } from './issue-status.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(HERE, '..', 'config', 'labels.json'), 'utf8'));
const REPO = 'o/claude-harness-hub';
const pr = (o = {}) => ({ body: 'Closes #5', draft: false, merged: false, state: 'open', labels: [], ...o });
const pe = (action, p, extra = {}) => ({ action, pull_request: p, repository: { full_name: REPO }, ...extra });

test('linkedIssues: keywords, case, dedupe, other repos', () => {
  assert.deepEqual(linkedIssues('closes #1, Fixes #2 and RESOLVED #3. fix #1', REPO), [1, 2, 3]);
  assert.deepEqual(linkedIssues(`Closes ${REPO}#7 Fixes other/repo#8 Resolves #9`, REPO), [7, 9]);
  assert.deepEqual(linkedIssues('see #4, no keyword', REPO), []);
  assert.deepEqual(linkedIssues(null, REPO), []);
});
for (const action of ['opened', 'reopened', 'ready_for_review', 'converted_to_draft']) {
  test(`statusFor: ${action} -> in-progress`, () => {
    const r = statusFor({ action, pr: pr({ draft: action === 'converted_to_draft' }), issueLabels: ['status:backlog'] });
    assert.deepEqual(r, { add: 'status:in-progress', remove: ['status:backlog'] });
  });
}
test('statusFor: non-draft gate-change -> blocked-on-operator', () => {
  const r = statusFor({ action: 'opened', pr: pr({ labels: [{ name: 'gate-change' }] }), issueLabels: [] });
  assert.equal(r.add, 'status:blocked-on-operator');
});
test('statusFor: draft gate-change -> in-progress', () => {
  const r = statusFor({ action: 'opened', pr: pr({ draft: true, labels: [{ name: 'gate-change' }] }), issueLabels: [] });
  assert.equal(r.add, 'status:in-progress');
});
test('statusFor: closed unmerged -> backlog', () => {
  const r = statusFor({ action: 'closed', pr: pr(), issueLabels: ['status:in-progress'] });
  assert.deepEqual(r, { add: 'status:backlog', remove: ['status:in-progress'] });
});
test('statusFor: merged removes all status labels', () => {
  const r = statusFor({ action: 'closed', pr: pr({ merged: true }), issueLabels: ['status:in-progress', 'status:blocked', 'bug'] });
  assert.deepEqual(r, { add: null, remove: ['status:in-progress', 'status:blocked'] });
});
test('statusFor: exactly one status invariant', () => {
  const r = statusFor({ action: 'opened', pr: pr(), issueLabels: ['status:in-progress', 'status:ready', 'status:blocked', 'x'] });
  assert.equal(r.add, 'status:in-progress');
  assert.deepEqual(r.remove, ['status:ready', 'status:blocked']);
});
test('statusFor: unknown action is a no-op', () => {
  assert.deepEqual(statusFor({ action: 'edited', pr: pr(), issueLabels: ['status:ready'] }), { add: null, remove: [] });
});

test('plan: labeled gate-change recomputes to blocked', () => {
  const p = pr({ labels: [{ name: 'gate-change' }] });
  const ops = planForEvent('pull_request', pe('labeled', p, { label: { name: 'gate-change' } }), config, { 5: ['status:in-progress'] });
  assert.deepEqual(ops, [{ issue: 5, add: ['status:blocked-on-operator'], remove: ['status:in-progress'] }]);
});
test('plan: unlabeled gate-change returns to in-progress', () => {
  const ops = planForEvent('pull_request', pe('unlabeled', pr(), { label: { name: 'gate-change' } }), config, { 5: ['status:blocked-on-operator'] });
  assert.deepEqual(ops, [{ issue: 5, add: ['status:in-progress'], remove: ['status:blocked-on-operator'] }]);
});
test('plan: labeled with another label is ignored', () => {
  assert.deepEqual(planForEvent('pull_request', pe('labeled', pr(), { label: { name: 'idea' } }), config, { 5: [] }), []);
});
test('plan: other PR action ignored', () => {
  assert.deepEqual(planForEvent('pull_request', pe('edited', pr()), config, { 5: [] }), []);
});
test('plan: already correct issue yields no op', () => {
  assert.deepEqual(planForEvent('pull_request', pe('opened', pr()), config, { 5: ['status:in-progress'] }), []);
});
test('plan: merged removes status labels', () => {
  const ops = planForEvent('pull_request', pe('closed', pr({ merged: true })), config, { 5: ['status:in-progress'] });
  assert.deepEqual(ops, [{ issue: 5, add: [], remove: ['status:in-progress'] }]);
});
test('plan: issue opened with slice gets backlog and project label', () => {
  const payload = { action: 'opened', issue: { number: 9, labels: [{ name: 'slice' }] }, repository: { full_name: REPO } };
  assert.deepEqual(planForEvent('issues', payload, config), [{ issue: 9, add: ['status:backlog', 'project:hub'], remove: [] }]);
});
test('plan: issue labeled slice works; project label already present is skipped', () => {
  const payload = { action: 'labeled', label: { name: 'slice' }, issue: { number: 9, labels: [{ name: 'slice' }, { name: 'project:hub' }] }, repository: { full_name: REPO } };
  assert.deepEqual(planForEvent('issues', payload, config), [{ issue: 9, add: ['status:backlog'], remove: [] }]);
});
test('plan: issue with status already is untouched; no slice label is untouched', () => {
  const a = { action: 'opened', issue: { number: 9, labels: [{ name: 'slice' }, { name: 'status:ready' }] }, repository: { full_name: REPO } };
  const b = { action: 'opened', issue: { number: 9, labels: [{ name: 'idea' }] }, repository: { full_name: REPO } };
  assert.deepEqual(planForEvent('issues', a, config), []);
  assert.deepEqual(planForEvent('issues', b, config), []);
});
test('plan: workflow_dispatch is a no-op', () => {
  assert.deepEqual(planForEvent('workflow_dispatch', {}, config), []);
});

test('apply: GET, POST, DELETE calls; PR number and 404 skipped', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(`${opts.method} ${url.replace('https://api.github.com', '')}${opts.body ? ' ' + opts.body : ''}`);
    const ok = (data) => ({ status: 200, json: async () => data, text: async () => '' });
    if (opts.method === 'GET' && url.endsWith('/issues/5')) return ok({ labels: [{ name: 'status:backlog' }, { name: 'status:blocked' }, { name: 'bug' }] });
    if (opts.method === 'GET' && url.endsWith('/issues/6')) return ok({ pull_request: {}, labels: [] });
    if (opts.method === 'GET') return { status: 404, text: async () => 'nf' };
    if (opts.method === 'DELETE' && url.endsWith('status%3Ablocked')) return { status: 404, text: async () => 'nf' };
    return { status: 200, json: async () => ({}), text: async () => '' };
  };
  const payload = pe('opened', pr({ body: 'Closes #5, fixes #6, resolves #7' }));
  const ops = await applyEvent({ eventName: 'pull_request', payload, repo: REPO, token: 't', config, fetchImpl });
  assert.equal(ops.length, 1);
  assert.deepEqual(calls, [
    `GET /repos/${REPO}/issues/5`,
    `GET /repos/${REPO}/issues/6`,
    `GET /repos/${REPO}/issues/7`,
    `POST /repos/${REPO}/issues/5/labels {"labels":["status:in-progress"]}`,
    `DELETE /repos/${REPO}/issues/5/labels/status%3Abacklog`,
    `DELETE /repos/${REPO}/issues/5/labels/status%3Ablocked`,
  ]);
});
test('apply: non-404 error throws', async () => {
  const fetchImpl = async () => ({ status: 500, text: async () => 'boom', json: async () => ({}) });
  await assert.rejects(applyEvent({ eventName: 'pull_request', payload: pe('opened', pr()), repo: REPO, token: 't', config, fetchImpl }), /500/);
});
