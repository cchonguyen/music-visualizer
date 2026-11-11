#!/usr/bin/env node
// Keep the status:* label of issues in step with the pull requests that close them.
// Pure rules (statusFor, planForEvent) plus a CLI for GitHub Actions. Zero dependencies.
// Needs GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REPOSITORY and GITHUB_TOKEN.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { projectLabelFor } from './sync-labels.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://api.github.com';
const PR_ACTIONS = new Set([
  'opened',
  'reopened',
  'ready_for_review',
  'converted_to_draft',
  'closed',
  'labeled',
  'unlabeled',
]);

const norm = (s) => String(s ?? '').toLowerCase();
const labelNames = (labels) =>
  (labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
const isStatus = (n) => norm(n).startsWith('status:');

export function linkedIssues(body, repo) {
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+((?:[\w.-]+\/[\w.-]+)?)#(\d+)/gi;
  const seen = new Set();
  const out = [];
  for (const m of String(body ?? '').matchAll(re)) {
    if (m[1] && norm(m[1]) !== norm(repo)) continue;
    const n = Number(m[2]);
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

export function statusFor({ action, pr, issueLabels = [] }) {
  const current = labelNames(issueLabels).filter(isStatus);
  let add = null;
  if (action === 'closed') {
    add = pr?.merged ? null : 'status:backlog';
  } else if (PR_ACTIONS.has(action)) {
    const gate = labelNames(pr?.labels).some((n) => norm(n) === 'gate-change');
    add = !pr?.draft && gate ? 'status:blocked-on-operator' : 'status:in-progress';
  } else {
    return { add: null, remove: [] };
  }
  return { add, remove: current.filter((n) => norm(n) !== norm(add)) };
}

// issueLabelsByNumber: { [n]: labels[] } for linked issues that exist and are not PRs.
export function planForEvent(eventName, payload, config = {}, issueLabelsByNumber = {}) {
  const repo = payload?.repository?.full_name ?? '';
  const action = payload?.action;
  if (eventName === 'pull_request') {
    const pr = payload.pull_request;
    if (!pr || !PR_ACTIONS.has(action)) return [];
    if (
      (action === 'labeled' || action === 'unlabeled') &&
      norm(payload.label?.name) !== 'gate-change'
    ) {
      return [];
    }
    if ((action === 'labeled' || action === 'unlabeled') && pr.state === 'closed') return [];
    const ops = [];
    for (const issue of linkedIssues(pr.body, repo)) {
      if (!(issue in issueLabelsByNumber)) continue;
      const labels = labelNames(issueLabelsByNumber[issue]);
      const { add, remove } = statusFor({ action, pr, issueLabels: labels });
      const hasAdd = add && labels.some((n) => norm(n) === norm(add));
      const addList = add && !hasAdd ? [add] : [];
      if (addList.length || remove.length) ops.push({ issue, add: addList, remove });
    }
    return ops;
  }
  if (eventName === 'issues') {
    const issue = payload.issue;
    if (!issue || (action !== 'opened' && action !== 'labeled')) return [];
    if (action === 'labeled' && norm(payload.label?.name) !== 'slice') return [];
    const labels = labelNames(issue.labels);
    if (!labels.some((n) => norm(n) === 'slice') || labels.some(isStatus)) return [];
    const want = ['status:backlog', projectLabelFor(repo, config)];
    const add = want.filter((w) => !labels.some((n) => norm(n) === norm(w)));
    return add.length ? [{ issue: issue.number, add, remove: [] }] : [];
  }
  return [];
}

async function call(fetchImpl, token, method, url, body, okStatuses = []) {
  const res = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'harness-issue-status',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!(res.status >= 200 && res.status < 300) && !okStatuses.includes(res.status)) {
    const text = await res.text();
    throw new Error(`${method} ${url} failed: ${res.status} ${text}`);
  }
  return res;
}

export async function applyEvent({ eventName, payload, repo, token, config, fetchImpl = fetch }) {
  const pl = { ...payload, repository: { ...payload?.repository, full_name: repo } };
  const byNumber = {};
  if (eventName === 'pull_request' && pl.pull_request) {
    for (const n of linkedIssues(pl.pull_request.body, repo)) {
      const res = await call(fetchImpl, token, 'GET', `${API}/repos/${repo}/issues/${n}`, null, [404]);
      if (res.status === 404) continue;
      const data = await res.json();
      if (data.pull_request) continue;
      byNumber[n] = data.labels ?? [];
    }
  }
  const ops = planForEvent(eventName, pl, config, byNumber);
  for (const op of ops) {
    if (op.add.length) {
      await call(fetchImpl, token, 'POST', `${API}/repos/${repo}/issues/${op.issue}/labels`, {
        labels: op.add,
      });
    }
    for (const name of op.remove) {
      await call(
        fetchImpl,
        token,
        'DELETE',
        `${API}/repos/${repo}/issues/${op.issue}/labels/${encodeURIComponent(name)}`,
        null,
        [404],
      );
    }
  }
  return ops;
}

async function main() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const path = process.env.GITHUB_EVENT_PATH;
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!eventName || !path || !repo || !token) {
    console.error(
      'Usage: GITHUB_EVENT_NAME=... GITHUB_EVENT_PATH=... GITHUB_REPOSITORY=owner/name GITHUB_TOKEN=... node .harness/scripts/issue-status.mjs',
    );
    process.exit(2);
  }
  try {
    const payload = JSON.parse(readFileSync(path, 'utf8'));
    const config = JSON.parse(readFileSync(resolve(ROOT, '.harness/config/labels.json'), 'utf8'));
    const ops = await applyEvent({ eventName, payload, repo, token, config });
    for (const op of ops) {
      const parts = [...op.add.map((l) => `+${l}`), ...op.remove.map((l) => `-${l}`)];
      console.log(`#${op.issue}: ${parts.join(' ')}`);
    }
    if (!ops.length) console.log('issue-status: no change');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
