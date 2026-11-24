# Stage 32: Auto-Cycle Upgrades (Sector 530)

**Status:** Direction approved by Charlie (2026-11-24, project thread: "Plan out the upgrades as well. They sound reasonable and I approve this direction."). Planned after Stage 31.
**Coordinate:** `530` (`.spec/specs/stage-32-upgrades.md`)

## Goal
Make auto-cycle keep moving through quiet passages, and let it cycle only your favourites.

## Facts checked against the code (2026-11-24)
- In "On strong beats" mode, `AutoCycler.next` in `src/presets/autoCycle.ts` switches only on a strong beat after the minimum gap (default 8 s). In a breakdown with no kicks the same preset can stay on screen indefinitely.
- The unused copy deleted in Slice 31.1 (`autoCycler.ts`) had a fallback that never shipped: switch anyway 3 s after the minimum gap with no beat.
- `CycleOptions.favouritesOnly` is read by `eligible()` and saved with the other cycle settings, but the Visuals menu has no switch for it. With fewer than two favourites the pool is empty and cycling stops without saying why.

## Slices
- **32.1 Beat mode keeps moving in quiet passages** `[CORE / DATA]`: in beat mode, switch when no strong beat has come for a fallback time after the minimum gap (3 s, a new `BEAT_FALLBACK_SEC` constant). `upcoming()` announces the fallback switch the same way, so the next preset is prepared in time. Target files: `src/presets/autoCycle.ts`, `src/presets/autoCycle.test.ts`.
- **32.2 "Favourites only" switch for auto-cycle** `[UI / VISUAL]`: a checkbox beside Shuffle in the Visuals menu, saved like the other cycle settings. With fewer than two favourites, `eligible()` falls back to every preset and the checkbox tooltip says so. Target files: `index.html`, `src/ui/controls.ts`, `src/presets/autoCycle.ts`, `src/ui/controls.test.ts`, `src/presets/autoCycle.test.ts`.

## Looked at and not planned
- **Smaller startup download.** Measured after Stage 31: the startup files are 579 KB (165 KB gzipped), down from 588 KB (167 KB). The Studio (246 KB) already loads only when opened. Most of what is left is the renderer's layer code and the built-in presets, which the first frame needs. Loading layer code per preset would need the scene builder to become asynchronous, which is a large change for a small gain. Moving the control descriptions out would save about 6 KB gzipped. Neither is worth it now.

## Verify (each slice)
`npm run typecheck && npx vitest run --maxWorkers=4 && npm run build`
