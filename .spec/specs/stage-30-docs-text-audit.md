# Stage 30: Docs, Comments & UI Text Audit (Sector 500)

**Status:** Approved by Charlie's request (2026-11-24, project thread: "Do a full audit of documentation and code base and clean up any outdated docs, specs, and comments. Audit tooltips, instructions, and other descriptive text and make sure that things are still clear and understandable.").
**Coordinate:** `500` (`.spec/specs/stage-30-docs-text-audit.md`)

## Goal
Make every document, code comment and piece of on-screen text match what the app does today, and make on-screen text clear to someone who has never seen the code.

## Hard boundary
Text only. No change to behaviour, rendering, preset values, storage keys, ids, CSS classes or event wiring. Tests change only where they assert an exact string that this stage rewrites.

## Facts checked against the code (2026-11-24)
- 37 built-in presets ship: 31 numbered presets (01–11, 13–32), plus 6 classics and textures (Crown, Flight, Bars, Vortex, Ripple Field, Dust Wave). Preset 12 (Reaction-Diffusion Coral) and the starter pack sit in `src/presets/review/` and are not in the app.
- System folders: Showcase (13–32), Flagship (01–11) and Classics & Textures. The labels still said "Stage 9 Showcase (13–20)" and "Flagship Generative (01–12)".
- Layer types the app draws (`LAYER_FACTORIES` in `src/presets/loader.ts`): shape, tunnel, particles, crown, rings, shockwave, bars, bassPulse, moire, spectralTerrain, chladniSand, ferrofluid, julia, orbit, architecture (15). Reaction-Diffusion was retired in Slice 15.10; legacy waveform layers load as Shape.
- Keys handled: Space, arrows, F, P, M, K, period, 0–9, [ ], C, B, X, E, Shift+E, A (hold), ?, D (debug panel), Esc. There is no Tab or H shortcut, which the old README listed.
- Tests: 1,849 across 83 files. The repo has no lint script.
- Target browsers: desktop Chrome and Edge (SYSTEM_SPEC section 1). Safari and Firefox are not supported targets.

## Slices
- **30.1 Docs and specs:** README, CLAUDE.md project facts, OVERVIEW, ATLAS, SYSTEM_SPEC status notes, SCOUT, `docs/` plan files (status lines say what was built), and a `docs/README.md` index.
- **30.2 Player and menu text:** tooltips, labels, hints and notices in `index.html`, `popout.html` and `src/ui/`, the shortcuts list, and the system folder names.
- **30.3 Studio text:** control labels and hover descriptions in the preset schemas, warp operators, link recipes and Studio panels.
- **30.4 Code comments:** comments that contradict the code (wrong counts, removed files, "planned" notes for shipped work).

## Verify (each slice)
`npm run typecheck && npx vitest run --maxWorkers=4 && npm run build`
