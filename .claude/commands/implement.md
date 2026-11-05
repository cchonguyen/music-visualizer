---
description: Implement the next pending slice in .spec/PROGRESS.md by hand, following CLAUDE.md. No subagents, no hooks.
argument-hint: [optional: slice id, e.g. 7.1]
allowed-tools: Bash(node *), Bash(git *), Bash(npm *)
---
Implement the slice named by `$ARGUMENTS`, or the first pending slice if none is given. Do the work in this session. Do not look for or spawn subagents, because threads cannot load them. The rules are in CLAUDE.md.

1. Start clean. Run `git status --short`. If `.spec/` has uncommitted edits, commit them first so the slice starts from a clean tree.
2. Pick the slice. Use the named id, or the first `- [ ]` or `[PENDING]` slice in `.spec/PROGRESS.md`. If its `Target files:` are missing or unclear, end with a `Needed from you:` block asking for them. Do not guess.
3. Lock the slice. Change its line to `[IN_PROGRESS]` in `.spec/PROGRESS.md`, and commit that change alone as `docs(spec): mark Slice <id> [IN_PROGRESS]`.
4. Build it. Edit only the listed `Target files:`. Honour the colour tag: `[UI / VISUAL]` needs typecheck only, `[CORE / DATA]` needs tests written and passing.
5. Verify once after the final edit, with both commands in CLAUDE.md under Verification. If the same error repeats twice, stop and ask.
6. Finish with `node .harness/scripts/finish-slice.mjs "<commit message>"`. Then run `node .harness/scripts/pr-scope-check.mjs origin/main HEAD` and report any findings.
7. Push with `git push -u origin <branch>`. On network errors only, retry up to 4 times with 2, 4, 8 and 16 second waits. Open the pull request as ready for review. Put the verification output in its description, then follow the Git and pull requests section of CLAUDE.md.
8. Reply with one receipt line: `✓ Slice <id> committed on <branch>: <PR link>`. If anything stopped the work, add the reason on that line.
