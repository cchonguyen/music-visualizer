# Global Director Specification — Camera & Color Evolution (Sector 483)

## 1. Overview & Architectural Motivation

The **Global Director** is an autonomous virtual cinematographer and colorist operating in the Compositor post-processing stage (`src/render/shaders/post.frag.glsl`).

### Why Compositor Level?
1. **Preset Independence**: Global camera movements (pan, tilt, roll, zoom) and color moods evolve continuously across preset changes. When the user or auto-cycler switches from Preset 01 (Curl Fluid) to Preset 04 (Möbius) or Preset 08 (Spectral Terrain), camera position and color flow smoothly without jarring snaps or resets.
2. **Complementary Motion**: Visual motion already present inside a preset (e.g., forward flight in Tunnel, or spinning rotation in Möbius) is dynamically detected via `analyzePresetMotion(preset)` so the global camera avoids conflicting motion axes (e.g. avoiding camera spin on spinning presets, avoiding zoom push on forward flight tunnels) and instead applies complementary axes (crane sways, Dutch rolls, or holographic 2.5D horizon tilts).
3. **Stage 7 Dark-Floor & Luminance Invariants**: Color re-grading operates strictly with perceived luminance preservation ($Y = \text{dot}(c, \text{vec3}(0.2126, 0.7152, 0.0722))$) and preserves dark pixels ($Y == 0 \implies 0.0$), never lifting blacks or tripping the Compositor brightness safety limiter.

---

## 2. 2.5D Post-Process Camera Architecture

### 2.1 Camera Coordinates & UV Pipeline
The post-processing pass receives fullscreen coordinates $vUv \in [0, 1]^2$. The camera applies the following transformations centered at $(0.5, 0.5)$:
```
p0 = vUv - 0.5;
p1 = rot(p0, uCamRoll);
p2 = p1 / max(0.2, 1.0 + p1.x * uCamTilt.x + p1.y * uCamTilt.y);  // 2.5D perspective keystone
p3 = (p2 / max(0.5, uCamZoom)) - uCamPan;
camUv = p3 + 0.5;
```

### 2.2 Mirrored-Repeat Edge Protection
To eliminate black borders, clamped streaks, or viewport artifacts when panning, rotating, or tilting:
- Minimum zoom floor $\ge 1.03$ during active camera motion ($1.02$ for `stillAnchor`).
- Mirrored-repeat UV fold in `post.frag.glsl`:
```glsl
vec2 m = mod(camUv, 2.0);
vec2 sampleUv = mix(m, 2.0 - m, step(1.0, m));
```
Because $m \in [0, 2)$, when $m \ge 1.0$, $2.0 - m$ mirrors the UV coordinates seamlessly back into $[0, 1]$.

### 2.3 The 5 Camera Moves
Each move computes target offsets $(\text{panX}, \text{panY}, \text{zoom}, \text{roll}, \text{tiltX}, \text{tiltY})$:
1. `craneSway`:
   - Slow elliptical pan: $p_x = 0.04 \cdot \sin(0.35 \cdot t)$, $p_y = 0.04 \cdot \cos(0.28 \cdot t)$.
   - Gentle counter-tilt: $\text{tilt}_x = -0.05 \cdot p_x$, $\text{tilt}_y = -0.05 \cdot p_y$.
   - Base zoom: $1.05$. Roll: $0.0$.
2. `dutchRoll`:
   - Gentle pendulum roll: $\text{roll} = 0.14 \cdot \sin(0.40 \cdot t)$ ($\pm 8^\circ$).
   - Slow diagonal drift: $p_x = 0.02 \cdot \cos(0.20 \cdot t)$, $p_y = 0.02 \cdot \sin(0.20 \cdot t)$.
   - Base zoom: $1.06$. Tilt: $(0, 0)$.
3. `breathingPush`:
   - Axial zoom swell: $1.04 + 0.14 \cdot \text{smoothedEnergy}$.
   - Near-zero pan, roll, and tilt.
