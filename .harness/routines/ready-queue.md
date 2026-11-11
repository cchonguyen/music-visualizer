# Harness ready queue

Purpose: start the oldest released slice in each repo, under the harness rules.

This file is the routine's prompt. The routine is a scheduled Claude Code trigger. It runs in a cloud session with the listed repos attached.

## Steps

1. Read `.harness/board.json`. Its `repos` list is the set of repos to check.
2. For each repo, list open issues labelled `slice` and `status:ready` with the GitHub MCP `list_issues` tool. Never use `gh`. Sort oldest first. Skip any issue that also carries `status:blocked-on-operator`, `status:blocked`, `needs-input` or `status:in-progress`.
3. Skip a repo that already has a slice in progress. That means any of these:
   - a `status:in-progress` slice issue
   - an open PR from a `claude/` branch that closes a slice issue
   - an `[IN_PROGRESS]` line in its `.spec/PROGRESS.md`

   Take at most one slice per repo per run.
4. For the chosen issue, look for a slice line in `.spec/PROGRESS.md` that carries `Issue: #N`. If none exists, write the slice with `/spec` from the issue body. `Target files:` are required. If you cannot know them, comment `/needs-me <question>` on the issue and stop for that repo.
5. Implement the slice under that repo's `CLAUDE.md`:
   - start the slice
   - delegate to `harness:gf-coder`
   - run the verification commands
   - run `finish-slice`
   - push, then open the PR with `Closes #N` in the body

   The issue-status workflow moves the label. Never set status labels by hand.
6. If you are blocked, comment `/block <reason>` or `/needs-me <question>` on the issue. Then move on to the next repo.
7. If the queue is empty, do nothing. Post nothing. End the run.

## Guardrails

- Never take an issue labelled `status:blocked-on-operator`.
- Never take a `gate-change` issue unless Charlie moved it to Ready on the board (or commented `/ready` on it).
- Never force-push, delete branches or deploy.
- Never merge a PR whose checks are red.
- Follow each repo's standing rules. In music-visualizer, every change is a slice.
- Never give Charlie terminal steps. If he must act, write web-UI steps only.

## Output

Your final message is a one-paragraph run summary. Say what you started and what you skipped, with the reason for each skip.
