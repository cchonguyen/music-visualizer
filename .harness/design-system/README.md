Harness UI is the shared look of a suite of personal apps: dark by default, quiet neutrals, one neon signature hue per app, a mid-tone that joins the two, and typography that does the work decoration usually does.

This folder holds what code consumes: `tokens.css` and `bundle.css`. Load `tokens.css` first, then `bundle.css`, then the app's own `app.css`. All are plain CSS, so a React app and a server-rendered app use the same files. The hub owns this folder and sync delivers it to every project, so change it in `claude-harness-hub` only. `adopting.md`, `principles.md` and `voice.md` sit beside this file.

The live reference, with every token and component rendered in dark and light, is https://claude.ai/artifact/3oDGNem4W16ah61RnmcbQp. A change to a token or a component goes to both places in the same piece of work. Load the two hosted faces from Google Fonts: Newsreader (400, 500) and JetBrains Mono (400, 500).

## What holds everywhere, and what an app decides

Six rules are the floor. They hold in every app with no exceptions.

1. Colour comes from tokens. No hex or oklch value in a component.
2. Text holds 4.5:1 on its ground in both themes. Text on an accent fill uses `on-accent`.
3. State is never shown by colour alone. A word, tick or icon goes with it.
4. Focus is always visible: a 2 px `focus` outline, offset 2 px.
5. Tappable controls are at least `touch-phone` (44 px) tall below 640 px.
6. Every screen works at phone and desktop width, in every theme the app ships.

Rules 1 and 2 are the dual-theme guarantee, and `tokens.css` keeps both themes intact in every app. An app that is dark-native (a real-time visualizer, a canvas tool) may declare `theme-lock: dark`, or `theme-lock: light`, in `design-system/profile.md` with a one-line justification. It then sets `data-theme` on `<html>` once, ships a single theme, and skips dual-theme screen checks. Nothing else in the tokens changes.

Everything else on this page is a default. An app follows it unless it has a reason not to, and writes that reason in one line in its own `design-system/profile.md`. That file sits at the project root. It is the app's own, and sync never touches it.

An app always decides these for itself: its signature hue, its density preset, its own states, its content layouts, and any component this system does not have.

## Colour

Three layers, in fixed proportions. Neutrals carry about 85% of a screen, the mid-tone about 10%, the accent about 5%.

**Neutrals.** A zinc ramp with a slight cool bias. `bg` is the page, `surface` is anything that sits on it, `surface-raised` is anything that floats, `surface-sunken` is anything you type into. In dark mode, height is shown by a lighter surface, so shadows only support it. Never use pure black or pure white: `bg` and `text` stop short of both, which is what keeps dark mode from glaring.

**Accent.** Each app claims one signature hue from the neon set: `neon-violet`, `neon-magenta`, `neon-azure`, `neon-cyan`, `neon-lime`. Set it once with `data-accent` on `<html>`. Violet is the default. Components only ever read `accent`.

- In dark mode the accent is bright and its fill takes dark `on-accent` ink, like a lit sign. In light mode the same hue deepens and takes white ink.
- Spend the accent on five things: the primary button, links, the current navigation mark, selection, and active interactive value indicators. That last group is active filter pills and chips, toggle switches, range sliders and scrubbers (`accent-color: var(--accent)`), and the primary series of a chart. Nothing else.
- `good`, `warn` and `bad` never stand in for an active control. A switch that is on is accent, never green.
- `glow-accent` is the one glow. Use it on at most one element per screen. No gradients, no glowing text, no neon borders on ordinary cards.
- Two apps should sit at least 40° of hue apart, so the suite reads as a set.

**Mid-tone.** `mid`, `mid-line` and `mid-text` are the accent mixed into the neutrals: 20% into `surface-raised`, 40% into `line`, 50% into `text`. They soften the jump from gray to neon. Use them for hover fills, selected rows, quiet pills and informational notices. When an app changes its accent, `bundle.css` derives its mid-tone with the same recipe.

**State.** `good`, `warn` and `bad` are fixed in every app and under every accent, each with a `-tint` fill. They are never used as an app's signature, and the accent is never used as a state.

## Typography

Three faces, three jobs. The contrast between them is the main visual device of the suite.

