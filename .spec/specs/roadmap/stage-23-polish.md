# Stage 23: Polish after Stage 22

Charlie chose option A on 2026-11-13. Stage 22 works on the live site. No defects were reported.

## 23.1 Pop-out refreshes when the preset list changes `[CORE / DATA]`
- The session has no change event, so the pop-out host compares a signature of the preset list (ids and names, in order) on its existing 2 s timer. When the signature differs and a pop-out is connected, it sends a fresh snapshot.
- Target files: `src/studio/popoutHost.ts`, `src/studio/popoutHost.test.ts`.
- Done when: adding, renaming or removing a preset sends one new snapshot within about 2 s. No change sends nothing extra. Nothing is sent when no pop-out is connected.

## 23.2 Per-preset display time `[CORE / DATA]`
- Preset gains an optional `displaySec` (5 to 300 s). Absent means today's behaviour.
- In Timer mode the cycler uses the shown preset's `displaySec` instead of the global interval. Beat and Phrase modes ignore it. Out-of-range values are clamped when read. Presets without it save and load as before.
- Blend time already exists as the Transition "Crossfade" seconds, so no `blendSec` is added.
- Target files: `src/presets/format.ts`, `src/presets/format.test.ts`, `src/presets/autoCycle.ts`, `src/presets/autoCycle.test.ts`, `src/main.ts`.

## 23.3 Studio control for display time `[UI / VISUAL]`
- A "Display time" slider in the Studio Transition group, with reset to default. Edits flow to the pop-out through the existing edit path.
- Target files: `src/presets/layerSchemas.ts` or the Studio transition spec site (confirm when locking), `src/studio/studio.ts`, `src/studio/studio.test.ts`.

## 23.4 Pop-out browser check (throwaway, no repo change)
- Playwright in this container against the built site. Checks: an edit in the pop-out reaches the visual window, the blocked-popup toast shows, the narrow-screen label fits, and a list change reaches the pop-out. Results go in the final report. Nothing is committed (Charlie, 2026-11-13).
