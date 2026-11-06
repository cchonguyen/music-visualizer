/**
 * Lock-guarded read-modify-write for .spec/.session-telemetry.json.
 * Every writer (PostToolUse telemetry, scrub counters, PreToolUse guard, finish-slice) goes through
 * updateTelemetry, so one writer never overwrites a record another writer appended in between.
 * Node built-ins only. Never throws: failures are logged to .spec/.telemetry-errors.log.
 */
import fs from 'node:fs';
import path from 'node:path';

const LOCK_WAIT_MS = 2000;
const LOCK_STALE_MS = 10000;
const POLL_MS = 5;
const sleepCell = new Int32Array(new SharedArrayBuffer(4));

export const telemetryFile = (root) => path.join(root, '.spec', '.session-telemetry.json');
const lockDir = (root) => path.join(root, '.spec', '.session-telemetry.lock');
export const telemetryErrorLog = (root) => path.join(root, '.spec', '.telemetry-errors.log');

/** Appends one line to the telemetry error log. Best-effort. */
export function logTelemetryError(root, where, err) {
  try {
    const msg = err && err.message ? err.message : String(err);
    fs.mkdirSync(path.dirname(telemetryErrorLog(root)), { recursive: true });
    fs.appendFileSync(telemetryErrorLog(root), `${new Date().toISOString()} ${where}: ${msg}\n`, 'utf8');
  } catch {}
}

/** Takes the lock by creating a directory. Returns false when it stays busy past LOCK_WAIT_MS. */
function acquire(root) {
  const dir = lockDir(root);
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(dir);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        // A holder that died leaves the lock behind. Break it once it is clearly stale.
        if (Date.now() - fs.statSync(dir).mtimeMs > LOCK_STALE_MS) {
          fs.rmdirSync(dir);
          continue;
        }
      } catch {}
      if (Date.now() >= deadline) return false;
      Atomics.wait(sleepCell, 0, 0, POLL_MS);
    }
  }
}

/** Runs fn while holding the telemetry lock. If the lock cannot be taken, fn still runs and the miss is logged. */
export function withTelemetryLock(root, fn) {
  let locked = false;
  try {
    fs.mkdirSync(path.join(root, '.spec'), { recursive: true });
    locked = acquire(root);
    if (!locked) logTelemetryError(root, 'lock', 'timed out waiting for telemetry lock; wrote unlocked');
  } catch (err) {
    logTelemetryError(root, 'lock', err);
  }
  try {
    return fn();
  } finally {
    if (locked) {
      try { fs.rmdirSync(lockDir(root)); } catch {}
    }
  }
}

/** Writes JSON to a temp file, then renames it over the target. Logs and returns false on failure. */
export function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    logTelemetryError(path.dirname(path.dirname(file)), 'writeJsonAtomic', err);
    return false;
  }
}

/**
 * Locked read-modify-write. mutate receives the latest stored object (with a calls array) and returns the
 * object to store. A corrupt non-empty file is kept as .bak before it is replaced.
 */
export function updateTelemetry(root, mutate) {
  return withTelemetryLock(root, () => {
    const file = telemetryFile(root);
    let current = {};
    let text = null;
    try { text = fs.readFileSync(file, 'utf8'); } catch {}
    if (text !== null && text.trim() !== '') {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed;
        else throw new Error('not an object');
      } catch {
        try { fs.writeFileSync(`${file}.bak`, text, 'utf8'); } catch {}
        current = {};
      }
    }
    const base = { ...current, calls: Array.isArray(current.calls) ? current.calls : [] };
    const next = mutate(base);
    writeJsonAtomic(file, next);
    return next;
  });
}
