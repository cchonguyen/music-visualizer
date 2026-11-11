// Hard-block list (Slice 11.3). Single source of the Bash commands that are always refused with exit 2,
// whatever the doctor state, the allow-list or the caller. Pure: no filesystem or process I/O.
import { bashWriteReason } from './guard-rules.mjs';

// Same separators the doctor allow-list splits on.
const SEGMENT_SPLIT = /\|\||&&|[;&|]/;

// Git global options that take a separate value (as in main-thread-guard.mjs).
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const SHORT_F_CLUSTER = /^-[A-Za-z]*f/;

// Returns the hard-block message for a git command, or ''.
function gitHard(tokens) {
  let i = 1;
  while (i < tokens.length && tokens[i].startsWith('-')) i += GIT_VALUE_OPTIONS.has(tokens[i]) ? 2 : 1;
  const sub = tokens[i];
  const args = tokens.slice(i + 1);
  if (sub === 'push' && args.some((x) => SHORT_F_CLUSTER.test(x) || x.startsWith('--force') || x.startsWith('+') || x.includes(':+'))) {
    return HARD_BLOCK_MESSAGES.forcePush;
  }
  if (sub === 'branch' && args.includes('-D')) return HARD_BLOCK_MESSAGES.branchDelete;
  return '';
}

// Deploy commands: the tool and its deploy verb must start the segment.
const DEPLOY = [
  /^npm run deploy(:\S*)?(\s|$)/,
  /^firebase deploy(\s|$)/,
  /^wrangler (deploy|publish)(\s|$)/,
  /^netlify deploy(\s|$)/,
  /^vercel (deploy(\s|$)|.*--prod(\s|$))/,
  /^gcloud (app|functions|run) deploy(\s|$)/,
  /^(fly|flyctl) deploy(\s|$)/,
  /^(serverless|sls) deploy(\s|$)/,
  /^gh workflow run\s+\S*deploy/,
];

// Changing repository visibility, e.g. `gh repo edit --visibility public`.
const VISIBILITY = [/^gh repo edit\b.*\s--visibility(\s|=|$)/];

export const HARD_BLOCK_MESSAGES = Object.freeze({
  forcePush: 'HARD BLOCK: Force push is never allowed. Push without --force, or ask the operator.',
  branchDelete: 'HARD BLOCK: Branch deletion (git branch -D) is never allowed. Ask the operator.',
  deploy: 'HARD BLOCK: Deploys are never run from the thread. Ask the operator to deploy.',
  visibility: 'HARD BLOCK: Changing repository visibility is never allowed. Ask the operator.',
  engineLock: 'ENGINE LOCK',
});

// Returns the hard-block reason for one command segment, or ''.
export function hardBlockSegmentReason(segment) {
  const s = String(segment ?? '').trim();
  if (!s) return '';
  const tokens = s.split(/\s+/);
  if (tokens[0] === 'git') return gitHard(tokens);
  if (DEPLOY.some((re) => re.test(s))) return HARD_BLOCK_MESSAGES.deploy;
  if (VISIBILITY.some((re) => re.test(s))) return HARD_BLOCK_MESSAGES.visibility;
  return '';
}

// True when a single segment is a hard block (used by the doctor allow-list).
export function isHardBlockedSegment(segment) {
  return hardBlockSegmentReason(segment) !== '';
}

// Full check for one Bash command. `spoke` is true when the repo is not claude-harness-hub,
// which turns on the engine lock. Returns a reason string, or '' when nothing matches.
export function hardBlockReason({ command, spoke = false } = {}) {
  const cmd = String(command ?? '');
  for (const part of cmd.split(SEGMENT_SPLIT)) {
    const reason = hardBlockSegmentReason(part);
    if (reason) return reason;
  }
  if (spoke) {
    const reason = bashWriteReason(cmd);
    if (reason) {
      return `${HARD_BLOCK_MESSAGES.engineLock}: This command would change harness-owned files, because ${reason}. Harness files change only in claude-harness-hub. Use the Edit tool on spoke files, or ask the operator.`;
    }
  }
  return '';
}
