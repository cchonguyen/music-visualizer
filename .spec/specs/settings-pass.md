# Settings pass

Status: decided 2026-11-06. Stage 11 in `.spec/PROGRESS.md`.

## Problem

The app has three control surfaces, and they do not match each other:

- **Studio panel.** Uses the Tweakpane-based sheet and buttons from Stage 9 and 10. It closes at the top.
- **Shortcuts dialog.** A native dialog with its own button and slider styles. It closes at the bottom, which is below the fold on phones, so a phone user may never see the close control.
- **Controls bar.** Uses hard-coded hex colours and 6 px radii. It has no close control, and it fades when idle.

Each surface uses different button, slider and text styles, and each closes in a different place. A user who learns one surface has to relearn the next.

## Decisions (from Charlie, 2026-11-06)

- Phones and accessibility are in scope now.
- Desktop follows the same style as phones. One style for all sizes.
- Consolidating and grouping related controls is in scope.
- No new settings or features.
- No change to Tweakpane, the native Shortcuts dialog, the renderer, or the preset format.

## Requirements

### 1. Shared tokens

- Define shared tokens on `:root` in `src/style.css` for:
  - button colours, padding and minimum size,
  - slider track, thumb and fill colours,
  - text colours and sizes,
  - radii.
- The controls bar moves off its hard-coded hex values and its 6 px radii, and uses the shared tokens.
- The Studio panel and the Shortcuts dialog use the same tokens. No surface keeps its own copy of a value.

### 2. One close pattern

Every surface (Studio panel, Shortcuts dialog, controls bar) gets the same close behaviour:

- A visible button labelled "Close".
- The button sits in the same header position on every surface, at the top right.
- Touch target is at least 44 px square under 600 px wide.
- Escape closes the surface.
- When the surface closes, focus returns to the element that opened it.

The Shortcuts dialog no longer relies on a close control at the bottom.

### 3. Phone grid and grouped controls

- Under 600 px, the controls bar and the Studio sections use a single-column grid.
- Related controls are grouped together, and each group has a visible label. For example, audio controls form one group, and render quality and aspect form another.
- Grouping changes layout only. No control is added, removed, or renamed in its behaviour.

### 4. Accessibility

- Range inputs and the Calm checkbox are at least 44 px tall under 600 px wide.
- Delete in the Studio panel uses a two-step "Tap again" confirmation. The "Tap again" state is announced through an `aria-live` region.
- The controls bar, when it fades for idleness, is removed from the focus order. A hidden control cannot take focus. It returns to the focus order when the bar is shown again.
- Text and borders on the dark surfaces meet WCAG AA contrast:
  - text at least 4.5:1 against its background,
  - UI borders and control outlines at least 3:1.

### 5. Layout

- No horizontal scrolling from 280 px to 600 px wide, on every surface.

## Out of scope

- New settings or new features.
- Replacing Tweakpane or the native Shortcuts dialog.
- Any change to the renderer.
- Any change to the preset format.
- A second-window Studio (tracked as T4).

## Verification

- `npm run typecheck` and `npm run build` gate every slice.
- `[CORE / DATA]` slices add unit tests and must pass them with `npm test`.
- `[UI / VISUAL]` slices are checked in a browser at these sizes:
  - 360 x 740 (small phone),
  - 390 x 844 (phone),
  - 768 x 1024 (tablet),
  - 1440 x 900 (desktop).
- Browser checks report `getBoundingClientRect` numbers where possible. The report gives the measured width, height, and position of each close button, slider, and checkbox, and the page scroll width at each size.
- Contrast is checked by measuring the actual colours used on the dark surfaces, not by eye.

## Slices

Planned in `.spec/PROGRESS.md` under Stage 11:

1. **11.1 Shared tokens.** Token definitions on `:root`, controls bar moved to tokens, buttons, sliders and text use tokens.
2. **11.2 One close pattern.** Close button, Escape, and focus return on all three surfaces.
3. **11.3 Phone grid and grouped controls.** Single-column grid under 600 px, grouped and labelled sections.
4. **11.4 Accessibility fixes.** Touch sizes, `aria-live` for Delete, focus removal for the faded bar, contrast fixes.