4. `horizonTilt`:
   - 2.5D perspective planar pitch/yaw keystone:
     $\text{tilt}_x = 0.15 \cdot \sin(0.25 \cdot t)$, $\text{tilt}_y = 0.20 \cdot \cos(0.18 \cdot t)$.
   - Base zoom: $1.06$. Pan: $(0, 0)$, Roll: $0.0$.
5. `stillAnchor`:
   - Gentle center anchor: zoom $= 1.02$, pan $= (0, 0)$, roll $= 0$, tilt $= (0, 0)$.

### 2.4 Complementary Axes Selection (`analyzePresetMotion(preset)`)
Analyzes active preset layers and feedback settings to compute move weight multipliers:
- **Forward Z-Flight** (`tunnel` enabled, or `spectralTerrain` enabled):
  - Suppress `breathingPush` (weight $\times 0.2$).
  - Favor `craneSway` ($\times 1.5$) or `dutchRoll` ($\times 1.5$).
- **Rotational Spin** (`feedback.rotate != 0`, `warpMode === 'mobius'` or `'polarFold'`, `rings` mandala spin, or `particles` phyllotaxis):
  - Suppress `dutchRoll` (weight $\times 0.1$).
  - Favor `horizonTilt` ($\times 1.5$) or `breathingPush` ($\times 1.5$).
- **Planar / Geometric** (`moire`, `chladniSand`, `waveform`, `bars`, `crown`):
  - Unlock all moves at full weight ($1.0$).
- When presets switch, axis weights interpolate smoothly over $4.0\text{s}$.

### 2.5 Fluid Velocity-Continuous Morphing
- When switching between camera moves, state morphs over a **6.0-second `smoothstep` window**:
  $\alpha = \text{smoothstep}(0.0, 1.0, t_{\text{morph}} / 6.0)$.
- Current position smoothly blends: $\mathbf{V}_{\text{active}}(t) = (1 - \alpha) \cdot \mathbf{V}_{\text{from}}(t) + \alpha \cdot \mathbf{V}_{\text{to}}(t)$.
- Position and velocity snaps are strictly prevented ($\alpha'(0) = 0$ and $\alpha'(1) = 0$).

### 2.6 Macro Trigger Cadence
Modes:
- `'section'` (default): Triggers on musical section novelty / flux shift, with a **35s minimum cooldown** and **75s maximum fallback**.
- `'beats32'`, `'beats64'`, `'beats128'`: Counts sub-band beat onsets (`frame.beatByBand.sub` or `frame.kickPulse`).
- `'timer45'`: Fires every 45s.

---

## 3. Curated Split-Tone Color Palettes & Spatial Screen Gradient

### 3.1 6 Curated Color Palettes
| Mood | Shadow Tint (RGB 0..1) | Highlight Tint (RGB 0..1) | Spatial Spread | Character |
| :--- | :--- | :--- | :--- | :--- |
| `native` | `(1.0, 1.0, 1.0)` | `(1.0, 1.0, 1.0)` | 0.00 | Preset original (identity) |
| `cyberpunk` | `(0.00, 0.90, 1.00)` | `(1.00, 0.00, 0.50)` | 0.45 | Electric cyan $\leftrightarrow$ magenta-violet |
| `ember` | `(0.10, 0.04, 0.20)` | `(1.00, 0.67, 0.00)` | 0.40 | Twilight indigo $\leftrightarrow$ solar amber |
| `biolum` | `(0.00, 0.17, 0.21)` | `(0.00, 1.00, 0.67)` | 0.35 | Abyssal teal $\leftrightarrow$ emerald-aqua |
| `vapor` | `(0.17, 0.04, 0.22)` | `(1.00, 0.47, 0.66)` | 0.50 | Dusk violet $\leftrightarrow$ sunset peach/rose |
| `prismatic` | `(0.00, 0.20, 0.80)` | `(1.00, 0.33, 0.20)` | 0.80 | Cobalt $\leftrightarrow$ coral + wide spatial hue sweep |

