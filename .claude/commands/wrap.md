---
description: Close a slice safely. Runs the verification gate and requires at least one recorded decision before completion.
allowed-tools: Read, Write, Edit, Bash(node bin/update-state.mjs*), Bash(bash bin/verify-slice.sh*), Bash(git rev-parse*), Bash(git status*)
disable-model-invocation: true
---
1. Run the verification gate: `bash bin/verify-slice.sh`. Report its exact output. If it exits non-zero, stop. Do not mark the slice complete.
2. Check for recorded decisions. Read `.spec/STATE.json` and count `recentDecisions`.
   - If the count is zero, do not ask. Run `node bin/update-state.mjs --bypass-decisions 'No architectural decision in this slice; logged by default'` and report it in the receipt. If a human has given a decision in this thread, record it with `--add-recent` instead, as the step already says.
   - If the human answers with a decision, record it with `node bin/update-state.mjs --add-recent "<id>:<tradeoff>:<decision>:.spec/decisions/<id>.md"` and write the matching `.spec/decisions/<id>.md`.
   - If the human answers `none` or explicitly asks to skip the gate, log the bypass with `node bin/update-state.mjs --bypass-decisions '<reason>'` (reason of at least 10 non-whitespace characters). This adds a `bypass-*` entry to `recentDecisions` with `tradeoff: none`.
   - Step 2 is complete only after either `--add-recent` or `--bypass-decisions` has been run.
   - Do not invent a decision.
3. Only after steps 1 and 2 pass, mark the slice complete in `.spec/PROGRESS.md` and stop.
4. Do not set stage `Verified` or `Accepted` by hand. `verify-slice.sh` sets `Verified`; `accept-slice.sh` sets `Accepted` with human confirmation.
5. Do not commit, push, or open a pull request here. Those happen only after the human approves.
6. Output a one-line receipt that names the slice, the verification result, and the number of decisions recorded.
