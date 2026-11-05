/**
 * Full tool telemetry: one record per tool call in .spec/.session-telemetry.json.
 * Shape: { "version": 1, "calls": [ { ts, tool, agentType, role, filePath, slice } ] }
 * Pure helpers plus file IO. Node built-ins only. Never imports the hooks (they run on import).
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseSliceLine } from './slice-parser.mjs';

const ACTIVE_TASK = /^\s*-\s*\[.\].*\[IN_PROGRESS\]/;
const SOURCE_WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

export function telemetryPath(root) {
  return path.join(root, '.spec', '.session-telemetry.json');
}

/** Same rule as isSourceFile in .harness/hooks/pre-tool-guard.mjs (copied, not imported). */
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

/** Same rule as resolveRole in .harness/hooks/pre-tool-guard.mjs (copied, not imported). */
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

/** Id of the single [IN_PROGRESS] slice in .spec/PROGRESS.md, or '' when there is none (or more than one). */
export function currentSliceId(root) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(root, '.spec', 'PROGRESS.md'), 'utf8');
  } catch {
    return '';
  }
  const active = text.split('\n').filter((line) => ACTIVE_TASK.test(line));
  if (active.length !== 1) return '';
  return parseSliceLine(active[0]).id || '';
}

/** Reads all recorded calls. Missing or unreadable file gives []. */
export function readCalls(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(telemetryPath(root), 'utf8'));
    return Array.isArray(parsed?.calls) ? parsed.calls : [];
  } catch {
    return [];
  }
}

/**
 * Appends one call. Never resets existing calls. Creates the file when missing.
 * A corrupt file is moved aside to a sibling .bak and telemetry starts fresh.
 */
export function appendCall(root, call) {
  const p = telemetryPath(root);
  let data = { version: 1, calls: [] };
  if (fs.existsSync(p)) {
    const text = fs.readFileSync(p, 'utf8');
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = { ...parsed, version: parsed.version ?? 1, calls: Array.isArray(parsed.calls) ? parsed.calls : [] };
    } else {
      fs.writeFileSync(`${p}.bak`, text, 'utf8');
    }
  }
  data.calls.push(call);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

const normPath = (f) => String(f || '').replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * Subagent dispatches (Agent or Task) recorded for the slice. A main-thread dispatch carries no
 * agent_type in its PostToolUse payload, so it is identified by dispatchedType (the subagent_type it was sent to).
 */
export function dispatchesFor(calls, sliceId) {
  return (calls || []).filter((c) =>
    (c.tool === 'Agent' || c.tool === 'Task') && c.slice === sliceId && Boolean(c.agentType || c.dispatchedType)
  );
}

/** Source-file writes made by the main thread (no agentType) for the slice. */
export function mainSourceWrites(calls, sliceId) {
  return (calls || []).filter((c) =>
    SOURCE_WRITE_TOOLS.includes(c.tool) &&
    !c.agentType &&
    c.slice === sliceId &&
    isSourceFile(normPath(c.filePath))
  );
}
