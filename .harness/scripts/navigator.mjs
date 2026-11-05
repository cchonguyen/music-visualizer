#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureHarnessRoot, atomicWriteFileSync } from './lib/fs-atomic.mjs';

export const ATLAS_COORDS_REGEX = /\|\s*Coords:\s*\[([0-9,\s]+)\]/;

export function resolveRoot() {
  ensureHarnessRoot();
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

export function countLines(text) {
  if (!text) return 0;
  return text.endsWith('\n') ? text.slice(0, -1).split('\n').length : text.split('\n').length;
}

export function loadThresholds(root) {
  const configPath = path.join(root, '.harness', 'config', 'thresholds.json');
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse .harness/config/thresholds.json: ${err.message}`);
  }
}

export function parseAtlasIndex(indexPath) {
  if (!fs.existsSync(indexPath)) {
    return { entries: new Map(), sections: new Set(), raw: '' };
  }
  const raw = fs.readFileSync(indexPath, 'utf8');
  const entries = new Map();
  const sections = new Set();

  for (const line of raw.split('\n')) {
    // Match section headers: ## Sector 100 Work Dispatch or ## 100 Work Dispatch
    const secMatch = line.match(/^##\s*(?:Sector\s*)?(\d{3})\b\s*(.*)$/);
    if (secMatch) {
      sections.add(secMatch[1]);
      continue;
    }
    // Match entry lines:
    // - `110` [.spec/PROGRESS.md](...) — Active slice queue & lock
    // - `130` `.spec/BLACK_BOX.md` — Sector 130 flight-recorder dump on 2-strike failure
    const entryMatch = line.match(/^-\s*`(\d{3})`\s+(?:\[(.*?)\]\((.*?)\)|`([^`]+)`|(\S+))\s*(?:—|-|\s)?\s*(.*)$/);
    if (entryMatch) {
      const code = entryMatch[1];
      const linkText = entryMatch[2] || entryMatch[4] || entryMatch[5] || '';
      const href = entryMatch[3] || '';
      const desc = entryMatch[6] || '';
      entries.set(code, {
        code,
        target: linkText.trim(),
        href: href.trim(),
        desc: desc.trim(),
      });
    }
  }

  return { entries, sections, raw };
}

// Backward compatibility alias
export const parseDeweyIndex = parseAtlasIndex;

export function extractAtlasCoords(text) {
  const coords = new Set();
  if (!text) return coords;

  // 1. Match Coords: [110, 120] or | Coords: [000, 305]
  const coordsMatch = text.matchAll(/Coords:\s*\[([^\]]+)\]/gi);
  for (const m of coordsMatch) {
    for (const code of m[1].split(',')) {
      const clean = code.trim();
      if (/^\d{3}$/.test(clean)) {
        coords.add(clean);
      }
    }
  }

  // Fallback: match Refs: [110, 120]
  const refsMatch = text.matchAll(/Refs:\s*\[([^\]]+)\]/gi);
  for (const m of refsMatch) {
    for (const code of m[1].split(',')) {
      const clean = code.trim();
      if (/^\d{3}$/.test(clean)) {
        coords.add(clean);
      }
    }
  }

  // 2. Match bracketed 3-digit codes [110], [210] (not followed by '(' which indicates a markdown link)
  const bracketMatch = text.matchAll(/\[(\d{3})\](?!\()/g);
  for (const m of bracketMatch) {
    coords.add(m[1]);
  }

  // 3. Match Sector 110, Atlas Sector 110, Dewey Class 110, Dewey 320
  const labelMatch = text.matchAll(/(?:(?:Atlas\s+)?Sector|Dewey(?:\s+Class)?)\s+(\d{3})\b/gi);
  for (const m of labelMatch) {
    coords.add(m[1]);
  }

  return coords;
}

// Backward compatibility alias
export const extractDeweyRefs = extractAtlasCoords;

