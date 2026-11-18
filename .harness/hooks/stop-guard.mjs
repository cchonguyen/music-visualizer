#!/usr/bin/env node
// Stop hook (stall prevention, slice 10.5, narrowed in slice 19.1). Blocks ending a turn only while the
// working-tree .spec/PROGRESS.md has an [IN_PROGRESS] slice line (the slice in progress on this branch).
// Pending `- [ ]` lines alone never block, so unmerged plans do not stall every thread. Escapes:
//   - CLAUDE_WAKE_SCHEDULED=1       a wake-up is scheduled for this session (no harness file records this yet)
//   - CLAUDE_PR_SUBSCRIBED=1        this session is subscribed to a PR (no harness marker file exists yet)
// Second block (slice 19.196): a stop that leaves a pull request opened in this session with nothing to wake
// the thread (no subscribe_pr_activity, merge_pull_request, send_later, create_trigger or ScheduleWakeup for it)
// is blocked too. It reads the session transcript at payload.transcript_path. Same escapes apply.
// Third block (slice 19.201): a stop with checklist steps still open, or a stated next step ("Next is slice 3"),
// and nothing after it that wakes the thread, is blocked too (see stalledPlan). Same escapes apply.
// Fourth block (slice 19.203): a turn that posts a decision card and then only ends (see parkedOnDecision).
// Output: {"decision":"block","reason":"..."} on stdout when blocking; nothing and exit 0 when allowing.
// Never throws. Malformed stdin fails open (allows stop). A repeat stop (stop_hook_active) is allowed,
// so the hook blocks at most once per stop attempt and cannot loop.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveRoot } from './lib/vibe.mjs';

const IN_PROGRESS_LINE = /^\s*-\s*\[[ x]\].*\[IN_PROGRESS\]/m;
const SLICE_ID = /\*\*Slice\s+([^:*]+):/;

// True when a slice line in the progress text is marked [IN_PROGRESS]. Pending `- [ ]` lines do not count.
export function hasInProgressSlice(progressText = '') {
  return IN_PROGRESS_LINE.test(String(progressText));
}

// The id of the first [IN_PROGRESS] slice line, or '' when there is none.
export function inProgressSliceId(progressText = '') {
  const line = String(progressText).split('\n').find((text) => IN_PROGRESS_LINE.test(text));
  const match = line ? SLICE_ID.exec(line) : null;
  return match ? match[1].trim() : '';
}

export function escapeReason(env = {}) {
  if (String(env.CLAUDE_WAKE_SCHEDULED || '') === '1') return 'wake scheduled';
  if (String(env.CLAUDE_PR_SUBSCRIBED || '') === '1') return 'PR subscribed';
  return '';
}

const endsWithTool = (name, suffix) => String(name || '').endsWith(suffix);

// The text of a tool_result content field: a string, or an array of {type:'text', text} blocks.
const resultText = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
};

// A raw transcript line that carries a pull_request.closed event (the event text is escaped inside JSON strings).
// Scanned on the raw line, before JSON parsing.
const CLOSED_EVENT = /pull_request\.closed[\s\S]{0,400}?#(\d+)/g;
const READ_TOOLS = ['pull_request_read', 'list_pull_requests'];
const MAX_DEPTH = 6;

// Adds the PR numbers in a parsed GitHub result that show closed or merged. An object with no numeric number
// that shows closed takes the pullNumber the read was called with (fallback). Depth-limited. Never throws.
function collectClosed(value, fallback, out, depth = 0) {
  if (depth > MAX_DEPTH || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectClosed(item, fallback, out, depth + 1);
    return;
  }
  const isClosed = value.state === 'closed' || value.merged === true || Boolean(value.merged_at);
  if (typeof value.number === 'number') {
    if (isClosed) out.add(value.number);
    return;
  }
  if (isClosed && Number.isFinite(fallback)) {
    out.add(fallback);
    return;
  }
  for (const child of Object.values(value)) collectClosed(child, fallback, out, depth + 1);
}

