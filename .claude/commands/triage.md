---
description: Run factual Scout discovery triage on a problem statement or feature idea and record .spec/SCOUT.md
---
1. Spawn the `discovery` subagent (Haiku) to analyze: "$ARGUMENTS".
2. In the main session, write the returned Scope Brief and "Do NOT Build" list into `.spec/SYSTEM_SPEC.md` (Section 1 & 2) and update `.spec/OVERVIEW.md`.
3. Write factual metrics to `.spec/SCOUT.md`:
   ```
   Files-Touched: <number>
   Contract-Change: <yes|no>
   Cross-Module: <yes|no>
   ```
4. Output a 1-line receipt with the recommended execution level (Level 1: Goldfish /quick-fix, Level 2: Sonnet /spec, Level 3: Opus /spec opus).
