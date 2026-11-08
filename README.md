# Music Visualizer

A high-performance, real-time, zero-dependency WebGL2 audio visualizer web application running natively in modern browsers (Chrome, Edge, Safari, Firefox).

Built entirely on **raw WebGL2** and the **Web Audio API** in TypeScript with Vite, featuring 13 distinct visual layer synthesizers, complex non-linear feedback warp shaders, multi-pass bloom post-processing, an interactive Preset Studio, and 20 handcrafted flagship generative presets.

Everything runs strictly client-side on the GPU and Web Audio threads: no accounts, no server round-trips, and no audio data leaves your device.

---

## Live Demo

- **Production:** [https://music-visualizer.charliechonguyen.com](https://music-visualizer.charliechonguyen.com)
- **Backup:** [https://music-visualizer.charliechonguyen.workers.dev](https://music-visualizer.charliechonguyen.workers.dev)

---

## Features

### 1. Audio Engine & Multi-Band Reactivity
- **Multi-Source Input**: Real-time microphone input, local audio file playback (with scrubber and loop controls), and tab / system audio via `getDisplayMedia`.
- **128-Bin Frequency Analysis**: Low-latency FFT analysis downsampled into 128 log-spaced frequency bands across Sub, Bass, Low-Mid, Mid, High-Mid, and High frequencies.
- **Audio Texture Pipeline**: Two-row persistent R32F data texture (Row 0: 512 box-averaged waveform samples; Row 1: 128 log-spectrum bins) passed to GPU shaders every frame.
- **Dynamic Physics & Envelopes**:
  - `kickEnv` with exponential decay and discrete `kickPulse` onset triggers.
  - Spectral centroid tracking with automatic silence freeze.
  - Adaptive loudness governor, dynamic range compression, and photosensitivity safety guards.

### 2. High-Performance WebGL2 Render Engine
- **Composable Multi-Layer Synthesis**:
  - **Shape Layer**: Parametric multi-point polygon and logarithmic spiral geometry with beat-reactive radius, rotation, stroke, and inward/outward tapering.
  - **Spectral Terrain**: 64 perspective 3D horizontal ridges with dark occlusion skirts (`gl.TRIANGLE_STRIP`) and glowing ridge lines (`gl.LINE_STRIP`) driven by audio history ring buffers.
  - **Chladni Cymatic Sand**: 8,192 seed points simulating 2D nodal standing wave physics with analytical gradient relaxation and harmonic mode morphing.
  - **Phyllotaxis Spiral Particles**: Outward Fibonacci golden-angle spiral blooms (`r = c * sqrt(i)`, `theta = i * 2.3999...`) with audio phase waves.
  - **Reaction-Diffusion**: Isolated 256x256 ping-pong Gray-Scott chemical simulation with normal and specular ridge lighting.
  - **Ferrofluid**: 4-subdivision icosahedron displaced by 3D curl noise and shaded with MatCap metallic reflections.
  - **Moiré Interference Loom**: Concentric dual-grid procedural interference patterns with screen-space `fwidth()` anti-aliasing.
  - **Tunnel**: Infinite 3D flight mechanics with polygon wall geometries, round rings, starry cosmic trails, and auto-reversing directional thrust.
  - **Waveform**: Multi-color ink parametric waveforms, 7-point wireframe stars, and 3D Lissajous parametric knots.
  - **Rings, Crown, Shockwave & BassPulse**: Audio-reactive geometric rings, radial audio crowns, and transient shockwave bursts.
- **Non-Linear Feedback Warp Engine**:
  - Fullscreen GPU feedback pass supporting 2D curl noise advection, complex Möbius transformations `(az+b)/(cz+d)`, polar angle folding, chromatic aberration RGB split, Sobel edge filtering, and sinusoidal solarization.
- **Post-Processing Chain**:
  - Half-resolution Gaussian bloom pass with thresholding.
  - CRT scanlines and barrel distortion.
  - Contrast, saturation, gamma, vignette, and chromatic aberration controls.
  - Photosensitive epilepsy safety governor with bidirectional luminance slew damping and high-frequency stripe attenuation.

### 3. Preset Studio & Organizational Hierarchy
- **20 Handcrafted Flagship Presets**:
  - `01 Curl Fluid Warp`
  - `02 Kaleidoscopic Mandala`
  - `03 Solarized Contour Rings`
  - `04 Möbius Dual Vortex`
  - `05 RGB Aberration Vortex`
  - `06 Lissajous Vector CRT`
  - `07 Moiré Interference Loom`
  - `08 Spectral Ridge Terrain`
  - `09 Chladni Cymatic Sand`
  - `10 Phyllotaxis Spiral Bloom`
  - `11 Liquid Metal Ferrofluid`
  - `12 Reaction Diffusion Turing Lab`
  - `13 Neon Polygon Nexus`
  - `14 Sacred Orbit Mandala`
  - `15 Polar Spirograph Bloom`
  - `16 Hexagon Inward Portal`
  - `17 Corridor LED Equalizer`
  - `18 Quantum Lattice`
  - `19 Spiral Pearl Beads`
  - `20 Dual Rail Aurora Ark`
- **Preset Folders**: Hierarchical categorization with immutable system folders (*Stage 9 Showcase*, *Flagship Generative*, *Classics & Textures*) and full user-defined folder management (create, rename, move, delete).
- **Studio Inspector**: Real-time parameter tweaking powered by Tweakpane, live parameter linking to audio signals, preset export/import as JSON, undo/redo, and A/B comparison.

---

## Architecture & Codebase Map

```
music-visualizer/
├── src/
│   ├── audio/                # Web Audio analysis pipeline
│   │   ├── engine.ts         # AudioContext, microphone, file and display capture
│   │   ├── frameBuilder.ts   # AudioFrame builder, kick detection, spectral centroid
│   │   ├── bandWaveforms.ts  # Multi-band waveform analysis
│   │   └── types.ts          # Audio data type definitions
│   ├── gl/                   # Raw WebGL2 abstractions
│   │   ├── fbo.ts            # Framebuffer objects (ping-pong, multi-target)
│   │   ├── shader.ts         # Shader compilation and linking utilities
│   │   └── size.ts           # Canvas and viewport resolution handling
│   ├── presets/              # Preset system, schemas, and builtin library
│   │   ├── builtin/          # 20 Flagship and classic JSON presets
│   │   ├── schema.ts         # Strict preset schemas and parameter contracts
│   │   ├── session.ts        # User preset storage, folder hierarchy, and state
│   │   └── loader.ts         # Preset instantiation and parameter interpolation
│   ├── render/               # WebGL2 rendering pipeline
│   │   ├── compositor.ts     # Multi-pass compositor, transitions, and Calm governor
│   │   ├── scene.ts          # Central render loop and layer coordination
│   │   ├── bandTexture.ts    # Persistent R32F audio data texture manager
│   │   ├── layers/           # 13 dedicated visual layer modules
│   │   │   ├── shape.ts
│   │   │   ├── spectralTerrain.ts
│   │   │   ├── chladniSand.ts
│   │   │   ├── ferrofluid.ts
│   │   │   ├── reactionDiffusion.ts
│   │   │   ├── moire.ts
│   │   │   ├── tunnel.ts
│   │   │   ├── waveform.ts
│   │   │   ├── particles.ts
│   │   │   ├── rings.ts
│   │   │   ├── crown.ts
│   │   │   ├── shockwave.ts
│   │   │   └── bassPulse.ts
│   │   └── shaders/          # GLSL ES 3.0 vertex and fragment shaders
│   ├── studio/               # Preset Studio inspector and folder UI
│   │   └── studio.ts         # Tweakpane integration, folder management
│   ├── ui/                   # Player controls, keyboard shortcuts, and HUD
│   │   └── controls.ts       # Play/pause, sensitivity, volume, file selector
│   └── main.ts               # Application entrypoint and tick loop
└── wrangler.jsonc            # Cloudflare Workers static assets configuration
```

---

## Getting Started

### Prerequisites
- Node.js (v20+ recommended)
- npm or pnpm

### Installation
```bash
git clone https://github.com/cchonguyen/music-visualizer.git
cd music-visualizer
npm install
```

### Development Server
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

### Verification & Testing
```bash
# Run Vitest unit tests (827 tests across 60 test suites)
npm test

# Typecheck TypeScript without emitting JS
npm run typecheck

# Production build
npm run build
```

### Production Deployment
Deploys to Cloudflare Workers static assets:
```bash
npm run deploy
```

---

## Keyboard Controls

| Key | Action |
| --- | --- |
| `Space` | Play / Pause audio playback |
| `0` – `9` | Instant switch to Flagship Presets 1–10 |
| `[` / `]` | Cycle previous / next preset |
| `Tab` | Toggle Preset Studio inspector |
| `F` | Toggle Fullscreen mode |
| `C` | Toggle Auto-Cycle timer |
| `B` | Toggle Beat-reactive preset auto-cycling |
| `X` | Shuffle presets randomly |
| `H` / `?` | Toggle Help & Keyboard Shortcuts overlay |
| `Escape` | Dismiss open modals and panels |

---

## License

MIT © [Charlie Cho Nguyen](https://github.com/cchonguyen)
