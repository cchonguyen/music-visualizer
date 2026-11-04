# Stage 1 Slice Specs — Audio Core and GPU Proof

Companion to `.spec/SYSTEM_SPEC.md` (contracts) and `.spec/PROGRESS.md` (queue). Written 2026-11-04. Not started.

**Stage 1 is done when:** the four checks in `docs/visualization-ladder.md` §3 pass on the owner's Mac and Windows machines, for file, tab/system audio, and mic, with latency under 100 ms shown in the debug panel.

## How the work is split

Each slice is small, owns its own files, and has a test command. Pure-logic slices (no browser needed) are written so a cheap model can do them from this doc alone.

**Worker tiers:**
| Tier | Who | Gets | Why |
|---|---|---|---|
| Free | OpenCode free model (DeepSeek, MiMo, etc.) | Pure TypeScript logic with unit tests | Spec is exact; tests catch mistakes; zero cost |
| Cheap | Claude Haiku subagent (`gf-coder`) | Small browser glue with a clear interface | Needs some judgment, low risk |
| Lead | Lead agent (Opus) | Web Audio engine, WebGL2 core, integration, merges | Browser quirks; hard to test automatically |
| Owner | Charlie | Listening and device tests, final pass/fail | Only a human can judge "it responds" |

**Every worker must:** touch only its slice's target files; run the Verify command and paste the output; not add dependencies; not change contracts in this doc (raise a question instead). The lead agent reviews each diff before merge.

## Waves (what can run in parallel)

```
Wave 0:  1.0 scaffold                                  (lead)
Wave 1:  1.1 bands   1.2 envelope+normalize   1.3 onset   1.4 test-signal plans   1.5 resize math     (parallel, free models)
Wave 2:  1.6 frame builder (needs 1.1–1.3)    1.7 audio engine + sources (lead)    1.8 WebGL2 core (lead)
Wave 3:  1.9 tracer visuals (needs 1.6, 1.8)  1.10 debug panel + latency (needs 1.6, 1.7)
Wave 4:  1.11 app shell + controls (integration, lead)
Wave 5:  1.12 deploy (owner login)   1.13 device test report (owner)
```

Parallel waves need one git worktree (a separate working copy on its own branch) per worker. See "Open decisions" at the end.

## Shared contract: `AudioFrame`

Defined in slice 1.1, used by everything after. Changing it later is expensive, so review it before Wave 1 starts.

```ts
// src/audio/types.ts
export interface BandLevels {
  sub: number;   // < 120 Hz
  mid: number;   // 120 Hz – 2.5 kHz
  high: number;  // 2.5 kHz – 10 kHz
}

export interface AudioFrame {
  time: number;            // AudioContext.currentTime, seconds
  raw: BandLevels;         // band energy this frame, 0..1, no smoothing
  env: BandLevels;         // after asymmetric envelope, 0..1
  norm: BandLevels;        // env scaled by rolling normalizer, 0..1 (use for effect SIZE)
  energy: number;          // overall loudness vs rolling window, 0..1 (use for COMPLEXITY)
  flux: number;            // spectral flux (novelty), >= 0
  beat: boolean;           // true on the frame an onset fires
  beatStrength: number;    // 0..1, how far flux exceeded threshold
  waveform: Float32Array;  // time-domain samples, -1..1, length = fftSize
  spectrum: Float32Array;  // magnitude per bin, 0..1, length = fftSize/2
  sampleRate: number;
}
```

Rule from the spec: `norm` scales effect size; `energy` drives complexity. `energy` is never fully normalized away, so swells still read as swells. Quiet passages keep a dim floor.

---

## Slice 1.0 — Project scaffold `[lead]`

