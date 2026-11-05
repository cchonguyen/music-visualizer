---
description: Record slice start, blockers, and completion in the dashboard state (.spec/STATE.json) for the current repo.
allowed-tools: Bash(node bin/update-state.mjs*), Bash(bin/verify-slice.sh*)
---
Apply the dashboard and slice tracking rules in CLAUDE.md ("Dashboard and slice tracking (required)"). Run them without asking:
1. Starting a slice or milestone: run update-state.mjs with `--slice-id`, `--slice-title`, `--intent`, and `--stage Implementation`.
2. Blocker or human decision needed: run update-state.mjs with `--add-decision '<id>:<question>:<contextFile>'`.
3. Coding complete: run `bin/verify-slice.sh`. It sets `Claimed`, then `Verified` on a pass. Then end with a one-line receipt asking the operator to click "Accept Verified Slice".
Report each command's exact output. Do not set Verified or Accepted by hand.
