#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { appendBatchEvent, resolveRoot } from './status-batch.mjs';

const root = resolveRoot();
const progressPath = path.join(root, '.spec', 'PROGRESS.md');
const specPath = path.join(root, '.spec', 'SYSTEM_SPEC.md');
const scoutPath = path.join(root, '.spec', 'SCOUT.md');
const strikePath = path.join(root, '.spec', '.strike-counter.json');

const mode = (process.argv[2] || 'implement').toLowerCase(); // 'implement' | 'spec'
const rawArg = (process.argv[3] || '').trim().toLowerCase();

export const parseScout = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const levelMatch = content.match(/Scout-Level:\s*(\d+)/i);
  const filesMatch = content.match(/Files-Touched:\s*(\d+)/i);
  const contractMatch = content.match(/Contract-Change:\s*(yes|no)/i);
  const crossMatch = content.match(/Cross-Module:\s*(yes|no)/i);

  const filesTouched = filesMatch ? parseInt(filesMatch[1], 10) : 0;
  const contractChange = contractMatch ? contractMatch[1].toLowerCase() === 'yes' : false;
  const crossModule = crossMatch ? crossMatch[1].toLowerCase() === 'yes' : false;

  let computedLevel = 1;
  if (crossModule || (contractChange && filesTouched >= 5)) {
    computedLevel = 3;
  } else if (contractChange || filesTouched >= 3) {
    computedLevel = 2;
  }

  const explicitLevel = levelMatch ? parseInt(levelMatch[1], 10) : computedLevel;
  return {
    level: explicitLevel,
    filesTouched,
    contractChange,
    crossModule
  };
};

export const levelFor = (scoutData) => {
  if (!scoutData) return { level: 2, agent: 'architect', tier: 'sonnet' };
  if (scoutData.level === 3) return { level: 3, agent: 'architect-opus', tier: 'opus' };
  if (scoutData.level === 1) return { level: 1, agent: 'engineer', tier: 'haiku' };
  return { level: 2, agent: 'architect', tier: 'sonnet' };
};

const parseTargets = (line) => {
  const match = line?.match(/Target files:\s*(.+)$/i);
  if (!match) return [];
  return match[1].replace(/[`*]/g, '').split(',').map((s) => s.trim().replace(/^\.\//, '')).filter(Boolean);
};

// Deprecated no-ops for backwards compatibility with tests / hooks
export const clearUpshiftAuth = () => {};
export const verifyUpshiftAuth = () => ({ allowed: true });

if (process.argv[1] && path.resolve(process.argv[1]).endsWith('evaluate-upshift.mjs')) {
  const progressLines = fs.existsSync(progressPath) ? fs.readFileSync(progressPath, 'utf8').split('\n') : [];
  const activeOrNextLine =
    progressLines.find((l) => /^\s*-\s*\[.\].*\[IN_PROGRESS\]/.test(l)) ||
    progressLines.find((l) => /^\s*-\s*\[\s\]/.test(l)) ||
    '';
  const sliceMatch = activeOrNextLine.match(/\*\*Slice\s+([^*]+)\*\*/);
  const sliceLabel = sliceMatch ? `Slice ${sliceMatch[1].trim()}` : 'next slice';

  // 1. Explicit CLI flag override
  if (mode === 'implement') {
    if (rawArg === 'sonnet') {
      console.log(`🐘 Dispatching Goldfish escalated subagent (engineer-sonnet / Sonnet) for ${sliceLabel}.`);
      process.exit(0);
    }
    console.log(`🐠 Dispatching Goldfish subagent (engineer / Haiku) for ${sliceLabel}.`);
    process.exit(0);
  }

  if (mode === 'spec') {
    if (rawArg === 'opus') {
      console.log(`🐘 Dispatching Elephant subagent (architect-opus / Opus) for /spec.`);
      process.exit(0);
    }
    if (rawArg === 'sonnet') {
      console.log(`🐘 Dispatching Elephant subagent (architect / Sonnet) for /spec.`);
      process.exit(0);
    }

    // Read SCOUT.md if present
    const scout = parseScout(scoutPath);
    const routed = levelFor(scout);
    if (routed.level === 3) {
      console.log(`🐘 SCOUT Level 3 detected -> Dispatching Elephant subagent (architect-opus / Opus).`);
    } else if (routed.level === 1) {
      console.log(`🐠 SCOUT Level 1 detected -> Recommend Goldfish direct execution (/quick-fix or /implement).`);
    } else {
      console.log(`🐘 SCOUT Level 2 detected -> Dispatching Elephant subagent (architect / Sonnet).`);
    }
    process.exit(0);
  }
}