**Goal:** an empty app that builds, type-checks, and runs tests.
**Target files:** `package.json` [NEW], `tsconfig.json` [NEW], `vite.config.ts` [NEW], `index.html` [NEW], `src/main.ts` [NEW], `.gitignore` [NEW]
**Setup:** Vite + TypeScript (strict), Vitest for tests. Scripts: `dev`, `build`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`).
**Accept:** `npm run dev` shows a page titled "Music Visualizer". All three checks below pass.
**Verify:** `npm run typecheck && npm test -- --passWithNoTests && npm run build`

## Slice 1.1 — Band math and AudioFrame types `[free]`

**Goal:** turn an FFT magnitude array into three band levels, with correct bin indices for any sample rate.
**Target files:** `src/audio/types.ts` [NEW], `src/audio/bands.ts` [NEW], `src/audio/bands.test.ts` [NEW]
**Functions:**
- `binForFrequency(hz: number, sampleRate: number, fftSize: number): number` — `Math.round(hz * fftSize / sampleRate)`, clamped to `[0, fftSize/2 - 1]`.
- `bandLevel(spectrum: Float32Array, loHz: number, hiHz: number, sampleRate: number, fftSize: number): number` — mean of bins in range, 0..1.
- `computeBands(spectrum, sampleRate, fftSize): BandLevels` — uses the three ranges above.
- `byteSpectrumToUnit(src: Uint8Array, out: Float32Array): void` — `src[i] / 255`.
**Tests must cover:** 44.1 kHz and 48 kHz give different bins for 120 Hz; a spectrum with energy only in bin 2 (at 48 kHz, fftSize 4096) gives sub > 0, mid = 0, high = 0; empty spectrum gives all zeros; clamping at the top bin.
**Verify:** `npm test -- src/audio/bands.test.ts && npm run typecheck`

## Slice 1.2 — Envelope follower and rolling normalizer `[free]`

**Goal:** fast-attack, slow-release smoothing, plus a rolling window that keeps quiet and loud music readable.
**Target files:** `src/audio/envelope.ts` [NEW], `src/audio/normalize.ts` [NEW], `src/audio/envelope.test.ts` [NEW], `src/audio/normalize.test.ts` [NEW]
**Envelope:** `class Envelope { constructor(attackMs: number, releaseMs: number); step(input: number, dtSec: number): number; reset(): void }`. Coefficient per step: `1 - Math.exp(-dt / tau)`, using attack tau when input > current, else release tau. Defaults: attack 10 ms, release 250 ms.
**Normalizer:** `class RollingNormalizer { constructor(windowSec: number, floor: number); push(value: number, dtSec: number): number; peak(): number; reset(): void }`. Keeps a decaying peak over `windowSec` (default 8 s). Returns `value / max(peak, floor)`, clamped 0..1. `floor` (default 0.02) stops silence from being amplified into noise.
**Tests must cover:** a step input reaches 90% within 3× attack time and decays to under 10% within 3× release time; dt of 0 changes nothing; normalizer returns ~1 for a steady signal after the window fills; a quiet signal after a loud one ramps back up over the window, not instantly; silence stays near 0 (floor works).
**Verify:** `npm test -- src/audio/envelope.test.ts src/audio/normalize.test.ts && npm run typecheck`

## Slice 1.3 — Spectral flux and onset detector `[free]`

**Goal:** detect kicks reliably; ignore steady tones and silence.
**Target files:** `src/audio/onset.ts` [NEW], `src/audio/onset.test.ts` [NEW]
**Functions:**
- `spectralFlux(prev: Float32Array, curr: Float32Array, loBin: number, hiBin: number): number` — sum of positive differences in the bin range.
- `class OnsetDetector { constructor(opts?: { triggerRatio?: number; releaseRatio?: number; cooldownMs?: number; meanTauMs?: number }); step(flux: number, timeSec: number): { beat: boolean; strength: number }; reset(): void }`. Defaults: trigger 1.3, release 1.05, cooldown 150 ms, mean tau 500 ms (EMA of flux). Fires when flux > mean × trigger and armed; re-arms when flux < mean × release; never fires twice within cooldown. `strength = clamp((flux / (mean × trigger)) - 1, 0, 1)`.
**Tests must cover:** a synthetic flux series with spikes every 500 ms fires exactly once per spike; a constant flux never fires after warm-up; spikes 100 ms apart fire only once (cooldown); zero flux never fires.
**Verify:** `npm test -- src/audio/onset.test.ts && npm run typecheck`

## Slice 1.4 — Test-signal plans `[free]`

**Goal:** describe the built-in test sounds as plain data, so they can be unit-tested before any audio plays.
**Target files:** `src/audio/testSignals.ts` [NEW], `src/audio/testSignals.test.ts` [NEW]
**Contract:** `type TestSignal = 'kick' | 'tone' | 'sweep' | 'silence'`. `planKicks(startSec: number, durationSec: number): { time: number; freq: 60; lengthSec: 0.05 }[]` (one every 0.5 s). `toneSpec(): { freq: 2000 }`. `sweepSpec(): { fromHz: 40; toHz: 8000; durationSec: 10; curve: 'exponential' }`.
A second function `scheduleTestSignal(ctx: BaseAudioContext, dest: AudioNode, signal: TestSignal, startSec: number): { stop(): void; kickTimes: number[] }` builds oscillator and gain nodes from the plans. It is tested with a fake context object (record calls), not real audio. `kickTimes` is used later for latency measurement.
**Tests must cover:** 10 s of kicks gives 20 kicks at 0, 0.5, … 9.5 s offset from start; scheduling calls `start` and `stop` at those times on the fake context; `stop()` stops everything.
**Verify:** `npm test -- src/audio/testSignals.test.ts && npm run typecheck`

## Slice 1.5 — Canvas size math `[free]`

**Goal:** pure function for the render budget, so resize logic is tested without a browser.
**Target files:** `src/gl/size.ts` [NEW], `src/gl/size.test.ts` [NEW]
**Function:** `canvasSize(cssWidth: number, cssHeight: number, devicePixelRatio: number, opts?: { maxDpr?: number; maxPixels?: number }): { width: number; height: number; dpr: number }`. Defaults: maxDpr 2, maxPixels 3_686_400 (1440p at DPR 1, about 2560×1440). Uses `min(dpr, maxDpr)`, then scales down uniformly if width × height exceeds maxPixels. Returns integers, minimum 1×1.
**Tests must cover:** DPR 3 is capped to 2; a 2560×1440 CSS window at DPR 2 is scaled down to fit maxPixels; zero size returns 1×1; aspect ratio is kept within 1 px.
**Verify:** `npm test -- src/gl/size.test.ts && npm run typecheck`

## Slice 1.6 — Frame builder `[free]` (needs 1.1–1.3)

**Goal:** combine analyser arrays into one `AudioFrame` per animation frame.
**Target files:** `src/audio/frameBuilder.ts` [NEW], `src/audio/frameBuilder.test.ts` [NEW]
**Contract:** `class FrameBuilder { constructor(sampleRate: number, fftSize: number); build(timeSec: number, byteSpectrum: Uint8Array, floatWaveform: Float32Array): AudioFrame; reset(): void }`. Uses `computeBands` → one `Envelope` per band → one `RollingNormalizer` per band. `energy` = envelope of mean of raw bands, divided by a slower normalizer (window 20 s) with a dim floor: `energy = 0.08 + 0.92 × value` when any signal is present, so it never reads as zero during quiet music. Flux is computed on the sub band against the previous spectrum. `dt` is from the previous `timeSec` and clamped to 0.1 s (handles hidden tabs).
**Tests must cover:** fake kick spectra every 0.5 s give `beat` true on those frames only; a steady 2 kHz spectrum gives sub ≈ 0 and no beats; silence gives energy 0 and no beats; a jump in `timeSec` of 5 s doesn't blow up envelopes (dt clamp).
**Verify:** `npm test -- src/audio/frameBuilder.test.ts && npm run typecheck`

## Slice 1.7 — Audio engine and sources `[lead]`

**Goal:** one engine with an analyser chain and four switchable sources.
**Target files:** `src/audio/engine.ts` [NEW], `src/audio/sources.ts` [NEW]
**Contract:** `class AudioEngine { static create(): AudioEngine` (called inside a click); `useFile(file: File): Promise<void>`; `useDisplayCapture(): Promise<void>`; `useMic(): Promise<void>`; `useTestSignal(s: TestSignal): void`; `stop(): void`; `readFrame(): AudioFrame`; `get media(): HTMLAudioElement | null`; `setVolume(v: number): void`; `on(event: 'source-ended' | 'error', cb): void }`.
**Rules (from the spec):** `<audio>` → `MediaElementAudioSourceNode`, never `decodeAudioData` for whole files. Capture: if the stream has no audio track, raise a clear error ("Tick 'Share audio' in the share prompt"); listen for track `ended`. Mic: `echoCancellation`, `noiseSuppression`, `autoGainControl` all false. Volume through `GainNode` only. Capture and mic are **not** routed to the speakers (prevents feedback and doubling); file and test signals are. Analyser `fftSize` 4096, `smoothingTimeConstant` 0.
**Accept (manual, lead + owner):** each source moves the debug numbers; switching sources doesn't leave the old one running.
**Verify:** `npm run typecheck && npm test && npm run build` plus manual check in Chrome.

## Slice 1.8 — WebGL2 core `[lead]`

**Goal:** the shared GPU layer: context, shaders, data textures, render-layer interface, and clean reset on GPU loss.
**Target files:** `src/gl/context.ts` [NEW], `src/gl/shader.ts` [NEW], `src/gl/texture.ts` [NEW], `src/render/layer.ts` [NEW]
**Contracts:**
- `interface RenderLayer { init(gl: WebGL2RenderingContext): void; resize(width: number, height: number, dpr: number): void; draw(frame: AudioFrame, timeSec: number): void; dispose(): void }`
- `compileProgram(gl, vertSrc, fragSrc): WebGLProgram` throws an error that includes the shader log and line numbers.
- `createDataTexture(gl, length)` and `updateDataTexture(gl, tex, data: Float32Array)` for one-row textures (spectrum, waveform). Uses `R32F` if `EXT_color_buffer_float`/float textures allow, else `R8` with a scaled upload.
- `GlHost`: owns the canvas and context, uses `canvasSize` from 1.5, debounced resize, and on `webglcontextlost` → `preventDefault`, stop drawing; on `webglcontextrestored` → re-run `init` on all layers from scratch (no state restore, per owner decision). Shows "WebGL2 not available" if `getContext('webgl2')` fails.
**Accept:** a clear screen at the right size; forcing loss with `WEBGL_lose_context` restarts cleanly while audio keeps playing.
**Verify:** `npm run typecheck && npm test && npm run build` plus manual check.

## Slice 1.9 — Tracer visuals: bass pulse and waveform line `[cheap]` (needs 1.6, 1.8)

**Goal:** the two Stage 1 visuals that prove response, nothing decorative.
**Target files:** `src/render/layers/bassPulse.ts` [NEW], `src/render/layers/waveform.ts` [NEW], `src/render/shaders/bassPulse.frag.glsl` [NEW], `src/render/shaders/waveform.vert.glsl` [NEW], `src/render/shaders/waveform.frag.glsl` [NEW]
**Bass pulse:** full-screen background whose brightness = `0.06 + 0.25 × env.sub` (dim floor; brightness change capped well under the WCAG flash limit). No other inputs.
**Waveform:** a line drawn from the waveform data texture, unscaled, no smoothing or effects.
**Accept:** owner sees the pulse rise on each test kick and stay flat on tone and silence; waveform shape matches the test signal.
**Verify:** `npm run typecheck && npm run build` plus manual check.

## Slice 1.10 — Debug panel and latency `[cheap]` (needs 1.6, 1.7)

**Goal:** live numbers that prove the audio is driving the visuals.
**Target files:** `src/ui/debugPanel.ts` [NEW], `src/audio/latency.ts` [NEW], `src/audio/latency.test.ts` [NEW]
**Panel (toggle with `D`, hidden by default):** source name, sample rate, `raw`/`env`/`norm` for each band, energy, flux, beat flag, frame time (ms), and estimated latency.
**Latency (pure, testable):** `estimateLatencyMs(kickTimes: number[], beatTimes: number[], outputLatencySec: number, baseLatencySec: number, frameMs: number): { medianMs: number; samples: number }`. Pairs each detected beat with the nearest earlier kick within 200 ms; latency = detection gap + output latency + base latency + half a frame. Reports the median. Panel shows pass (green) under 100 ms.
**Tests must cover:** perfectly matched times give the fixed latency terms only; beats with no nearby kick are ignored; median of mixed values.
**Verify:** `npm test -- src/audio/latency.test.ts && npm run typecheck`

## Slice 1.11 — App shell and controls `[lead]`

**Goal:** one page that wires everything together.
**Target files:** `index.html`, `src/main.ts`, `src/ui/controls.ts` [NEW], `src/ui/notices.ts` [NEW], `src/style.css` [NEW]
**Includes:** start screen with photosensitivity note and a Start button (creates the `AudioEngine` inside the click); source picker (File, Tab/System audio, Microphone, Test signals); file input with explicit audio types plus drag-and-drop; play/pause, seek, volume (file only); keyboard: Space, arrows, `D`, `F`; unsupported-browser notice (no WebGL2, or no `getDisplayMedia` audio); "capture ended" notice. Native buttons and ranges with visible focus; `aria-live` for source changes.
**Accept:** every source can be selected and heard or seen; keyboard works; no console errors.
**Verify:** `npm run typecheck && npm test && npm run build` plus manual check.

## Slice 1.12 — Deploy to Cloudflare `[lead + owner]`

**Goal:** a URL the owner can open on the Windows machine.
**Target files:** `wrangler.jsonc` [NEW], `package.json` (deploy script)
**Steps:** owner runs `npx wrangler login` if `npx wrangler whoami` fails. Deploy as a static-assets Worker. Use `music-visualizer.charliechonguyen.com` as a `custom_domain` route if the zone is in the owner's account, else the free `*.workers.dev` URL. Explained and confirmed before running, since it's outward-facing.
**Verify:** `npx wrangler deploy` succeeds and the URL loads.

## Slice 1.13 — Device test report `[owner]`

**Goal:** the Stage 1 pass/fail record.
**Target files:** `docs/stage1-test-report.md` [NEW]
**Checklist per machine (Mac, Windows) and per source (file, tab/system, mic, test signals):** the four checks from `docs/visualization-ladder.md` §3; latency median shown; notes on anything that felt off. Plus the H1 research check (do other web tools already visualize system audio?), done by the lead agent.
**Verify:** owner signs off in the report.

---

## Open decisions before building

1. **Parallel workers vs. the one-slice lock.** The harness allows only one `[IN_PROGRESS]` slice at a time. Running Wave 1 in parallel needs one git worktree per worker, with the lead merging each branch. Proposal: allow parallel slices *only* when they are in separate worktrees and share no target files.
2. **How free OpenCode models are reached.** The OpenCode CLI is not installed on this machine, and the only agent with OpenCode access (Council) is a reviewer, not a coder. Options: (a) install the OpenCode CLI (free, open source) and run free models from the lead agent; (b) create a "Coder" OpenBot agent backed by OpenCode; (c) use Claude Haiku subagents for the "free" slices instead (small token cost, no setup).
3. **Contract review.** `AudioFrame` and `RenderLayer` are the two expensive-to-change contracts. Optional: send this doc to the Council for review before Wave 1.
