#!/usr/bin/env node
// Universal Hook Adapter
// Standardizes input across platforms (Claude Code STDIN JSON vs Antigravity/Gemini environment/CLI).
// Normalizes tool_name and tool_input, then delegates to the appropriate .harness/hooks/ script.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function normalizeToolName(toolName) {
  if (!toolName || typeof toolName !== 'string') return '';
  const lower = toolName.toLowerCase().replace(/[_-]/g, '');
  if (['runcommand', 'bash', 'shell', 'exec'].includes(lower)) return 'Bash';
  if (['viewfile', 'readfile', 'read', 'view', 'cat'].includes(lower)) return 'Read';
  if (['editfile', 'edit', 'replace'].includes(lower)) return 'Edit';
  if (['writefile', 'write', 'createfile'].includes(lower)) return 'Write';
  if (['notebookedit', 'notebook'].includes(lower)) return 'NotebookEdit';
  if (['sendmessage', 'agent', 'task', 'dispatch'].includes(lower)) return 'Agent';
  if (['grepsearch', 'searchfiles', 'grep'].includes(lower)) return 'Grep';
  if (['filesearch', 'findbyname', 'glob'].includes(lower)) return 'Glob';
  if (['searchweb', 'websearch'].includes(lower)) return 'WebSearch';
  return toolName;
}

export function normalizeToolInput(normToolName, input = {}) {
  const result = { ...input };
  if (normToolName === 'Bash') {
    result.command = input.CommandLine || input.command || input.cmd || '';
  } else if (normToolName === 'Read') {
    result.file_path = input.AbsolutePath || input.Path || input.path || input.file_path || '';
  } else if (normToolName === 'Edit') {
    result.file_path = input.Path || input.AbsolutePath || input.path || input.file_path || '';
    result.old_string = input.Target !== undefined ? input.Target : input.old_string;
    result.new_string = input.Replacement !== undefined ? input.Replacement : input.new_string;
  } else if (normToolName === 'Write') {
    result.file_path = input.Path || input.AbsolutePath || input.path || input.file_path || '';
    result.content = input.Content !== undefined ? input.Content : (input.content !== undefined ? input.content : '');
  } else if (normToolName === 'NotebookEdit') {
    result.notebook_path = input.NotebookPath || input.notebook_path || input.Path || input.path || '';
    result.file_path = result.notebook_path;
    result.action = input.Action || input.action || '';
    result.cell_index = input.CellIndex !== undefined ? input.CellIndex : input.cell_index;
    result.content = input.Content !== undefined ? input.Content : input.content;
  } else if (normToolName === 'Agent') {
    result.subagent_type = input.Recipient || input.subagent_type || input.name || '';
    result.name = result.subagent_type;
    result.prompt = input.Message || input.prompt || input.input || '';
  }
  return result;
}

export function normalizePayload(event = {}) {
  const toolNameRaw = event.tool_name || event.toolName || event.tool || '';
  const toolInputRaw = event.tool_input || event.toolInput || event.input || {};
  const normToolName = normalizeToolName(toolNameRaw);
  const normToolInput = normalizeToolInput(normToolName, toolInputRaw);

  return {
    ...event,
    tool_name: normToolName,
    tool_input: normToolInput,
    session_id: event.session_id || event.sessionId || process.env.CLAUDE_SESSION_ID || 'default',
    agent: event.agent || event.subagent || event.agent_name || process.env.CLAUDE_AGENT || process.env.HARNESS_ROLE || ''
  };
}

export function resolveScript(scriptArg, baseDir = path.dirname(fileURLToPath(import.meta.url))) {
  if (path.isAbsolute(scriptArg)) return scriptArg;
  const inHooks = path.resolve(baseDir, scriptArg);
  if (fs.existsSync(inHooks)) return inHooks;
  const inCwd = path.resolve(process.cwd(), scriptArg);
  if (fs.existsSync(inCwd)) return inCwd;
  return inHooks;
}

// CLI Execution Entry Point
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  const targetScriptArg = process.argv[2];
  if (!targetScriptArg) {
    console.error('Universal Hook Adapter: Missing target hook script argument.');
    process.exit(1);
  }

  const scriptPath = resolveScript(targetScriptArg);
  const extraArgs = process.argv.slice(3);

  let rawInput = '';
  if (!process.stdin.isTTY) {
    try {
      rawInput = fs.readFileSync(0, 'utf8');
    } catch {}
  }

  let normalizedInput = rawInput;
  if (rawInput && rawInput.trim()) {
    try {
      const parsed = JSON.parse(rawInput);
      const normalized = normalizePayload(parsed);
      normalizedInput = JSON.stringify(normalized);
    } catch {
      normalizedInput = rawInput;
    }
  }

  const child = spawnSync(process.execPath, [scriptPath, ...extraArgs], {
    input: normalizedInput,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit'],
    env: process.env
  });

  process.exit(child.status !== null ? child.status : (child.error ? 1 : 0));
}
