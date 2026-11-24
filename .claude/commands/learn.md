---
description: Record a new operator rule in this project's .claude/project-rules.md (hub-wide only on request)
argument-hint: [rule in plain English] | promote <candidate>
allowed-tools: Bash(node *), Edit, Write, mcp__github__create_pull_request
disable-model-invocation: true
---
0. If `$ARGUMENTS` starts with `promote`, do not add a rule. Instead, move the named candidate (by its text or number) from `## Pending Rule Candidates — not in force` to `## Active Project Rules` in `.claude/project-rules.md`. Then output a 1-line receipt and stop.
1. Otherwise, append the rule concisely under `## Active Project Rules` in `.claude/project-rules.md`:
$ARGUMENTS
   The active section holds at most 15 rules. If it is full, ask which one to retire, in a `Needed from you:` block, and stop.
   This file belongs to the project, so it is never locked and sync never overwrites it.
2. Stop here unless the operator said the rule applies to every project. Then:
   - Write the 1-line rule summary into `.spec/.learn-staging.txt` with the `Write` tool.
   - In the hub repo (this repo when it is the hub, or the attached hub checkout), add the rule under `## Learned Operator Rules` in `.claude/harness-rules.md`. Never edit `.claude/harness-rules.md` in a spoke: sync overwrites it.
   - Run `node "${CLAUDE_PROJECT_DIR}/.harness/scripts/hub-sync.mjs" push`. If it prints `HUB_BRANCH_PUSHED repo=<owner/repo> branch=<branch> base=<base>`, open a pull request for that branch into `<base>` with GitHub MCP `create_pull_request` (title: the rule summary). If it prints `HUB_NOT_ATTACHED`, show its `Needed from you:` block verbatim.
3. Output a 1-line receipt naming the file the rule went into, plus "PR opened: <url>" when step 2 opened one.