- **Display: Newsreader.** A serif, set large and light with tight tracking. Use `display-xl`, `display-lg` and `display-md` for the page title, section titles, dialog titles and the app name. One display title per screen is the loudest thing on it.
- **Text: the system sans.** Utilitarian on purpose, and free to load. Use `heading`, `body`, `body-compact` and `caption` for everything a person reads or operates.
- **Mono: JetBrains Mono.** Use `label` in uppercase for eyebrows above fields and sections, and `data` with tabular numerals for counts, dates, durations and IDs. This is where the technical character comes from.

Components never name a typeface. They read three role variables: `--font-display`, `--font-sans` and `--font-mono`, which default to Newsreader, the system sans stack and JetBrains Mono. A serif display face does not suit every domain, so an app may override `--font-display` (for example to a grotesk for a real-time visualizer or a high-density utility tool). The override goes in the app's own `app.css`, loaded after the kit, and `design-system/profile.md` records it with one line of reasoning.

Rules:

- Differentiate with face, size and weight before reaching for colour or a box.
- Never set body copy or controls in the display face. Never set a paragraph in mono.
- Semibold (600) is the only emphasis weight in the sans. The display face stays at 400 or 500.
- Keep running text within `measure` (68 characters). Give titles `text-wrap: balance`.
- Two density presets and nothing between: comfortable uses `body` (15 px), compact uses `body-compact` (13 px). Display and mono sizes do not change with density.

## Shape, depth and motion

- Radius follows role: `radius-control` for things you press or type in, `radius-card` for things that hold content or float, `radius-dialog` for modals, `radius-pill` for pills and dots.
- Borders separate surfaces before shadows do. Only floating surfaces take a shadow: `shadow-pop` for menus, popovers and toasts, `shadow-dialog` for dialogs.
- Every floating surface is the same object: `surface-raised`, a `line` border, `radius-card`, `shadow-pop`. Menu, Popover and Toast must look related.
- Spacing moves in 4 px steps from `space-1` to `space-12`. Lay out with gap, not margins.
- Three structural classes cover most containers: `surface-card` for content that sits on the page, `surface-well` for an inset area such as a code block or a group of inputs, and `table-scroll` for anything wider than the screen. Reach for these before writing a container of your own.
- Density is set once on `<html>` with `data-density="comfortable"` or `"compact"`. Card and well padding, and base text size, follow it. Touch targets do not.
- Motion is short and functional: `duration-fast` for hover and colour, `duration-enter` for surfaces arriving. Under `prefers-reduced-motion`, transitions turn off.

## Layout

- Design the phone screen and the desktop screen together. Neither is derived from the other at the end.
- Three breakpoints: `bp-sm` 640 px, `bp-md` 768 px, `bp-lg` 1100 px.
- Navigation is the AppShell: a sidebar from `bp-lg`, a bottom tab bar below it, the same destinations in both. A single-workspace or canvas app with fewer than three destinations uses the `minimal` variant instead, a compact top bar at every width.
- A record's detail view defaults to master-detail: a split view from `bp-lg`, a slide-over from `bp-md`, and a bottom sheet on phones. It is a default, not a law. `design-system/profile.md` may choose one pattern for a screen instead: a dedicated route, a modal or sheet, or a split view.
- A dialog is a centred card from `bp-sm` and a bottom sheet below it.
- The page body never scrolls sideways. A wide table goes inside `table-scroll`.

## Iconography

- Lucide only, as inline SVG so it works without React. Stroke 1.75, round caps and joins, no fills.
- 16 px inside controls and pills, 20 px in the tab bar and headers.
- Icons take the colour of their text. Only a state icon or the current navigation mark takes a colour of its own.
- The app icon is a rounded square filled with the app's accent, holding one lucide glyph in `on-accent`. No logo files exist yet, so the app name is set in the display face beside it.

## Interface fundamentals

- Missing data is shown as missing, in `text-faint`, with words: "Not known yet", "No date yet". Never a plausible default.
- Reversible actions happen at once and offer Undo in a Toast. Only irreversible ones open a confirming Dialog.
- A warning always carries its way forward as a button.
- An empty screen says it is empty and how to start. No sample data.
- Labels are sentence case and name the action: "Delete list", not "OK".
- One primary button per view.

## Components

Each component is a set of `ui-` classes in `bundle.css`. Use them before building a new pattern. When an app needs a component that is not here, build it from the tokens in `app.css`, give it the same floating surface, radius and focus rules, and offer it back to the hub once a second app needs it.

