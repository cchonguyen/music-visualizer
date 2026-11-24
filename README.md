# Music Visualizer

A real-time music visualizer for desktop Chrome and Edge (macOS and Windows). It draws GPU visuals in time with a music file, the audio playing in a browser tab or your whole system, or your microphone.

It is built on **raw WebGL2** and the **Web Audio API** in TypeScript with Vite. The only runtime library is Tweakpane, which the Preset Studio panel uses. Audio is analysed on your device and never uploaded, and you need no account.

---

## Live app

- **Production:** [https://music-visualizer.charliechonguyen.com](https://music-visualizer.charliechonguyen.com)
- **Backup:** [https://music-visualizer.charliechonguyen.workers.dev](https://music-visualizer.charliechonguyen.workers.dev)

---

## Features

### 1. Audio sources and analysis
- **Four sources:** a local audio file (with play, pause and a seek bar), tab or system audio shared through the browser's screen-share prompt (tick "Share audio"), the microphone, and built-in test signals (kick, tone, sweep, silence).
- **Frequency analysis:** 128 log-spaced frequency bins from 20 Hz to 12 kHz, grouped into sub, bass, mid and high bands.
- **Audio texture:** a 512 × 2 float texture sent to the shaders every frame (row 0 holds 512 waveform samples, row 1 holds the 128 log-spectrum bins).
- **Music signals:** kick envelope and onsets, beat and tempo tracking, spectral centroid, loudness, and song-arc signals (drop, breakdown, 16- and 32-beat phrases, slow energy).

### 2. Render engine
- **Visual layers** (`src/render/layers/`), stacked and blended per preset:
  - **Shape:** polygons, stars, spirals, rings, waveform lines and ribbons, 3D knots and the twisting oscilloscope wave, with wall-bounce motion and beat-reactive size, spin and stroke. Old waveform layers load as Shape layers.
  - **Particles:** streaks, dots, stars and rings, including phyllotaxis (golden-angle) spiral layouts.
  - **Tunnel:** forward flight through ring, grid, spoke, checker or stripe walls, with polygon cross-sections and twist.
  - **Spectral Terrain:** 3D ridge lines built from the recent spectrum.
  - **Chladni Sand:** grains that settle on the nodal lines of a vibrating plate.
  - **Reaction-Diffusion:** a Gray-Scott chemical simulation with lit ridges.
  - **Ferrofluid:** a metallic blob pushed by 3D noise.
  - **Moiré:** two overlapping line grids that make interference patterns.
  - **Julia, Orbit and Architecture:** a breathing Julia set, bodies on tilted 3D orbits, and a gliding 3D corridor.
  - **Rings, Crown, Bars, Shockwave and Bass Pulse:** the original Stage 2 visuals.
- **Feedback and warp:** each frame can feed into the next with zoom, rotation and drift, plus curl, Möbius, polar-fold, RGB-split, edge and solarize warps, trail blur, and a stack of up to four warp operators.
- **Post effects:** bloom (with tint and beat pulse), hue shift, saturation, contrast, gamma, brightness, vignette, mirror, chromatic aberration, gradient colour mapping and invert.
- **Global Director:** four experience modes (Cinematic, Calm, Minimal, Color Walk), camera moves and colour palettes applied on top of any preset.
- **Photosensitivity safety:** flashes are kept under 3 per second, brightness changes are slew-limited, and Calm mode softens motion further.
- **Performance:** render quality presets, an automatic quality governor, and a Low-power mode that caps resolution and skips heavy post effects.

### 3. Presets and the Studio
- **Built-in presets:** 31 numbered presets plus Classics & Textures, in three system folders:
  - **Flagship Generative (01–12):** Curl Fluid Warp, Kaleidoscopic Mandala, Solarized Contour Rings, Möbius Dual Vortex, RGB Aberration Vortex, Lissajous Vector CRT, Moiré Interference Loom, Spectral Ridge Terrain, Chladni Cymatic Sand, Phyllotaxis Spiral Bloom, Ferrofluid Magnetic Crown, Reaction Diffusion Coral.
  - **Showcase (13–32):** Solar Crown Eclipse, Sacred Orbit Mandala, Polar Spirograph Bloom, Hexagon Inward Portal, Corridor LED Equalizer, Star Burst Stream, Spiral Pearl Beads, Dual-Rail Aurora Ark, Inhale Exhale, Ripple Pool, Gradient Storm, Mirror Tunnel, Deep Field, Scope Bloom, Ink Flow, Julia Drift, Orbit Hall, Corridor Glide, Bouncing Ribbon Wave, Twisting Scope Wave.
  - **Classics & Textures:** Crown, Flight, Bars, Vortex, Ripple Field, Dust Wave.
- **Preset browser:** a grid of presets grouped by theme, with favourites and a Light / Medium / Heavy cost badge.
- **Auto-cycle:** switch presets on a timer, on strong beats, or every musical phrase, in order or shuffled, with an optional hard cut on the beat.
- **Preset Studio:** edit every layer, feedback, warp and post setting live; add, remove and reorder layers; save, duplicate, export and import presets; undo and redo; randomise or mutate; organise your own presets in folders. Every slider, dropdown and colour can be linked to the music (the ⚡ button) with one-click recipes.
- **Pop-out Studio:** open the Studio in its own window so the visuals stay full-screen.
- **System presets:** the owner can publish system presets from the app; the admin path is protected by Cloudflare Access.

---

## Codebase map

```
music-visualizer/
├── index.html                # Main page: start screen, controls, menus, shortcuts list
├── popout.html               # Pop-out Studio window
├── src/
│   ├── main.ts               # App entry point and frame loop
│   ├── worker.ts             # Cloudflare Worker: static assets plus the /admin routes
│   ├── audio/                # Audio sources, analysis, onsets, tempo, test signals
│   ├── gl/                   # WebGL2 helpers: context, shaders, framebuffers, textures, sizing
│   ├── render/               # Scene, compositor, safety, Global Director, quality governor
│   │   ├── layers/           # One module per visual layer type
│   │   └── shaders/          # GLSL ES 3.0 shaders
│   ├── presets/              # Preset format, schemas, loader, session, links, auto-cycle
│   │   ├── builtin/          # Built-in preset JSON files and folder setup
│   │   └── review/           # Presets still being tuned (Preset 12, starter pack)
│   ├── studio/               # Preset Studio, reactive sliders, pop-out window, admin controls
│   ├── ui/                   # Controls bar, menus, preset browser, notices, debug panel
│   └── config/               # Remote preset configuration
├── supabase/                 # Database migrations for system presets
└── wrangler.jsonc            # Cloudflare Workers configuration
```

---

## Getting started

### Prerequisites
- Node.js 20 or newer
- npm

### Install
```bash
git clone https://github.com/cchonguyen/music-visualizer.git
cd music-visualizer
npm install
```

### Run locally
```bash
npm run dev
```
Open `http://localhost:5173` in Chrome or Edge.

### Check and test
```bash
npm test            # Vitest unit tests
npm run typecheck   # TypeScript check
npm run build       # Production build to dist/
```

### Deploy
Production deploys run in GitHub Actions when a pull request merges into `main`. `npm run deploy` is disabled on purpose.

---

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play or pause (file source) |
| `←` / `→` | Seek 5 s back or forward (file source) |
| `↑` / `↓` | Volume up or down 5% |
| `0` – `9` | Switch to preset 1–10 in the current order |
| `[` / `]` | Previous or next preset |
| `C` | Auto-cycle on a timer (press again to stop) |
| `B` | Auto-cycle on strong beats (press again to stop) |
| `X` | Shuffle the auto-cycle order |
| `M` | Next experience mode (Cinematic, Calm, Minimal, Color Walk) |
| `P` | Next colour palette |
| `K` | Freeze or resume the picture |
| `.` | Step one frame while frozen |
| `E` | Open or close the Studio |
| `Shift` + `E` | Pop the Studio out into its own window |
| `A` (hold) | Compare with the saved copy of the preset |
| `F` | Fullscreen |
| `?` | Show or close the shortcuts list |
| `D` | Show or hide the debug panel |
| `Esc` | Close open menus |

---

## License

MIT © [Charlie Cho Nguyen](https://github.com/cchonguyen)
