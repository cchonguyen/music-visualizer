import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stopDecision, hasInProgressSlice, unwatchedPrs, stalledPlan, parkedOnDecision } from '../stop-guard.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'stop-guard.mjs');

const makeRoot = (progress) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-guard-'));
  if (progress !== undefined) {
    fs.mkdirSync(path.join(root, '.spec'), { recursive: true });
    fs.writeFileSync(path.join(root, '.spec', 'PROGRESS.md'), progress);
  }
  return root;
};

const IN_PROGRESS = '- [ ] **Slice 1: Demo** [IN_PROGRESS] [CORE / DATA] Target files: a.mjs\n';
const DONE_ONLY = '- [x] **Slice 1: Demo** [CORE / DATA] Target files: a.mjs\n';

test('hasInProgressSlice detects an [IN_PROGRESS] slice line only, not pending boxes', () => {
  assert.equal(hasInProgressSlice(IN_PROGRESS), true);
  assert.equal(hasInProgressSlice('- [ ] **Slice 2: Next** Target files: b.mjs\n'), false);
  assert.equal(hasInProgressSlice(DONE_ONLY), false);
  assert.equal(hasInProgressSlice(''), false);
});

test('pending-only slices (unchecked boxes, no IN_PROGRESS) allow stop', () => {
  const root = makeRoot('- [x] **Slice 1: Done** [CORE / DATA] Target files: a.mjs\n- [ ] **Slice 2: Next** [CORE / DATA] Target files: b.mjs\n');
  try {
    assert.equal(stopDecision({ root, env: {} }), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no IN_PROGRESS slice allows stop', () => {
  const root = makeRoot(DONE_ONLY);
  try {
    assert.equal(stopDecision({ root, env: {} }), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing PROGRESS.md allows stop', () => {
  const root = makeRoot();
  try {
    assert.equal(stopDecision({ root, env: {} }), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('IN_PROGRESS slice with no escape blocks stop', () => {
  const root = makeRoot(IN_PROGRESS);
  try {
    const reason = stopDecision({ root, env: {} });
    assert.ok(reason.length > 0);
    assert.match(reason, /Slice 1 is still \[IN_PROGRESS\]/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('IN_PROGRESS slice with the wake escape allows stop', () => {
  const root = makeRoot(IN_PROGRESS);
  try {
    assert.equal(stopDecision({ root, env: { CLAUDE_WAKE_SCHEDULED: '1' } }), '');
    assert.equal(stopDecision({ root, env: { CLAUDE_PR_SUBSCRIBED: '1' } }), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stop_hook_active allows stop so the hook cannot loop', () => {
  const root = makeRoot(IN_PROGRESS);
  try {
    assert.equal(stopDecision({ root, env: {}, payload: { stop_hook_active: true } }), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('malformed stdin does not throw and allows stop', () => {
  const root = makeRoot(IN_PROGRESS);
  try {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
    delete env.CLAUDE_WAKE_SCHEDULED;
    delete env.CLAUDE_PR_SUBSCRIBED;
    const res = spawnSync(process.execPath, [HOOK], { input: '{not json', encoding: 'utf8', env });
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('blocking run emits a Stop block decision on stdout', () => {
  const root = makeRoot(IN_PROGRESS);
  try {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
    delete env.CLAUDE_WAKE_SCHEDULED;
    delete env.CLAUDE_PR_SUBSCRIBED;
    const res = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: root }), encoding: 'utf8', env });
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.equal(out.decision, 'block');
    assert.ok(out.reason.length > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Transcript helpers for slice 19.196 (JSONL, same shape as Claude Code session transcripts).
const toolUse = (id, name, input = {}) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const openPr = (id, n) => [toolUse(id, 'mcp__github__create_pull_request'), toolResult(id, [{ type: 'text', text: `https://github.com/acme/app/pull/${n}` }])];
const transcript = (...lines) => lines.join('\n') + '\n';

test('unwatchedPrs: opened and never watched returns the PR number', () => {
  assert.deepEqual(unwatchedPrs(transcript(...openPr('a', 7))), [7]);
});

test('unwatchedPrs: opened then subscribed to activity returns nothing', () => {
  const text = transcript(...openPr('a', 7), toolUse('b', 'mcp__github__subscribe_pr_activity', { pullNumber: 7 }));
  assert.deepEqual(unwatchedPrs(text), []);
});

test('unwatchedPrs: opened then merged returns nothing', () => {
  const text = transcript(...openPr('a', 7), toolUse('b', 'mcp__github__merge_pull_request', { pullNumber: 7 }));
  assert.deepEqual(unwatchedPrs(text), []);
});

test('unwatchedPrs: opened then send_later returns nothing', () => {
  const text = transcript(...openPr('a', 7), toolUse('b', 'send_later', { delaySeconds: 300 }));
  assert.deepEqual(unwatchedPrs(text), []);
});

test('unwatchedPrs: send_later before opening does not count', () => {
  const text = transcript(toolUse('b', 'send_later', {}), ...openPr('a', 7));
  assert.deepEqual(unwatchedPrs(text), [7]);
});

test('unwatchedPrs: garbage lines return an empty list and do not throw', () => {
  assert.deepEqual(unwatchedPrs('{not json\n\nnull\n[1,2\n'), []);
  assert.deepEqual(unwatchedPrs(''), []);
  assert.deepEqual(unwatchedPrs(undefined), []);
});

test('unwatchedPrs: string tool_result content and multiple PRs, sorted and unique', () => {
  const text = transcript(
    toolUse('a', 'create_pull_request'), toolResult('a', 'Opened https://github.com/acme/app/pull/9'),
    toolUse('b', 'create_pull_request'), toolResult('b', 'Opened https://github.com/acme/app/pull/3'),
    toolUse('c', 'subscribe_pr_activity', { pullNumber: 9 }),
  );
  assert.deepEqual(unwatchedPrs(text), [3]);
});

test('stopDecision: unwatched PR with no in-progress slice blocks and names the PR', () => {
  const root = makeRoot(DONE_ONLY);
  const transcriptPath = path.join(root, 'session.jsonl');
  fs.writeFileSync(transcriptPath, transcript(...openPr('a', 42)));
  try {
    const reason = stopDecision({ root, env: {}, payload: { transcript_path: transcriptPath } });
    assert.match(reason, /PR #42 was opened in this session/);
    assert.match(reason, /subscribe_pr_activity/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stopDecision: stop_hook_active allows stop even with an unwatched PR', () => {
  const root = makeRoot(DONE_ONLY);
  const transcriptPath = path.join(root, 'session.jsonl');
  fs.writeFileSync(transcriptPath, transcript(...openPr('a', 42)));
  try {
    assert.equal(stopDecision({ root, env: {}, payload: { stop_hook_active: true, transcript_path: transcriptPath } }), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stopDecision: watched PR allows stop', () => {
  const root = makeRoot(DONE_ONLY);
  const transcriptPath = path.join(root, 'session.jsonl');
  fs.writeFileSync(transcriptPath, transcript(...openPr('a', 42), toolUse('b', 'subscribe_pr_activity', { pullNumber: 42 })));
  try {
    assert.equal(stopDecision({ root, env: {}, payload: { transcript_path: transcriptPath } }), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stopDecision: PR block respects the wake and PR-subscribed escapes', () => {
  const root = makeRoot(DONE_ONLY);
  const transcriptPath = path.join(root, 'session.jsonl');
  fs.writeFileSync(transcriptPath, transcript(...openPr('a', 42)));
  try {
    const payload = { transcript_path: transcriptPath };
    assert.equal(stopDecision({ root, env: { CLAUDE_WAKE_SCHEDULED: '1' }, payload }), '');
    assert.equal(stopDecision({ root, env: { CLAUDE_PR_SUBSCRIBED: '1' }, payload }), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Closed or merged PRs are settled (slice 19.199).
const closedEventLine = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'z', content: '<event source="github" kind="pull_request.closed" from="system" trust="relay">\n {"outcome":"closed","pr":"acme/app#7"}\n</event>' }] } });

test('unwatchedPrs: a closed event for the opened PR settles it', () => {
  assert.deepEqual(unwatchedPrs(transcript(...openPr('a', 7), closedEventLine)), []);
});

test('unwatchedPrs: a closed event for a different PR does not settle this one', () => {
  const otherClosed = closedEventLine.replace('acme/app#7', 'acme/app#8');
  assert.deepEqual(unwatchedPrs(transcript(...openPr('a', 7), otherClosed)), [7]);
});

test('unwatchedPrs: update_pull_request with state closed settles the PR', () => {
  assert.deepEqual(unwatchedPrs(transcript(...openPr('a', 7), toolUse('b', 'mcp__github__update_pull_request', { pullNumber: 7, state: 'closed' }))), []);
});

test('unwatchedPrs: update_pull_request without state (body edit) does not settle the PR', () => {
  assert.deepEqual(unwatchedPrs(transcript(...openPr('a', 7), toolUse('b', 'mcp__github__update_pull_request', { pullNumber: 7, body: 'edited' }))), [7]);
});

test('unwatchedPrs: unsubscribe_pr_activity settles the PR', () => {
  assert.deepEqual(unwatchedPrs(transcript(...openPr('a', 7), toolUse('b', 'mcp__github__unsubscribe_pr_activity', { pullNumber: 7 }))), []);
});

test('unwatchedPrs: pull_request_read result that is closed settles the PR', () => {
  const text = transcript(...openPr('a', 7), toolUse('r', 'mcp__github__pull_request_read', { pullNumber: 7 }), toolResult('r', JSON.stringify({ number: 7, state: 'closed', merged: false })));
  assert.deepEqual(unwatchedPrs(text), []);
});

test('unwatchedPrs: pull_request_read result that is open does not settle the PR', () => {
  const text = transcript(...openPr('a', 7), toolUse('r', 'mcp__github__pull_request_read', { pullNumber: 7 }), toolResult('r', JSON.stringify({ number: 7, state: 'open', merged: false })));
  assert.deepEqual(unwatchedPrs(text), [7]);
});

test('unwatchedPrs: list_pull_requests result containing a closed PR settles it', () => {
  const text = transcript(...openPr('a', 7), toolUse('l', 'mcp__github__list_pull_requests', { owner: 'acme', repo: 'app' }), toolResult('l', JSON.stringify([{ number: 7, state: 'closed' }])));
  assert.deepEqual(unwatchedPrs(text), []);
});

test('stopDecision: block reason tells the thread to read a closed PR with pull_request_read', () => {
  const root = makeRoot(DONE_ONLY);
  const transcriptPath = path.join(root, 'session.jsonl');
  fs.writeFileSync(transcriptPath, transcript(...openPr('a', 42)));
  try {
    const reason = stopDecision({ root, env: {}, payload: { transcript_path: transcriptPath } });
    assert.match(reason, /pull_request_read/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unwatchedPrs: subscribe sent in parallel with the open (before its result) counts as watched', () => {
  const text = transcript(
    JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'c', name: 'mcp__github__create_pull_request', input: {} },
      { type: 'tool_use', id: 's', name: 'mcp__claude-code-remote__subscribe_pr_activity', input: { pullNumber: 200 } },
    ] } }),
    toolResult('c', [{ type: 'text', text: 'https://github.com/acme/app/pull/200' }]),
    toolResult('s', 'Subscribed'),
  );
  assert.deepEqual(unwatchedPrs(text), []);
});

test('unwatchedPrs: send_later sent in parallel with the open counts as watched', () => {
  const text = transcript(
    JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'c', name: 'mcp__github__create_pull_request', input: {} },
      { type: 'tool_use', id: 'l', name: 'mcp__claude-code-remote__send_later', input: {} },
    ] } }),
    toolResult('c', [{ type: 'text', text: 'https://github.com/acme/app/pull/9' }]),
  );
  assert.deepEqual(unwatchedPrs(text), []);
});

test('unwatchedPrs: this session\'s real shape (subscribe beside create) is not flagged, but a later open still is', () => {
  const text = transcript(
    JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'c', name: 'mcp__github__create_pull_request', input: {} },
      { type: 'tool_use', id: 's', name: 'mcp__claude-code-remote__subscribe_pr_activity', input: { pullNumber: 5 } },
    ] } }),
    toolResult('c', [{ type: 'text', text: 'https://github.com/acme/app/pull/5' }]),
    ...openPr('d', 6),
  );
  assert.deepEqual(unwatchedPrs(text), [6]);
});

// Checklist and next-step stall (slice 19.201).
const CL = 'mcp__hearthbot__update_progress_checklist';
const OPEN_LIST = 'Title\n\n✓ a\n✱ b\n○ c';
const DONE_LIST = 'Title\n\n✓ a\n✓ b';
const checklist = (text) => toolUse('cl', CL, { text });

test('stalledPlan: open checklist steps with nothing after them blocks and names the next step', () => {
  const reason = stalledPlan(transcript(checklist(OPEN_LIST)));
  assert.match(reason, /unfinished/);
  assert.match(reason, /"b"/);
});

test('stalledPlan: all steps done allows stop', () => {
  assert.equal(stalledPlan(transcript(checklist(DONE_LIST))), '');
});

test('stalledPlan: open steps then send_later allows stop', () => {
  assert.equal(stalledPlan(transcript(checklist(OPEN_LIST), toolUse('s', 'mcp__hearthbot__send_later', { delaySeconds: 600 }))), '');
});

test('stalledPlan: open steps then request_decision allows stop', () => {
  assert.equal(stalledPlan(transcript(checklist(OPEN_LIST), toolUse('d', 'mcp__hearthbot__request_decision', { question: 'Go on?' }))), '');
});

test('stalledPlan: open steps then post_message with a question allows stop; without one blocks', () => {
  assert.equal(stalledPlan(transcript(checklist(OPEN_LIST), toolUse('p', 'mcp__hearthbot__post_message', { text: 'Ready to merge?' }))), '');
  assert.match(stalledPlan(transcript(checklist(OPEN_LIST), toolUse('p', 'mcp__hearthbot__post_message', { text: 'Working on it.' }))), /unfinished/);
});

test('stalledPlan: open steps then subscribe_pr_activity only still blocks', () => {
  assert.match(stalledPlan(transcript(checklist(OPEN_LIST), toolUse('s', 'mcp__github__subscribe_pr_activity', { pullNumber: 7 }))), /unfinished/);
});

test('stalledPlan: background Agent covers the stop; a foreground one does not', () => {
  assert.equal(stalledPlan(transcript(checklist(OPEN_LIST), toolUse('g', 'Agent', { prompt: 'x' }))), '');
  assert.match(stalledPlan(transcript(checklist(OPEN_LIST), toolUse('g', 'Agent', { prompt: 'x', run_in_background: false }))), /unfinished/);
});

test('stalledPlan: set_thread_resolved with resolved true allows stop', () => {
  assert.equal(stalledPlan(transcript(checklist(OPEN_LIST), toolUse('r', 'mcp__hearthbot__set_thread_resolved', { resolved: true }))), '');
});

test('stalledPlan: an all-done checklist after an earlier open one allows stop', () => {
  assert.equal(stalledPlan(transcript(checklist(OPEN_LIST), checklist(DONE_LIST))), '');
});

test('stalledPlan: a stated next step with no checklist blocks and quotes the phrase', () => {
  const reason = stalledPlan(transcript(toolUse('p', 'mcp__hearthbot__post_message', { text: 'Merged. Next is slice 3, the writes.' })));
  assert.match(reason, /Next is/);
});

test('stalledPlan: garbage lines and non-string input do not throw', () => {
  assert.equal(stalledPlan('{not json\nnull\n[1,2\n'), '');
  assert.equal(stalledPlan(''), '');
  assert.equal(stalledPlan(undefined), '');
});

test('stopDecision: stop_hook_active allows a stalled plan', () => {
  const root = makeRoot(DONE_ONLY);
  const transcriptPath = path.join(root, 'session.jsonl');
  fs.writeFileSync(transcriptPath, transcript(checklist(OPEN_LIST)));
  try {
    assert.equal(stopDecision({ root, env: {}, payload: { stop_hook_active: true, transcript_path: transcriptPath } }), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stopDecision: a stalled plan with no in-progress slice blocks', () => {
  const root = makeRoot(DONE_ONLY);
  const transcriptPath = path.join(root, 'session.jsonl');
  fs.writeFileSync(transcriptPath, transcript(checklist(OPEN_LIST)));
  try {
    assert.ok(stopDecision({ root, env: {}, payload: { transcript_path: transcriptPath } }).length > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stalledPlan: a stated next step followed by real work is not a stall', () => {
  const text = transcript(
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: "I'll run the tests now." }] } }),
    toolUse('b1', 'Bash', { command: 'npm test' }),
    toolResult('b1', 'ok'),
    toolUse('n1', 'mcp__hearthbot__no_reply_needed', { reason: 'nothing_to_add' }),
  );
  assert.equal(stalledPlan(text), '');
});

test('stalledPlan: a stated next step followed only by end-of-turn calls is a stall', () => {
  const text = transcript(
    toolUse('p1', 'mcp__hearthbot__post_message', { text: 'Merged. Next is slice 3.' }),
    toolUse('r1', 'mcp__hearthbot__unreact', { emoji: 'eyes' }),
  );
  assert.match(stalledPlan(text), /Next is/);
});

test('stalledPlan: a send_later earlier in the same turn as the checklist counts', () => {
  const text = transcript(
    JSON.stringify({ type: 'user', message: { content: 'wake' } }),
    toolUse('l1', 'mcp__claude-code-remote__send_later', { delay_minutes: 6 }),
    toolResult('l1', 'ok'),
    toolUse('c1', 'mcp__hearthbot__update_progress_checklist', { text: 'T\n\n✓ a\n✱ b' }),
  );
  assert.equal(stalledPlan(text), '');
});

test('stalledPlan: a send_later from an earlier turn does not cover a later checklist', () => {
  const text = transcript(
    toolUse('l1', 'mcp__claude-code-remote__send_later', { delay_minutes: 6 }),
    toolResult('l1', 'ok'),
    JSON.stringify({ type: 'user', message: { content: 'wake' } }),
    toolUse('c1', 'mcp__hearthbot__update_progress_checklist', { text: 'T\n\n✓ a\n✱ b' }),
  );
  assert.match(stalledPlan(text), /unfinished/);
});

// First-person next steps and decision cards (slice 19.203).
const assistantText = (text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const userPrompt = (text) => JSON.stringify({ type: 'user', message: { content: text } });
const DECISION_REASON_START = 'You posted a decision card and stopped.';
const decision = (id = 'd') => toolUse(id, 'mcp__hearthbot__request_decision', { question: 'Go on?' });
const noReply = (reason, id = 'n') => toolUse(id, 'mcp__hearthbot__no_reply_needed', { reason });

test('stalledPlan: "I\'ll check" in a post_message with nothing after blocks and quotes the phrase', () => {
  const reason = stalledPlan(transcript(toolUse('p', 'mcp__hearthbot__post_message', { text: "I'll check the undo first" })));
  assert.match(reason, /"I'll check"/);
});

test('stalledPlan: "Next I\'ll check" in assistant text blocks', () => {
  const reason = stalledPlan(transcript(assistantText('Merged. Next I\'ll check the logs.')));
  assert.match(reason, /Next I'll check/);
});

test('stalledPlan: curly apostrophe "I’ll check" in assistant text blocks', () => {
  const reason = stalledPlan(transcript(assistantText('Pushed. I’ll check the build.')));
  assert.match(reason, /I’ll check/);
});

test('stalledPlan: "I\'ll check" with "I will" and "I\'ll first" forms block', () => {
  assert.match(stalledPlan(transcript(assistantText('I will check the tests.'))), /I will check/);
  assert.match(stalledPlan(transcript(assistantText("I'll first check the diff."))), /I'll first check/);
});

test('stalledPlan: "Next, I\'ll" bare form blocks', () => {
  assert.match(stalledPlan(transcript(assistantText('Done with that. Next, I\'ll'))), /Next, I'll/);
});

test('stalledPlan: "I\'ll check" followed by a Read tool call is not a stall', () => {
  const text = transcript(
    assistantText("I'll check the file."),
    toolUse('r1', 'Read', { file_path: '/x/a.mjs' }),
    toolResult('r1', 'contents'),
    toolUse('n1', 'mcp__hearthbot__no_reply_needed', { reason: 'nothing_to_add' }),
  );
  assert.equal(stalledPlan(text), '');
});

test('parkedOnDecision: request_decision then no_reply_needed(nothing_to_add) blocks with the decision reason', () => {
  const reason = parkedOnDecision(transcript(decision(), noReply('nothing_to_add')));
  assert.ok(reason.startsWith(DECISION_REASON_START));
  assert.match(reason, /stop again\.$/);
});

test('parkedOnDecision: request_decision then a Read or Edit call allows', () => {
  assert.equal(parkedOnDecision(transcript(decision(), toolUse('r', 'Read', { file_path: '/x' }), toolResult('r', 'x'))), '');
  assert.equal(parkedOnDecision(transcript(decision(), toolUse('e', 'Edit', { file_path: '/x' }))), '');
});

test('parkedOnDecision: request_decision then send_later, create_trigger or ScheduleWakeup allows', () => {
  assert.equal(parkedOnDecision(transcript(decision(), toolUse('s', 'mcp__claude-code-remote__send_later', { delaySeconds: 600 }))), '');
  assert.equal(parkedOnDecision(transcript(decision(), toolUse('t', 'mcp__hearthbot__create_trigger', {}))), '');
  assert.equal(parkedOnDecision(transcript(decision(), toolUse('w', 'ScheduleWakeup', {}))), '');
});

test('parkedOnDecision: request_decision then only post_message, react or text blocks', () => {
  assert.ok(parkedOnDecision(transcript(decision(), toolUse('p', 'mcp__hearthbot__post_message', { text: 'FYI' }))).length > 0);
  assert.ok(parkedOnDecision(transcript(decision(), toolUse('r', 'mcp__hearthbot__react', { emoji: 'eyes' }), assistantText('Waiting.'))).length > 0);
});

test('parkedOnDecision: no_reply_needed with a quiet reason allows', () => {
  assert.equal(parkedOnDecision(transcript(decision(), noReply('asked_to_be_quiet'))), '');
  assert.equal(parkedOnDecision(transcript(decision(), noReply('not_for_me'))), '');
});

test('parkedOnDecision: request_decision in an earlier turn, then a new prompt and a finished turn does not block', () => {
  const text = transcript(decision(), userPrompt('thanks'), assistantText('Done.'));
  assert.equal(parkedOnDecision(text), '');
  assert.equal(stalledPlan(text), '');
});

test('parkedOnDecision: garbage and non-string input do not throw', () => {
  assert.equal(parkedOnDecision('{not json\nnull\n'), '');
  assert.equal(parkedOnDecision(''), '');
  assert.equal(parkedOnDecision(undefined), '');
});

test('stopDecision: decision card then a bare end blocks, and stop_hook_active allows', () => {
  const root = makeRoot(DONE_ONLY);
  const transcriptPath = path.join(root, 'session.jsonl');
  fs.writeFileSync(transcriptPath, transcript(decision(), noReply('nothing_to_add')));
  try {
    const payload = { transcript_path: transcriptPath };
    assert.match(stopDecision({ root, env: {}, payload }), /You posted a decision card and stopped\./);
    assert.equal(stopDecision({ root, env: {}, payload: { ...payload, stop_hook_active: true } }), '');
    assert.equal(stopDecision({ root, env: { CLAUDE_WAKE_SCHEDULED: '1' }, payload }), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hook run: decision card then a bare end emits a block on stdout', () => {
  const root = makeRoot(DONE_ONLY);
  const transcriptPath = path.join(root, 'session.jsonl');
  fs.writeFileSync(transcriptPath, transcript(decision(), noReply('nothing_to_add')));
  try {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
    delete env.CLAUDE_WAKE_SCHEDULED;
    delete env.CLAUDE_PR_SUBSCRIBED;
    const res = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: root, transcript_path: transcriptPath }), encoding: 'utf8', env });
    assert.equal(res.status, 0);
    assert.equal(JSON.parse(res.stdout).decision, 'block');
    const again = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: root, transcript_path: transcriptPath, stop_hook_active: true }), encoding: 'utf8', env });
    assert.equal(again.stdout, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stalledPlan: a stated step in a later turn is not covered by an earlier turn's question (tours thread 2026-11-18)", () => {
  const earlierTurn = [
    userPrompt('scope please'),
    checklist('Scope\n\n✓ a\n✓ b'),
    toolUse('q', 'mcp__hearthbot__post_message', { text: 'Of the 118 series, 88 are Festival. Which should change?' }),
    noReply('nothing_to_add', 'q2'),
  ];
  const laterTurn = [
    userPrompt('A and B, use the 9 above'),
    toolUse('g', 'mcp__hearthbot__post_message', { text: "Got it. I'll check the type-change undo first, then spec option A and option B in the repo." }),
    assistantText("Your message reached me. Next I'll check whether a series type change is logged and undoable, then write the spec."),
  ];
  const reason = stalledPlan(transcript(...earlierTurn, ...laterTurn));
  assert.ok(reason.length > 0);
  assert.match(reason, /I'll check|Next I'll check/);
  assert.equal(stalledPlan(transcript(...earlierTurn)), '');
  assert.equal(stalledPlan(transcript(...earlierTurn, ...laterTurn, toolUse('s', 'mcp__claude-code-remote__send_later', { delay_minutes: 10 }))), '');
});
