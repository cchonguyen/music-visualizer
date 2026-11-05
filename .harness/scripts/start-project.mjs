#!/usr/bin/env node
// Usage:
//   node .harness/scripts/start-project.mjs status   plain-English summary, writes nothing
//   node .harness/scripts/start-project.mjs apply    create only the missing harness files
import process from 'node:process';
import { inspectProject, applyScaffold, summarize, receiptOf } from './lib/start-project.mjs';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const command = process.argv[2];

try {
  if (command === 'status') {
    console.log(summarize(inspectProject(root)).join('\n'));
    process.exit(0);
  }
  if (command === 'apply') {
    console.log(receiptOf(applyScaffold(root)));
    process.exit(0);
  }
  console.error('Usage: node .harness/scripts/start-project.mjs <status|apply>');
  process.exit(1);
} catch (err) {
  console.error(`✗ START PROJECT: ${err.message}`);
  process.exit(1);
}