export function checkAtlasReferences(root) {
  const atlasPath = path.join(root, '.spec', 'ATLAS.md');
  const indexPath = path.join(root, '.spec', 'INDEX.md');
  const targetPath = fs.existsSync(atlasPath) ? atlasPath : indexPath;
  const index = parseAtlasIndex(targetPath);
  const brokenRefs = [];
  const brokenLinks = [];
  const unindexedSpecFiles = [];

  // Every .spec/ file (except the index itself) must be a target in ATLAS.md
  const indexedTargets = new Set(
    [...index.entries.values()]
      .map((e) => e.target.replace(/^file:\/\/[^/]*\//, '').replace(/^\.\//, ''))
      .filter(Boolean)
      .map((t) => path.posix.normalize(t))
  );

  // Known valid codes in index (entries + section headings)
  const validCodes = new Set([...index.entries.keys(), ...index.sections]);

  // Check if targets listed in index exist on disk
  for (const [code, entry] of index.entries) {
    // 130 (.spec/BLACK_BOX.md / .spec/CRIME_SCENE.md) is incident-only/ephemeral
    if (code === '130') continue;
    if (entry.target) {
      const targetRel = entry.target.replace(/^file:\/\/[^/]*\//, '').replace(/^\.\//, '');
      const fullPath = path.resolve(root, targetRel);
      if (!fs.existsSync(fullPath)) {
        brokenLinks.push({
          code,
          target: entry.target,
          reason: `Target file not found on disk: ${targetRel}`,
        });
      }
    }
  }

  // Scan .spec/ directory for references
  const specDir = path.join(root, '.spec');
  if (fs.existsSync(specDir)) {
    function walk(dir) {
      const files = fs.readdirSync(dir, { withFileTypes: true });
      for (const f of files) {
        const full = path.join(dir, f.name);
        if (f.isDirectory()) {
          walk(full);
        } else if (f.isFile() && f.name.endsWith('.md')) {
          const rel = path.relative(root, full).split(path.sep).join('/');
          if (rel !== '.spec/ATLAS.md' && !indexedTargets.has(rel)) {
            unindexedSpecFiles.push({ file: rel, reason: `${rel} has no coordinate in .spec/ATLAS.md` });
          }
          const content = fs.readFileSync(full, 'utf8');
          const refs = extractAtlasCoords(content);
          for (const code of refs) {
            if (!validCodes.has(code)) {
              brokenRefs.push({
                file: rel,
                code,
                reason: `Atlas coordinate [${code}] not found in .spec/ATLAS.md`,
              });
            }
          }
        }
      }
    }
    walk(specDir);
  }

  return { brokenRefs, brokenLinks, unindexedSpecFiles };
}

// Backward compatibility alias
export const checkDeweyReferences = checkAtlasReferences;

export function checkLineBudgets(root, thresholds) {
  const violations = [];
  const softCaps = thresholds?.line_budgets?.soft_caps || {};

  for (const [relPath, cap] of Object.entries(softCaps)) {
    const fullPath = path.join(root, relPath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = countLines(content);
      if (lines > cap) {
        violations.push({
          file: relPath,
          lines,
          cap,
          reason: `${relPath} exceeds soft cap: ${lines} lines (budget: ${cap})`,
        });
      }
    }
  }

  return violations;
}

export function archiveCompletedSlices(root) {
  const progressPath = path.join(root, '.spec', 'PROGRESS.md');
  const historyPath = path.join(root, '.spec', 'archive', 'HISTORY.md');

  if (!fs.existsSync(progressPath)) {
    return { archived: 0, remaining: 0 };
  }

  const progressText = fs.readFileSync(progressPath, 'utf8');
  const lines = progressText.split('\n');

  const completed = [];
  const remaining = [];

  for (const line of lines) {
    if (/^\s*-\s*\[x\]\s*\*\*Slice\b/i.test(line)) {
      completed.push(line);
    } else {
      remaining.push(line);
    }
  }

  if (completed.length === 0) {
    return { archived: 0, remaining: lines.length };
  }

  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  let historyText = fs.existsSync(historyPath) ? fs.readFileSync(historyPath, 'utf8') : '# Completed Slice Archive (Atlas Sector 120)\n\n';

  if (!historyText.endsWith('\n')) historyText += '\n';
  historyText += `\n## Archived Slices (${new Date().toISOString().slice(0, 10)})\n`;
  for (const sliceLine of completed) {
    historyText += `${sliceLine.trim()}\n`;
  }

  atomicWriteFileSync(historyPath, historyText, 'utf8');
  atomicWriteFileSync(progressPath, remaining.join('\n'), 'utf8');

  return { archived: completed.length, remaining: remaining.length };
}

export function navigatorCheck(root) {
  const thresholds = loadThresholds(root);
  const budgetViolations = thresholds ? checkLineBudgets(root, thresholds) : [];
  const { brokenRefs, brokenLinks, unindexedSpecFiles } = checkAtlasReferences(root);

  const errors = [
    ...budgetViolations.map((v) => `Line budget violation: ${v.reason}`),
    ...brokenRefs.map((r) => `Broken Atlas coordinate reference: ${r.reason} (${r.file})`),
    ...brokenLinks.map((l) => `Broken ATLAS link: ${l.reason} (code ${l.code})`),
    ...unindexedSpecFiles.map((u) => `Unindexed spec file: ${u.reason}`),
  ];

  return {
    ok: errors.length === 0,
    errors,
    budgetViolations,
    brokenRefs,
    brokenLinks,
    unindexedSpecFiles,
  };
}

// Backward compatibility alias
export const librarianCheck = navigatorCheck;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureHarnessRoot();
  const root = resolveRoot();
  const args = process.argv.slice(2);

  if (args.includes('--archive') || args.includes('--compact')) {
    const res = archiveCompletedSlices(root);
    console.log(`NAVIGATOR: Archived ${res.archived} completed slices to .spec/archive/HISTORY.md.`);
  }

  if (args.includes('--check')) {
    const check = navigatorCheck(root);
    if (!check.ok) {
      console.error(`✗ NAVIGATOR CHECK FAILED: ${check.errors.length} error(s) found:`);
      for (const err of check.errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }
    console.log('✓ NAVIGATOR CHECK: PASS (0 errors). All Atlas coordinates and line budgets valid.');
    process.exit(0);
  }

  if (!args.includes('--archive') && !args.includes('--compact') && !args.includes('--check')) {
    console.log('Usage: node .harness/scripts/navigator.mjs [--check] [--archive]');
    process.exit(0);
  }
}