### 3.2 Spatial Gradient & Luminance Matching Math
In `post.frag.glsl`:
```glsl
// Pre-color perceived luminance
float Y = dot(c, vec3(0.2126, 0.7152, 0.0722));
if (Y > 1e-5 && uColorIntensity > 0.0) {
  // Rotating spatial axis (uColorGradAngle rotates at ~0.025 rad/s)
  vec2 gradDir = vec2(cos(uColorGradAngle), sin(uColorGradAngle));
  float s = dot(vUv - 0.5, gradDir); // -0.5 .. 0.5
  
  // Tonal split + spatial spread
  float tTone = clamp(Y + s * uColorSpatialSpread, 0.0, 1.0);
  vec3 tint = mix(uColorShadowTint, uColorHighlightTint, tTone);
  
  // Blend with original color scaled by intensity
  vec3 tinted = mix(c, c * tint * 1.5, uColorIntensity);
  
  // Exact luminance conservation: re-normalize to pre-color luminance Y
  float Ytint = dot(tinted, vec3(0.2126, 0.7152, 0.0722));
  c = tinted * (Y / max(1e-4, Ytint));
}
```

### 3.3 Palette Morphing
On macro triggers, when `colorMood === 'auto'`, target palette crossfades over **6.0 seconds `smoothstep`**. `'native'` is excluded from auto-cycle selection to ensure continuous color exploration, while remaining selectable manually.

---

## 4. Contracts & State Storage

### 4.1 Data Contracts (`src/render/globalDirector.ts`)
```typescript
export type CameraMode = 'auto' | 'craneSway' | 'dutchRoll' | 'breathingPush' | 'horizonTilt' | 'stillAnchor' | 'off';
export type ColorMood = 'auto' | 'native' | 'cyberpunk' | 'ember' | 'biolum' | 'vapor' | 'prismatic';
export type TriggerCadence = 'section' | 'beats32' | 'beats64' | 'beats128' | 'timer45';

export interface GlobalDirectorSettings {
  cameraMode: CameraMode;
  cameraIntensity: number; // 0..1, default 0.65
  colorMood: ColorMood;
  colorIntensity: number;  // 0..1, default 0.45
  triggerCadence: TriggerCadence;
}

export interface CameraUniforms {
  panX: number;
  panY: number;
  zoom: number;
  roll: number;
  tiltX: number;
  tiltY: number;
}

export interface ColorUniforms {
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  spatialSpread: number;
  gradAngle: number;
  intensity: number;
}
```

### 4.2 Storage Key
- Key: `'mv.globalDirector'` in `localStorage`.

---

## 5. Atomic Implementation Slices

### Slice 7.30: Core `GlobalDirector` Engine & State Store
- **Goal**: Implement `GlobalDirector` class and state store with 5 camera moves, preset motion analyzer, 6-second velocity-continuous morphing, trigger cadence, 6 curated palettes, and storage persistence.
- **Target files**:
  - `src/render/globalDirector.ts` [NEW]
  - `src/render/__tests__/globalDirector.test.ts` [NEW]
- **Verify**: `npm run typecheck && npm test && npm run build`

### Slice 7.31: Shader & Compositor Integration
- **Goal**: Add 2.5D camera UV transform, overscan inward floor, mirrored-repeat edge protection, rotating spatial gradient, and luminance-matching split-tone to `post.frag.glsl`. Connect `GlobalDirector` uniforms to `Compositor`, ensuring `postPass` runs whenever Global Director camera or color is active.
- **Target files**:
  - `src/render/shaders/post.frag.glsl`
  - `src/render/compositor.ts`
  - `src/render/__tests__/compositorDirector.test.ts` [NEW]
- **Verify**: `npm run typecheck && npm test && npm run build`

### Slice 7.32: Live Studio Folder, HUD Settings, and Main Loop Wiring
- **Goal**: Add "Global Director" folder to Studio panel (`src/studio/studio.ts`), add compact Director control to HUD Display group (`index.html`, `src/ui/controls.ts`), wire Calm attenuation (`min(intensity, 0.25)` and roll/tilt suppression) and main animation loop updates (`src/main.ts`).
- **Target files**:
  - `src/main.ts`
  - `src/studio/studio.ts`
  - `src/ui/controls.ts`
  - `index.html`
  - `src/studio/studio.test.ts`
- **Verify**: `npm run typecheck && npm test && npm run build`