// PR numbers opened in the transcript and never given a wake (slice 19.196). Walks the JSONL in order:
// create_pull_request opens a PR (number read from its result's /pull/<n> URL); subscribe_pr_activity or
// merge_pull_request with that pullNumber watches it; send_later, create_trigger or ScheduleWakeup watches
// every PR opened before it. A PR the transcript shows closed or merged (closed event, update_pull_request
// with state closed, unsubscribe_pr_activity, or a pull_request_read / list_pull_requests result) is settled
// and not returned, whenever that close appears. Returns sorted unique numbers, or [] on any problem. Never throws.
export function unwatchedPrs(transcriptText) {
  try {
    if (typeof transcriptText !== 'string' || !transcriptText) return [];
    const opened = new Map(); // PR number -> watched?
    const closed = new Set(); // PR numbers the transcript shows closed or merged, at any point
    const pendingOpens = new Set(); // tool_use ids of create_pull_request calls awaiting a result
    const pendingReads = new Map(); // tool_use id -> input of pull_request_read / list_pull_requests calls
    const watchedAny = new Set(); // pullNumbers subscribed or merged at any point (parallel calls can precede the open's result)
    const timerCovered = new Set(); // create_pull_request ids still awaiting a result when a timer was set
    for (const line of transcriptText.split('\n')) {
      if (!line.trim()) continue;
      for (const match of line.matchAll(CLOSED_EVENT)) closed.add(Number(match[1]));
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const blocks = entry && entry.message && Array.isArray(entry.message.content) ? entry.message.content : [];
      for (const block of blocks) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'tool_use') {
          const name = block.name;
          const input = block.input && typeof block.input === 'object' ? block.input : {};
          if (endsWithTool(name, 'create_pull_request')) {
            if (block.id) pendingOpens.add(block.id);
          } else if (endsWithTool(name, 'subscribe_pr_activity') || endsWithTool(name, 'merge_pull_request')) {
            const n = Number(input.pullNumber);
            watchedAny.add(n);
            if (opened.has(n)) opened.set(n, true);
          } else if (endsWithTool(name, 'send_later') || endsWithTool(name, 'create_trigger') || endsWithTool(name, 'ScheduleWakeup')) {
            for (const n of opened.keys()) opened.set(n, true);
            for (const id of pendingOpens) timerCovered.add(id);
          } else if (endsWithTool(name, 'update_pull_request')) {
            if (input.state === 'closed') closed.add(Number(input.pullNumber));
          } else if (endsWithTool(name, 'unsubscribe_pr_activity')) {
            closed.add(Number(input.pullNumber));
          } else if (READ_TOOLS.some((tool) => endsWithTool(name, tool))) {
            if (block.id) pendingReads.set(block.id, input);
          }
        } else if (block.type === 'tool_result') {
          if (pendingOpens.has(block.tool_use_id)) {
            pendingOpens.delete(block.tool_use_id);
            const match = /\/pull\/(\d+)/.exec(resultText(block.content));
            if (match) {
              const n = Number(match[1]);
              if (!opened.has(n)) opened.set(n, timerCovered.has(block.tool_use_id));
            }
          } else if (pendingReads.has(block.tool_use_id)) {
            const input = pendingReads.get(block.tool_use_id);
            pendingReads.delete(block.tool_use_id);
            let parsed;
            try { parsed = JSON.parse(resultText(block.content)); } catch { parsed = undefined; }
            collectClosed(parsed, Number(input.pullNumber), closed);
          }
        }
      }
    }
    return [...opened.entries()].filter(([n, watched]) => !watched && !watchedAny.has(n) && !closed.has(n)).map(([n]) => n).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

