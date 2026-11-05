# Claude Code Harness Contract (v3.2)

## Core Communication & Silent Batching Rules
- **Substantive Inception:** Start immediately with output or action. Zero pleasantries, apologies, or filler.
- **Anti-Echo Protocol (always):** Never reprint full files, unchanged code blocks, `.spec/HANDOFF_PACKET.md`, or `.spec/BRIEFING_PACKET.md`.
- **Silent Batching & 1-Line Receipts:** Hooks and scripts automatically queue operational telemetry into `.spec/STATUS_BATCH.jsonl` for the Gemini Briefing Agent. When an autonomous slash command (`/init-harness`, `/triage`, `/spec`, `/implement`, `/prep-audit`, `/ingest-feedback`, `/sync-harness`, `/learn`, `/checkpoint-handoff`, `/prep-debug`, `/review-pr`, `/pickup`, `/brief`) completes, output ONLY a 1-line receipt (e.g., `✓ Updated .spec/PROGRESS.md: Slice 2 verified.`). Never spend chat output tokens narrating multi-paragraph status updates under the hood; delegate status digests to `.spec/OVERVIEW.md` (at milestones) and the Gemini Briefing Agent (`/brief` or Antigravity `brief me`).
- **Deterministic Step-by-Step Instructions:** Never give vague directions. Always write explicit, numbered click-by-click steps: `Step 1: Go to [URL] -> Step 2: Click [Tab] -> Step 3: Paste into [Field]`.
- **Dedicated Action Footer:** Omit closing questions when working autonomously. ONLY when blocked on human input, an Upshift Threshold pause, or external Gemini review, conclude with:
  ---
  Needed from you:
  1. [Exact step-by-step action or decision required]

## Model Tiering & Cognitive Modes (Elephant vs. Goldfish)
- **The Elephant (Planning & Spec Finalization):** Standard `/spec` uses `architect` (**Sonnet**). Complex multi-system planning or spec finalization uses `architect-opus` (**Opus**) based on factual `.spec/SCOUT.md` Level 3 assessment or explicit `/spec opus`. Always announce dispatch: `🐘 Dispatching Elephant subagent (<name>)...`.
- **The Goldfish (Implementation & Verification):** Main session orchestration (`settings.json`), all direct implementation of clearly spec'd slices (`engineer`), `discovery`, `auditor`, and handoff housekeeping (`clerk`) run on **Haiku**. Escalates to `engineer-sonnet` (**Sonnet**) when explicitly requested via `/implement sonnet`.
- **Opus Strictly Forbidden for Goldfish:** Opus is never dispatched for slice coding, unit testing, PR reviews, or debugging.
- **Factual Scout Routing:** `/triage` writes factual metrics to `.spec/SCOUT.md`. `evaluate-upshift.mjs` maps these deterministically to level and agent with zero bureaucratic auth tokens.

## Work Modes (read from `.spec/PROGRESS.md`)
- **Vibe Mode (no `[IN_PROGRESS]` slice, or no `.spec/PROGRESS.md`):** Edit the requested files directly. Do NOT require `/triage` or `/spec` first. The harness snapshots the working tree at session start and advances a "last known green" checkpoint every time a test or build passes (lint and typecheck passes do not move it).
- **Slice Mode (exactly 1 `[IN_PROGRESS]` slice):** Strict single-task lock. Edit only `.spec/` files and the slice's declared `Target files:`. A slice-start checkpoint (`.spec/.slice-checkpoint`) is saved automatically when the line is marked `[IN_PROGRESS]`.
- **2+ `[IN_PROGRESS]` slices:** Edits are blocked. Keep only 1 active slice (or clear them all for Vibe Mode).
- **Manager Mode (`.spec/harness.json` says `"workMode": "manager"`):** With no `[IN_PROGRESS]` slice, source edits are blocked (PLAN LOCK). Plan with `/triage` or `/spec`, or make a one-file change with `/quick-fix`. Harness files, `.spec/harness.json`, and the harness block in `AGENTS.md` are locked in every mode.
- **Pending rule candidates:** Lines under `## Pending Rule Candidates — not in force` in `.claude/project-rules.md` are not rules. Do not follow them until the operator promotes one with `/learn promote`.
- **Main-red stop:** While origin has the tag `harness-main-red`, do not start a slice or a quick fix. Fixing main is the only work.

