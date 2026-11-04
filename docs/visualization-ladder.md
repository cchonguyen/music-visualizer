# Visualization Ladder and Differentiation

Companion to `.spec/SYSTEM_SPEC.md`. Written 2026-11-04. Owner is the taste judge; this doc says what the engine can do and how we test each step.

## 1. What We Are Trying to Do Better

These are hypotheses. Each one has a test. None is proven yet.

| # | Hypothesis | How we test it | Stage |
|---|---|---|---|
| H1 | A browser tab can visualize what your computer is playing, with no install and no setup. | Play music in another app, open the tab, see it react. | 1 |
| H2 | A small set of presets the owner tuned by hand beats thousands of mixed-quality community presets. | Owner uses it weekly, and nothing in it feels "ugly." | 4 |
| H3 | Smoothed, musical response (attack and release, onset detection) feels better than raw frequency bars. | Test signals (kick vs tone) show a clean response; owner rates it against bars. | 1–2 |
| H4 | Mic plus fullscreen gives a zero-setup room or party mode. | A real session in a room with other people. | 2–3 |

**What we are not claiming:**
- That our engine looks better than MilkDrop's at the top end. Stage 2 and Stage 4 decide that.
- That we have more features. We have fewer, on purpose.
- That MilkDrop compatibility matters. It's optional and last.

**Research check still needed:** whether other web tools already visualize system audio. Unverified. Run a search before Stage 1 ends, so H1 isn't claimed falsely.

## 2. Visualization Capability Ladder

Each tier needs engine features. We build a tier only when the one below it passes its test.

| Tier | What it looks like | Example | Engine need | Stage | Audio test |
|---|---|---|---|---|---|
| 0 | Raw signal | Waveform line, level meter | Draw a line from audio data | 1 | Waveform matches the test signal's shape |
| 0 | Bass response | Background brightness pulses on bass | One uniform fed from bass band, with attack and release | 1 | Kick moves it; 2 kHz tone and silence don't |
| 1 | Shapes driven by bands | Spectrum bars, radial rings | Shader per shape, one data texture | 2 | Each bar follows its band on the test sweep |
| 1 | Beat events | Flash or ring pulse on each kick | Onset detection with hysteresis and cooldown | 2 | One flash per kick, none on the tone |
| 1 | Color by frequency | Low bands warm, high bands cool | Color mapping in shader | 2 | Color shifts on the sweep |
| 2 | Trails | Previous frames fade behind shapes | Two framebuffers, ping-pong | 2 | Trail length changes with level |
| 2 | Zoom and spin feedback | Each frame sampled and transformed | Feedback with a transform | 2 | Spin speed follows energy |
| 3 | Warp fields | Image bends and ripples to the music | Distortion grid or field in shader | 4 | Ripple amplitude follows bass |
| 3 | Particles | Thousands of points moving with audio | GPU points or instancing | 4 | Particle count or speed follows band |
| 3 | Glow and post effects | Bloom, color shift, blur | Extra render pass | 4 | Glow strength follows level |
| 3 | Presets and crossfades | Our own presets blended over seconds | Preset loader, two-scene blend | 4 | Blend is smooth, no frame drops on target machine |
| 4 | Later | 3D, video input, recording | Out of v1 | later | — |

**Engine rule:** a tier-3 effect should be expressible as "a shader that reads the audio object and the previous frame." If a new effect needs something else, we stop and decide before building.

## 3. Stage 1 Test Plan (the "does it really respond?" test)

Stage 1 must prove the audio is driving the visuals, not approximating it.

**Built-in test signals** (generated inside the app, no file needed):
- **Kick:** 60 Hz tone burst, 50 ms long, every 500 ms.
- **Tone:** steady 2 kHz sine.
- **Sweep:** 40 Hz to 8 kHz over 10 seconds.
- **Silence.**

**Debug panel** (shown with a key press, hidden by default):
- Live numbers: band energies, bass level, onset flag, frame time.
- A waveform strip and a bass meter.
- Source name and sample rate.

**Pass criteria (proposed; owner to confirm):**
1. Kick: the bass pulse rises on every kick and falls back before the next one.
2. 2 kHz tone and silence: bass pulse stays flat.
3. Waveform strip matches the test signal's shape.
4. Latency: the gap between the audio event and the visual response is measured and shown in the panel. Target to confirm in Stage 1 (proposal: under 100 ms, aim lower).
5. Same checks pass for file, tab or system audio, and microphone.

**Known limit:** latency from the browser's audio clock to the screen is approximate. The panel reports it honestly and we don't claim better.

## 4. Quality Bar

