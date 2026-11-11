/**
 * Per-session JSONL event log at .spec/.events/<session_id>.jsonl.
 * Each event is one line: {"v":1,"ts","session","kind","source","slice","detail"}.
 * Writes use a single fs.appendFileSync with flag 'a' (O_APPEND). No read-modify-write, no lock file.
 * Node built-ins only. appendEvent never throws. readEvents skips malformed lines.
 */
import fs from 'node:fs';
import path from 'node:path';

export const EVENT_VERSION = 1;
export const MAX_LINE_BYTES = 4096;
const FALLBACK_SESSION = 'nosession';
const MAX_FIELD_CHARS = 200;

/** Maps a session id to a safe file name. Anything outside [A-Za-z0-9_.-] becomes '_'. */
export function sessionId(raw) {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) return FALLBACK_SESSION;
  const safe = id.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^\.+/, '_').slice(0, 128);
  return safe || FALLBACK_SESSION;
}

/** Absolute path of the JSONL file for one session. */
export function eventFile(root, session) {
  return path.join(root, '.spec', '.events', `${sessionId(session)}.jsonl`);
}

const clip = (value, max = MAX_FIELD_CHARS) => {
  const text = value === undefined || value === null ? null : String(value);
  return text === null ? null : text.slice(0, max);
};

/** Serialises the detail object. Falls back to a marker when it cannot be serialised. */
function safeStringify(value) {
  try {
    const text = JSON.stringify(value === undefined ? {} : value);
    return text === undefined ? '{}' : text;
  } catch {
    return '{"unserializable":true}';
  }
}

/** Builds one JSONL line (with trailing newline) of at most MAX_LINE_BYTES bytes. */
export function buildLine(event = {}) {
  const base = {
    v: EVENT_VERSION,
    ts: new Date().toISOString(),
    session: clip(sessionId(event.session)),
    kind: clip(event.kind ?? 'unknown'),
    source: clip(event.source ?? 'unknown'),
    slice: clip(event.slice),
  };
  const render = (detail) => `${JSON.stringify({ ...base, detail })}\n`;

  // Normalise detail to plain JSON first, so circular or unserialisable values cannot throw.
  const raw = safeStringify(event.detail);
  let detail;
  try {
    detail = JSON.parse(raw);
  } catch {
    detail = { unserializable: true };
  }

  let line = render(detail);
  if (Buffer.byteLength(line, 'utf8') <= MAX_LINE_BYTES) return line;

  // Too long: keep a truncated preview of the detail, shrinking it until the line fits.
  for (let keep = 2048; keep >= 0; keep -= 256) {
    line = render({ truncated: true, preview: raw.slice(0, keep) });
    if (Buffer.byteLength(line, 'utf8') <= MAX_LINE_BYTES) return line;
  }
  return render({ truncated: true });
}

/**
 * Appends one event to the session file. Creates .spec/.events on first use.
 * Returns true on success, false on any failure. Never throws.
 */
export function appendEvent(root, event = {}) {
  try {
    const file = eventFile(root, event.session);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, buildLine(event), { flag: 'a', encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads a JSONL event file. Missing file gives []. Malformed lines are skipped. Never throws.
 */
export function readEvents(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) events.push(parsed);
    } catch {
      // Skip malformed line.
    }
  }
  return events;
}
