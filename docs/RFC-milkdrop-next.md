# RFC: Open-Source Cross-Platform Audio-Reactive Visualizer ("Project MilkDrop-Next")

**Status:** Draft / Request for Comments (RFC)  
**Target Platforms:** Desktop (Windows, macOS), Web Browser (PWA), Mobile (iOS, Android)  
**License Intent:** Open-Source (MIT / GPLv3)  

---

## 1. Problem Statement & Vision

### 1.1 The Gap in the Current Landscape
Existing music visualization software falls into two flawed categories:
1. **Legacy Engines (e.g., MilkDrop, projectM):** Visually iconic due to stateful multi-pass framebuffer feedback loops, but architecturally dated. They lack modern cross-platform ergonomics, detached multi-screen control surfaces, modern shader pipeline integrations, and seamless plug-and-play system audio routing across modern OS security boundaries.
2. **Modern Commercial / Web Visualizers:** Often locked behind steep paywalls, built as heavy VJ suites (Resolume, TouchDesigner) with high cognitive overhead, or implemented as naive single-pass WebGL fragment shaders driven by raw, unsmoothed FFT arrays that appear mathematically rigid and jittery rather than musical.

### 1.2 Project Objective
Architect a lightweight, open-source, cross-platform music visualizer that operates passively alongside external audio sources (Spotify, Apple Music, DJ software, live line-in). It must deliver:
* **Perceptual Musicality:** Deep psychoacoustic audio analysis (transient onset detection, envelope following, logarithmic frequency mapping) rather than raw FFT bin mapping.
* **Stateful Visual Depth:** First-class support for multi-pass ping-pong framebuffers, warp grids, and seamless crossfades between active shaders.
* **Backward & Forward Compatibility:** Out-of-the-box support for legacy `.milk` (Butterchurn) presets alongside a modern, hot-reloadable GLSL/WGSL pipeline using Interactive Shader Format (ISF) conventions.
* **Zero-Clutter Projection:** A detachable "Control Deck" architecture allowing live parameter manipulation on a secondary screen/device while projecting clean visuals full-screen.

---

## 2. Core Technical Constraints & Premise Audit

Any proposed architecture must account for three non-negotiable system realities:

1. **OS Audio Loopback Fragmentation:**
   * **Windows:** Supports native passive capture via WASAPI Loopback.
   * **macOS:** Requires `ScreenCaptureKit` or CoreAudio Process Tap APIs (macOS 13+) for native zero-driver loopback, or a virtual audio driver (e.g., BlackHole) for browser/legacy capture.
   * **Browser (PWA):** Sandboxed from passive OS audio output. Must rely on `navigator.mediaDevices.getDisplayMedia({ audio: true })` (tab/system audio sharing) or `getUserMedia` (microphone or virtual loopback cable).
   * **Mobile (iOS/Android):** Strict OS sandboxing prevents capturing raw PCM output from backgrounded DRM streaming apps (Spotify/Apple Music). Mobile deployment must default to either **Ambient Microphone Capture** (ideal for live parties/rooms) or **Networked Display/Controller Mode** (receiving real-time audio telemetry or control state over local WebSockets from a desktop host).
2. **Stateful Rendering (Why MilkDrop Works):**
   * Visual organicism requires a multi-pass feedback pipeline: Frame $N-1$ is sampled, warped via a vertex grid or UV displacement map, blended with new geometry/waveforms, decayed slightly, and written to Frame $N$. Single-pass stateless shaders are insufficient.
3. **Decoupled DSP vs. Rendering:**
   * Audio analysis must run on a dedicated thread/worklet at a fixed sample rate, independent of display refresh rates (60Hz–144Hz), exposing a normalized data contract to the GPU.

---

## 3. Proposed System Architecture (4-Layer Pipeline)

### Layer 1: Audio Ingestion Layer
* **Desktop Native Host:** Captures raw stereo PCM stream directly from the default system output device or specific application process.
* **Web / Mobile Fallback:** Captures audio via Web Audio API (`getUserMedia` for mic/line-in/virtual-cable, or `getDisplayMedia` for tab/screen audio).

### Layer 2: Psychoacoustic DSP Engine
Transforms raw PCM time-domain samples into a normalized `AudioTelemetryFrame` struct at 60–120Hz:
* **Time-Domain Data:** Downsampled L/R oscilloscope arrays (e.g., 512 floats) for vector waveform rendering.
* **Logarithmic Frequency Binning:** Maps linear FFT bins into perceptual Bark/Mel bands (`sub_bass`, `bass`, `low_mid`, `mid`, `high_mid`, `brilliance`).
* **Envelope Followers (EMA):** Applies configurable Fast-Attack / Slow-Release smoothing per band to mirror human auditory perception and prevent visual strobing.
* **Spectral Flux & Onset Detection:** Tracks rapid energy deltas to emit discrete boolean triggers (`is_kick`, `is_snare`, `is_onset`) and calculates an estimated BPM phase sawtooth wave (`0.0` to `1.0`).

### Layer 3: Preset & Transition State Machine
* **Dual-Pipeline Crossfader:** Instantiates two concurrent preset render targets (`Scene A` and `Scene B`) during transitions, blending them over a 3–10 second window using transition shaders (luma dissolve, displacement warp, plasma fade).
* **Engine Adapters:**
  1. *Legacy Adapter:* Wraps `Butterchurn` (WebGL2 MilkDrop implementation) to immediately unlock thousands of community `.milk` presets.
  2. *Modern Native Adapter:* Executes custom multi-pass GLSL/WGSL shaders adhering to the **ISF (Interactive Shader Format)** JSON header specification for automatic UI slider generation.

