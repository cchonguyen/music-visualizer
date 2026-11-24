# Project Overview (Owner's Manual)

## What This App Does
A desktop web app (Chrome or Edge) that draws live visuals in time with music. It can play a file you pick, or visualize what your computer is playing from a browser tab or the whole system (you approve the screen-share prompt and tick "share audio"). Everything runs locally: nothing is uploaded or stored, and no account is needed.

## Current Build Status
- **Live:** https://music-visualizer.charliechonguyen.com (custom domain; workers.dev backup).
- **Stages 1 to 29:** complete, verified and deployed. Each stage's slices are listed in `.spec/HISTORY.md`.
  - 15 WebGL2 visual layer types: Shape, Particles, Tunnel, Spectral Terrain, Chladni Sand, Ferrofluid, Moiré, Julia, Orbit, Architecture, Rings, Crown, Bars, Shockwave and Bass Pulse. Old Waveform layers load as Shape layers. Reaction-Diffusion was retired in Slice 15.10; presets that still hold it skip that layer.
  - Feedback warp (curl, Möbius, polar fold, RGB split, edge, solarize), up to four stacked warp operators, and post effects including bloom, vignette, mirror, colour mapping and invert.
  - 31 numbered built-in presets (Flagship 01–11 and Showcase 13–32; number 12 was retired) plus six Classics & Textures.
  - Preset browser with favourites, auto-cycle (timer, beat, phrase, shuffle, hard cut), Preset Studio with folders, and a pop-out Studio window.
  - Global Director: experience modes (Cinematic, Calm, Minimal, Color Walk), camera moves and colour palettes.
  - Photosensitivity safety governor with bidirectional slew clamping, and a Low-power mode.
  - Unit tests: 1,849 passing across 83 test files (2026-11-24).
- **Stage 14 (trust and foundations):** admin access is Cloudflare Access only (the old client passkey path and direct database writes are gone). The Worker caps and checks request bodies and sends security headers. Frame time steps are clamped to 0.1 s, feedback motion is per second so it looks the same at any refresh rate, and the morph wave no longer jumps when its rate changes.
- **Stage 29 (music-reactive sliders):** every Studio slider, enum dropdown, colour picker, Warp Operator, and layer opacity slider now has inline `⚡` music-reactivity controls with 1-click recipes, live modulation track overlays, direction-flipping on beats/drops/sections, song-arc sources, and an `⚡ Active Links` overview, with flagship built-in presets updated out of the box.
- **Stage 30 (docs and text audit, 2026-11-24):** documents, code comments and on-screen text were checked against the code and rewritten where they were out of date or hard to follow. No behaviour changed.
- **Stage 31 (streamlining, 2026-11-24):** unused code was removed (a second auto-cycle copy and the retired Reaction-Diffusion renderer), the review presets left the app download, the settings lists are defined in one place, the built-in presets are one list, and the Studio file was split into smaller modules. The app looks and behaves the same; the preset browser no longer shows preset counts, and Export and Import Look run once per click.
- **Stage 32 (auto-cycle upgrades, 2026-11-24):** beat-mode auto-cycle switches anyway 3 s after the usual gap when no beat comes, and the Visuals menu has a "Favourites only" switch (all presets are used when fewer than two are favourites).
- **In Progress:** none
- **Up Next:** Ongoing refinement and preset authoring.

## Scope Change
- 2026-11-04: rescoped to desktop first. iPhone and phone versions are deferred. Reason: system audio can't be captured on iPhone, and desktop allows heavier visuals.

- 2026-11-09: bug fix. The layer opacity slider had no visible effect on Shape layers, because their default additive blend ignored the alpha it changes. The fix scales the Shape layer's color by the opacity, so the slider works. No other layer changes.

- 2026-11-06: particles will fill the whole frame, corners included, at twice their current size. A new "Follow scene transform" switch lets particles move with the scene. It is on for new presets only, so existing presets look the same.
- 2026-11-12: confirmed by Charlie and planned as Slice 21.13. The Visuals menu gets an auto-cycle choice (Off / Timer / Beat), a Shuffle switch, and a timer length (5 to 120 seconds, 20 by default). Your choice is remembered after reload and stays in step with the C, B and X keys. The colour "Auto-cycle" option, favourite/skip tags and safety code are untouched.
- 2026-11-12: Studio jumped to the top when you picked an option, because the whole panel was rebuilt. Fixed in Slice 21.15: the Studio keeps your scroll place and open sections.

## Where the Plan Lives
- Working contract: `.spec/SYSTEM_SPEC.md`
- Earlier phone-focused brief (superseded for scope): `.spec/SCOPE_BRIEF.md`
- Long-term research RFC: `docs/RFC-milkdrop-next.md`
- Decisions: `.spec/DECISIONS.md`
- 2026-11-13: Charlie chose to adopt the shared Harness UI design system. Stage 24 moved the controls, pills and Studio onto it (`design-system/profile.md` records where the app departs from the kit).
