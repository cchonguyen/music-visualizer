# Spec: Mobile Studio panel with the shortcuts design language

Status: draft. Nothing is built. Three decisions for Charlie are below (D1 to D3). Build waits for the single `[IN_PROGRESS]` slot, which slice 7.4 holds on main (see `.spec/specs/responsive-fit.md`).

## Problem (verified in code, 2026-11-06)
- **Studio is not phone-shaped.** It is a Tweakpane pane in `#studio`, fixed to the right edge at 320 px with `max-width: 90vw` (src/style.css:35). No `@media` rule covers it. The phone rules cover only the controls bar and the shortcuts dialog.
- **Studio rows are below touch size.** Tweakpane brings its own fonts, radii and row heights, and nothing overrides them yet. Rows and buttons sit well under the 44 px minimum the shortcut keys already meet (src/style.css:23). Inferred from library defaults, not yet measured in a browser.
- **Studio cannot be opened on a phone.** The controls bar (index.html:22-50) has no Studio button. The only route is the E key, listed in Shortcuts (index.html:68). A phone has no keyboard.
- **Closing is unclear.** The part of `src/studio/studio.ts` I read (lines 1 to 250) has no close control, so only E hides the panel. The rest of the file still needs checking before build.
- **Native dialogs.** Save as uses `window.prompt` and Delete uses `window.confirm`. They look nothing like the rest of the UI and are awkward on a phone.
- **The shortcuts language already exists.** Surface #111, control #222, border #444, text #eee, accent #2d5bd8, focus ring #ffd54a. Radii are 4, 6 and 10 px. Keys are 44 px on touch. Under 600 px the list is a three-column tile grid (src/style.css:19-64).

## Decisions for Charlie

**D1. How far the rounding goes.**
- **A (recommended):** one token set (surfaces, borders, accent, radius, spacing) applied to both the shortcuts dialog and Studio in one pass. The two stay matched, and the shortcuts list gets the softer corners too.
- **B:** only Studio adopts the tokens. Shortcuts keep their current 4 to 10 px radii. Cheaper, but the two drift apart again.

**D2. Studio's phone layout (below 600 px).**
- **A (recommended):** bottom sheet. Slides up from the bottom, at most 80% of the screen tall, rounded top corners, a drag handle, scrolls inside itself. Sits in thumb reach.
- **B:** full-screen sheet with a sticky header and a Close button. More room, but hides the visuals behind it.
- Desktop stays a right-side panel: 320 px wide, 12 px inset from the edges, rounded.

**D3. How Studio opens.**
- **A (recommended):** add a visible Studio button to the controls bar at every width. E still works on desktop.
- **B:** show the button on phones only. Desktop keeps the E key alone.

## Requirements
1. **Tokens.** Define them once on `:root` in `src/style.css`: `--surface`, `--surface-2`, `--border`, `--text`, `--muted`, `--accent`, `--focus`, and three radius steps (proposed 12 px for controls and keys, 20 px for panels and sheets, 8 px for small chips). Values are proposals for Charlie to approve by eye.
2. **Shared surfaces.** The shortcuts dialog and Studio both read the tokens (per D1). Shortcut keys keep their 44 px minimum and the phone tile grid keeps its layout.
3. **Studio on a phone (below 600 px).** Per D2. Full width, scrolls inside, safe-area padding at the bottom using `env(safe-area-inset-bottom)`. Every Studio control has a 44 px touch target. The Tweakpane overrides go through its `--tp-*` CSS variables. The exact variable names must be checked in the installed Tweakpane 4.0.5 before build.
4. **Studio on desktop.** Right-side panel, same token look, width unchanged (320 px).
5. **Open and close.** Open with the button (per D3) or E. Close with E, Escape, or a Close button in the header. Focus moves into the panel on open and returns to the opener on close.
6. **No native dialogs.** Save as shows an in-panel text field with OK and Cancel. Delete uses a two-tap confirm button ("Delete", then "Tap again to delete"). The saved data does not change.
7. **Behaviour unchanged.** Layers, presets, undo and redo, the link editor, morph and the frame-time readout keep working as they do. Only the look and the open and close paths change.
8. **Accessibility.** Focus ring stays `#ffd54a`. Labels stay. The panel is a `role="dialog"` with an accessible name.
9. **Layout.** No horizontal scroll from 280 px to 600 px wide. Keep the 16 px side gutter.
10. **Out of scope.** Replacing Tweakpane, new controls, a light theme, changing the shortcut list, the second-window Studio (T4), and any change to the renderer.

## Target files (by slice)
- `src/style.css`: tokens, Studio and shortcuts surfaces, phone sheet, Tweakpane variable overrides
- `index.html`: Studio button in the controls bar (D3), Close button in the Studio header
- `src/main.ts`: Studio open and close wiring, Escape handling
- `src/studio/studio.ts`: in-panel name field and two-tap delete, header close
- `src/studio/studio.test.ts` [NEW]: tests for any pure helpers added in slice 9.4 (no DOM tests unless the harness already has a DOM setup)

## Proposed slices (numbered when the slot frees)
- **Slice 9.1: Shared tokens and shortcuts restyle** `[UI / VISUAL]`. Target files: `src/style.css`, `index.html`. Verify: `npm run typecheck && npm run build`.
- **Slice 9.2: Studio open and close affordance** `[UI / VISUAL]`. Target files: `index.html`, `src/main.ts`, `src/studio/studio.ts`. Verify: `npm run typecheck && npm test && npm run build`.
- **Slice 9.3: Studio phone sheet and touch sizes** `[UI / VISUAL]`. Target files: `src/style.css`, `src/studio/studio.ts` (class names only). Verify: `npm run typecheck && npm test && npm run build`.
- **Slice 9.4: Replace native prompt and confirm** `[CORE / DATA]`. Target files: `src/studio/studio.ts`, `src/studio/studio.test.ts` [NEW]. Verify: `npm run typecheck && npm test && npm run build`. Tests must pass before the slice closes.

## Verification
- Typecheck and build gate every slice. `[CORE / DATA]` slices add tests and must pass them.
- Browser check with the pre-installed Chromium at 360x740, 390x844, 768x1024 and 1440x900. Measure Studio tap targets with `getBoundingClientRect` and report the numbers. Screenshots at deviceScaleFactor 2 go in the PR.
- Charlie signs off the look by eye, as on the other 🖐 slices.