// Checklist and next-step check (slice 19.201). Walks the JSONL in order. Blocks a stop that leaves checklist
// steps open (or a stated next step) with nothing after it that wakes the thread. A PR subscription alone does
// not count: a green check sometimes never wakes the thread. Returns '' (allow) or a block reason. Never throws.
const CHECKLIST_TOOL = 'update_progress_checklist';
// Also a first-person future step (slice 19.203): "I'll check", "I’ll first check", "I will check", "Next I'll check", or a bare "Next, I'll".
const NEXT_STEP = /\b(next (is|up)|i'?ll (now )?(start|begin|move on|do|build|open|run)|starting (on )?|moving on to|now (starting|building|doing))\b|\b(next,?\s+)?i(?:['’]ll|\s+will)\s+(?:(?:now|first|then|next)\s+)*[a-z]+\b|\bnext,?\s+i(?:['’]ll|\s+will)\b/i;
const OPEN_STEP_MARK = /^[✱○]/;
const QUIET_REASONS = ['asked_to_be_quiet', 'not_for_me'];
const END_OF_TURN = ['no_reply_needed', 'react', 'unreact', 'edit_message', 'rename_thread'];

// True when a tool_use made after the checklist or stated step will wake the thread (or otherwise settles the stop).
function wakesThread(name, input) {
  if (endsWithTool(name, 'request_decision')) return true;
  if (endsWithTool(name, 'post_message') && typeof input.text === 'string' && (input.text.includes('?') || input.text.includes('Needed from you'))) return true;
  if (endsWithTool(name, 'send_later') || endsWithTool(name, 'create_trigger') || endsWithTool(name, 'ScheduleWakeup')) return true;
  if (endsWithTool(name, 'set_thread_resolved') && input.resolved === true) return true;
  if ((name === 'Agent' || name === 'Task') && input.run_in_background !== false) return true;
  if (name === 'Bash' && input.run_in_background === true) return true;
  if (endsWithTool(name, 'no_reply_needed') && QUIET_REASONS.includes(input.reason)) return true;
  return false;
}

// Events in transcript order: { kind: 'prompt' } for a person's message or wake, { kind: 'tool', name, input },
// or { kind: 'text', text } for assistant text. Malformed lines are skipped. Never throws.
function transcriptEvents(transcriptText) {
  const events = [];
  for (const line of transcriptText.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const message = entry && entry.message;
    const blocks = message && Array.isArray(message.content) ? message.content : [];
    const assistant = Boolean(entry) && (entry.type === 'assistant' || Boolean(message && message.role === 'assistant'));
    // A user entry that is not only tool results starts a new turn (a person's message or a wake).
    if (!assistant && entry && entry.type === 'user' && message) {
      const content = message.content;
      const isPrompt = typeof content === 'string' || (Array.isArray(content) && content.some((b) => b && b.type !== 'tool_result'));
      if (isPrompt) events.push({ kind: 'prompt' });
    }
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'tool_use') {
        const input = block.input && typeof block.input === 'object' ? block.input : {};
        events.push({ kind: 'tool', name: String(block.name || ''), input });
      } else if (block.type === 'text' && assistant && typeof block.text === 'string') {
        events.push({ kind: 'text', text: block.text });
      }
    }
  }
  return events;
}

