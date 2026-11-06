import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { updateTelemetry, telemetryFile, telemetryErrorLog } from './telemetry-store.mjs';

const storeUrl = new URL('./telemetry-store.mjs', import.meta.url).href;
const telemetryUrl = new URL('./telemetry.mjs', import.meta.url).href;

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-store-'));
  fs.mkdirSync(path.join(root, '.spec'), { recursive: true });
  return root;
}

// Runs one child process per worker. Each worker mixes appendCall-style and counter-style writes.
function runWorkers(root, workers, perWorker) {
  const script = `
    const [root, n, appendUrl, storeUrl] = process.argv.slice(1);
    const { appendCall } = await import(appendUrl);
    const { updateTelemetry } = await import(storeUrl);
    for (let i = 0; i < Number(n); i++) {
      appendCall(root, { tool: 'Agent', i });
      updateTelemetry(root, (t) => ({ ...t, totalToolCalls: (t.totalToolCalls || 0) + 1 }));
    }
  `;
  const jobs = Array.from({ length: workers }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, root, String(perWorker), telemetryUrl, storeUrl], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err || `exit ${code}`))));
  }));
  return Promise.all(jobs);
}

test('concurrent writers from separate processes keep every call record and counter', async () => {
  const root = tempRoot();
  const workers = 6;
  const perWorker = 20;
  await runWorkers(root, workers, perWorker);
  const data = JSON.parse(fs.readFileSync(telemetryFile(root), 'utf8'));
  assert.equal(data.calls.length, workers * perWorker, 'no call record may be lost');
  assert.equal(data.totalToolCalls, workers * perWorker, 'no counter increment may be lost');
});

test('updateTelemetry keeps the latest stored calls and hands mutate a copy', () => {
  const root = tempRoot();
  fs.writeFileSync(telemetryFile(root), JSON.stringify({ calls: [{ tool: 'Bash' }], totalToolCalls: 1 }));
  const next = updateTelemetry(root, (t) => ({ ...t, totalToolCalls: t.totalToolCalls + 1 }));
  assert.equal(next.calls.length, 1);
  assert.equal(next.totalToolCalls, 2);
  const stored = JSON.parse(fs.readFileSync(telemetryFile(root), 'utf8'));
  assert.deepEqual(stored, next);
});

test('a corrupt non-empty file is kept as .bak before it is replaced', () => {
  const root = tempRoot();
  fs.writeFileSync(telemetryFile(root), '{not json');
  updateTelemetry(root, (t) => ({ ...t, calls: [...t.calls, { tool: 'Agent' }] }));
  assert.equal(fs.readFileSync(`${telemetryFile(root)}.bak`, 'utf8'), '{not json');
  assert.equal(JSON.parse(fs.readFileSync(telemetryFile(root), 'utf8')).calls.length, 1);
});

test('a failed write is logged to the telemetry error log and never throws', () => {
  const root = tempRoot();
  // A directory where the file should be makes the final rename fail.
  fs.mkdirSync(telemetryFile(root));
  assert.doesNotThrow(() => updateTelemetry(root, (t) => ({ ...t, calls: [] })));
  const log = fs.readFileSync(telemetryErrorLog(root), 'utf8');
  assert.match(log, /writeJsonAtomic:/);
});