## Execution & Guardrail Rules
- **Verification in Vibe Mode:** Run the project's quick check from `CLAUDE.md` (`Project-Specific Commands`) **once per turn, after the final edit**, using the project's quiet flags. Do not re-run it after every single file edit.
- **Risk-Based Verification (Slice Mode):**
  - `[UI / VISUAL]` tasks: Run quiet typecheck only. Zero unit tests required.
  - `[CORE / DATA]` tasks: Write and pass automated unit tests before marking complete.
- **Non-Destructive 2-Strike Circuit Breaker:** If a build or test command fails twice in a row with the same error, STOP guessing and run `node .harness/hooks/pre-tool-guard.mjs --restore`:
  - Slice Mode: restores only the active slice's target files to the slice-start checkpoint.
  - Vibe Mode: restores every changed file (outside `.spec/`, `.claude/`, `.harness/`) to the last known green checkpoint. If nothing has passed yet this session, it only lists the changed files; offer that restore to the user instead.
  Then output a `Needed from you:` block offering `/prep-audit diff`. Missing tools or dependencies (exit 127, `command not found`, `No module named`) are not strikes: install the project dependencies and re-run.
- **Exploration Hint:** When you cannot locate the relevant code within 2 searches, delegate exploration to the `discovery` subagent (Haiku) or built-in Explore agent rather than reading large numbers of unfamiliar files into main context.
- **Zero Manual Script Burden:** Execute `.harness/scripts/*.mjs` via `node` directly on the user's behalf.

## Web-First Execution
- Run all scripts, tests, and git operations yourself in the Cloud container. Never ask the operator to run something you can run.
- When blocked, tell apart the two kinds of help and use the step-by-step `Needed from you:` format for both:
  - **Cloud Settings Click (preferred):** something the operator fixes in the Claude web UI, e.g. attaching a second repo to the session, allowing a network host, adding an environment secret.
  - **True Terminal Fallback (last resort):** only when the Cloud container physically cannot do it (another account's credentials, interactive OAuth, local hardware). Give one self-contained copy-paste command.

## External Co-Development (Google Antigravity & AI Studio)
- **Contract:** External relief implementors follow `.spec/EXTERNAL_AGENT_RULES.md`. `.spec/AI_STUDIO_RULES.md` is an alias that points to it.
- **Handoff format:** Every platform overwrites `.spec/SESSION_HANDOFF.md` with the same five fields, including `Last Active Platform`.
- **Zero-Turn Ingest on Return (`/pickup`):** When `.spec/SESSION_HANDOFF.md` names an external `Last Active Platform`, avoid multi-turn main-thread git exploration:
  1. Start a fresh session (`/clear`) and run `/pickup` (`node .harness/scripts/baton-pickup.mjs`) or delegate to the `clerk` / `auditor` (Haiku) subagent.
  2. If the external agent has not yet run quick checks (e.g. AI Studio), run the quick checks from `CLAUDE.md` once via `auditor` (Haiku) and record results in `.spec/SESSION_HANDOFF.md`. If Antigravity already verified and merged under `.spec/EXTERNAL_AGENT_RULES.md` section 4, trust the recorded receipt and proceed directly to the next slice without re-running checks in Claude.
- **Engine files:** External agents never edit `.claude/`, `.harness/`, or `.harness-version` in spoke repos. Those change only in this hub repo.
- **Audit Registry & Relay:** Review findings and verdicts are recorded in `.spec/AUDIT_VERDICT.json` and posted as PR review comments with structured verdicts (`CLEAN` or `NEEDS CHANGES`).

## Learned Operator Rules (Synced via `/learn`)
- Always preserve plain-English auditability in `.spec/OVERVIEW.md` at major feature milestones.
- When giving the operator steps to run in Terminal, always use labelled, one-per-stage fenced code blocks with full absolute paths and the expected result after each block. Every command must be complete and paste-ready: never a partial snippet, never "run the same as before", and never a path the operator has not confirmed. Before writing Terminal steps, confirm the project folder with a directory listing.
- **Standing approval to commit and open PRs:** Once the operator approves an implementation, commit the work and open a pull request for it without asking again. Do not merge, deploy, force-push, delete branches, close or reopen pull requests, or change repository visibility without the operator's explicit yes for that specific action. Merging stays an operator step.
