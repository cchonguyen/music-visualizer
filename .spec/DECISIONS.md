# Architecture Decision Records (ADRs)

- Add one line per decision: date, decision, and why.
- 2026-11-04: v1 audio = file only; mic deferred to v1.1. Why: mic is the main iOS failure source; Council 3–1.
- 2026-11-04: Visuals = classic 2D Canvas. Why: fastest to ship on phones; Council consensus.
- 2026-11-04: Framework = plain TypeScript + Vite, not React. Why: one animation loop; Council 3–1 (GPT preferred React for AI scaffolding; owner can override).
- 2026-11-04: Audio pipeline = `<audio>` → MediaElementAudioSourceNode → Analyser → GainNode. Why: avoids decoding whole file into memory (iOS crash risk); Council consensus.
