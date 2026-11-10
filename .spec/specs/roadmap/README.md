# Roadmap stages 14 to 21

Source: the research and plan doc "Music Visualizer: Research, Priorities and Plan" (https://claude.ai/artifact/JrH4xcaL4Ygm4m7b7ZqLMe) and `docs/ideas.md`. Charlie confirmed the stage order and the decisions below on 2026-11-10.

| Stage | File | Was called | Depends on |
|---|---|---|---|
| 14 Trust and foundations | `stage-14-trust-foundations.md` | A | none |
| 15 Studio clarity and quick wins | `stage-15-studio-clarity.md` | B | 14 |
| 16 Performance | `stage-16-performance.md` | C | 14 |
| 17 Reactive background | `stage-17-reactive-background.md` | D | 14, 15 |
| 18 Warp field, blur chain, colour | `stage-18-warp-blur-colour.md` | E | 16 |
| 19 Shapes and particles | `stage-19-shapes-particles.md` | F | 15, 18 |
| 20 Generators and preset overhaul | `stage-20-generators-presets.md` | G | 18, 19 |
| 21 Public release | `stage-21-public-release.md` | H | 16 |

## Decisions (Charlie, 2026-11-10)
- Supabase sign-ups were on until Charlie turned new sign-ups off on 2026-11-10. Accounts created before that could still use the admin-role rule, so Slice 14.1 goes first and checks existing accounts.
- Phone support is basic for now: file and microphone.
- ReactionDiffusion is retired.
- Near-duplicate presets move to a separate review folder. They are not deleted.
- Legacy bars, waveform and rings layers fold into Shape only after an audit shows Shape gives a similar level of function and reactivity.
- Visitor preset sharing (a marketplace) is a future design. Out of scope here.
- Benchmark devices: Mac, Windows machine, one integrated-graphics laptop, one mid-range phone.
- Charlie asked for Sonnet agents to execute these stages (thread message, 2026-11-10).

## Rules for the agent executing a stage
1. Work one stage per thread, on its own branch from the latest `main`.
2. Before the first slice, copy that stage's slice lines into `.spec/PROGRESS.md`. Keep PROGRESS under 60 lines: archive finished stages to `.spec/HISTORY.md` first.
3. One slice `[IN_PROGRESS]` at a time. Do not start the next until the current one is verified.
4. Target files were written from a code review, not from a build. Read them before starting a slice. If the real files differ, correct the slice line first. If the scope itself is wrong, stop and ask Charlie.
5. Every slice: `npm run typecheck && npm test && npm run build && npm run lint`, once after the final edit. Report real output. `[UI / VISUAL]` slices still run the full command here because several touch shared shaders.
6. Finish each slice with `node .harness/scripts/finish-slice.mjs "<message>"`. Never hand-stamp trailers. No bootstrap exceptions.
7. Slices marked `🖐` change what Charlie sees. Tell him what to look at on the live site after merge.
8. Old presets must keep loading and looking the same unless the slice says otherwise. Add a migration on load when a control is renamed, merged or removed.
9. No test-only code paths. A test must exercise the same code the app runs.
10. Charlie does not use a terminal. Any step he must do is written as web-UI clicks.

## Known gaps in these documents
- No performance number was measured on a device. Stage 16 starts with a benchmark.
- File and line references come from review agents. Two serious claims were confirmed directly: the call-stack test rigging and the `user_metadata` rule.