### AppShell

The skeleton every app shares: a sidebar on wide screens and a bottom tab bar on phones.

You provide the app mark, the app name, up to five top-level destinations, and the page content.

- From 1100 px (`bp-lg`) the shell is `ui-sidebar` beside `ui-main`. Below it the sidebar is hidden and `ui-tabbar` sticks to the bottom.
- The same destinations appear in both, in the same order, with the same lucide icons. More than five destinations means the fifth tab is "More".
- The current destination sets `aria-current="page"`. Its icon takes `accent`. In the sidebar the row also takes `accent-tint`.
- The app mark is a rounded square at `radius-control`, filled with `accent`, holding one lucide glyph in `on-accent`. The favicon and home-screen icon use the same formula.
- The app name beside the mark is set in the display face.
- Every page opens the same way: an eyebrow, then one display title, then the content. That title is the only large type on the screen.
- Detail views follow the width: a split view from 1100 px, a slide-over from 768 px, a bottom sheet below that.
- The page body never scrolls sideways. The side gutter is `space-4` on phones.

#### Minimal variant

An app with a single workspace or fewer than three destinations (a canvas, a visualizer, a one-screen tool) does not need a sidebar and a tab bar. Set `data-shell="minimal"` on `ui-shell` and give it a `ui-topbar` before `ui-main`.

- The top bar is sticky and 52 px tall at every width. It holds the app mark and name on the left as `ui-topbar__brand`, an optional `ui-topbar__nav` of up to two `ui-nav-item` links, and `ui-topbar__actions` on the right.
- `ui-sidebar` and `ui-tabbar` are hidden in this variant, so leave them out of the markup.
- Add `ui-main--bleed` to `ui-main` for a full-bleed canvas. It removes all padding, so the content draws to the edges.
- Everything else is unchanged: tokens, the focus ring, touch targets and the page-title pattern.
- An app that wants a collapsible rail builds it in its own `app.css` from the tokens. The kit does not ship one yet.

### Button

The one text button, in four variants, plus the icon-only button and the inline link.

You provide the label, an optional leading lucide icon, and `type`. Write `type="button"` unless the button submits a form.

- `ui-btn ui-btn--primary`: the single most likely action in a view. One per view. Its fill is `accent` and its text is `on-accent`, never literal white.
- `ui-btn`: every other action. Hover moves it onto `mid`.
- `ui-btn ui-btn--ghost`: low-stakes actions such as Cancel.
- `ui-btn ui-btn--danger`: irreversible actions only. It is outlined in `bad`, never filled, so it cannot be mistaken for the primary.
- `ui-icon-btn`: icon only. `aria-label` is required and the same words go in `title`.
- `ui-link`: inline links inside running text.

Labels are a verb plus an object in sentence case: "Delete list", "Look again". Never "OK" or "Submit".

Height is `touch-phone` below 640 px and `touch-desktop` above, through one shared pair of tokens: `--control-h` and `--control-fs` (44 px and 16 px, then 36 px and 14 px). Button, input, select and textarea all read them, so they always match. Do not set a height or text size on a control yourself.

Inside a table row, put `ui-table` on the table. From 640 px up its buttons, inputs and selects use `--control-h-compact` and `--control-fs-compact` (32 px and 13 px), so rows stay short. Two fields that belong together in a row, such as Rating and Tier, go in a `ui-control-pair` so they sit side by side and do not stack.

### Field

A labelled form control with a help line beneath it, for text, long text, choices and toggles.

You provide the label text, the control, and the help line. Give every control an `id` and point its label's `for` at it. A control that has no visible label needs `aria-label`.

