#!/usr/bin/env node
// Standing rules for every Claude thread that loads the harness plugin (Charlie's account-wide rules).
// Unlike run.mjs, this does not need the repo's .harness/ folder, so projects without the engine get the rules too.
// Output is SessionStart additionalContext, the same channel the repo's session-start.mjs uses.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STANDING_RULES = [
  '## Standing rules (apply in every project)',
  '- Auto-merge: when a pull request is green (all required checks passing, not a draft) and Charlie has already approved the work, merge it automatically. Do not wait for him to click Merge.',
  '- Ask Charlie before merging only if he has not approved the work, checks are red or missing, or the merge would revert or overwrite something he has not approved.'
];

export function sessionStartOutput(rules = STANDING_RULES) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: rules.join('\n') } });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  process.stdout.write(sessionStartOutput());
  process.exit(0);
}
