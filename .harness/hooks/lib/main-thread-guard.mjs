// Main-thread allow-list (Slice 10.3). A PreToolUse call with no agent_type comes from the main thread.
// Subagents set agent_type and are not restricted here. Pure: no filesystem or process I/O.
import path from 'node:path';

const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
const EDIT_REFUSAL = 'Main thread may edit only .spec/. Dispatch harness:gf-coder for source edits.';
const BASH_REFUSAL = 'Main thread Bash is limited to the allow-list (git, test/typecheck/lint, finish-slice, doctor, read-only gh and status). Dispatch harness:gf-coder for other work.';
const STATUS_COMMANDS = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'pwd', 'date', 'stat', 'file', 'diff', 'realpath']);
const GH_NOUNS = new Set(['pr', 'run', 'issue', 'repo']);
const GH_VERBS = new Set(['view', 'list', 'checks', 'status', 'diff']);
const NPM_SCRIPTS = new Set(['typecheck', 'lint', 'test']);
const NODE_SCRIPTS = new Set(['.harness/scripts/finish-slice.mjs', '.harness/scripts/doctor.mjs']);
const RESTORE_SCRIPT = '.harness/hooks/pre-tool-guard.mjs';

const ALLOWED = Object.freeze({ allowed: true, reason: '' });
const refused = (reason) => ({ allowed: false, reason });

export function stripHarmless(command) {
  return String(command)
    .replace(/2>&1/g, ' ')
    .replace(/[12]?>\s*\/dev\/null/g, ' ');
}

// Git global options that take a separate value. Other leading "-" tokens are standalone flags.
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
// Short-flag cluster containing f (e.g. -f, -fu, -uf).
const SHORT_F_CLUSTER = /^-[A-Za-z]*f/;

function gitAllowed(tokens) {
  let i = 1;
  while (i < tokens.length && tokens[i].startsWith('-')) i += GIT_VALUE_OPTIONS.has(tokens[i]) ? 2 : 1;
  const sub = tokens[i];
  const args = tokens.slice(i + 1);
  if (sub === 'push') return !args.some((x) => SHORT_F_CLUSTER.test(x) || x.startsWith('--force') || x.startsWith('+') || x.includes(':+'));
  if (sub === 'branch') return !args.includes('-D');
  if (sub === 'reset') return !args.includes('--hard');
  if (sub === 'clean') return !args.some((x) => /^-[^-]*[fdx]/.test(x) || x === '--force');
  if (sub === 'checkout') return !args.some((x) => x === '--' || x === '.' || x === '*' || x.startsWith('./') || x === '--force' || SHORT_F_CLUSTER.test(x));
  if (sub === 'restore') return args.includes('--staged') && !args.some((x) => x === '--worktree' || x === '-W');
  return true;
}

// Refuses -i/--in-place, -f/--file, and any script containing w, W, e or F. The script is the
// first positional token, or the value(s) of -e/--expression. Filenames are not checked.
function sedAllowed(tokens, segment) {
  if (tokens[1] !== '-n' || /[\r\n]/.test(segment)) return false;
  const args = tokens.slice(1);
  const scripts = [];
  let firstPositional = true;
  for (let i = 0; i < args.length; i++) {
    const x = args[i];
    if (x === '--in-place' || x.startsWith('--in-place=') || x === '--file' || x.startsWith('--file=') || /^-[A-Za-z]*[if]/.test(x)) return false;
    if (x === '--expression') { scripts.push(args[++i] ?? ''); continue; }
    if (x.startsWith('--expression=')) { scripts.push(x.slice('--expression='.length)); continue; }
    if (!x.startsWith('--') && /^-[A-Za-z]*e/.test(x)) {
      const rest = x.slice(x.indexOf('e') + 1);
      scripts.push(rest || args[++i] || '');
      continue;
    }
    if (x.startsWith('-')) continue;
    if (firstPositional) scripts.push(x);
    firstPositional = false;
  }
  return !scripts.some((s) => /[wWeF]/.test(s));
}

function rgAllowed(tokens) {
  return !tokens.some((x) => x === '--pre' || x.startsWith('--pre=') || x === '--pre-glob' || x.startsWith('--pre-glob='));
}

