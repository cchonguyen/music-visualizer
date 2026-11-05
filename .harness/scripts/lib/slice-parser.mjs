/**
 * Shared slice parser and validator for harness-hub workflows.
 * Parses slice lines from .spec/PROGRESS.md and validates file targets & coords.
 */

/**
 * Parses a PROGRESS.md slice line into its constituent components.
 *
 * @param {string} line - Single slice line from PROGRESS.md
 * @returns {{
 *   id: string|null,
 *   title: string|null,
 *   fullTitle: string|null,
 *   status: string,
 *   targets: string[],
 *   targetFiles: string[],
 *   coords: string[],
 *   verify: string
 * }}
 */
export function parseSliceLine(line) {
  if (!line || typeof line !== 'string') {
    return {
      id: null,
      title: null,
      fullTitle: null,
      status: '',
      targets: [],
      targetFiles: [],
      coords: [],
      verify: '',
    };
  }

  const parts = line.split('|');

  // 1. Status extraction
  let status = '';
  if (/\[IN_PROGRESS\]/i.test(line)) {
    status = '[IN_PROGRESS]';
  } else if (/\[PENDING\]/i.test(line)) {
    status = '[PENDING]';
  } else if (/\[[xX]\]/.test(line)) {
    status = '[x]';
  } else if (/\[BLOCKED\]/i.test(line)) {
    status = '[BLOCKED]';
  } else if (/^\s*-\s*\[\s*\]/.test(line)) {
    status = '[PENDING]';
  }

  // 2. Title & ID extraction
  let id = null;
  let title = null;
  let fullTitle = null;

  const boldMatch = line.match(/\*\*([^*]+)\*\*/);
  if (boldMatch) {
    fullTitle = boldMatch[1].trim();
    const sliceMatch = fullTitle.match(/^Slice\s+([0-9]+(?:\.[0-9]+)*)(?::\s*(.*))?$/i);
    if (sliceMatch) {
      id = sliceMatch[1];
      title = sliceMatch[2] ? sliceMatch[2].trim() : fullTitle;
    } else {
      title = fullTitle;
    }
  } else {
    const sliceMatch = line.match(/Slice\s+([0-9]+(?:\.[0-9]+)*)/i);
    if (sliceMatch) {
      id = sliceMatch[1];
    }
  }

  // 3. Target files extraction
  // Find segment containing 'Target files:'
  let rawTargets = '';
  for (const part of parts) {
    const match = part.match(/Target files:\s*(.*)/i);
    if (match) {
      rawTargets = match[1];
      break;
    }
  }
  if (!rawTargets) {
    const match = line.match(/Target files:\s*([^|\n]*)/i);
    if (match) {
      rawTargets = match[1];
    }
  }

  const targets = rawTargets
    ? rawTargets
        .split(',')
        .map((s) =>
          s
            .replace(/\[NEW\]/gi, '')
            .replace(/\[DELETE\]/gi, '')
            .replace(/\[MODIFIED\]/gi, '')
            .replace(/[`*]/g, '')
            .trim()
            .replace(/^\.\//, '')
        )
        .filter(Boolean)
    : [];

  // 4. Coords / Refs extraction
  let coords = [];
  const coordsMatch = line.match(/(?:Coords|Refs):\s*\[([^\]]*)\]/i);
  if (coordsMatch) {
    coords = coordsMatch[1]
      .split(',')
      .map((s) => s.replace(/[`*]/g, '').trim())
      .filter(Boolean);
  }

  // 5. Verify command extraction
  let verify = '';
  for (const part of parts) {
    const match = part.match(/^\s*Verify:\s*(.*)/i);
    if (match) {
      verify = match[1].trim();
      break;
    }
  }
  if (!verify) {
    const match = line.match(/Verify:\s*(.*)$/i);
    if (match) {
      verify = match[1].trim();
    }
  }

  return {
    id,
    title,
    fullTitle,
    status,
    targets,
    targetFiles: targets,
    coords,
    verify,
  };
}

/**
 * Validates a slice line against safety rules and Context Atlas entries.
 *
 * @param {string} line - Single slice line from PROGRESS.md
 * @param {string} [atlasContent] - Optional raw content of ATLAS.md
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSliceLine(line, atlasContent) {
  const parsed = parseSliceLine(line);
  const errors = [];

  // Check 1: Coding slice target files must never include .spec/PROGRESS.md
  const hasProgress = parsed.targets.some((t) => {
    const norm = t.replace(/\\/g, '/').replace(/^\.\//, '');
    return norm === '.spec/PROGRESS.md' || norm.endsWith('/.spec/PROGRESS.md');
  });
  if (hasProgress) {
    errors.push('Coding slice target files must not include .spec/PROGRESS.md');
  }

  // Check 2: All cited coords must exist in atlasContent if provided
  if (atlasContent && typeof atlasContent === 'string' && parsed.coords.length > 0) {
    for (const coord of parsed.coords) {
      const regex = new RegExp(`(?:[\`\\[\\b]|^)${coord}(?:[\`\\]\\b]|$)`);
      if (!regex.test(atlasContent)) {
        errors.push(`Coordinate ${coord} does not exist in Context Atlas`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
