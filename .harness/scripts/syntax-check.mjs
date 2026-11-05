#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureHarnessRoot } from './lib/fs-atomic.mjs';

const root = ensureHarnessRoot();
const harnessDir = path.join(root, '.harness');

if (!fs.existsSync(harnessDir)) {
  console.error(`Error: .harness directory not found at ${harnessDir}`);
  process.exit(1);
}

function findMjsFiles(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findMjsFiles(fullPath, fileList);
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

const files = findMjsFiles(harnessDir);
let failureCount = 0;

for (const file of files) {
  const relPath = path.relative(root, file);
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failureCount++;
    console.error(`Syntax check failed: ${relPath}`);
    if (result.stderr) console.error(result.stderr.trim());
    if (result.stdout) console.error(result.stdout.trim());
  }
}

if (failureCount > 0) {
  console.error(`✗ SYNTAX CHECK: FAIL (${failureCount} errors found)`);
  process.exit(1);
} else {
  console.log(`✓ SYNTAX CHECK: PASS (0 errors). Checked ${files.length} .mjs files.`);
  process.exit(0);
}
