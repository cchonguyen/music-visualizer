#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { resolveRoot } from './status-batch.mjs';

const root = resolveRoot();
const scoutPath = path.join(root, '.spec', 'SCOUT.md');

const mode = (process.argv[2] || 'implement').toLowerCase(); // 'implement' | 'spec'

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

// Level 1 is small enough for gf-coder (or a quick fix); anything larger is planned by el-architect.
export const levelFor = (scoutData) => {
  if (scoutData?.level === 1) return { level: 1, agent: 'harness:gf-coder' };
  return { level: scoutData?.level === 3 ? 3 : 2, agent: 'harness:el-architect' };
};

if (process.argv[1] && path.resolve(process.argv[1]).endsWith('evaluate-upshift.mjs')) {
  if (mode === 'implement') {
    console.log('🐠 Dispatch harness:gf-coder for the [IN_PROGRESS] slice.');
    process.exit(0);
  }
  if (mode === 'spec') {
    const routed = levelFor(parseScout(scoutPath));
    if (routed.level === 1) {
      console.log('🐠 SCOUT Level 1 -> small change: dispatch harness:gf-coder, or make a quick fix.');
    } else {
      console.log(`🐘 SCOUT Level ${routed.level} -> dispatch harness:el-architect for /spec.`);
    }
    process.exit(0);
  }
}
