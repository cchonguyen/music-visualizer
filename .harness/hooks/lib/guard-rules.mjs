// Pure rules for the guard hooks: what is locked, what a Bash command writes, and how a PROGRESS or AGENTS edit reads.
// Zero dependencies. Nothing here touches git or the filesystem.

export const AGENTS_MARKERS = ['<!-- >>> harness >>> -->', '<!-- <<< harness <<< -->'];

// Spoke engine lock (SYSTEM_SPEC 4.A.3). Enforced in every work mode. The hub itself is not locked.
const ENGINE_LOCKED = [
  /^\.harness\//,
  /^\.harness-version$/,
  /^\.claude\/settings\.json$/,
  /^\.claude\/agents\//,
  /^\.claude\/commands\//,
  /^\.claude\/harness-rules\.md$/,
  /^\.spec\/EXTERNAL_AGENT_RULES\.md$/,
  // Only a person changes the work mode. An agent that could edit it could switch the plan lock off.
  /^\.spec\/harness\.json$/,
];
export const isEngineLocked = (rel) => ENGINE_LOCKED.some((re) => re.test(rel));

// Hub-owned engine paths (the hub is the source, so these are writable there)
export const isEnginePath = (rel) => rel.startsWith('.claude/') || rel.startsWith('.harness/') || rel === '.harness-version';

// Paths a Bash command must not write in a spoke (SYSTEM_SPEC 4.A.5)
const PROTECTED_PREFIXES = ['.harness/', '.claude/agents/', '.claude/commands/'];
const PROTECTED_EXACT = ['.harness-version', '.claude/settings.json', '.claude/harness-rules.md', '.spec/EXTERNAL_AGENT_RULES.md', '.spec/harness.json', 'AGENTS.md'];
export const isProtectedPath = (p) => {
  const clean = String(p).replace(/^\.\//, '');
  return PROTECTED_EXACT.includes(clean) || PROTECTED_PREFIXES.some((prefix) => clean.startsWith(prefix));
};

// The harness-owned part of AGENTS.md: the text between the markers, markers included ('' when absent)
export function agentsBlock(text) {
  const [start, end] = AGENTS_MARKERS;
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from === -1 || to <= from) return '';
  return text.slice(from, to + end.length);
}

// Colour tag on a slice line: [GREEN], [YELLOW] or [RED]
export const colourOf = (line) => line?.match(/\[(GREEN|YELLOW|RED)\]/)?.[1] ?? null;

// Slice identity: the text inside **Slice N**, so rewording a line keeps its identity
export const sliceIdOf = (line) => line?.match(/\*\*Slice\s+([^*]+)\*\*/)?.[1].trim() ?? line?.trim();

// The file content after an Edit, Write or NotebookEdit call, computed from what is on disk now
export function nextContent(currentContent, toolName, input = {}) {
  if (toolName === 'Write') return input.content || '';
  if (toolName === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    // split/join avoids String.replace treating "$&" etc. in new_string as patterns
    return input.replace_all
      ? currentContent.split(input.old_string).join(input.new_string)
      : currentContent.replace(input.old_string, () => input.new_string);
  }
  return currentContent;
}

const REDIRECT = />>?\s*(['"]?)([^\s'"|;&)]+)/g;
const WRITE_VERB = /\b(tee|cp|mv|rm|unlink|truncate)\b|\bsed\s+-i|\bperl\s+-i|\bpython3?\s+-c|\bnode\s+-e|\bgit\s+checkout\s+--|\bgit\s+restore\b/;

// Why a Bash command would write a protected path, or null. A speed bump: CI is the real wall.
export function bashWriteReason(command) {
  for (const match of command.matchAll(REDIRECT)) {
    const target = match[2];
    if (isProtectedPath(target)) return `it redirects output into ${target}`;
  }
  const verb = command.match(WRITE_VERB)?.[0];
  if (verb) {
    const named = [...PROTECTED_EXACT, ...PROTECTED_PREFIXES].find((token) => command.includes(token));
    if (named) return `it runs "${verb}" and names ${named}`;
  }
  return null;
}

// Whether a git origin URL points at the hub. Uses the URL only: folder names can be changed.
export const isHubOrigin = (url, repo = 'claude-harness-hub') =>
  new RegExp(`[/:]${repo}(\\.git)?$`).test(String(url).trim());
