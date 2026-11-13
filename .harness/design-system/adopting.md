# Adopting it in a project

The system is a starting kit, not a gate. Nothing in the harness checks a project against it. The hub owns the kit and sync delivers it to `.harness/design-system/`.

## Upstream immutability

`tokens.css` and `bundle.css` are read-only copies of the hub's files. A project never edits them, because the next sync would overwrite the edit or flag a conflict, and two apps that edit their copies drift apart.

- App-specific overrides and app-only components go in a separate `app.css` (or `profile.css`) that loads after `bundle.css`.
- Typical overrides: a different `--font-display`, a tuned `--accent`, or a component the kit does not have.
- To change a token or a shared component for every app, change it in `claude-harness-hub`. A copy of the kit text inside a project (for a Worker that cannot read files at run time) carries a comment naming the source file, and a test that fails when it drifts.

## A new project

1. Serve `.harness/design-system/tokens.css` and `bundle.css`, then the app's own `app.css`, or copy their text into the app's stylesheet module with a source comment. Do not edit the copies.
2. Set `data-accent` and `data-density` on `<html>`, for example `<html data-accent="azure" data-density="comfortable">`. Pick the accent from the table below.
3. Load Newsreader and JetBrains Mono, unless the profile overrides `--font-display`.
4. Write `design-system/profile.md` at the project root: the accent, the density preset, the voice warmth, any `theme-lock`, the app's states (label, icon and tone for each), and every default the app departs from, with its reason.
5. Add one line to the project's `AGENTS.md`: "UI follows Harness UI. Read its README.md, voice.md, principles.md, and this project's design-system/profile.md before changing a screen. Never edit tokens.css or bundle.css directly." `AGENTS.md` is a red-tripwire path, so the line goes in through a spec'd slice.
6. Build the first screen from AppShell, Button and Field. Add other components when a change needs them.

## An existing project

Adopt on touch. When a change opens a screen, move that screen onto the tokens and the shared components in the same change. No migration project is needed.

### Utility CSS interop

A project that already uses Tailwind keeps it for layout only.

- Use utility classes for flex and grid positioning and for spacing that lands on the 4 px scale: `1` is `space-1`, `2` is `space-2`, `3` is `space-3`, `4` is `space-4`, `6` is `space-6`, `8` is `space-8`, `12` is `space-12`. Other steps are not used.
- Never use a raw Tailwind palette class (`bg-zinc-900`, `text-violet-400`) and never an arbitrary bracket value (`w-[437px]`, `bg-[#222]`). Colour, radius, shadow and type come from the kit's classes and variables.
- A pattern that the kit has gets the kit's component, not a utility-built copy.

## What stays free

- Content layouts: tables, card grids, timelines, whatever the data wants.
- App-only components. Build them from the tokens, and offer them back when a second app needs the same thing.
- Celebrations and warmth, set in the profile.
- A theme or accent picker. The system supports one and does not require it.

## What a profile may not change

Floor rules 1 to 5 in the README, and rule 6 as it is written there.

## Current signature hues

| App | Hue | Note |
| --- | --- | --- |
| LiveArchive | `neon-violet` | Unchanged. |
| Job Application Tracker | `neon-cyan` | Moves off indigo, which sat too close to violet. |
| Media Recommendation | `neon-azure` | Maps from the blue it uses today. |
| Next apps | `neon-magenta`, `neon-lime` | Reserved. Music Visualizer is the likely first. |

Target spacing is 40° of hue or more. Measured in OKLCH, violet and azure sit 40° apart in both themes (dark 295° and 255°, light 297° and 257°). Cyan sits 42° to 47° from azure and more than 80° from violet, and magenta and lime are well clear. Tune a hue by moving the OKLCH hue angle only, so lightness and chroma stay put.
