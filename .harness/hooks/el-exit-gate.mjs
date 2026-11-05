#!/usr/bin/env node
// SubagentStop Exit Gate for Tier 1 el-architect
// Verifies .spec/PROGRESS.md has valid Target files:, valid Coords:, and a Verify: command for every slice.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRoot } from './lib/vibe.mjs';
import { validateSliceLine } from '../scripts/lib/slice-parser.mjs';

export const ATLAS_COORDS_REGEX = /\|\s*Coords:\s*\[([0-9,\s]+)\]/;

export function validateProgressSlices(progressContent, atlasContent, { openOnly = false } = {}) {
  const errors = [];
  const lines = progressContent.split('\n');

  // Match slices: - [ ] **Slice X... or - [x] **Slice X...
  const sliceRegex = /^\s*-\s*\[([ xX])\]\s*\*\*Slice\s+([^:*]+)(?::\s*([^*]+))?\*\*(.*)$/;

  const slices = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(sliceRegex);
    if (match) {
      slices.push({
        lineNum: i + 1,
        line,
        isCompleted: match[1].toLowerCase() === 'x',
        sliceId: match[2].trim(),
        title: (match[3] || '').trim(),
        rest: match[4] || ''
      });
    }
  }

  if (slices.length === 0) {
    errors.push('No declared slices found in .spec/PROGRESS.md.');
    return { valid: false, errors, slicesCount: 0 };
  }

  const checked = openOnly ? slices.filter((s) => !s.isCompleted) : slices;

  for (const slice of checked) {
    const label = `Slice ${slice.sliceId}`;

    // 1. Target files:
    const targetMatch = slice.rest.match(/Target files:\s*([^|\n]+)/i);
    if (!targetMatch) {
      errors.push(`${label}: Missing "Target files:" declaration.`);
    } else {
      const targetStr = targetMatch[1].replace(/[`*]/g, '').trim();
      const targets = targetStr.split(',').map((t) => t.trim()).filter(Boolean);
      if (targets.length === 0) {
        errors.push(`${label}: "Target files:" declaration is empty.`);
      }
    }

    // 2. Coords: (or fallback Refs:)
    const coordsMatch = slice.rest.match(/(?:Coords|Refs):\s*(\[[^\]]+\]|[^|\n]+)/i);
    if (!coordsMatch) {
      errors.push(`${label}: Missing "Coords:" declaration.`);
    } else {
      const coordsStr = coordsMatch[1].replace(/[[\]`]/g, '').trim();
      if (!coordsStr) {
        errors.push(`${label}: "Coords:" declaration is empty.`);
      }
    }

    // 3. Verify:
    const verifyMatch = slice.rest.match(/Verify:\s*([^|\n]+)/i);
    if (!verifyMatch) {
      errors.push(`${label}: Missing "Verify:" command.`);
    } else {
      const verifyCmd = verifyMatch[1].trim();
      if (!verifyCmd) {
        errors.push(`${label}: "Verify:" command is empty.`);
      }
    }

    // 4. Canonical slice validation (no .spec/PROGRESS.md in targets, coords exist in atlas)
    const sliceRes = validateSliceLine(slice.line, atlasContent);
    if (!sliceRes.valid) {
      for (const err of sliceRes.errors) {
        errors.push(`${label}: ${err}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    slicesCount: checked.length
  };
}

// CLI Execution Entry Point
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  let event = {};
  if (!process.stdin.isTTY) {
    try {
      event = JSON.parse(fs.readFileSync(0, 'utf8'));
    } catch {}
  }

  // Claude Code sends agent_type on SubagentStop; the gate only applies to el-architect.
  if (event.stop_hook_active === true) process.exit(0);

  const agent = String(
    event.agent_type ||
    event.agent ||
    event.subagent_type ||
    event.subagent ||
    event.name ||
    process.env.HARNESS_ROLE ||
    process.env.CLAUDE_AGENT ||
    ''
  ).toLowerCase();

  // If invoked with a known non-architect subagent, pass through
  if (agent && !agent.includes('elephant') && !agent.includes('architect') && !agent.includes('el-')) {
    process.exit(0);
  }

  const root = resolveRoot();
  const progressPath = process.argv[2] && !process.argv[2].startsWith('-')
    ? path.resolve(process.argv[2])
    : path.join(root, '.spec', 'PROGRESS.md');

  if (!fs.existsSync(progressPath)) {
    console.error('EL EXIT GATE BLOCK: .spec/PROGRESS.md not found.');
    process.exit(2);
  }

  const atlasPath = path.join(root, '.spec', 'ATLAS.md');
  const atlasContent = fs.existsSync(atlasPath) ? fs.readFileSync(atlasPath, 'utf8') : '';

  const content = fs.readFileSync(progressPath, 'utf8');
  // Open slices only: completed slices are history and must not block the architect.
  const result = validateProgressSlices(content, atlasContent, { openOnly: true });

  if (!result.valid) {
    console.error('EL EXIT GATE BLOCK: Validation failed for .spec/PROGRESS.md:');
    for (const err of result.errors) {
      console.error(`- ${err}`);
    }
    console.error('All slices declared by Tier 1 Architect must specify Target files, Coords, and a Verify command.');
    process.exit(2);
  }

  console.log('EL EXIT GATE PASS: All declared slices in .spec/PROGRESS.md have valid Target files, Coords, and Verify commands.');
  process.exit(0);
}
