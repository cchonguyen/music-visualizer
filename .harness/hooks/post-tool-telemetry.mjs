#!/usr/bin/env node
// PostToolUse: append one call record to .spec/.session-telemetry.json. Never throws, never blocks.
import fs from 'node:fs';
import path from 'node:path';
import { resolveRoot } from './lib/vibe.mjs';
import { appendCall, currentSliceId, resolveRole } from '../scripts/lib/telemetry.mjs';

try {
  let event = {};
  try { event = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
  const root = resolveRoot();
  const input = event.tool_input || {};
  const toolName = String(event.tool_name || '');
  const isDispatch = toolName === 'Agent' || toolName === 'Task';
  const raw = String(input.file_path || input.path || '');
  let filePath = raw;
  if (raw) {
    const rel = path.relative(root, path.resolve(root, raw)).replace(/\\/g, '/');
    if (rel && !rel.startsWith('../') && !path.isAbsolute(rel)) filePath = rel;
  }
  appendCall(root, {
    ts: new Date().toISOString(),
    tool: toolName,
    agentType: String(event.agent_type || ''),
    dispatchedType: isDispatch ? String(input.subagent_type || input.name || '') : '',
    role: resolveRole(event),
    filePath,
    slice: currentSliceId(root),
  });
} catch {
  // Telemetry must never break a tool call.
}
process.exit(0);
