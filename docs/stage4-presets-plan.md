# Stage 4 Plan: Presets, Effects and the Preset Studio

**Status:** draft for owner review, 2026-11-04. Nothing here is built yet.
**Owner direction (2026-11-04):** Stage 3 polish is parked. Next work: more visual variety, a set of effects, presets you can switch between, and a **Preset Studio** for tuning and saving presets visually.
**Replaces:** the short Stage 4 plan in `.spec/SYSTEM_SPEC.md` §7 (4a/4b). Still true: our own engine, our own JSON format, Butterchurn and `.milk` stay reference only.

## 1. What we learned from projectM / MilkDrop

Sources: the MilkDrop preset authoring guide (geisswerks.com/milkdrop/milkdrop_preset_authoring.html), the projectM repo and wiki (github.com/projectM-visualizer/projectm, wiki page "Preset-Transition-Shaders"), MilkDrop3 (github.com/milkdrop2077/MilkDrop3), and the ISF spec (github.com/mrRay/ISF_Spec). Read 2026-11-04.

1. **The look comes from the feedback warp, not from the shapes.** Each frame, MilkDrop takes the previous frame, moves it slightly (zoom, rotate, shift, stretch, wavy warp), dims it (`decay`), and draws new shapes on top. Thin waveforms become tunnels, spirals and smoke this way. Our `Scene` already has the feedback loop (`decay.frag.glsl`), but today it only dims. **Adding motion to that one pass is the single biggest visual upgrade available.**
2. **A preset is mostly numbers.** MilkDrop presets are about 60 named values (zoom, rot, warp, decay, wave mode, colours, borders) plus optional code. The numbers alone make a large share of the looks.
3. **Audio drives the numbers.** Authors write small equations like `zoom = 1 + 0.1*bass`. That is how a static setting becomes musical. We get the same result without a code language: each slider can have an **audio link** (source, amount, smoothing). See §4.
4. **Two shader stages:** a *warp* stage that feeds the next frame (effects build up over time) and a *composite* stage that only affects what is shown (effects stay put). We copy that split: **feedback effects** and **post effects**.
5. **Blur at three sizes** (blur1/2/3) gives glow and soft trails.
6. **Up to 4 custom shapes and 4 custom waves per preset**, each a polygon with 3–100 sides, fill and border colours, optional instancing (up to 1024 copies) and "textured" mode (the shape shows the previous frame inside it, a picture-in-picture tunnel).
7. **Transitions:** projectM draws the old and new presets separately, then a transition shader blends them using a progress value (linear, cosine or bicubic easing) and the audio bands. Our `Compositor` already draws two scenes, so we can add transition styles the same way.
8. **Editing in MilkDrop is clumsy:** arrow keys on one value at a time, or raw code. MilkDrop3 adds a colour randomiser, "mash-ups" (mix parts of two presets), and blend patterns. **No tool found offers sliders with live preview for every setting.** That is the gap the Preset Studio fills.
9. **ISF's input format** (name, type, label, default, min, max; types float, bool, long/enum, color, point2D, event) is a proven way to describe settings so a UI can be generated from them. We adopt the same idea for our parameter schema.

Not verified: projectM's soft-cut/hard-cut and beat-sensitivity settings (the API page was empty when fetched).

## 2. The core idea: a preset is data

Today every look is hard-coded: constants like `RING_DENSITY = 0.5` sit inside each layer file, and `main.ts` wires three scenes by hand. Stage 4 turns this into:

```
Preset (JSON)
├── name, tags, version
├── transition: { style, seconds }
├── feedback:   { zoom, rotate, warp, decay, hueDrift, blur, ... }   ← feeds the next frame
├── layers: [   { type: "tunnel",    enabled, opacity, blend, params: {...} },
│               { type: "particles", ... }, { type: "rings", ... } ]
├── post:       { hueShift, saturation, mirror, bloom, ... }         ← shown only
└── each number may be { value, link: { source: "bass", amount: 0.3, smooth: 0.2 } }
```