The engine is only as good as the presets on it. Before Stage 2:
- Owner names 3 visuals they like (any source: a preset, an app, a video, a film).
- We write down what makes each one work (motion speed, color, depth, beat response).
- Those notes become the checklist for judging our visuals.

**Owner's stated targets (2026-11-04):**
- **Two kinds of response, both required:** a beat-locked pulse (tight, consistent on the kick), and a slower response to the overall energy of the music. Swells add complexity and vibrancy. Quiet passages soften into a calmer look; they don't cut to black.
- **Full frequency coverage:** bass, beat, mids, and treble each drive something visible.
- **Movement through space:** the strongest preference is a sense of flying through a space or landscape. Camera-style forward motion beats static shapes.
- **Particles for treble:** a "twinkle" layer that reacts to treble, kept below the pulses in visual weight.
- **Psychedelic and strobing effects:** allowed as accents, never the main look. Flash limits apply (WCAG 2.3.1, from the spec).

**Reference videos (5, from owner):** the links are logged in the owner's notes. Not yet analyzed: I can't watch video directly. The owner describes what they like in each one, and we write that into the checklist above.

## 5. Vibralizer: What We Learn (researched 2026-11-04)

Sources: [Steam page](https://store.steampowered.com/app/4270240/Vibralizer), [itch.io page](https://vibralizer.itch.io/vibralizer), [Higher Plain Music review, 2026-05-27](https://higherplainmusic.com/2026/05/27/vibralizer-is-your-winamp-and-media-player-visualisations-evolved/).

**What it is:** a downloadable visualizer for Windows and macOS, in early access, version 0.6.0. Listed as a two-person team. Pay-what-you-want with a $6.99 minimum on itch.io.

**Where it matches our goals:**
- Real-time, audio-reactive visuals with several distinct "vibes" (visual modes).
- 4K output for TVs and projectors, which matches the room and party use case.
- Photosensitivity warning on the page. Good practice we should copy.

**Where it falls short (per reviewer and its own page):**
- **Audio input is mic-first.** The reviewer says it doesn't read MP3 playback directly and had to route audio through a webcam mic. That's the gap we target: file and tab or system audio, in one app.
- **Dynamics feel flattened** through the mic path, so visuals look timid. Our capture path must keep levels, so we test for this in Stage 1.
- **No presets or saving.** The reviewer wants custom presets and calls it "the cherry on the cake." Our Stage 4 preset system answers this.
- **System audio on Mac is unexplained** on the page. We can't learn its method from the listing.

**What we take from it:**
1. Mood-based "vibes" are a good way to organize visuals. Lets the owner pick a look, not a settings screen.
2. Space and motion (eyes drifting in space, light streams toward the viewer) matches the owner's flying preference. Worth a Stage 2 prototype.
3. A photosensitivity note on the first screen.
4. Test the signal path, not only the visuals: a flattened input makes everything look weak.

**What it does not tell us:** latency, how beat, bass, mid, and treble are separated, and the Mac capture method. These stay open; we test them ourselves.

## 6. Design Rules from the Reference Guide (2026-11-04)

Source: owner-shared "Engineering & Aesthetic Specification: Effective Real-Time Music Visualization" (Gemini-generated, unverified). Numbers are proposals to test, not measured facts.

**Mapping to our tiers:**
| Guide idea | Our tier | Stage | Test |
|---|---|---|---|
| Four signal streams (sub, mid, high, flux) | Tier 0 | 1 | Each stream responds to its test signal only |
| Asymmetric envelopes (5–15 ms attack, 120–450 ms release) | Tier 0 | 1 | Kick decays before the next kick; no snap to zero |
| Rolling normalization (5–10 s) | Tier 0 | 1 | Quiet intro still readable; drop doesn't clip to white |
| Fixed-axis forward tunnel (vection) | Tier 2 | 2 | Owner rates it against the flying preference |
| Particles on treble | Tier 1 | 2 | Particles count follows high band; stays below pulses in weight |
| Visual mass (large slow, small fast) | Tier 1–2 | 2 | Tunnel steady while sparks flash |
| Negative space (quiet = dim) | Tier 0 | 1 | Quiet passage stays visible, not black |
| 16/32/64-bar state changes | — | later | Needs beat and bar tracking (not v1) |
| Spline and moiré fields, 3D PBR scenes | Tier 3 | 4 or later | Out of v1 scope |

**Conflicts to resolve with the owner:**
1. **Quiet passages:** the guide says black; the owner wants a gentle, not cut-off, look. Proposal: a dim floor.
2. **Normalization vs. swells:** normalization must scale effect size, not the complexity signal, or swells disappear.
3. **Bar-based pacing:** needs beat and bar tracking. v1 uses energy and section changes instead.