- The label is an eyebrow: mono, uppercase, `text-muted`. It sits above the control, never inside it.
- `ui-input`, `ui-textarea` and `ui-select` share one look: fill `surface-sunken`, border `line-strong` (3:1 against the surface), `radius-control`. Text is 16 px on phones so the browser does not zoom, 14 px from 640 px up.
- `ui-textarea` is at least 96 px tall and resizes vertically.
- `ui-select` is a native select. Wrap it in `ui-select-wrap` with a chevron `svg` after it, so the arrow looks the same in every browser. A choice of three or fewer is a segmented control, not a select.
- `ui-check` wraps a checkbox and its text in a label. The whole row is the tap target. The tick inside the box is the state.
- `ui-switch` wraps `<input type="checkbox" role="switch">` and its text, and always ends with `<span class="ui-switch__state">On</span>` or `Off`. The word and the thumb position carry the state, the accent fill supports them. Use it for a setting that takes effect at once. Use a checkbox when the person submits a form.
- `ui-segmented` is `role="radiogroup"` with `aria-label`. Each option is a `ui-segmented__opt` button with `role="radio"` and `aria-checked`, and holds a check `svg` that shows only on the chosen one. Arrow keys move and choose. Use it for two to four short options.
- A missing value shows a placeholder in `text-faint` that says so ("Not known yet"). Never prefill a guess.
- The help line carries save status ("Saving…", "Saved · just now", "Couldn't save · Try again") or a hint.
- An invalid control sets `aria-invalid="true"` and `aria-describedby` pointing at a `ui-help ui-help--bad` line that says how to fix it. The red border is never the only signal.

### Pill

A small rounded label for one short fact or state.

You provide the words and, for a state, its icon.

- `ui-pill`: neutral facts such as a media type.
- `ui-pill ui-pill--mid`: the app's own states that are neither good nor bad. This is the mid-tone at work.
- `ui-pill ui-pill--active`: a filter pill or chip that is switched on. It uses an accent border and tint, always carries a check icon, and sets `aria-pressed="true"` when it is a button.
- `ui-pill--good`, `ui-pill--warn`, `ui-pill--bad`: state. Each one always carries a word and an icon, so the colour is never the only signal.
- Only the active filter pill uses `accent`. No state pill does: the accent means "this app" and "act here", not a state.

Define each app's states once, in one map of label, icon and tone, and render every pill from it.

### Notice

A message that stays in the page: a result, a caveat or a warning.

You provide the tone, the icon, the sentence, and the actions.

- Default tone sits on `mid`. Use it for plain information.
- `ui-notice--warn` and `ui-notice--bad` use `role="alert"`. The others use `role="status"`.
- A warning or error always offers the way forward as a button: "Save anyway", "Skip", "Try again". A notice that only complains is not finished.
- Say what failed in the person's terms. No "Oops", no "Something went wrong".
- Use a Toast instead when the message confirms something the person just did and needs no decision.

### Toast

A brief confirmation that floats above the page, with at most one action.

You provide the message and, when the action can be reversed, an Undo handler.

- Wrap toasts in `ui-toasts`, a polite live region fixed to the bottom centre. On phones it clears the tab bar and the safe area.
- A toast stays for `duration-toast` (6 seconds). At most three show at once. Hovering or focusing a toast pauses its timer.
- Reversible actions (archive, remove from a list) act at once and show a toast with Undo. Do not ask first.
- One action only. A toast that needs two buttons is a Dialog.
- Errors that need a decision go in a Notice, where they stay until dealt with.

### Dialog

A modal surface: a centred card from 640 px up and a bottom sheet below it.

You provide the title, the body, and the footer buttons. You also provide the behaviour: move focus inside on open, trap Tab, close on Escape and on a press outside, and return focus to the opener.

- Markup is `ui-scrim` wrapping `ui-dialog`, with `ui-dialog__head`, `__body` and `__foot`.
- The title is set in the display face. It is the one place inside a floating component where the display face appears.
- Use `role="dialog"` with `aria-modal="true"`. A confirmation uses `role="alertdialog"`.
- A confirmation is only for what cannot be undone. Its title is a question, its body says what is lost and what is kept, and its button names the action. The safe choice is the ghost button on the left.
- On phones the same markup becomes a sheet: full width, top corners at `radius-dialog`, bottom padding for the safe area, at most 90% of the screen height.
- The surface is `surface-raised`. In dark mode the lighter surface shows the height and the shadow only supports it.

### Menu

A dropdown list opened from a button that shows the current choice.

You provide the trigger label, the options, and the behaviour: arrow keys move, Home and End jump, Enter picks, Escape closes, and focus lands on the current option when it opens.

