# Project Overview (Owner's Manual)

## What This App Does
A desktop web app (Chrome or Edge) that draws live visuals in time with music. It can play a file you pick, or visualize what your computer is playing from a browser tab or the whole system (you approve the screen-share prompt and tick "share audio"). Everything runs locally: nothing is uploaded or stored, and no account is needed.

## Current Build Status
- **Live:** https://music-visualizer.charliechonguyen.com (custom domain; workers.dev backup).
- **Stages 1 to 10:** Complete and verified in code.
  - 13 WebGL2 visual layers including ShapeLayer, SpectralTerrain, ChladniSand, ReactionDiffusion, Ferrofluid, Moire, Tunnel, Waveform, Particles, Rings, Crown, Shockwave, BassPulse.
  - Post-processing chain with multi-mode feedback warp (curl, mobius, polarFold, rgbSplit, sobel, solarize) and bloom.
  - 20 Flagship Presets fully tuned and registered.
  - Preset Studio with hierarchical preset folders and user folder management.
  - Photosensitivity safety governor with bidirectional slew clamping.
  - Unit tests: 827 tests passing across 60 test suites.
- **In Progress:** none
- **Up Next:** Ongoing refinement and preset authoring.

## Scope Change
- 2026-11-04: rescoped to desktop first. iPhone and phone versions are deferred. Reason: system audio can't be captured on iPhone, and desktop allows heavier visuals.

- 2026-11-06: particles will fill the whole frame, corners included, at twice their current size. A new "Follow scene transform" switch lets particles move with the scene. It is on for new presets only, so existing presets look the same.

## Where the Plan Lives
- Working contract: `.spec/SYSTEM_SPEC.md`
- Earlier phone-focused brief (superseded for scope): `.spec/SCOPE_BRIEF.md`
- Long-term research RFC: `docs/RFC-milkdrop-next.md`
- Decisions: `.spec/DECISIONS.md`