One **parameter schema** per layer and per effect (name, label, group, type, default, min, max, step) is the single source of truth. It drives three things at once:
- **the loader** (checks a preset and fills missing values with defaults),
- **the Studio** (builds sliders, toggles, dropdowns and colour pickers automatically),
- **the randomiser** (knows each setting's safe range).

So every new effect or variant added later shows up in the Studio with no extra UI work.

**Safety stays outside presets.** The brightness limiter, red-saturation rule and flash governor (`safety.ts`, `composite.frag.glsl`) run after every preset and cannot be switched off from a preset or the Studio. Settings that could strobe (invert, hue jumps, flash on beat) go through the flash governor.

## 3. Feature list

### 3a. Effects (MilkDrop-inspired)

| Effect | Where | What it does | MilkDrop name |
|---|---|---|---|
| Zoom (+ zoom curve) | feedback | Trails fly in or out of the centre | `zoom`, `zoomexp` |
| Rotate | feedback | Trails spiral | `rot` |
| Centre point | feedback | Move the zoom/rotate centre | `cx`, `cy` |
| Drift | feedback | Trails slide sideways/up | `dx`, `dy` |
| Stretch | feedback | Trails stretch on one axis | `sx`, `sy` |
| Warp (amount, speed, scale) | feedback | Wavy, liquid distortion | `warp` |
| Decay and fade | feedback | Trail length (exists today, made adjustable) | `decay` |
| Edge mode | feedback | Trails wrap around screen edges or clamp | `wrap` |
| Hue drift | feedback | Trails change colour as they age | (shader) |
| Feedback blur | feedback | Trails soften into smoke | blur1 |
| Echo | post | A second, zoomed or flipped copy on top | `echo_zoom`, `echo_alpha`, `echo_orient` |
| Mirror / kaleidoscope | post | 2, 4, 6, 8… fold symmetry | (shader) |
| Hue shift, saturation, contrast, gamma | post | Colour grading | `gamma` |
| Brighten / darken / solarize / invert | post | Tone filters | same names |
| Bloom / glow | post | Bright parts glow (blur at 3 sizes) | blur1/2/3 |
| Chromatic aberration | post | Red/blue edge split | (shader) |
| Vignette / darken centre | post | Darker edges or centre | `darken_center` |
| Kick punch | modulation | Short zoom or scale jump on a kick | (equation) |

### 3b. Component variety

| Component | Variants to add | Settings exposed |
|---|---|---|
| **Tunnel** | wall pattern: rings, grid, spokes, checker, stripes; cross-section: circle, polygon (3–12 sides), square; spiral twist; direction in/out | ring density, speed, twist, bend, roll, contrast, fog/depth, centre wander |
| **Particles** | emitter: centre burst, ring, screen edges, random field, along waveform; motion: outflow (today), vortex, rain, orbit, 3D starfield, noise drift; shape: dot, streak, star, ring, square | count, size, lifetime, speed, swirl, streak length, colour mode (palette, by speed, by band), trigger band |
| **Rings / shapes** | concentric (today), polygon rings (3–100 sides, like MilkDrop custom shapes), orbiting rings, instanced shape grids, filled vs outline, "textured" (shows the previous frame inside) | count, sides, stroke, spacing, spin, pulse band |
| **Pulse** | ring shockwave (today), full-field glow, radial burst lines, centre bloom, screen-zoom kick | trigger band, size, duration, strength (governed) |
| **Spectrum ring (crown)** | bars, line, dots, mirrored, filled petals | bar count, height, rim radius, smoothing |
| **Waveform** (exists, small) | line, circle, radial, XY scope, dots, mirrored (MilkDrop's 8 wave modes as a guide) | thickness, position, size, colour |

### 3c. Presets and switching
- Built-in presets shipped as JSON files in the repo (read-only), plus your own presets saved in the browser.
- Keys: `1`–`9` pick a preset, `[` and `]` previous/next, name shown briefly on screen.
- Crossfade time per preset (today fixed at 0.32 s; presets can ask for 0.3–10 s).
- Later: transition styles (crossfade, zoom-through, wipe, luma dissolve, plasma), auto-cycle on a timer or on a strong beat, shuffle, favourites.

### 3d. Preset Studio (the tuning tool)
- **Live panel** next to the visual: every setting of the current preset as a slider, toggle, dropdown or colour picker, grouped and collapsible (Feedback · each layer · Post). Changes apply on the next frame.
- **Layer stack:** add, remove, duplicate, reorder, enable/solo, opacity and blend mode per layer.
- **Audio links:** a small button next to each slider opens source (sub, bass, mid, high, energy, loudness, beat, LFO), amount and smoothing, with a live meter showing the linked value moving.
- **Randomise and mutate:** randomise everything within safe ranges, mutate (nudge every value ±10%), randomise one group, lock settings you want to keep. Inspired by MilkDrop3's mash-ups.
- **Undo / redo** for every change.
- **Save, duplicate, rename, delete** in your browser library; **export / import** a preset as a `.json` file (backup, or to promote it into the built-in set).
- **A/B compare:** hold a key to see the last saved version.
- **Health:** frame time and a warning when a preset gets too heavy for 60 fps.
- Later: open the Studio in a second window (the visual stays clean full-screen; the RFC's "Control Deck").

**Data choice:** presets live in the browser (`localStorage`) plus JSON files you can download. No database, no accounts, no cost. Reason: one user, small data, and SYSTEM_SPEC rules out accounts and cloud storage. Risk: clearing browser data deletes saved presets, so export is built into slice S2.

## 4. Audio links (how settings follow the music)

Each number can be a plain value or a value plus a link:

```
final = base + amount × shaped(source)      then clamped to the setting's min..max
```

- **Sources:** `sub`, `bass`, `mid`, `high` (normalised bands), `energy`, `loudness`, `beat` (kick envelope), `onset`, `section` (section contrast), `lfoSine`, `lfoSaw`, `lfoRandom` (each with a rate), `time`.
- **Shaping:** smoothing (attack/release), curve (linear, soft, hard), invert.
- Pure TypeScript, unit tested, evaluated once per frame before layers draw. Calm mode scales all link amounts down (and Visual Gain keeps working).
- **Rejected for now:** a code/equation language like MilkDrop's. It needs a parser and interpreter (the same reason `.milk` import is parked), and sliders are easier to tune and debug. Can be added later as an "expression" source.

## 5. Slices (in build order)

Order rule: build the Studio early, so every effect and variant after it is tuned in the Studio instead of by editing code. Each slice ends with a browser check; slices marked 🖐 need your visual sign-off.

### Phase 1 — Presets as data (foundation)
| Slice | What | Main files | Check |
|---|---|---|---|
| **4.1 Parameter schema and preset format** | Types for settings and presets, a validator that fills defaults and clamps ranges, a version number for future changes | `src/presets/schema.ts`, `src/presets/format.ts` [NEW] + tests | unit tests |
| **4.2 Layers read settings** | Move hard-coded constants from tunnel, particles, crown, rings, shockwave, bars into each layer's schema; layers read `params` each frame. **No visible change** | `src/render/layers/*.ts` | side-by-side: looks identical 🖐 |
| **4.3 Loader and built-in presets** | Layer registry (type → layer); build a Scene from JSON; today's crown, flight and bars scenes become 3 JSON presets; `main.ts` wiring shrinks | `src/presets/loader.ts`, `src/presets/builtin/*.json`, `src/main.ts` | same 3 looks load from JSON |
| **4.4 Preset switching** | Keys 1–9, `[` `]`, name toast, per-preset crossfade time, remember last preset | `src/presets/library.ts`, `src/render/compositor.ts`, `src/ui/` | switch and fade 🖐 |

### Phase 2 — Preset Studio v1
| Slice | What | Check |
|---|---|---|
| **S1 Live panel** | Panel generated from the schema; slider, toggle, dropdown, colour; grouped; live preview; `E` key toggles it | every 4.2 setting moves the visual 🖐 |
| **S2 Save and library** | Save, duplicate, rename, delete in the browser; export/import `.json`; unsaved-changes dot | reload keeps presets; export→import round-trip |
| **S3 Layer stack** | Add, remove, duplicate, reorder, enable/solo, opacity, blend mode per layer | build a new preset from scratch 🖐 |
| **S4 Undo, randomise, mutate, lock** | History of changes; randomise all/group; mutate ±10%; lock toggles; A/B compare | randomised presets never break safety rules |

### Phase 3 — Motion and effects
| Slice | What | Check |
|---|---|---|
| **E1 Feedback warp** | Replace the decay pass with zoom, zoom curve, rotate, centre, drift, stretch, warp, decay, fade, edge mode | MilkDrop-style spirals and fly-through trails 🖐 |
| **E2 Audio links** | §4 modulation model + Studio link editor with live meter | zoom pumping with bass 🖐 |
| **E3 Feedback colour and blur** | Hue drift and feedback blur inside the warp pass | smoky, colour-shifting trails 🖐 |
| **E4 Post chain** | Hue shift, saturation, contrast, gamma, brighten/darken/solarize/invert, echo, mirror/kaleidoscope, vignette, chromatic aberration; one shader with switches | each effect on/off 🖐 |
| **E5 Bloom** | Blur at 3 sizes at half and quarter resolution; glow amount and threshold | stays under frame budget |

### Phase 4 — Component variety
| Slice | What |
|---|---|
| **V1 Tunnel variants** | wall patterns, polygon cross-section, spiral twist, direction |
| **V2 Particle variants** | emitters, motion modes, shapes, colour modes |
| **V3 Shapes and rings** | polygon rings, orbiting, instanced grids, filled/outline, textured |
| **V4 Pulse variants** | glow field, burst lines, centre bloom, zoom kick |
| **V5 Spectrum ring and waveform modes** | crown styles; waveform line/circle/radial/XY/dots/mirror |

Each V slice: new options appear in the Studio automatically; owner tunes one built-in preset per variant 🖐.

### Phase 5 — Transitions and curation
| Slice | What |
|---|---|
| **T1 Transition styles** | crossfade, zoom-through, wipe, luma dissolve, plasma (projectM-style, eased progress + audio) |
| **T2 Auto-cycle** | timer, switch on strong beat, shuffle, favourites, skip list |
| **T3 Starter pack** | 10–15 presets you tune and approve; replaces the 3 converted ones as defaults |
| **T4 Studio in a second window** (optional) | Studio in its own window via `BroadcastChannel` (browser messaging between windows of the same site) |

## 6. Risks and limits
- **Frame budget.** Each full-screen effect is one more GPU pass per scene, and a crossfade draws two scenes. Bloom runs at reduced size. The Studio shows frame time; target stays 60 fps on your Mac and Windows machines.
- **Photosensitivity.** Randomise and audio links could create strobes. Safety pass and flash governor stay on and outside presets; invert and hue jumps are rate-limited.
- **Preset format changes.** The `version` field plus a small upgrade function keeps old saved presets loading after later slices add settings.
- **Browser storage loss.** Mitigated by export/import (S2). Cloud sync is out of scope.
- **Scope creep.** Each V and E slice is small and independently useful; we can stop after any phase.

## 7. Owner decisions (2026-11-04)
1. **Studio controls use a small library: Tweakpane** (MIT, v4.0.5). It has folders, colour pickers, a 2D point pad (for the zoom/rotate centre) and live graph monitors (for audio-link meters), which match the Studio's needs. Alternative kept: lil-gui (MIT, v0.21.0, released more recently, lighter, but no 2D pad or graphs). Risk: Tweakpane's last release was 2024-11; it's UI only, so browser changes are unlikely to break it. It is loaded only by the Studio, never by the renderer.
2. **Studio placement v1: side panel** over the visual, toggled with `E`. Second window stays in T4.