export function stalledPlan(transcriptText) {
  try {
    if (typeof transcriptText !== 'string' || !transcriptText) return '';
    const events = transcriptEvents(transcriptText);
    let checklistAt = -1;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i].kind === 'tool' && endsWithTool(events[i].name, CHECKLIST_TOOL)) { checklistAt = i; break; }
    }
    const checklistText = checklistAt >= 0 && typeof events[checklistAt].input.text === 'string' ? events[checklistAt].input.text : '';
    const openSteps = checklistText.split('\n').map((line) => line.trim()).filter((line) => OPEN_STEP_MARK.test(line));
    let lastAt = -1;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      if (ev.kind === 'text' || (ev.kind === 'tool' && endsWithTool(ev.name, 'post_message'))) { lastAt = i; break; }
    }
    let stated = null;
    if (lastAt >= 0 && (checklistAt < 0 || lastAt > checklistAt)) {
      const ev = events[lastAt];
      const said = ev.kind === 'text' ? ev.text : (typeof ev.input.text === 'string' ? ev.input.text : '');
      // A stated step that substantive tool calls followed was acted on; only end-of-turn calls may follow it.
      const actedOn = events.slice(lastAt + 1).some((later) => later.kind === 'tool' && !END_OF_TURN.some((t) => endsWithTool(later.name, t)));
      stated = actedOn ? null : NEXT_STEP.exec(said);
    }
    if (openSteps.length === 0 && !stated) return '';
    // A wake set earlier in the same turn as the checklist counts too (calls in one message can come in any order).
    let base = checklistAt >= 0 ? checklistAt : lastAt;
    for (let i = base - 1; i >= 0; i -= 1) {
      if (events[i].kind === 'prompt') { base = i; break; }
    }
    if (events.slice(base + 1).some((ev) => ev.kind === 'tool' && wakesThread(ev.name, ev.input))) return '';
    if (openSteps.length > 0) {
      const step = openSteps[0].replace(OPEN_STEP_MARK, '').trim().slice(0, 80);
      return `Your checklist still has ${openSteps.length} unfinished step(s) (next: "${step}") and nothing will wake this thread. Keep going with that step now. If it waits on the operator, ask with request_decision or a reply that asks the question. If it waits on checks or another job, call send_later to check back in about 10 minutes (a PR subscription alone can miss a green check). If the step is actually done or dropped, update the checklist.`;
    }
    return `You said "${stated[0]}" but ended the turn with nothing that will wake this thread. Do that step now, or call send_later, or ask the question with request_decision.`;
  } catch {
    return '';
  }
}

// Decision-card stall (slice 19.203). In the current turn (events after the last prompt), a request_decision card
// followed only by assistant text, post_message, or end-of-turn calls (no_reply_needed without a quiet reason,
// react, unreact, edit_message, rename_thread) parks the thread. Any other tool call after the card (real work,
// send_later, create_trigger, ScheduleWakeup) lets the stop through, as does no_reply_needed with a quiet reason.
// Returns '' (allow) or a block reason. Never throws.
const DECISION_REASON = 'You posted a decision card and stopped. Keep working on the option you recommended while the card waits, unless that step cannot be undone. If it truly cannot go on without the answer, stop again.';
export function parkedOnDecision(transcriptText) {
  try {
    if (typeof transcriptText !== 'string' || !transcriptText) return '';
    const events = transcriptEvents(transcriptText);
    let turnStart = 0;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i].kind === 'prompt') { turnStart = i + 1; break; }
    }
    let cardAt = -1;
    for (let i = events.length - 1; i >= turnStart; i -= 1) {
      if (events[i].kind === 'tool' && endsWithTool(events[i].name, 'request_decision')) { cardAt = i; break; }
    }
    if (cardAt < 0) return '';
    for (const ev of events.slice(cardAt + 1)) {
      if (ev.kind !== 'tool' || endsWithTool(ev.name, 'post_message')) continue;
      if (endsWithTool(ev.name, 'no_reply_needed')) {
        if (QUIET_REASONS.includes(ev.input.reason)) return '';
        continue;
      }
      if (END_OF_TURN.some((t) => endsWithTool(ev.name, t))) continue;
      return '';
    }
    return DECISION_REASON;
  } catch {
    return '';
  }
}

// Block reason for a stalled checklist or stated next step at payload.transcript_path, or ''. Never throws.
const stalledPlanReason = (transcriptPath) => {
  try {
    if (!transcriptPath) return '';
    fs.accessSync(transcriptPath, fs.constants.R_OK);
    return stalledPlan(fs.readFileSync(transcriptPath, 'utf8'));
  } catch {
    return '';
  }
};

