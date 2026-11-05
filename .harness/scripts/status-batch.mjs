#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const gitSafe = (cwd, args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

export const resolveRoot = () =>
  process.env.CLAUDE_PROJECT_DIR || gitSafe(process.cwd(), ['rev-parse', '--show-toplevel']) || process.cwd();

export const activeSliceLabel = (root) => {
  const progressPath = path.join(root, '.spec', 'PROGRESS.md');
  if (!fs.existsSync(progressPath)) return 'none';
  const line = fs.readFileSync(progressPath, 'utf8').split('\n').find((l) => /^\s*-\s*\[.\].*\[IN_PROGRESS\]/.test(l));
  if (!line) return 'none';
  const m = line.match(/\*\*Slice\s+([^*]+)\*\*/);
  return m ? `Slice ${m[1].trim()}` : line.trim().slice(0, 60);
};

export function appendBatchEvent(root, { event, summary, slice, details = '', actor = 'harness' }) {
  try {
    const batchPath = path.join(root, '.spec', 'STATUS_BATCH.jsonl');
    fs.mkdirSync(path.dirname(batchPath), { recursive: true });
    const entry = {
      ts: new Date().toISOString(),
      actor,
      branch: gitSafe(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown',
      slice: slice || activeSliceLabel(root),
      event: String(event || 'info'),
      summary: String(summary || '').trim(),
      ...(details ? { details: String(details).trim() } : {})
    };
    fs.appendFileSync(batchPath, `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  } catch {
    return null;
  }
}

export function readBatchEvents(root) {
  const batchPath = path.join(root, '.spec', 'STATUS_BATCH.jsonl');
  if (!fs.existsSync(batchPath)) return [];
  return fs
    .readFileSync(batchPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const root = resolveRoot();
  const batchPath = path.join(root, '.spec', 'STATUS_BATCH.jsonl');
  const cmd = (process.argv[2] || 'digest').toLowerCase();

  if (cmd === 'append') {
    const event = process.argv[3] || 'note';
    const summary = process.argv[4] || 'Status update recorded';
    const details = process.argv.slice(5).join(' ');
    const actor = process.env.HARNESS_ACTOR || 'agent';
    appendBatchEvent(root, { event, summary, details, actor });
    console.log(`✓ Queued [${event}] in .spec/STATUS_BATCH.jsonl.`);
    process.exit(0);
  }

  if (cmd === 'clear') {
    if (fs.existsSync(batchPath)) fs.unlinkSync(batchPath);
    console.log('✓ Cleared .spec/STATUS_BATCH.jsonl after briefing delivery.');
    process.exit(0);
  }

  if (cmd === 'digest' || cmd === 'bundle') {
    const events = readBatchEvents(root);
    const handoffPath = path.join(root, '.spec', 'SESSION_HANDOFF.md');
    const progressPath = path.join(root, '.spec', 'PROGRESS.md');
    const handoff = fs.existsSync(handoffPath) ? fs.readFileSync(handoffPath, 'utf8').trim() : '_None_';
    const progress = fs.existsSync(progressPath) ? fs.readFileSync(progressPath, 'utf8').trim() : '_None_';
    const recentCommits = gitSafe(root, ['log', '-n', '5', '--oneline']) || '_No commits_';

    const eventLines = events.length === 0
      ? ['- No new queued events in .spec/STATUS_BATCH.jsonl.']
      : events.map((e) => {
          const extra = e.details ? ` — ${e.details}` : '';
          return `- [${e.ts}] (${e.actor}@${e.branch} | ${e.slice}) **${e.event}**: ${e.summary}${extra}`;
        });

    const digestBody = [
      `# CONSOLIDATED STATUS BATCH (${events.length} queued event${events.length === 1 ? '' : 's'})`,
      ...eventLines,
      `\n# RECENT COMMITS\n${recentCommits}`,
      `\n# SESSION HANDOFF\n${handoff}`,
      `\n# PROGRESS\n${progress}`
    ].join('\n');

    if (cmd === 'digest') {
      console.log(digestBody);
      process.exit(0);
    }

    const payload = `@status-briefing Please translate this batched telemetry digest into a concise, plain-English Operator Briefing: (1) What happened under the hood, (2) Current verification & branch state, and (3) Any upshift decision or next action needed from me.\n\n${digestBody}`;
    const outPath = path.join(root, '.spec', 'BRIEFING_PACKET.md');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, payload, 'utf8');

    if (os.platform() === 'darwin') {
      const copied = spawnSync('pbcopy', { input: payload });
      if (copied.status === 0) {
        console.log(`✓ Briefing packet (${events.length} event(s)) written to .spec/BRIEFING_PACKET.md and auto-copied to macOS Clipboard.`);
      } else {
        console.log(`✓ Briefing packet (${events.length} event(s)) written to .spec/BRIEFING_PACKET.md (open file to copy).`);
      }
    } else {
      console.log(`✓ Briefing packet (${events.length} event(s)) saved to .spec/BRIEFING_PACKET.md.`);
    }
    process.exit(0);
  }

  console.log(`✗ Unknown command "${cmd}". Use: append <event> <summary> [details] | digest | bundle | clear`);
  process.exit(1);
}
