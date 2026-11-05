---
description: Package the exact failure trace for @root-cause-solver after a 2-strike breaker or a stuck error
allowed-tools: Read, Write, Bash(git diff*), Bash(git status*)
disable-model-invocation: true
---
1. Find the last failed build or test command in this session and its output. Find the file currently being edited.
2. Extract the failure message and its stack or assertion lines. Cap the excerpt at 25 lines. Remove memory addresses (any `0x` followed by hex digits) and replace each with `<addr>`.
3. Write `.spec/DEBUG_PACKET.md` with this structure:
   - First line, exactly: `@root-cause-solver Please diagnose this failure and provide an atomic code replacement.`
   - `Command:` the failed command.
   - `File in focus:` the file currently being edited, with its path.
   - `Failure excerpt:` the capped excerpt in a fenced code block.
4. Output this receipt only: `✓ Debug packet written to .spec/DEBUG_PACKET.md for @root-cause-solver.`
