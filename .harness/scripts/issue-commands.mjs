#!/usr/bin/env node
// Owner slash commands on issue comments set the status:* label. Zero dependencies.
// Needs GITHUB_EVENT_PATH, GITHUB_REPOSITORY and GITHUB_TOKEN.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';
const COMMANDS = new Set(['ready', 'backlog', 'block', 'unblock', 'needs-me', 'wontdo']);

const norm = (s) => String(s ?? '').toLowerCase();
const labelNames = (labels) =>
  (labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
const isStatus = (n) => norm(n).startsWith('status:');

export function parseCommand(body) {
  const line = String(body ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== '');
  if (!line || !line.startsWith('/')) return null;
  const m = line.match(/^\/(\S+)\s*(.*)$/);
  if (!m) return null;
  let name = m[1].toLowerCase();
  if (name === 'start') name = 'ready';
  if (!COMMANDS.has(name)) return null;
  return { name, arg: m[2].trim() };
}

const TARGET = {
  ready: 'status:ready',
  unblock: 'status:ready',
  backlog: 'status:backlog',
  block: 'status:blocked',
  'needs-me': 'status:blocked-on-operator',
};

export function planCommand({ command, issueLabels = [], issueState = 'open' }) {
  const current = labelNames(issueLabels).filter(isStatus);
  if (issueState === 'closed' && command.name !== 'wontdo') {
    return { add: null, remove: [], close: null, reply: 'Issue is closed. No change made.' };
  }
  if (command.name === 'wontdo') {
    return {
      add: null,
      remove: current,
      close: issueState === 'closed' ? null : 'not_planned',
      reply: "Closed as won't do.",
    };
  }
  const add = TARGET[command.name];
  const remove = current.filter((n) => norm(n) !== norm(add));
  const arg = command.arg;
  let reply;
  if (command.name === 'block') reply = arg ? `Status: blocked. Reason: ${arg}.` : 'Status: blocked.';
  else if (command.name === 'needs-me')
    reply = arg ? `Status: needs you. Question: ${arg}.` : 'Status: needs you.';
  else reply = `Status: ${add.slice('status:'.length)}.`;
  return { add, remove, close: null, reply };
}

async function call(fetchImpl, token, method, url, body, okStatuses = []) {
  const res = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'harness-issue-commands',
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

// Returns { acted, reason?, plan? }. Makes no API call unless it acts.
export async function applyCommand({ payload, repo, token, fetchImpl = fetch }) {
  const comment = payload?.comment;
  const issue = payload?.issue;
  if (!comment || !issue) return { acted: false, reason: 'not an issue comment' };
  if (issue.pull_request) return { acted: false, reason: 'pull request comment ignored' };
  if (comment.user?.type === 'Bot') return { acted: false, reason: 'bot comment ignored' };
  if (comment.author_association !== 'OWNER') return { acted: false, reason: 'commenter is not the owner' };
  const command = parseCommand(comment.body);
  if (!command) return { acted: false, reason: 'no command' };

  const plan = planCommand({
    command,
    issueLabels: issue.labels,
    issueState: issue.state === 'closed' ? 'closed' : 'open',
  });
  const base = `${API}/repos/${repo}/issues/${issue.number}`;
  if (plan.add) await call(fetchImpl, token, 'POST', `${base}/labels`, { labels: [plan.add] });
  for (const name of plan.remove) {
    await call(fetchImpl, token, 'DELETE', `${base}/labels/${encodeURIComponent(name)}`, null, [404]);
  }
  if (plan.close) {
    await call(fetchImpl, token, 'PATCH', base, { state: 'closed', state_reason: plan.close });
  }
  await call(fetchImpl, token, 'POST', `${base}/comments`, { body: plan.reply });
  return { acted: true, plan };
}

async function main() {
  const path = process.env.GITHUB_EVENT_PATH;
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!path || !repo || !token) {
    console.error(
      'Usage: GITHUB_EVENT_PATH=... GITHUB_REPOSITORY=owner/name GITHUB_TOKEN=... node .harness/scripts/issue-commands.mjs',
    );
    process.exit(2);
  }
  try {
    const payload = JSON.parse(readFileSync(path, 'utf8'));
    const r = await applyCommand({ payload, repo, token });
    console.log(r.acted ? `#${payload.issue.number}: ${r.plan.reply}` : `issue-commands: ${r.reason}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
