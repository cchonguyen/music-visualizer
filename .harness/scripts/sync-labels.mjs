#!/usr/bin/env node
// Create or update the harness labels (and the repo's project label) via the GitHub REST API.
// Idempotent. Never deletes. Zero dependencies. Needs GITHUB_TOKEN and GITHUB_REPOSITORY.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://api.github.com';

const norm = (s) => String(s ?? '').toLowerCase();

export function planLabelSync(existing, desired) {
  const byName = new Map(existing.map((l) => [norm(l.name), l]));
  const plan = { create: [], update: [], unchanged: [] };
  for (const want of desired) {
    const have = byName.get(norm(want.name));
    if (!have) {
      plan.create.push(want);
    } else if (
      norm(have.color) !== norm(want.color) ||
      (have.description ?? '') !== (want.description ?? '')
    ) {
      plan.update.push({ ...want, currentName: have.name });
    } else {
      plan.unchanged.push(want);
    }
  }
  return plan;
}

export function projectLabelFor(repo, config) {
  const name = String(repo).split('/').pop();
  const key = Object.keys(config.projects ?? {}).find((k) => norm(k) === norm(name));
  return key ? config.projects[key] : `project:${norm(name)}`;
}

async function call(fetchImpl, token, method, url, body) {
  const res = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'harness-labels',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!(res.status >= 200 && res.status < 300)) {
    const text = await res.text();
    throw new Error(`${method} ${url} failed: ${res.status} ${text}`);
  }
  return res;
}

async function listLabels(fetchImpl, token, repo) {
  const all = [];
  let url = `${API}/repos/${repo}/labels?per_page=100`;
  while (url) {
    const res = await call(fetchImpl, token, 'GET', url);
    all.push(...(await res.json()));
    const link = res.headers?.get?.('link') ?? '';
    const m = link.match(/<([^>]+)>\s*;\s*rel="next"/);
    url = m ? m[1] : null;
  }
  return all;
}

export async function syncLabels({ repo, token, config, fetchImpl = fetch }) {
  const desired = [
    ...config.labels,
    {
      name: projectLabelFor(repo, config),
      color: config.projectColor ?? '6f42c1',
      description: `Work in ${String(repo).split('/').pop()}`,
    },
  ];
  const existing = await listLabels(fetchImpl, token, repo);
  const plan = planLabelSync(existing, desired);
  for (const l of plan.create) {
    await call(fetchImpl, token, 'POST', `${API}/repos/${repo}/labels`, {
      name: l.name,
      color: l.color,
      description: l.description,
    });
  }
  for (const l of plan.update) {
    await call(
      fetchImpl,
      token,
      'PATCH',
      `${API}/repos/${repo}/labels/${encodeURIComponent(l.currentName)}`,
      { new_name: l.name, color: l.color, description: l.description },
    );
  }
  return plan;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    console.error('Usage: GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/name node .harness/scripts/sync-labels.mjs');
    process.exit(2);
  }
  try {
    const config = JSON.parse(readFileSync(resolve(ROOT, '.harness/config/labels.json'), 'utf8'));
    const plan = await syncLabels({ repo, token, config });
    for (const l of plan.create) console.log(`created ${l.name}`);
    for (const l of plan.update) console.log(`updated ${l.name}`);
    console.log(
      `labels: ${plan.create.length} created, ${plan.update.length} updated, ${plan.unchanged.length} unchanged`,
    );
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
