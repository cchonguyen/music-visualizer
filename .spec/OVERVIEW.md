# Project Overview (Owner's Manual)

## What This App Does
A desktop web app (Chrome or Edge) that draws live visuals in time with music. It can play a file you pick, or visualize what your computer is playing from a browser tab or the whole system (you approve the screen-share prompt and tick "share audio"). Everything runs locally: nothing is uploaded or stored, and no account is needed.

## Current Build Status
- **Live:** https://music-visualizer.charliechonguyen.com (custom domain; workers.dev backup).
- **Stages 1 to 10:** Complete and verified in code.
  - 14 WebGL2 visual layer types including ShapeLayer, SpectralTerrain, ChladniSand, ReactionDiffusion, Ferrofluid, Moire, Tunnel, Waveform, Particles, Rings, Crown, Shockwave, BassPulse, Bars.
  - Post-processing chain with multi-mode feedback warp (curl, mobius, polarFold, rgbSplit, sobel, solarize) and bloom.
  - 20 Flagship Presets fully tuned and registered.
  - Preset Studio with hierarchical preset folders and user folder management.
  - Photosensitivity safety governor with bidirectional slew clamping.
  - Unit tests: 993 tests passing across 65 test suites.
- **Stage 14 (trust and foundations):** admin access is Cloudflare Access only (the old client passkey path and direct database writes are gone). The Worker caps and checks request bodies and sends security headers. Frame time steps are clamped to 0.1 s, feedback motion is per second so it looks the same at any refresh rate, and the morph wave no longer jumps when its rate changes.
- **In Progress:** none
- **Up Next:** Ongoing refinement and preset authoring.

## Scope Change
- 2026-11-04: rescoped to desktop first. iPhone and phone versions are deferred. Reason: system audio can't be captured on iPhone, and desktop allows heavier visuals.

- 2026-11-09: bug fix. The layer opacity slider had no visible effect on Shape layers, because their default additive blend ignored the alpha it changes. The fix scales the Shape layer's color by the opacity, so the slider works. No other layer changes.

- 2026-11-06: particles will fill the whole frame, corners included, at twice their current size. A new "Follow scene transform" switch lets particles move with the scene. It is on for new presets only, so existing presets look the same.

## Where the Plan Lives
- Working contract: `.spec/SYSTEM_SPEC.md`
- Earlier phone-focused brief (superseded for scope): `.spec/SCOPE_BRIEF.md`
- Long-term research RFC: `docs/RFC-milkdrop-next.md`
- Decisions: `.spec/DECISIONS.md`