### Layer 4: Rendering & Control Surface
* **Canvas View:** Pure, chrome-free rendering viewport supporting ping-pong framebuffers, instanced 3D geometry, and a global post-processing stack (bloom, chromatic aberration, kaleidoscope symmetry).
* **Detached Control Deck:** Communicates with the Canvas View via `BroadcastChannel API` (local browser windows) or `WebSockets` (local network / Tauri IPC). Controls preset playlists, transition timers, audio gain/attack/release curves, and live shader uniform macro sliders.

---

## 4. Candidate Tech Stack Options

### Option A: Tauri v2 Hybrid (Rust Backend + TypeScript/WebGL2/WebGPU Frontend) — *[Current Baseline Recommendation]*
* **Architecture:** Rust handles native OS audio loopback (`cpal` / `ScreenCaptureKit`) and optionally heavy DSP (`rustfft`), streaming a compact `Float32Array` over Tauri IPC to a lightweight WebView running TypeScript + Three.js/WebGL2. The exact same frontend compiles to a standalone PWA for browser/mobile use.
* **Pros:** Tiny binary (<15MB), low memory overhead, native zero-config system audio capture on Desktop, 100% code reuse for the web/UI layer, direct compatibility with Butterchurn.
* **Cons:** Dual-language boundary (Rust + TypeScript); Tauri IPC serialization must be tuned for high-frequency 120Hz telemetry.

### Option B: Pure Web PWA (TypeScript + AudioWorklet + WebGL2/WebGPU)
* **Architecture:** 100% browser-based. Uses `AudioWorklet` (potentially compiled to WASM) for DSP.
* **Pros:** Zero native build toolchains, instant deployment, single language.
* **Cons:** Poor UX for capturing external desktop audio (requires user to configure virtual audio cables like BlackHole/VB-Cable or re-authorize screen/tab sharing every session).

### Option C: Native Rust Engine (`wgpu` + `cpal` + `egui`)
* **Architecture:** Pure Rust compiled to native desktop binaries and WebAssembly for browser.
* **Pros:** Maximum performance, unified language, deterministic memory management.
* **Cons:** High friction for building flexible, detachable multi-window web UIs; loses drop-in compatibility with existing JavaScript-based Butterchurn/WebGL libraries.

---

## 5. Phased Scope & Roadmap

* **Phase 1: DSP Sandbox & Telemetry Contract (Weeks 1–2)**
  * Build the Web Audio / Rust DSP pipeline (Logarithmic FFT, Envelope Followers, Spectral Flux Onset Detector).
  * Build a real-time diagnostic visualizer (graphs/oscilloscopes) to tune attack/decay curves against diverse music genres before writing complex shaders.
* **Phase 2: Multi-Pass Renderer & Butterchurn Bridge (Weeks 3–4)**
  * Implement dual-scene framebuffer architecture with shader crossfading.
  * Integrate Butterchurn as Renderer Module 1.
  * Build Renderer Module 2 (Custom Ping-Pong GLSL pipeline with ISF uniform bindings).
* **Phase 3: Detached Control Deck & Preset Schema (Weeks 5–6)**
  * Define JSON Preset Schema (shader references, default uniforms, mood tags, transition preferences).
  * Build the detachable Control UI using `BroadcastChannel` / WebSockets for dual-screen projection setups.
* **Phase 4: Tauri Desktop Wrapper & Native Loopback (Weeks 7–8)**
  * Wrap core in Tauri v2.
  * Implement native Windows (WASAPI) and macOS (`ScreenCaptureKit`/CoreAudio) loopback audio ingestion.

---

## 6. Open Questions & Instructions for Reviewers (AI Models / Peers)

Please review the architecture and roadmap above and provide critical, constructive feedback across the following vectors:

1. **Architectural Stress-Test:** Where are the hidden bottlenecks or failure modes in the **Tauri v2 (Rust + WebView)** approach? Specifically, evaluate the latency and serialization overhead of streaming 60–120Hz audio telemetry between Rust and the WebView vs. sending raw PCM to a Web `AudioWorklet`.
2. **macOS & Mobile Audio Loopback Realities:** Are there cleaner, modern approaches to capturing system audio on macOS (e.g., CoreAudio Process Tap APIs introduced in macOS 14.2+ vs. `ScreenCaptureKit`) or workarounds on iOS/Android that haven't been considered?
3. **WebGL2 vs. WebGPU:** Given the requirement to support both Butterchurn (which relies on WebGL2) and custom modern shaders across desktop and mobile browsers, what is the cleanest abstraction strategy? Should we build strictly on WebGL2 first, or use a dual-context architecture where WebGPU compute shaders feed textures into a WebGL2 compositor?
4. **DSP & Beat Detection Algorithms:** What specific open-source libraries, algorithms, or mathematical models (e.g., BTrack, Aubio, Superflux, dynamic thresholding) perform best for real-time, zero-lookahead genre-agnostic beat/onset detection?
5. **Scope & Feature Critique:** What features in the phased roadmap are over-engineered for V1, and what critical "table stakes" features for live party/study projection are currently missing?