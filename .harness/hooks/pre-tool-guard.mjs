#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { modeOf, readCheckpoints, ensureBaseline, diffSince } from './lib/vibe.mjs';
import {
  agentsBlock, colourOf, isEngineLocked, isEnginePath, isHubOrigin, nextContent,
} from './lib/guard-rules.mjs';
import { appendBatchEvent } from '../scripts/status-batch.mjs';
import { writeJsonAtomic } from '../scripts/lib/telemetry.mjs';
import { clearUpshiftAuth, verifyUpshiftAuth } from '../scripts/evaluate-upshift.mjs';
import { normalizePayload } from './adapter.mjs';
import { currentHead, ensureDoctorState } from '../scripts/doctor.mjs';
import { gateDecision } from './lib/doctor-state.mjs';

const gitIn = (cwd, args, env = {}) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, ...env } }).trim();
const gitRoot = () => { try { return gitIn(process.cwd(), ['rev-parse', '--show-toplevel']); } catch { return ''; } };

const CHECKPOINT_REF = 'refs/harness/slice-checkpoint';
const ACTIVE_TASK = /^\s*-\s*\[.\].*\[IN_PROGRESS\]/;

export const activeTargets = (line) => {
  const match = line?.match(/Target files:\s*([^|\n]+)/i);
  if (!match) return [];
  return match[1]
    .replace(/\[NEW\]/gi, '')
    .replace(/\[DELETE\]/gi, '')
    .replace(/[`*]/g, '')
    .split(',')
    .map((s) => s.trim().replace(/^\.\//, ''))
    .filter(Boolean);
};

export function resolveRole(event = {}) {
  const agentField = String(
    event.agent_type ||
    event.agent ||
    event.subagent ||
    event.agent_name ||
    event.tool_input?.subagent_type ||
    event.tool_input?.name ||
    process.env.HARNESS_ROLE ||
    process.env.CLAUDE_AGENT ||
    process.env.AGENT_ROLE ||
    ''
  ).toLowerCase();

  if (agentField.includes('goldfish') || agentField.includes('gf-')) return 'goldfish';
  if (agentField.includes('elephant') || agentField.includes('architect') || agentField.includes('el-')) return 'elephant';
  if (agentField.includes('librarian') || agentField.includes('navigator')) return 'librarian';
  if (agentField.includes('git-clerk') || agentField.includes('gitclerk') || agentField.includes('gf-clerk')) return 'git-clerk';
  return 'coordinator';
}

export function loadThresholds(projectRoot) {
  const p = path.join(projectRoot, '.harness', 'config', 'thresholds.json');
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
  }
  return {
    fa_fast_path: {
      max_source_reads: 3,
      max_reads: 3,
      max_searches: 1,
      max_edits: 1,
      max_single_file_edit_lines: 25,
      max_edit_lines: 25
    },
    gf_circuit_breaker: {
      max_exploratory_searches: 2,
      max_searches: 2,
      max_test_failure_strikes: 2,
      max_strikes: 2,
      max_mutating_calls: 15
    }
  };
}

export function isSourceFile(rel) {
  const clean = String(rel || '').replace(/^\.\//, '');
  if (!clean) return false;
  if (clean.startsWith('.spec/') || clean.startsWith('.harness/') || clean.startsWith('.claude/')) {
    return false;
  }
  const specOrCatalogDocs = ['AGENTS.md', 'CLAUDE.md', 'README.md', '.gitignore', '.geminiignore'];
  if (specOrCatalogDocs.includes(clean)) {
    return false;
  }
  return true;
}

export function checkFastPathBudget({ role, toolName, targetFile, editLines = 0, telemetry = {}, thresholds = {} }) {
  if (role !== 'coordinator') {
    return { allowed: true };
  }

  const fastPath = thresholds.fa_fast_path || thresholds.fast_path || thresholds.shepherd_fast_path || {
    max_source_reads: 3,
    max_reads: 3,
    max_searches: 1,
    max_edits: 1,
    max_single_file_edit_lines: 25,
    max_edit_lines: 25
  };
  const maxReads = fastPath.max_source_reads ?? fastPath.max_reads ?? 3;
  const maxSearches = fastPath.max_searches ?? 1;
  const maxEdits = fastPath.max_edits ?? 1;
  const maxEditLines = fastPath.max_single_file_edit_lines ?? fastPath.max_edit_lines ?? 25;

  if (['Read', 'View'].includes(toolName)) {
    if (isSourceFile(targetFile)) {
      const nextCount = (telemetry.coordinator_reads || 0) + 1;
      if (nextCount > maxReads) {
        return {
          allowed: false,
          reason: `FAST-PATH BUDGET EXCEEDED: Coordinator attempted ${nextCount} source reads (max ${maxReads}). Delegate this task to gf-coder or el-architect.`
        };
      }
    }
  }

  if (['Grep', 'Glob', 'WebSearch'].includes(toolName)) {
    const nextCount = (telemetry.coordinator_searches || 0) + 1;
    if (nextCount > maxSearches) {
      return {
        allowed: false,
        reason: `FAST-PATH BUDGET EXCEEDED: Coordinator attempted ${nextCount} searches (max ${maxSearches}). Delegate this task to gf-coder or el-architect.`
      };
    }
  }

  if (['Edit', 'Write', 'NotebookEdit'].includes(toolName)) {
    if (isSourceFile(targetFile)) {
      const nextCount = (telemetry.coordinator_edits || 0) + 1;
      if (nextCount > maxEdits) {
        return {
          allowed: false,
          reason: `FAST-PATH BUDGET EXCEEDED: Coordinator attempted ${nextCount} source edits (max ${maxEdits}). Fast-path allows at most 1 single-file edit. Delegate to gf-coder.`
        };
      }
      if (editLines > maxEditLines) {
        return {
          allowed: false,
          reason: `FAST-PATH BUDGET EXCEEDED: Coordinator edit has ${editLines} lines (max ${maxEditLines}). Delegate to gf-coder.`
        };
      }
    }
  }

  return { allowed: true };
}

export function checkSearchBudget({ role, telemetry = {}, thresholds = {} }) {
  if (role === 'goldfish') {
    const cb = thresholds.gf_circuit_breaker || thresholds.circuit_breaker || thresholds.goldfish_circuit_breaker || {};
    const maxSearches = cb.max_exploratory_searches ?? cb.max_searches ?? 2;
    const nextCount = (telemetry.goldfish_searches || 0) + 1;
    if (nextCount > maxSearches) {
      return {
        allowed: false,
        count: nextCount,
        reason: `CIRCUIT BREAKER: Goldfish search budget exceeded (${nextCount} searches, max ${maxSearches}). Escalate to Tier 1 Architect or freeze black box.`
      };
    }
  }

  if (role === 'coordinator') {
    const fp = thresholds.fa_fast_path || thresholds.fast_path || thresholds.shepherd_fast_path || {};
    const maxSearches = fp.max_searches ?? 1;
    const nextCount = (telemetry.coordinator_searches || 0) + 1;
    if (nextCount > maxSearches) {
      return {
        allowed: false,
        count: nextCount,
        reason: `FAST-PATH BUDGET EXCEEDED: Coordinator attempted ${nextCount} searches (max ${maxSearches}). Delegate this task to gf-coder or el-architect.`
      };
    }
  }

  return { allowed: true };
}

export function checkTargetFileScope({ relTarget, allowedTargets = [], role = 'goldfish' }) {
  const clean = relTarget.replace(/^\.\//, '');
  const stateFiles = ['.spec/PROGRESS.md', '.spec/ATLAS.md', '.spec/archive/HISTORY.md'];
  if (role === 'goldfish' && stateFiles.includes(clean)) {
    return {
      allowed: false,
      reason: 'DENIED: gf-coder cannot modify .spec/PROGRESS.md or Atlas state files. Leave [IN_PROGRESS] untouched; finish-slice.mjs transitions state automatically.'
    };
  }

  if (relTarget === '.spec/PROGRESS.md') return { allowed: true };
  if (!allowedTargets || allowedTargets.length === 0) return { allowed: true };

  const isAllowed = allowedTargets.some((target) => {
    const cleanTarget = target.replace(/^\.\//, '');
    return clean === cleanTarget || clean.startsWith(cleanTarget.endsWith('/') ? cleanTarget : `${cleanTarget}/`);
  });

  if (!isAllowed) {
    return {
      allowed: false,
      reason: `SCOPE LOCK BLOCK: "${clean}" is not listed in the active slice's Target files (${allowedTargets.join(', ')}). Update .spec/PROGRESS.md first if this file is required.`
    };
  }

  return { allowed: true };
}