function isAllowedSegment(tokens, segment) {
  const [cmd, sub, verb] = tokens;
  switch (cmd) {
    case 'git': return gitAllowed(tokens);
    case 'cd': return true;
    case 'node': return sub === '--test' || NODE_SCRIPTS.has(sub) || (sub === RESTORE_SCRIPT && verb === '--restore');
    case 'npm': return sub === 'run' && NPM_SCRIPTS.has(verb) && tokens.slice(3).every((x) => x.startsWith('-'));
    case 'rm': return tokens.length === 2 && sub === '.spec/.doctor-canary';
    case 'bin/restart-dashboard.sh': return true;
    case 'gh': return sub === 'search' || (GH_NOUNS.has(sub) && GH_VERBS.has(verb));
    case 'sed': return sedAllowed(tokens, segment);
    case 'rg': return rgAllowed(tokens);
    default: return STATUS_COMMANDS.has(cmd);
  }
}

const HARMLESS_PATTERNS = [/2>&1/g, /[12]?>\s*\/dev\/null/g];

// Replaces quoted content with `_` (same length, quotes kept). Live `$(` and backticks inside
// double quotes are kept so they still get refused. Returns null when a quote is unterminated.
function maskQuoted(text) {
  const out = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '\\') {
      out.push(c);
      if (i + 1 < n) out.push(text[i + 1]);
      i += 2;
      continue;
    }
    if (c === "'" || (c === '$' && text[i + 1] === "'")) {
      const ansi = c === '$';
      if (ansi) { out.push('$'); i++; }
      out.push("'");
      i++;
      let closed = false;
      while (i < n) {
        const d = text[i];
        if (ansi && d === '\\' && i + 1 < n) { out.push('_', '_'); i += 2; continue; }
        if (d === "'") { out.push("'"); i++; closed = true; break; }
        out.push('_');
        i++;
      }
      if (!closed) return null;
      continue;
    }
    if (c === '"') {
      out.push('"');
      i++;
      let closed = false;
      while (i < n) {
        const d = text[i];
        if (d === '\\' && i + 1 < n) { out.push('_', '_'); i += 2; continue; }
        if (d === '"') { out.push('"'); i++; closed = true; break; }
        if (d === '`') { out.push('`'); i++; continue; }
        if (d === '$' && text[i + 1] === '(') { out.push('$', '('); i += 2; continue; }
        out.push('_');
        i++;
      }
      if (!closed) return null;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

function harmlessHits(masked) {
  const hit = Array(masked.length).fill(false);
  for (const re of HARMLESS_PATTERNS) {
    for (const m of masked.matchAll(re)) hit.fill(true, m.index, m.index + m[0].length);
  }
  return hit;
}

const blankAt = (s, hit) => s.split('').map((ch, i) => (hit[i] ? ' ' : ch)).join('');

function bashDecision(command) {
  const text = String(command ?? '').trim();
  if (!text) return ALLOWED;
  const masked = maskQuoted(text);
  if (masked === null) {
    return refused(`Main thread Bash refused: unterminated quote in \`${text}\`. ${BASH_REFUSAL}`);
  }
  const hit = harmlessHits(masked);
  const checkText = blankAt(masked, hit);
  const tokenText = blankAt(text, hit);
  if (/[<>`]|\$\(/.test(checkText)) {
    return refused(`Main thread Bash refused: \`${text}\` (redirection, input or substitution). ${BASH_REFUSAL}`);
  }
  const pieces = [];
  let last = 0;
  for (const m of checkText.matchAll(/&&|\|\||[;|&\r\n]/g)) {
    pieces.push([last, m.index]);
    last = m.index + m[0].length;
  }
  pieces.push([last, checkText.length]);
  for (const [s, e] of pieces) {
    const segment = tokenText.slice(s, e).replace(/["']/g, '').trim();
    if (!segment) continue;
    if (!isAllowedSegment(segment.split(/\s+/), segment)) {
      return refused(`Main thread Bash refused: \`${text.slice(s, e).trim()}\`. ${BASH_REFUSAL}`);
    }
  }
  return ALLOWED;
}

function editDecision(toolInput, root) {
  const raw = toolInput?.file_path || toolInput?.notebook_path || toolInput?.path || '';
  if (!raw) return refused(`Main thread edit refused: no file path given. ${EDIT_REFUSAL}`);
  const base = path.resolve(root);
  const rel = path.relative(base, path.resolve(base, raw)).split(path.sep).join('/');
  if (rel.startsWith('.spec/')) return ALLOWED;
  return refused(`Main thread edit refused for "${raw}" (repo-relative: ${rel || '.'}). ${EDIT_REFUSAL}`);
}

export function mainThreadDecision({ agentType, toolName, toolInput = {}, root = '.' } = {}) {
  if (typeof agentType === 'string' && agentType.trim() !== '') return ALLOWED;
  if (EDIT_TOOLS.includes(toolName)) return editDecision(toolInput, root);
  if (toolName === 'Bash') return bashDecision(toolInput?.command);
  return ALLOWED;
}