- The trigger is a `ui-btn` with `aria-haspopup="listbox"` and `aria-expanded`. Its label shows the current value and ends in a chevron.
- The list is `ui-menu` with `role="listbox"`. Each row is a `ui-menu-item` with `role="option"`.
- The chosen row sits on `mid` and carries a tick. The tick is the signal, the tint supports it.
- A hint on the right is set in mono, in `text-muted`.
- Rows are `touch-phone` tall on phones. Below 640 px a long menu opens as a Dialog sheet instead of a floating list.
- A menu of actions (not choices) uses the same surface with `role="menu"` and `role="menuitem"`, and no ticks.

### Popover

A small anchored panel for help text or a short form.

You provide the trigger, the content, and the behaviour: open on hover for a fine pointer, pin on tap or Enter, close on Escape or a press outside.

- The panel is `ui-popover`: the same raised surface, border, radius and shadow as Menu and Toast. All floating surfaces match.
- Keep it under about 40 words. Longer explanations belong in the page.
- This is where explanations go. Keep them off button labels and out of placeholder text.
- A tooltip is the smallest popover: the name of an icon-only control, shown on hover and focus, and for 1.5 seconds after a touch.

## Component markup quick-reference

Set `data-accent` and `data-density` once on `<html>`, for example `<html data-accent="azure" data-density="comfortable">`. Every component inherits them. The attributes below are the ones each component needs on its own markup. Guidelines for each component sit beside its preview.

| Component | Root class | Variants and parts | Required attributes |
| --- | --- | --- | --- |
| AppShell | `ui-shell` | `data-shell="minimal"` with `ui-topbar`; parts `ui-sidebar`, `ui-main` (`ui-main--bleed`), `ui-tabbar`, `ui-nav-item`, `ui-tab` | `aria-current="page"` on the current destination, in the sidebar and the tab bar alike |
| Button | `ui-btn` | `--primary`, `--ghost`, `--danger`; `ui-icon-btn` (`--dismiss`); `ui-link` | `type="button"`; an icon-only control needs `aria-label` and `title` |
| Card | `ui-card`, `surface-card` | `--glow` | none |
| Control pair | `ui-control-pair` | none | none |
| Dialog | `ui-scrim` around `ui-dialog` | parts `__head`, `__title`, `__body`, `__foot` | `role="dialog"` or `"alertdialog"`, `aria-modal="true"`, `aria-labelledby` |
| Field | `ui-field` | `ui-input`, `ui-textarea`, `ui-select` in `ui-select-wrap`, `ui-check`, `ui-switch`, `ui-segmented`; `ui-help` (`--bad`) | label `for` matches input `id`; invalid sets `aria-invalid="true"` and `aria-describedby`; a switch sets `role="switch"` and shows On or Off in `ui-switch__state`; a segmented control is `role="radiogroup"` with `role="radio"` and `aria-checked` options |
| Menu | `ui-menu` | `ui-menu-item`, `ui-menu-item__hint`, `ui-menu__rule` | trigger has `aria-haspopup` and `aria-expanded`; list is `role="listbox"`, rows `role="option"` with `aria-selected` |
| Notice | `ui-notice` | `--good`, `--warn`, `--bad`; part `__body`, `__actions` | `role="alert"` for warn and bad, `role="status"` for the rest |
| Pill | `ui-pill` | `--mid`, `--active`, `--good`, `--warn`, `--bad` | a word, and an icon on every state pill |
| Popover | `ui-popover` | none | `role="dialog"` and `aria-label`; trigger has `aria-expanded` |
| Surface well | `surface-well` | `--tight` | none |
| Table | `ui-table` | none | none |
| Table scroll | `table-scroll` | none | none |
| Toast | `ui-toast` inside `ui-toasts` | parts `__msg`, `__action` | `ui-toasts` is `aria-live="polite"`; each toast is `role="status"` |

## Core rules, condensed

The full text is in `principles.md` and `voice.md`. Read those two before writing a screen.

- Never guess: missing data stays missing and says so. Your word wins: suggest, never overwrite.
- Capture beats completeness: saving never waits on a slow step. Slow work runs on a press or a schedule, on saved data.
- Flag, don't block: warn, and give a way forward. Reversible acts happen at once with Undo.
- Calm by default: neutrals carry the screen, colour is for meaning, and meaning never depends on colour alone.
- Speak to the person as "you". Say what happened in their terms. Ask when something is missing.
- Errors say what failed and offer the retry. No "Oops", no "Sorry".
- Name actions by what they do, in sentence case. Never "OK" or "Submit".