// Execution Entry Point
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  let root = process.env.CLAUDE_PROJECT_DIR || gitRoot() || process.cwd();
  let progressPath = path.join(root, '.spec', 'PROGRESS.md');
  let checkpointFile = path.join(root, '.spec', '.slice-checkpoint');

  function repoRootOf(absFile) {
    let dir = path.dirname(absFile);
    while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
    try { return gitIn(dir, ['rev-parse', '--show-toplevel']); } catch { return ''; }
  }
  function useRepo(dir) {
    root = dir;
    progressPath = path.join(dir, '.spec', 'PROGRESS.md');
    checkpointFile = path.join(dir, '.spec', '.slice-checkpoint');
  }
  const git = (args, env) => gitIn(root, args, env);

  function readTelemetry(repoRoot, currentSlice, sessionId = 'default') {
    const p = path.join(repoRoot, '.spec', '.session-telemetry.json');
    let data = {
      sessionId,
      totalToolCalls: 0,
      mutatingCallsOnSlice: 0,
      currentSlice: currentSlice || '',
      slicesCommitted: 0,
      coordinator_reads: 0,
      coordinator_searches: 0,
      coordinator_edits: 0,
      goldfish_searches: 0
    };
    if (fs.existsSync(p)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        data = { ...data, ...parsed };
        if (currentSlice && data.currentSlice !== currentSlice) {
          data.currentSlice = currentSlice;
          data.goldfish_searches = 0;
          data.coordinator_reads = 0;
          data.coordinator_searches = 0;
          data.coordinator_edits = 0;
        }
      } catch {}
    }
    return data;
  }

  function writeTelemetry(repoRoot, data) {
    writeJsonAtomic(path.join(repoRoot, '.spec', '.session-telemetry.json'), data);
  }

  function captureCheckpoint() {
    const tmpIndex = path.join(os.tmpdir(), `harness-index-${process.pid}`);
    const env = { GIT_INDEX_FILE: tmpIndex };
    try {
      let head = '';
      try { head = git(['rev-parse', '--verify', 'HEAD']); } catch {}
      if (head) git(['read-tree', head], env);
      git(['add', '-A', '--', '.'], env);
      const tree = git(['write-tree'], env);
      const identity = { GIT_AUTHOR_NAME: 'claude-harness', GIT_AUTHOR_EMAIL: 'harness@localhost', GIT_COMMITTER_NAME: 'claude-harness', GIT_COMMITTER_EMAIL: 'harness@localhost' };
      const commit = git(['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', 'harness: slice-start checkpoint'], identity);
      git(['update-ref', CHECKPOINT_REF, commit]);
      fs.mkdirSync(path.dirname(checkpointFile), { recursive: true });
      fs.writeFileSync(checkpointFile, commit, 'utf8');
    } catch {
    } finally {
      fs.rmSync(tmpIndex, { force: true });
    }
  }

  function restoreVibe() {
    const all = readCheckpoints(root);
    const sid = process.env.CLAUDE_SESSION_ID;
    const entry = all[sid] || Object.values(all).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    if (!entry?.sha) {
      console.log('✗ Nothing restored: no Vibe checkpoint exists for this project yet.');
      process.exit(1);
    }
    const { restore, remove } = diffSince(root, entry.sha);
    if (!entry.green) {
      const all2 = [...restore, ...remove];
      console.log(`⚠ Nothing has passed yet this session, so nothing was restored. ${all2.length} file(s) changed since the session baseline${all2.length ? `: ${all2.join(', ')}` : ''}. Offer the user a restore in the "Needed from you:" block.`);
      process.exit(0);
    }
    if (restore.length) git(['restore', `--source=${entry.sha}`, '--worktree', '--', ...restore]);
    for (const file of remove) fs.rmSync(path.join(root, file), { force: true });
    console.log(`✓ Restored ${restore.length} file(s) to the last green checkpoint${remove.length ? `; removed ${remove.length} file(s) created since (${remove.join(', ')})` : ''}.`);
    process.exit(0);
  }

  // `node .harness/hooks/pre-tool-guard.mjs --restore`
  if (process.argv[2] === '--restore') {
    const lines = fs.existsSync(progressPath) ? fs.readFileSync(progressPath, 'utf8').split('\n') : [];
    if (!lines.some((line) => ACTIVE_TASK.test(line))) restoreVibe();
    const targets = activeTargets(lines.find((line) => ACTIVE_TASK.test(line)));
    if (!targets.length) {
      console.log('✗ Nothing restored: no [IN_PROGRESS] task with "Target files:" in .spec/PROGRESS.md.');
      process.exit(1);
    }
    let source = fs.existsSync(checkpointFile) ? fs.readFileSync(checkpointFile, 'utf8').trim() : '';
    try { if (source) git(['cat-file', '-e', `${source}^{commit}`]); } catch { source = ''; }
    const hasCheckpoint = Boolean(source);
    const label = hasCheckpoint ? 'slice-start checkpoint' : 'last commit (no checkpoint found; new files left in place)';
    source ||= 'HEAD';

    const listAt = (rel) => {
      let inSource = [];
      try { inSource = git(['ls-tree', '-r', '--name-only', source, '--', rel]).split('\n').filter(Boolean); } catch {}
      let onDisk = [];
      try { onDisk = git(['ls-files', '--cached', '--others', '--exclude-standard', '--', rel]).split('\n').filter(Boolean); } catch {}
      return { inSource, onDisk };
    };
    const restored = [];
    const removed = [];
    for (const rel of targets) {
      const { inSource, onDisk } = listAt(rel);
      if (inSource.length) {
        git(['restore', `--source=${source}`, '--worktree', '--', ...inSource]);
        restored.push(...inSource);
      }
      if (!hasCheckpoint) continue;
      for (const file of onDisk.filter((f) => !inSource.includes(f))) {
        fs.rmSync(path.join(root, file), { force: true });
        removed.push(file);
      }
    }
    const msg = `✓ Restored ${restored.length} file(s) to the ${label}${removed.length ? `; removed ${removed.length} file(s) the slice created (${removed.join(', ')})` : ''}.`;
    appendBatchEvent(root, { event: 'slice_restore', summary: msg });
    console.log(msg);
    process.exit(0);
  }

  let event = {};
  if (!process.stdin.isTTY) {
    try {
      event = normalizePayload(JSON.parse(fs.readFileSync(0, 'utf8')));
    } catch {
      process.exit(0);
    }
  }

  // Live doctor gate: edits and non-allow-listed Bash need a DOCTOR_PASS for the current HEAD
  const gateHead = currentHead(root);
  const doctorState = ensureDoctorState({ root, head: gateHead });
  const gate = gateDecision({
    state: doctorState,
    head: gateHead,
    toolName: event.tool_name,
    command: event.tool_input?.command,
  });
  if (!gate.allowed) {
    console.error(gate.reason);
    process.exit(2);
  }

  const role = resolveRole(event);
  const thresholds = loadThresholds(root);

  // Guard 0: Block silent subagent upshifts
  if (event.tool_name === 'Agent' || event.tool_name === 'Task') {
    const subagentType = String(event.tool_input?.subagent_type || event.tool_input?.name || '').trim();
    if (subagentType === 'architect-opus') {
      const scoutPath = path.join(root, '.spec', 'SCOUT.md');
      let allowed = false;
      if (fs.existsSync(scoutPath)) {
        const scoutText = fs.readFileSync(scoutPath, 'utf8');
        if (/Level:\s*3|Scout-Level:\s*3|Model:\s*opus/i.test(scoutText)) {
          allowed = true;
        }
      }
      if (!allowed) {
        console.error('UPSHIFT LOCK VIOLATION: architect-opus requires Level 3 in .spec/SCOUT.md or explicit operator authorization.');
        process.exit(2);
      }
      process.exit(0);
    }
    if (subagentType === 'engineer-sonnet') {
      const scoutPath = path.join(root, '.spec', 'SCOUT.md');
      let allowed = false;
      if (fs.existsSync(scoutPath)) {
        const scoutText = fs.readFileSync(scoutPath, 'utf8');
        if (/Level:\s*[23]|Scout-Level:\s*[23]|Model:\s*(sonnet|opus)/i.test(scoutText)) {
          allowed = true;
        }
      }
      if (!allowed && fs.existsSync(scoutPath)) {
        console.error('UPSHIFT LOCK VIOLATION: engineer-sonnet requires Level 2 or 3 in .spec/SCOUT.md.');
        process.exit(2);
      }
      process.exit(0);
    }
    process.exit(0);
  }

  // Active slice name for telemetry
  let activeSliceName = '';
  if (fs.existsSync(progressPath)) {
    try {
      const lines = fs.readFileSync(progressPath, 'utf8').split('\n');
      const active = lines.find((l) => ACTIVE_TASK.test(l));
      activeSliceName = active?.match(/\*\*Slice\s+([^*]+)\*\*/)?.[1]?.trim() || '';
    } catch {}
  }

  let telemetry = readTelemetry(root, activeSliceName, event.session_id);

  // Searches (Grep / Glob / WebSearch) circuit breakers and fast-path budget
  if (['Grep', 'Glob', 'WebSearch'].includes(event.tool_name)) {
    const searchCheck = checkSearchBudget({ role, telemetry, thresholds });
    if (!searchCheck.allowed) {
      console.error(searchCheck.reason);
      process.exit(2);
    }
    if (role === 'goldfish') {
      telemetry.goldfish_searches = (telemetry.goldfish_searches || 0) + 1;
    } else if (role === 'coordinator') {
      telemetry.coordinator_searches = (telemetry.coordinator_searches || 0) + 1;
    }
    writeTelemetry(root, telemetry);
    process.exit(0);
  }

  const targetFile = event.tool_input?.file_path || event.tool_input?.notebook_path || '';
  if (!targetFile) process.exit(0);

  function canonicalPath(p) {
    const abs = path.resolve(p);
    let cur = abs;
    const tail = [];
    while (!fs.existsSync(cur) && path.dirname(cur) !== cur) {
      tail.unshift(path.basename(cur));
      cur = path.dirname(cur);
    }
    try { cur = fs.realpathSync(cur); } catch {}
    return path.join(cur, ...tail);
  }

  const fileRepo = repoRootOf(path.resolve(root, targetFile));
  if (fileRepo) useRepo(canonicalPath(fileRepo));
  else useRepo(canonicalPath(root));

  const absTarget = canonicalPath(path.resolve(root, targetFile));
  const relTarget = path.relative(root, absTarget).replace(/\\/g, '/');

  if (relTarget.startsWith('../') || path.isAbsolute(relTarget)) process.exit(0);

  if (modeOf(root) === 'vibe') ensureBaseline(root, event.session_id || 'default');

  if (['Read', 'View'].includes(event.tool_name)) {
    if (role === 'coordinator') {
      const budgetCheck = checkFastPathBudget({ role, toolName: 'Read', targetFile: relTarget, telemetry, thresholds });
      if (!budgetCheck.allowed) {
        console.error(budgetCheck.reason);
        process.exit(2);
      }
      if (isSourceFile(relTarget)) {
        telemetry.coordinator_reads = (telemetry.coordinator_reads || 0) + 1;
        writeTelemetry(root, telemetry);
      }
    }
    process.exit(0);
  }

  // Hard State-File Lockout for goldfish workers
  const stateFiles = ['.spec/PROGRESS.md', '.spec/ATLAS.md', '.spec/archive/HISTORY.md'];
  if (role === 'goldfish' && stateFiles.includes(relTarget)) {
    console.error('DENIED: gf-coder cannot modify .spec/PROGRESS.md or Atlas state files. Leave [IN_PROGRESS] untouched; finish-slice.mjs transitions state automatically.');
    process.exit(2);
  }

  // 1. If editing .spec/PROGRESS.md itself
  if (relTarget === '.spec/PROGRESS.md') {
    const currentContent = fs.existsSync(progressPath) ? fs.readFileSync(progressPath, 'utf8') : '';
    const incoming = nextContent(currentContent, event.tool_name, event.tool_input || {});
    const activeTaskLines = incoming.split('\n').filter((line) => ACTIVE_TASK.test(line));

    if (activeTaskLines.length > 1) {
      console.error('WORK LOCK VIOLATION: Cannot mark more than 1 task line as [IN_PROGRESS] in .spec/PROGRESS.md.');
      process.exit(2);
    }
    const sliceId = (line) => line?.match(/\*\*Slice\s+([^*]+)\*\*/)?.[1].trim() ?? line?.trim();
    const previousActive = currentContent.split('\n').find((line) => ACTIVE_TASK.test(line));
    const nowActive = activeTaskLines[0];
    if (activeTaskLines.length === 1 && previousActive && sliceId(nowActive) === sliceId(previousActive)
      && colourOf(nowActive) !== colourOf(previousActive)) {
      console.error(`COLOUR LOCK: The colour tag on the active slice is frozen at /spec. Keep ${colourOf(previousActive) || 'its current tag'}; only the architect changes it.`);
      process.exit(2);
    }
    const prevId = sliceId(previousActive);
    const nextId = sliceId(activeTaskLines[0]);
    if (previousActive && prevId !== nextId) {
      const completedNow = incoming.split('\n').some((l) => /^\s*-\s*\[x\]/i.test(l) && sliceId(l) === prevId);
      if (completedNow) {
        clearUpshiftAuth(root);
        appendBatchEvent(root, {
          event: 'slice_complete',
          slice: `Slice ${prevId}`,
          summary: `Completed Slice ${prevId}`
        });
      }
    }
    if (activeTaskLines.length === 1 && nextId !== prevId) {
      captureCheckpoint();
      appendBatchEvent(root, {
        event: 'slice_start',
        slice: `Slice ${nextId}`,
        summary: `Locked and started Slice ${nextId} (checkpoint saved)`
      });
    }
    process.exit(0);
  }

  // 2. Engine lock
  let origin = '';
  try { origin = git(['remote', 'get-url', 'origin']); } catch {}
  const isHubRepo = isHubOrigin(origin);
  if (!isHubRepo && isEngineLocked(relTarget)) {
    console.error(`ENGINE LOCK: ${relTarget} is owned by the harness hub. Change it in claude-harness-hub, then run node .harness/scripts/hub-sync.mjs pull.`);
    process.exit(2);
  }
  if (!isHubRepo && relTarget === 'AGENTS.md') {
    const current = fs.existsSync(absTarget) ? fs.readFileSync(absTarget, 'utf8') : '';
    const next = nextContent(current, event.tool_name, event.tool_input || {});
    if (agentsBlock(current) !== agentsBlock(next)) {
      console.error('ENGINE LOCK: The harness block in AGENTS.md is hub-owned. Edit the text outside the markers, or change the block in claude-harness-hub.');
      process.exit(2);
    }
  }

  if (role !== 'goldfish' && (relTarget.startsWith('.spec/') || relTarget === 'CLAUDE.md' || relTarget === '.claude/project-rules.md')) {
    process.exit(0);
  }

  if (modeOf(root) === 'locked') {
    console.error('PLAN LOCK: No task is marked [IN_PROGRESS] in .spec/PROGRESS.md. Run /triage or /spec first.');
    process.exit(2);
  }

  // Fast-path budget check for Coordinator on Edits
  if (role === 'coordinator' && ['Edit', 'Write', 'NotebookEdit'].includes(event.tool_name)) {
    let editLines = 0;
    if (['Write', 'NotebookEdit'].includes(event.tool_name)) {
      editLines = (event.tool_input?.content || '').split('\n').length;
    } else if (event.tool_name === 'Edit') {
      editLines = (event.tool_input?.new_string || '').split('\n').length;
    }

    const editCheck = checkFastPathBudget({
      role,
      toolName: event.tool_name,
      targetFile: relTarget,
      editLines,
      telemetry,
      thresholds
    });

    if (!editCheck.allowed) {
      console.error(editCheck.reason);
      process.exit(2);
    }

    if (isSourceFile(relTarget)) {
      telemetry.coordinator_edits = (telemetry.coordinator_edits || 0) + 1;
      writeTelemetry(root, telemetry);
    }
  }

  // 3. Active slice target lock & goldfish-coder boundaries
  if (fs.existsSync(progressPath)) {
    const lines = fs.readFileSync(progressPath, 'utf8').split('\n');
    const activeLines = lines.filter((line) => ACTIVE_TASK.test(line));

    if (activeLines.length > 1) {
      console.error('WORK LOCK VIOLATION: Multiple tasks are marked [IN_PROGRESS] in .spec/PROGRESS.md. Keep only 1 active slice (or clear them all for Vibe Mode), then retry.');
      process.exit(2);
    }

    if (activeLines.length === 1) {
      const allowedList = activeTargets(activeLines[0]);
      const scopeCheck = checkTargetFileScope({ relTarget, allowedTargets: allowedList, role });
      if (!scopeCheck.allowed) {
        console.error(scopeCheck.reason);
        process.exit(2);
      }
    }
  }

  if (isHubRepo && isEnginePath(relTarget) && ['vibe', 'slice'].includes(modeOf(root))) {
    process.exit(0);
  }

  process.exit(0);
}
