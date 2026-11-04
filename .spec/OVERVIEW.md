# Project Overview (Owner's Manual)

## What This App Does
A desktop web app (Chrome or Edge) that draws live visuals in time with music. It can play a file you pick, or visualize what your computer is playing from a browser tab or the whole system (you approve the screen-share prompt and tick "share audio"). Everything runs locally: nothing is uploaded or stored, and no account is needed.

## Current Build Status
- **Live & Verified:** none yet. Harness, spec, and scope are set up in the project folder and on GitHub.
- **In Progress:** none
- **Up Next:** Stage 1 — the audio core (file playback and tab/system audio capture feeding one analyser), tested on your desktop.

## Scope Change
- 2026-11-04: rescoped to desktop first. iPhone and phone versions are deferred. Reason: system audio can't be captured on iPhone, and desktop allows heavier visuals.

## Where the Plan Lives
- Working contract: `.spec/SYSTEM_SPEC.md`
- Earlier phone-focused brief (superseded for scope): `.spec/SCOPE_BRIEF.md`
- Long-term research RFC: `docs/RFC-milkdrop-next.md`
- Decisions: `.spec/DECISIONS.md`