// Block reason for a decision card the turn ended on, at payload.transcript_path, or ''. Never throws.
const parkedOnDecisionReason = (transcriptPath) => {
  try {
    if (!transcriptPath) return '';
    fs.accessSync(transcriptPath, fs.constants.R_OK);
    return parkedOnDecision(fs.readFileSync(transcriptPath, 'utf8'));
  } catch {
    return '';
  }
};

// Block reason for PRs opened but never watched in the transcript at payload.transcript_path, or ''.
const unwatchedPrReason = (transcriptPath) => {
  try {
    if (!transcriptPath) return '';
    fs.accessSync(transcriptPath, fs.constants.R_OK);
    const nums = unwatchedPrs(fs.readFileSync(transcriptPath, 'utf8'));
    if (nums.length === 0) return '';
    const list = nums.map((n) => `#${n}`).join(', ');
    return `PR ${list} was opened in this session, but nothing will wake you when its checks finish. Call subscribe_pr_activity for it now (or send_later to recheck in a few minutes). From that wake: merge when green, merge the base branch on a conflict, fix the cause on red. If it is already closed or merged, read it once with pull_request_read so this check sees that.`;
  } catch {
    return '';
  }
};

// Returns a block reason string, or '' to allow the stop.
export function stopDecision({ root, env = {}, payload = {} } = {}) {
  try {
    if (payload && payload.stop_hook_active === true) return '';
    const progressPath = path.join(String(root || ''), '.spec', 'PROGRESS.md');
    const progress = fs.existsSync(progressPath) ? fs.readFileSync(progressPath, 'utf8') : '';
    if (hasInProgressSlice(progress) && !escapeReason(env)) {
      const id = inProgressSliceId(progress) || '(unnamed)';
      return `Slice ${id} is still [IN_PROGRESS] in .spec/PROGRESS.md. Finish it with finish-slice.mjs or schedule a wake-up before stopping.`;
    }
    if (escapeReason(env)) return '';
    const transcriptPath = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
    return unwatchedPrReason(transcriptPath) || stalledPlanReason(transcriptPath) || parkedOnDecisionReason(transcriptPath);
  } catch {
    return '';
  }
}

// Baseline telemetry (slice 19.3): writes <root>/.spec/.events/receipt-<sessionId>.json from the session
// transcript. Never throws and never changes the stop decision or stdout. Returns the file path, or ''.
export async function writeStopReceipt({ root, payload = {} } = {}) {
  try {
    const transcriptPath = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
    if (!transcriptPath) return '';
    fs.accessSync(transcriptPath, fs.constants.R_OK);
    const { buildReceipt } = await import('../scripts/receipt.mjs');
    const transcript = fs.readFileSync(transcriptPath, 'utf8');
    const git = (args) => {
      try {
        return execFileSync('git', args, { cwd: String(root || ''), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return '';
      }
    };
    let progress = '';
    try { progress = fs.readFileSync(path.join(String(root || ''), '.spec', 'PROGRESS.md'), 'utf8'); } catch { progress = ''; }
    const sessionId = String(payload.session_id || '').replace(/[^A-Za-z0-9_-]/g, '') || 'unknown';
    const receipt = buildReceipt(transcript, {
      slice: inProgressSliceId(progress),
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      head: git(['rev-parse', 'HEAD']),
    });
    const dir = path.join(String(root || ''), '.spec', '.events');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `receipt-${sessionId}.json`);
    fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
    return file;
  } catch {
    return '';
  }
}

const main = async () => {
  let payload = null;
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }
  if (!payload || typeof payload !== 'object') return;
  const root = (typeof payload.cwd === 'string' && payload.cwd) || process.env.CLAUDE_PROJECT_DIR || resolveRoot();
  await writeStopReceipt({ root, payload });
  const reason = stopDecision({ root, env: process.env, payload });
  if (reason) process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
};

// Run only when executed directly, so tests can import stopDecision without touching stdin.
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch(() => {
    // A Stop hook must never break the turn. Allow the stop on any failure.
  }).finally(() => process.exit(0));
}
