import fs from 'node:fs';
import path from 'node:path';

/**
 * Atomic write helper that writes to a temporary file before renaming it into place.
 * Prevents macOS sandbox EPERM errors caused by in-place file truncation.
 *
 * @param {string} filePath - Absolute or relative path to destination file.
 * @param {string|Buffer|Uint8Array} data - Content to write.
 * @param {string|object} [encoding='utf8'] - Write encoding or options.
 */
export function atomicWriteFileSync(filePath, data, encoding = 'utf8') {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, data, encoding);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch (_) {}
    throw err;
  }
}

/**
 * Checks if the current working directory is the harness root or workspace parent.
 * If in workspace parent, changes directory to claude-harness-hub.
 *
 * @returns {string} The active harness root directory path.
 */
export function ensureHarnessRoot() {
  if (
    !fs.existsSync('.harness/config/thresholds.json') &&
    fs.existsSync('claude-harness-hub/.harness/config/thresholds.json')
  ) {
    process.chdir('claude-harness-hub');
  }
  return process.cwd();
}
