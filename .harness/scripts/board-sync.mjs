#!/usr/bin/env node
// Sync slice issues with a user-owned GitHub Project (REST Projects API). Zero dependencies.
// Needs PROJECT_BOARD_TOKEN (classic PAT). Optional BOARD_PROJECT_NUMBER overrides board.json.
// Missing token or project number: logs a notice and exits 0.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://api.github.com';
const norm = (s) => String(s ?? '').toLowerCase();
const labelNames = (labels) => (labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
const statusLabels = (options) => Object.keys(options).filter((k) => k.startsWith('status:'));

export function desiredStatus({ state, state_reason, labels }, options) {
  if (state === 'closed') return state_reason === 'not_planned' ? options.wontdo : options.done;
  const names = labelNames(labels).map(norm);
  const hit = statusLabels(options).find((k) => names.includes(norm(k)));
  return hit ? options[hit] : options['status:backlog'];
}

export function itemStatusName(item, statusFieldId, optionNamesById = {}, fieldName = 'Status') {
  const fields = Array.isArray(item?.fields) ? item.fields : [];
  const f = fields.find((x) => x && (String(x.id) === String(statusFieldId) || x.name === fieldName));
  if (!f) return null;
  let v = f.value;
  if (v && typeof v === 'object' && 'value' in v && !('name' in v) && !('id' in v)) v = v.value;
  if (v == null) return null;
  const resolveStr = (s) => optionNamesById[s] ?? s;
  if (typeof v === 'string') return resolveStr(v) || null;
  if (typeof v === 'object') {
    if (typeof v.name === 'string') return v.name || null;
    if (v.name && typeof v.name === 'object' && typeof v.name.raw === 'string') return v.name.raw || null;
    if (v.id != null) return optionNamesById[v.id] ?? null;
  }
  return null;
}

function itemRepo(item) {
  const c = item.content;
  if (c?.repository?.full_name) return c.repository.full_name;
  const m = /\/repos\/([^/]+\/[^/]+)$/.exec(c?.repository_url ?? '');
  return m ? m[1] : null;
}

export function planBoard({ issues, items, options, optionIdsByName }) {
  const plan = { add: [], set: [], writeBack: [] };
  const byKey = new Map();
  for (const it of items) {
    if (it.content_type !== 'Issue' || !it.content) continue;
    const repo = itemRepo(it);
    if (repo) byKey.set(`${norm(repo)}#${it.content.number}`, it);
  }
  const allStatus = statusLabels(options);
  const labelFor = (name) => allStatus.find((k) => options[k] === name) ?? null;
  for (const issue of issues) {
    const item = byKey.get(`${norm(issue.repo)}#${issue.number}`);
    if (!item) {
      plan.add.push(issue);
      continue;
    }
    const want = desiredStatus(issue, options);
    const have = item.status ?? null;
    if (have === want) continue;
    const present = labelNames(issue.labels).filter((n) => allStatus.some((k) => norm(k) === norm(n)));
    const cardNewer = item.updated_at && issue.updated_at && item.updated_at > issue.updated_at;
    const setPlan = () => {
      if (optionIdsByName[want]) plan.set.push({ itemId: item.id, optionId: optionIdsByName[want], name: want });
    };
    if (cardNewer && have !== options.done && have && optionIdsByName[have]) {
      if (have === options.wontdo) {
        if (issue.state === 'closed' && issue.state_reason === 'not_planned') continue;
        plan.writeBack.push({ repo: issue.repo, number: issue.number, addLabel: null, removeLabels: present, close: 'not_planned' });
        continue;
      }
      const lab = labelFor(have);
      if (issue.state === 'open' && lab) {
        plan.writeBack.push({
          repo: issue.repo,
          number: issue.number,
          addLabel: present.some((n) => norm(n) === norm(lab)) ? null : lab,
          removeLabels: present.filter((n) => norm(n) !== norm(lab)),
          close: null,
        });
        continue;
      }
    }
    setPlan();
  }
  return plan;
}

function nextLink(res) {
  const h = res.headers?.get?.('link') ?? '';
  const m = /<([^>]+)>\s*;\s*rel="next"/.exec(h);
  return m ? m[1] : null;
}

export async function runBoard({ env = process.env, fetchImpl = fetch, config, log = console.log, now = new Date() } = {}) {
  const cfg = config ?? JSON.parse(readFileSync(resolve(ROOT, '.harness', 'board.json'), 'utf8'));
  const token = env.PROJECT_BOARD_TOKEN;
  if (!token) {
    log('::notice::board-sync: PROJECT_BOARD_TOKEN is not set. Skipping.');
    return 0;
  }
  const num = env.BOARD_PROJECT_NUMBER ? Number(env.BOARD_PROJECT_NUMBER) : cfg.projectNumber;
  if (!num) {
    log('::notice::board-sync: no project number set (board.json projectNumber or BOARD_PROJECT_NUMBER). Skipping.');
    return 0;
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': cfg.apiVersion ?? '2026-03-10',
    'User-Agent': 'harness-board-sync',
  };
  const call = async (method, url, body) => {
    const res = await fetchImpl(url.startsWith('http') ? url : API + url, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  };
  const must = async (method, url, body) => {
    const res = await call(method, url, body);
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}`);
    return res;
  };
  const getAll = async (url) => {
    const out = [];
    let next = url;
    while (next) {
      const res = await must('GET', next);
      const data = await res.json();
      out.push(...(Array.isArray(data) ? data : []));
      next = nextLink(res);
    }
    return out;
  };
  try {
    const base = `/users/${cfg.owner}/projectsV2/${num}`;
    const fields = await getAll(`${base}/fields?per_page=100`);
    const sf = fields.find((f) => f.name === (cfg.statusField ?? 'Status'));
    if (!sf) throw new Error(`status field "${cfg.statusField ?? 'Status'}" not found on project ${num}`);
    const optionIdsByName = {};
    const optionNamesById = {};
    for (const o of sf.options ?? []) {
      const n = typeof o.name === 'string' ? o.name : o.name?.raw;
      optionIdsByName[n] = String(o.id);
      optionNamesById[String(o.id)] = n;
    }
    const rawItems = await getAll(`${base}/items?per_page=100&fields=${sf.id}`);
    const items = rawItems.map((it) => ({ ...it, status: itemStatusName(it, sf.id, optionNamesById, cfg.statusField) }));

    const since = new Date(now.getTime() - (cfg.closedWindowDays ?? 14) * 86400000).toISOString();
    const issues = [];
    for (const repo of cfg.repos) {
      try {
        const open = await getAll(`/repos/${repo}/issues?labels=slice&state=open&per_page=100`);
        const closed = await getAll(`/repos/${repo}/issues?labels=slice&state=closed&since=${encodeURIComponent(since)}&per_page=100`);
        for (const i of [...open, ...closed]) if (!i.pull_request) issues.push({ ...i, repo });
      } catch (e) {
        log(`::warning::board-sync: skipping ${repo}: ${e.message}`);
      }
    }

    const plan = planBoard({ issues, items, options: cfg.statusOptions, optionIdsByName });
    const patch = (itemId, optionId) =>
      must('PATCH', `${base}/items/${itemId}`, { fields: [{ id: sf.id, value: optionId }] });
    for (const issue of plan.add) {
      const [owner, name] = issue.repo.split('/');
      const res = await must('POST', `${base}/items`, { type: 'Issue', owner, repo: name, number: issue.number });
      const item = await res.json();
      log(`add ${issue.repo}#${issue.number}`);
      const want = desiredStatus(issue, cfg.statusOptions);
      if (optionIdsByName[want]) {
        await patch(item.id, optionIdsByName[want]);
        log(`set ${issue.repo}#${issue.number} -> ${want}`);
      }
    }
    for (const s of plan.set) {
      await patch(s.itemId, s.optionId);
      log(`set item ${s.itemId} -> ${s.name}`);
    }
    for (const w of plan.writeBack) {
      const path = `/repos/${w.repo}/issues/${w.number}`;
      if (w.addLabel) await must('POST', `${path}/labels`, { labels: [w.addLabel] });
      for (const l of w.removeLabels) {
        const res = await call('DELETE', `${path}/labels/${encodeURIComponent(l)}`);
        if (!res.ok && res.status !== 404) throw new Error(`DELETE label ${l} -> ${res.status}`);
      }
      if (w.close) await must('PATCH', path, { state: 'closed', state_reason: w.close });
      log(`write-back ${w.repo}#${w.number}: ${w.close ? 'closed as not planned' : `label ${w.addLabel ?? 'unchanged'}`}`);
    }
    log(`board-sync: ${plan.add.length} added, ${plan.set.length} set, ${plan.writeBack.length} written back.`);
    return 0;
  } catch (e) {
    log(`::error::board-sync: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(await runBoard());
}
