# Stage 9 Architectural Specification: Unified Composable `shape` Layer (Sector 485)

**Status:** Approved & Locked for Implementation (2026-11-07)  
**Coordinate:** `485` (`.spec/specs/shape-layer-spec.md`)

---

## 1. Executive Summary & Architectural Goals

Stage 9 replaces the fragmented legacy 2D audio-reactive layers (`crown`, `waveform`, `bars`, `rings`, and `shockwave`) with a single, orthogonal, composable **`shape` layer (`ShapeLayer`)**:
1. **First-in-Studio Registration:** `shape` is registered as the **first key** in `LAYER_SPECS` and `LAYER_FACTORIES` so it appears at the top of the Studio's "Add layer" selector.
2. **Multi-Layer Stacking & Descriptive Studio Labels:** Presets can stack multiple `shape` instances in `preset.layers` (e.g., an inner Solar Crown + outer Concentric Rings + a Kick Shockwave). In the Studio layer selector, `shape` entries are formatted with a concise summary: `${i + 1}. shape (${baseShape} · ${effectType} · ${propMode})${enabled ? '' : ' (off)'}`.
3. **5 Orthogonal Parameter Categories (`ShapeParams`):**
   - **Category 1 — Base Geometry (`base`):** 8 base curves (`centerLine`, `edgeLine`, `circle`, `arc`, `polygon`, `star`, `spiral`, `figure8`), edge rail modes, polygon/star vertex controls, smooth corner rounding, and 2D affine transforms (`size`, `posX`, `posY`, `rotation`, `spinSpeed`, `basePulse`).
   - **Category 2 — Reactive Effect (`effect`):** 8 visual styles (`solidLine`, `pulsingLine`, `waveform`, `harmonicWave`, `bars`, `segmentedBars`, `dots`, `auroraFill`) with sample density, extrusion length, stroke/bar thickness, bar gaps, LED segment counts, and floating gravity peak-hold caps (`peakCaps`).
   - **Category 3 — Direction & Symmetry (`direction`):** Extrusion polarity (`outward`, `inward`, `bilateral`, `alternating` with center anti-inversion clamping), seamless closed-loop audio mapping (`wrap`, `mirror` $0 \to 1 \to 0$, `repeat2`, `repeat4`), and normal vector calculation (`radial`, `perpendicular`).
   - **Category 4 — Propagation (`propagation`):** 6 spatial replication engines (`single`, `concentric`, `shockwave`, `stream`, `orbit`, `polar`) with shell/satellite/spoke count (`1..16`), spacing/radius, expansion/revolution speed, direction, satellite self-spin/tidal lock, and per-instance audio phase/envelope attenuation (`propDelay`).
   - **Category 5 — Audio & Style Tuning (`audio` / `style`):** Per-layer audio signal routing (`spectrum`, `waveform`, `sub`, `bass`, `mid`, `treble`, `energy`), reactivity gain, asymmetric attack/release envelope follower (`attackMs`, `releaseMs`), color mapping (`solid`, `palette`, `frequencyGradient`, `amplitudeHot`), and bloom/halo glow (`glow`).
4. **Declarative Conditional Studio UI (`showWhen`):** `ParamSpec` in `src/presets/schema.ts` gains `showWhen?: Record<string, ParamValue | readonly ParamValue[]>`. `src/studio/studio.ts` evaluates `isSpecVisible(spec, holder)` on initial bind and whenever any controlling enum/boolean changes, dynamically toggling Tweakpane blade `.hidden` so users only see sliders relevant to their active selections.
5. **Legacy Layer Retirement & Showcase Preset Reel:** Legacy presets are migrated to `shape` (or legacy layer entries are coerced/upgraded cleanly via a compatibility shim in `parsePreset` / `buildScene` so existing saved user presets never crash), and a new **Showcase Preset Reel** highlights the full permutation power of `shape`.

---

## 2. Schema & Declarative Conditional Visibility (`src/presets/schema.ts` & `src/presets/layerSchemas.ts`)

### 2.1 `ParamSpec.showWhen` Contract (`src/presets/schema.ts`)

Extend `BaseSpec` in `src/presets/schema.ts`:
```ts
export type ShowWhenCondition = Record<string, ParamValue | readonly ParamValue[]>;

interface BaseSpec {
  name: string;
  label: string;
  group: string;
  /** Optional declarative visibility rule: blade is visible only when every key in showWhen matches the current layer/section settings. */
  showWhen?: ShowWhenCondition;
}
```

Add helper function `isSpecVisible(spec: ParamSpec, values: Record<string, ParamValue>): boolean` in `src/presets/schema.ts`:
```ts
export function isSpecVisible(spec: ParamSpec, values: Record<string, ParamValue>): boolean {
  if (!spec.showWhen) return true;
  for (const [depKey, expected] of Object.entries(spec.showWhen)) {
    const actual = values[depKey];
    if (Array.isArray(expected)) {
      if (!expected.includes(actual as never)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}
```

### 2.2 Complete `ShapeParams` Interface & `SHAPE_DEFAULTS` (`src/presets/layerSchemas.ts`)

```ts
export type ShapeBaseType =
  | 'centerLine'
  | 'edgeLine'
  | 'circle'
  | 'arc'
  | 'polygon'
  | 'star'
  | 'spiral'
  | 'figure8';

export type ShapeEdgeMode =
  | 'bottom'
  | 'top'
  | 'dualHorizontal'
  | 'dualVertical'
  | 'frame';

export type ShapeEffectType =
  | 'solidLine'
  | 'pulsingLine'
  | 'waveform'
  | 'harmonicWave'
  | 'bars'
  | 'segmentedBars'
  | 'dots'
  | 'auroraFill';

export type ShapeExtrudeDirection =
  | 'outward'
  | 'inward'
  | 'bilateral'
  | 'alternating';

export type ShapeSymmetry =
  | 'wrap'
  | 'mirror'
  | 'repeat2'
  | 'repeat4';

export type ShapeNormalMode =
  | 'radial'
  | 'perpendicular';

export type ShapePropMode =
  | 'single'
  | 'concentric'
  | 'shockwave'
  | 'stream'
  | 'orbit'
  | 'polar';

export type ShapePropDirection =
  | 'outward'
  | 'inward'
  | 'cw'
  | 'ccw'
  | 'alternating';

export type ShapeAudioSource =
  | 'spectrum'
  | 'waveform'
  | 'sub'
  | 'bass'
  | 'mid'
  | 'treble'
  | 'energy';

export type ShapeColorMode =
  | 'solid'
  | 'palette'
  | 'frequencyGradient'
  | 'amplitudeHot';

export interface ShapeParams {
  // Category 1 — Base Geometry ("Base")
  baseShape: ShapeBaseType;
  edgeMode: ShapeEdgeMode;
  sides: number;          // 3..12
  starInner: number;      // 0.2..0.9
  cornerRadius: number;   // 0..0.5
  arcSweep: number;       // 0.1..1.0
  spiralTurns: number;    // 1..5
  size: number;           // 0.1..2.0
  posX: number;           // -0.8..0.8
  posY: number;           // -0.8..0.8
  rotation: number;       // -180..180 (degrees)
  spinSpeed: number;      // -2.0..2.0 (rad/s)
  basePulse: number;      // 0..1.0

  // Category 2 — Reactive Effect ("Effect")
  effectType: ShapeEffectType;
  sampleCount: number;    // 16..256
  effectLength: number;   // 0.05..1.5
  thickness: number;      // 0.5..10.0
  barGap: number;         // 0..0.8
  ledSegments: number;    // 2..24
  peakCaps: boolean;

  // Category 3 — Direction & Symmetry ("Direction")
  extrudeDirection: ShapeExtrudeDirection;
  symmetry: ShapeSymmetry;
  normalMode: ShapeNormalMode;

  // Category 4 — Propagation ("Propagation")
  propMode: ShapePropMode;
  propCount: number;      // 1..16
  propSpacing: number;    // 0.05..1.0
  propSpeed: number;      // -2.0..2.0
  propDirection: ShapePropDirection;
  propSelfSpin: number;   // -2.0..2.0
  propDelay: number;      // 0..1.0

  // Category 5 — Audio & Style Tuning ("Audio & Style")
  audioSource: ShapeAudioSource;
  reactivity: number;     // 0..3.0
  attackMs: number;       // 5..200
  releaseMs: number;      // 20..600
  colorMode: ShapeColorMode;
  solidColor: string;     // "#rrggbb" (when colorMode === 'solid')
  glow: number;           // 0..2.0
}
```

#### Default Values (`SHAPE_DEFAULTS`)
Defaults reproduce a vibrant **Solar Crown** out of the box:
```ts
export const SHAPE_DEFAULTS: ShapeParams = {
  baseShape: 'circle',
  edgeMode: 'bottom',
  sides: 6,
  starInner: 0.5,
  cornerRadius: 0.0,
  arcSweep: 0.75,
  spiralTurns: 2.5,
  size: 0.45,
  posX: 0.0,
  posY: 0.0,
  rotation: 0,
  spinSpeed: 0.0,
  basePulse: 0.15,

  effectType: 'bars',
  sampleCount: 64,
  effectLength: 0.35,
  thickness: 3.0,
  barGap: 0.25,
  ledSegments: 8,
  peakCaps: false,

  extrudeDirection: 'outward',
  symmetry: 'mirror',
  normalMode: 'radial',

  propMode: 'single',
  propCount: 4,
  propSpacing: 0.22,
  propSpeed: 0.65,
  propDirection: 'outward',
  propSelfSpin: 0.0,
  propDelay: 0.25,

  audioSource: 'spectrum',
  reactivity: 1.0,
  attackMs: 12,
  releaseMs: 180,
  colorMode: 'palette',
  solidColor: '#00f0ff',
  glow: 0.6,
};
```

### 2.3 Complete `SHAPE_SPECS` Table & `showWhen` Rules

| Parameter | Type | Group | Default | Range / Options | `showWhen` Condition |
|---|---|---|---|---|---|
| `baseShape` | `enum` | `'Base'` | `'circle'` | `['centerLine', 'edgeLine', 'circle', 'arc', 'polygon', 'star', 'spiral', 'figure8']` | *(always visible)* |
| `edgeMode` | `enum` | `'Base'` | `'bottom'` | `['bottom', 'top', 'dualHorizontal', 'dualVertical', 'frame']` | `{ baseShape: 'edgeLine' }` |
| `sides` | `int` | `'Base'` | `6` | `3..12`, step `1` | `{ baseShape: ['polygon', 'star'] }` |
| `starInner` | `float` | `'Base'` | `0.5` | `0.2..0.9`, step `0.05` | `{ baseShape: 'star' }` |
| `cornerRadius` | `float` | `'Base'` | `0.0` | `0..0.5`, step `0.02` | `{ baseShape: ['polygon', 'star', 'edgeLine'] }` |
| `arcSweep` | `float` | `'Base'` | `0.75` | `0.1..1.0`, step `0.05` | `{ baseShape: 'arc' }` |
| `spiralTurns` | `float` | `'Base'` | `2.5` | `1..5`, step `0.25` | `{ baseShape: 'spiral' }` |
| `size` | `float` | `'Base'` | `0.45` | `0.1..2.0`, step `0.02` | *(always visible)* |
| `posX` | `float` | `'Base'` | `0.0` | `-0.8..0.8`, step `0.02` | *(always visible)* |
| `posY` | `float` | `'Base'` | `0.0` | `-0.8..0.8`, step `0.02` | *(always visible)* |
| `rotation` | `float` | `'Base'` | `0` | `-180..180`, step `1` | *(always visible)* |
| `spinSpeed` | `float` | `'Base'` | `0.0` | `-2.0..2.0`, step `0.05` | *(always visible)* |
| `basePulse` | `float` | `'Base'` | `0.15` | `0..1.0`, step `0.05` | *(always visible)* |
| `effectType` | `enum` | `'Effect'` | `'bars'` | `['solidLine', 'pulsingLine', 'waveform', 'harmonicWave', 'bars', 'segmentedBars', 'dots', 'auroraFill']` | *(always visible)* |
| `sampleCount` | `int` | `'Effect'` | `64` | `16..256`, step `4` | `{ effectType: ['waveform', 'harmonicWave', 'bars', 'segmentedBars', 'dots', 'auroraFill'] }` |
| `effectLength` | `float` | `'Effect'` | `0.35` | `0.05..1.5`, step `0.02` | `{ effectType: ['pulsingLine', 'waveform', 'harmonicWave', 'bars', 'segmentedBars', 'dots', 'auroraFill'] }` |
| `thickness` | `float` | `'Effect'` | `3.0` | `0.5..10.0`, step `0.25` | *(always visible)* |
| `barGap` | `float` | `'Effect'` | `0.25` | `0..0.8`, step `0.02` | `{ effectType: ['bars', 'segmentedBars'] }` |
| `ledSegments` | `int` | `'Effect'` | `8` | `2..24`, step `1` | `{ effectType: 'segmentedBars' }` |
| `peakCaps` | `bool` | `'Effect'` | `false` | `true \| false` | `{ effectType: ['bars', 'segmentedBars'] }` |
| `extrudeDirection` | `enum` | `'Direction'` | `'outward'` | `['outward', 'inward', 'bilateral', 'alternating']` | `{ effectType: ['waveform', 'harmonicWave', 'bars', 'segmentedBars', 'dots', 'auroraFill'] }` |
| `symmetry` | `enum` | `'Direction'` | `'mirror'` | `['wrap', 'mirror', 'repeat2', 'repeat4']` | *(always visible)* |
| `normalMode` | `enum` | `'Direction'` | `'radial'` | `['radial', 'perpendicular']` | `{ baseShape: ['polygon', 'star', 'spiral', 'figure8', 'arc'] }` |
| `propMode` | `enum` | `'Propagation'` | `'single'` | `['single', 'concentric', 'shockwave', 'stream', 'orbit', 'polar']` | *(always visible)* |
| `propCount` | `int` | `'Propagation'` | `4` | `1..16`, step `1` | `{ propMode: ['concentric', 'stream', 'orbit', 'polar'] }` |
| `propSpacing` | `float` | `'Propagation'` | `0.22` | `0.05..1.0`, step `0.02` | `{ propMode: ['concentric', 'orbit', 'polar'] }` |
| `propSpeed` | `float` | `'Propagation'` | `0.65` | `-2.0..2.0`, step `0.05` | `{ propMode: ['shockwave', 'stream', 'orbit', 'polar'] }` |
| `propDirection` | `enum` | `'Propagation'` | `'outward'` | `['outward', 'inward', 'cw', 'ccw', 'alternating']` | `{ propMode: ['concentric', 'shockwave', 'stream', 'orbit', 'polar'] }` |
| `propSelfSpin` | `float` | `'Propagation'` | `0.0` | `-2.0..2.0`, step `0.05` | `{ propMode: ['orbit', 'polar'] }` |
| `propDelay` | `float` | `'Propagation'` | `0.25` | `0..1.0`, step `0.05` | `{ propMode: ['concentric', 'stream', 'orbit', 'polar'] }` |
| `audioSource` | `enum` | `'Audio & Style'` | `'spectrum'` | `['spectrum', 'waveform', 'sub', 'bass', 'mid', 'treble', 'energy']` | *(always visible)* |
| `reactivity` | `float` | `'Audio & Style'` | `1.0` | `0..3.0`, step `0.05` | *(always visible)* |
| `attackMs` | `float` | `'Audio & Style'` | `12` | `5..200`, step `5` | *(always visible)* |
| `releaseMs` | `float` | `'Audio & Style'` | `180` | `20..600`, step `10` | *(always visible)* |
| `colorMode` | `enum` | `'Audio & Style'` | `'palette'` | `['solid', 'palette', 'frequencyGradient', 'amplitudeHot']` | *(always visible)* |
| `solidColor` | `colour` | `'Audio & Style'` | `'#00f0ff'` | `#rrggbb` | `{ colorMode: 'solid' }` |
| `glow` | `float` | `'Audio & Style'` | `0.6` | `0..2.0`, step `0.05` | *(always visible)* |

---

## 3. Mathematical & GPU Rendering Specification (`src/render/layers/shape.ts` & `src/render/shaders/shape.*.glsl`)

### 3.1 Parametric Curve Evaluation $\mathbf{P}(u)$ and Tangent/Normal $\mathbf{N}(u)$ ($u \in [0, 1]$)

For any normalized parameter $u \in [0, 1]$, each base shape defines a 2D curve point $\mathbf{P}_0(u) \in \mathbb{R}^2$ (in aspect-corrected local coordinates scaled by `size` $S_{\text{eff}} = \text{size} \cdot (1 + \text{basePulse} \cdot E_{\text{kick}})$) and an outward unit normal $\mathbf{N}_0(u)$:

1. **`centerLine`**:
   - $\mathbf{P}_0(u) = \big((2u - 1) \cdot S_{\text{eff}} \cdot \text{aspect}, \, 0\big)$, $\mathbf{N}_0(u) = (0, 1)$.
2. **`edgeLine`**:
   - Subdivides $u \in [0, 1]$ across 1, 2, or 4 rails according to `edgeMode`:
     - `'bottom'`: single rail at $y = -0.92 \cdot S_{\text{eff}}$, $x \in [-0.92 \cdot \text{aspect}, 0.92 \cdot \text{aspect}]$, $\mathbf{N} = (0, 1)$ (inward toward screen center when `extrudeDirection === 'outward'` on bottom rail, or standard screen-inward normal so `'outward'` extrudes into the frame). Specifically, for `edgeLine`, define the canonical normal pointing **into the screen interior** so `extrudeDirection: 'outward'` grows bars from the screen edge toward the center!
     - `'top'`: single rail at $y = +0.92 \cdot S_{\text{eff}}$, canonical normal $(0, -1)$.
     - `'dualHorizontal'`: $u \in [0, 0.5)$ bottom rail ($\mathbf{N}=(0,1)$), $u \in [0.5, 1]$ top rail ($\mathbf{N}=(0,-1)$).
     - `'dualVertical'`: $u \in [0, 0.5)$ left rail ($x = -0.92 \cdot \text{aspect} \cdot S_{\text{eff}}$, $\mathbf{N}=(1,0)$), $u \in [0.5, 1]$ right rail ($x = +0.92 \cdot \text{aspect} \cdot S_{\text{eff}}$, $\mathbf{N}=(-1,0)$).
     - `'frame'`: 4-sided perimeter rectangle with corner rounding controlled by `cornerRadius`.
3. **`circle`**:
   - $\theta = 2\pi u$, $\mathbf{P}_0(u) = S_{\text{eff}} (\cos\theta, \sin\theta)$, $\mathbf{N}_0(u) = (\cos\theta, \sin\theta)$.
4. **`arc`**:
   - $\theta = \big((u - 0.5) \cdot \text{arcSweep}\big) \cdot 2\pi + \frac{\pi}{2}$, $\mathbf{P}_0(u) = S_{\text{eff}} (\cos\theta, \sin\theta)$, $\mathbf{N}_0(u) = (\cos\theta, \sin\theta)$.
5. **`polygon`** ($K = \text{sides} \in [3..12]$):
   - Let sector $s = u \cdot K$, vertex index $k = \lfloor s \rfloor$, fractional edge parameter $f = s - k \in [0, 1)$.
   - Vertices $\mathbf{V}_k = S_{\text{eff}} (\cos\frac{2\pi k}{K}, \sin\frac{2\pi k}{K})$ and $\mathbf{V}_{k+1}$.
   - With `cornerRadius` $r_c \in [0, 0.5]$: when $f < r_c$ or $f > 1 - r_c$, evaluate a quadratic Bézier arc blending the adjacent edges so corners round smoothly without tangent discontinuities.
6. **`star`** ($K = \text{sides} \in [3..12]$, inner ratio $r_{\text{in}} = \text{starInner} \in [0.2..0.9]$):
   - $2K$ alternating outer/inner vertices: even vertices at radius $S_{\text{eff}}$, odd vertices at radius $S_{\text{eff}} \cdot r_{\text{in}}$, with smooth quadratic Bézier corner rounding via `cornerRadius`.
7. **`spiral`** ($T = \text{spiralTurns} \in [1..5]$):
   - Archimedean/golden spiral: $\theta = 2\pi T u$, $r(u) = S_{\text{eff}} \cdot (0.08 + 0.92 u)$, $\mathbf{P}_0(u) = r(u)(\cos\theta, \sin\theta)$.
8. **`figure8`** (Lemniscate of Gerono / Lissajous $\infty$):
   - $\theta = 2\pi u$, $\mathbf{P}_0(u) = S_{\text{eff}} \big(\sin\theta, \, 0.55 \sin(2\theta)\big)$.

#### Normal Vector Mode (`normalMode`)
- **`'radial'`**: $\mathbf{N}_0(u) = \text{normalize}(\mathbf{P}_0(u))$ (points radially away from shape center; ideal for radial crowns on polygons/stars).
- **`'perpendicular'`**: $\mathbf{N}_0(u) = \text{normalize}\big(-P'_{0,y}(u), \, P'_{0,x}(u)\big)$ (true Frenet curve normal perpendicular to each edge/tangent).

### 3.2 Symmetry Mapping $u_{\text{audio}}(u)$ (`symmetry`)

Closed shapes (`circle`, `polygon`, `star`, `figure8`, `frame`) suffer a visible seam at $u=0 \equiv 1$ if raw spectrum $[0 \to 1]$ wraps abruptly from treble back to sub-bass. `symmetry` maps curve coordinate $u \in [0, 1]$ to audio lookup coordinate $u_{\text{audio}} \in [0, 1]$:
- **`'wrap'`**: $u_{\text{audio}} = u$.
- **`'mirror'`**: $u_{\text{audio}} = 1 - |2u - 1|$ (maps $0 \to 1 \to 0$ seamlessly across the two halves so both $u=0$ and $u=0.5$ sit at the symmetry axis with zero seam!).
- **`'repeat2'`**: $u_{\text{audio}} = \text{fract}(2u)$.
- **`'repeat4'`**: $u_{\text{audio}} = 1 - |2\,\text{fract}(2u) - 1|$ (4-fold mirrored symmetry).

### 3.3 Extrusion Polarity & Center Anti-Inversion Clamping (`extrudeDirection`)

Given audio amplitude $A(u) \in [0, 1]$ and `effectLength` $L$:
- Displacement magnitude $\Delta(u) = A(u) \cdot L$.
- **`'outward'`**: inner base at $\mathbf{P}_0(u)$, outer tip at $\mathbf{P}_0(u) + \Delta(u) \mathbf{N}_0(u)$.
- **`'inward'`**: outer base at $\mathbf{P}_0(u)$, inner tip at $\mathbf{P}_0(u) - \Delta_{\text{clamped}}(u) \mathbf{N}_0(u)$, where **Center Anti-Inversion Clamping** caps inward displacement along radial rays:
  $$\Delta_{\text{clamped}}(u) = \min\big(\Delta(u), \, 0.92 \cdot \|\mathbf{P}_0(u)\|\big)$$
  so bars/waves extruding inward never cross the center $(0, 0)$ and invert through the opposite side.
- **`'bilateral'`**: centered on $\mathbf{P}_0(u)$, extending $+\frac{1}{2}\Delta(u)\mathbf{N}_0(u)$ and $-\frac{1}{2}\Delta(u)\mathbf{N}_0(u)$.
- **`'alternating'`**: sample index $i$ even extrudes outward ($+\Delta(u)$), $i$ odd extrudes inward ($-\Delta_{\text{clamped}}(u)$).

### 3.4 Propagation Engine (`propMode`)

Each `ShapeLayer` evaluates $M$ instances ($m = 0 \dots M-1$, where $M = 1$ for `'single'` or `'shockwave'`, and $M = \text{propCount}$ for `'concentric'`, `'stream'`, `'orbit'`, `'polar'`). Each instance $m$ computes an affine transform $(\mathbf{T}_m, s_m, \phi_m)$, opacity fade $\alpha_m$, and delayed audio envelope scale $d_m = (1 - \text{propDelay} \cdot \frac{m}{\max(1, M-1)})$:

1. **`'single'`**: $M = 1$, $\mathbf{T}_0 = (\text{posX}, \text{posY})$, $s_0 = 1$, $\phi_0 = \theta_{\text{rot}} + \theta_{\text{spin}}(t)$, $\alpha_0 = 1$.
2. **`'concentric'`**: $M = \text{propCount}$ nested shells around $(\text{posX}, \text{posY})$:
   - Scale step $\delta_s = \text{propSpacing} \cdot 0.45$.
   - If `propDirection === 'inward'`, $s_m = \max(0.08, 1 - m \cdot \delta_s)$; else $s_m = 1 + m \cdot \delta_s$.
   - If `propDirection === 'alternating'`, odd shells negate `spinSpeed` ($\phi_m = \theta_{\text{rot}} + (-1)^m \theta_{\text{spin}}(t)$).
3. **`'shockwave'`**: Kick-triggered expanding ring (governed by `kickGrant(frame, clock, calm)` from `shockwave.ts` / `flashGovernor`):
   - Maintains up to 4 concurrent travelling wave slots triggered on sub-bass kicks.
   - Each active slot has normalized age $k \in [0, 1)$ advancing at rate $|\text{propSpeed}| / 0.55\,\text{s}^{-1}$.
   - Scale $s(k) = \text{mix}(0.25, 2.2, k)$ (or reversed if `propDirection === 'inward'`), quadratic fade $\alpha(k) = (1 - k)^2$.
4. **`'stream'`**: Continuous fountain of $M = \text{propCount}$ shells travelling outward (`outward`) or inward (`inward`):
   - Phase $p_m = \text{fract}(\Phi_{\text{prop}} + \frac{m}{M})$, where $\dot{\Phi}_{\text{prop}} = 0.35 \cdot \text{propSpeed} \cdot (1 + 0.4 E_{\text{bass}})$.
   - Scale $s_m = \text{mix}(0.15, 2.0, p_m)$, smooth bell envelope $\alpha_m = \sin(\pi p_m)$.
5. **`'orbit'`**: $M = \text{propCount}$ satellite shapes revolving around $(\text{posX}, \text{posY})$ at orbit radius $R_{\text{orbit}} = \text{propSpacing} \cdot 0.75$:
   - Orbit angle $\beta_m = \frac{2\pi m}{M} + \sigma_{\text{dir}} \Phi_{\text{prop}}$.
   - Center $\mathbf{T}_m = (\text{posX}, \text{posY}) + R_{\text{orbit}} (\cos\beta_m, \sin\beta_m)$.
   - Self-orientation $\phi_m = \beta_m + \theta_{\text{rot}} + \Phi_{\text{selfSpin}}$ (tidal-locked to orbit tangent when `propSelfSpin === 0`, plus integrated `propSelfSpin`).
6. **`'polar'`**: $M = \text{propCount}$ rotational symmetry copies sharing center $(\text{posX}, \text{posY})$ (or offset by $\text{propSpacing} \cdot 0.35$ along ray $\beta_m = \frac{2\pi m}{M} + \Phi_{\text{prop}}$) rotated by $\beta_m + \Phi_{\text{selfSpin}}$ to create intricate Spirograph and Sacred Geometry mandalas.

### 3.5 GPU Draw Pipeline & Audio Envelope Processing

To achieve crisp anti-aliased rendering across all 8 base geometries and 8 effects at 60 fps in raw WebGL2:
- **CPU Audio Buffer & Peak-Hold State (`ShapeLayer` in `src/render/layers/shape.ts`):**
  - Maintains a `Float32Array(256)` smoothed sample buffer `smoothedSamples` and `Float32Array(256)` `peakHoldSamples` + `peakVelocities`.
  - Per frame, extracts raw samples from `AudioFrame` based on `audioSource`:
    - `'spectrum'`: log-spaced frequency bins via `buildBarEdges(sampleCount, frame.sampleRate, fftSize)` + `barValues(frame.smoothedSpectrum, edges)` with dynamic punch.
    - `'waveform'`: resampled time-domain `frame.waveform` mapped to $[0, 1]$ (or signed $[-1, 1]$ for `waveform` / `harmonicWave` effects).
    - `'sub' | 'bass' | 'mid' | 'treble' | 'energy'`: band-specific waveform modulation (`frame.bandWaveforms`) scaled by band envelope (`frame.env.sub`, `frame.env.mid`, `frame.env.high`, `frame.energy`).
  - Applies asymmetric attack/release smoothing per bin using `attackMs` and `releaseMs`:
    $$\alpha_{\text{att}} = 1 - e^{-\Delta t / (\text{attackMs} / 1000)}, \quad \alpha_{\text{rel}} = 1 - e^{-\Delta t / (\text{releaseMs} / 1000)}$$
  - When `peakCaps === true`, updates `peakHoldSamples[i]`: if `smoothedSamples[i] >= peakHoldSamples[i]`, sets `peakHoldSamples[i] = smoothedSamples[i]` and `peakVelocities[i] = 0`; otherwise accelerates downward with gravity $g = 1.25\,\text{s}^{-2}$.
  - Uploads `smoothedSamples` (row 0) and `peakHoldSamples` (row 1) into a $256 \times 2$ `R32F` (or 2 one-row `DataTexture`s) bound to `TEXTURE0` / `TEXTURE1`.
- **Unified Instanced / Triangle-Strip Vertex + Fragment Shader (`shape.vert.glsl` & `shape.frag.glsl`):**
  - **Continuous Ribbon Effects (`solidLine`, `pulsingLine`, `waveform`, `harmonicWave`, `auroraFill`):**
    - Drawn as a high-resolution extruded triangle strip (`gl.TRIANGLE_STRIP`, $(N_{\text{verts}} + 1) \times 2$ vertices per instance via `gl.drawArraysInstanced`) where the vertex shader evaluates $\mathbf{P}(u)$ and $\mathbf{N}(u)$, displaces the curve for `waveform` / `harmonicWave` / `auroraFill`, and extrudes screen-space quad miter normals by `thickness` (plus `glow` halo padding).
    - Fragment shader computes signed distance to the ribbon centerline (or aurora fill gradient from baseline $\mathbf{P}_0(u)$ to displaced tip $\mathbf{P}(u)$), applies smooth anti-aliased falloff and `glow` bloom, and outputs **strictly stencil-safe alpha** ($\alpha = 0$ on empty pixels).
  - **Discrete Element Effects (`bars`, `segmentedBars`, `dots`):**
    - Drawn via instanced quads (`gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, sampleCount * activePropInstances)`):
      - Each instance $k$ decodes `propIdx = k / sampleCount` and `barIdx = k % sampleCount`.
      - Vertex shader evaluates $\mathbf{P}(u_i)$ and $\mathbf{N}(u_i)$ at $u_i = (\text{barIdx} + 0.5) / \text{sampleCount}$, constructs an oriented bounding quad covering the bar (and optional floating `peakCaps` cap), and passes local bar UV $(q_x, q_y) \in [-1, 1] \times [0, 1]$ to the fragment shader.
      - Fragment shader renders rounded bars, LED segment cells (`fract(q_y * ledSegments)`), floating peak-hold caps, or circular/glowing `dots`, with `colorMode` (`solid`, `palette`, `frequencyGradient`, `amplitudeHot`) and `uLayerOpacity`.

---

## 4. Studio UI Enhancements (`src/studio/studio.ts`)

1. **First Option in Layer Registry:**
   - `LAYER_SPECS` in `src/presets/layerSchemas.ts` and `LAYER_FACTORIES` in `src/presets/loader.ts` list `shape` **first** (`shape`, `tunnel`, `particles`, `bassPulse`, `moire`, `spectralTerrain`, `chladniSand`, `ferrofluid`, `reactionDiffusion`, followed by legacy aliases if needed).
   - `Studio.addType` defaults to `'shape'` instead of `'tunnel'`.
2. **Multi-Layer `shape` Labeling in Studio:**
   - Format layer dropdown labels in `Studio.bind()` via a helper `formatLayerLabel(layer: LayerEntry, index: number): string`:
     - When `layer.type === 'shape'`, returns `${index + 1}. shape (${layer.params.baseShape?.value ?? 'circle'} · ${layer.params.effectType?.value ?? 'bars'})${layer.enabled ? '' : ' (off)'}`.
     - When `bindSection` renders an enabled `shape` layer's settings, if multiple `shape` layers exist, prefix the section title with `shape #${k + 1}`.
3. **Reactive `showWhen` Visibility in `bindSection` / `bindSpec`:**
   - When `bindSection` binds a list of `ParamSpec`s, it captures the returned Tweakpane binding blade(s) alongside their `ParamSpec`.
   - Immediately after creating each blade, sets `blade.hidden = !isSpecVisible(spec, holder)`.
   - On any parameter change inside `bindSection`, re-evaluates `blade.hidden = !isSpecVisible(s, holder)` for all blades in that section so changing `baseShape`, `effectType`, `propMode`, or `colorMode` dynamically reveals/hides dependent sliders in real time without losing scroll position or rebuilding the entire pane.

---

## 5. Legacy Layer Retirement, Preset Migration & Showcase Preset Reel

### 5.1 Legacy Layer Translation Shim (`migrateLegacyLayerToShape`)
To guarantee that:
1. No active built-in preset uses legacy `crown`, `waveform`, `bars`, `rings`, or `shockwave` layer types, AND
2. Any user-saved preset in `localStorage` or imported `.json` file containing `crown`, `waveform`, `bars`, `rings`, or `shockwave` continues to load and render seamlessly:

We provide a pure translator `migrateLegacyLayerEntry(entry: LayerEntry): LayerEntry` in `src/presets/legacyShapeMigration.ts` (invoked optionally or when legacy layers are retired from `LAYER_SPECS`), AND we migrate the built-in JSON presets directly to `shape`.
- **Note on Existing Unit Tests:** Check `src/presets/layerSchemas.test.ts` and `src/presets/loader.test.ts`. We will update `layerSchemas.test.ts`, `loader.test.ts`, and `presets.test.ts` in locking slices to assert `shape` is first in `LAYER_SPECS`/`LAYER_FACTORIES` and verify all migrated + new Showcase presets pass with zero warnings.
- **Global Director Motion Analysis (`src/render/globalDirector.ts`):** Update `analyzePresetMotion` to inspect `layer.type === 'shape'`: if `spinSpeed !== 0` or `propMode === 'orbit'` or `propMode === 'polar'`, set `hasSpin = true`; if `propMode === 'stream'`, set `hasZFlight = true`.

### 5.2 Built-In Preset Clean-Up & Showcase Preset Reel (`src/presets/builtin/`)
1. **Clean up Flagship & Generative Presets (`01`–`12`, `tex-*`, `crown`, `flight`, `bars`):**
   - Convert legacy `crown`, `waveform`, `bars`, `rings`, and `shockwave` layers in built-in presets (`crown.json`, `flight.json`, `bars.json`, `01`–`06`, `10`, `starter-*`, `tex-*`) to `type: "shape"` with equivalent or enhanced `ShapeParams` (or strip redundant legacy clutter on pure generative presets where appropriate).
2. **New Stage 9 `shape` Showcase Presets (in `FLAGSHIP_PRESETS` / `BUILTIN_PRESETS`):**
   - `13-solar-crown-eclipse.json` (**"Solar Crown Eclipse"**): Stack of 2 `shape` layers — inner `circle` + `bars` (`outward`, `mirror`, `peakCaps: true`) + outer `circle` + `pulsingLine` (`propMode: 'shockwave'`).
   - `14-sacred-orbit-mandala.json` (**"Sacred Orbit Mandala"**): `polygon` (`sides: 6`, `cornerRadius: 0.15`) + `harmonicWave` (`propMode: 'orbit'`, `propCount: 6`, `propSelfSpin: -0.8`, `colorMode: 'frequencyGradient'`).
   - `15-polar-spirograph-bloom.json` (**"Polar Spirograph Bloom"**): `figure8` + `waveform` (`propMode: 'polar'`, `propCount: 8`, `propSpacing: 0.25`, `propSpeed: 0.45`, `symmetry: 'mirror'`).
   - `16-hexagon-inward-portal.json` (**"Hexagon Inward Portal"**): `polygon` (`sides: 6`) + `bars` (`extrudeDirection: 'inward'`, `propMode: 'concentric'`, `propCount: 4`, `propDelay: 0.35` — demonstrating anti-inversion center clamping).
   - `17-corridor-led-equalizer.json` (**"Corridor LED Equalizer"**): `edgeLine` (`edgeMode: 'dualHorizontal'`) + `segmentedBars` (`ledSegments: 12`, `peakCaps: true`, `colorMode: 'amplitudeHot'`).
   - `18-star-burst-stream.json` (**"Star Burst Stream"**): `star` (`sides: 5`, `starInner: 0.42`, `cornerRadius: 0.12`) + `auroraFill` (`propMode: 'stream'`, `propCount: 6`, `propSpeed: 0.8`).
   - `19-spiral-pearl-beads.json` (**"Spiral Pearl Beads"**): `spiral` (`spiralTurns: 3.5`) + `dots` (`extrudeDirection: 'bilateral'`, `sampleCount: 128`, `colorMode: 'frequencyGradient'`).
   - `20-dual-rail-aurora-ark.json` (**"Dual-Rail Aurora Ark"**): Stack of `arc` (`arcSweep: 0.65`) + `auroraFill` (`extrudeDirection: 'outward'`) and `edgeLine` (`edgeMode: 'frame'`, `cornerRadius: 0.2`) + `pulsingLine`.

---

## 6. Atomic Implementation Slice Plan (Stage 9)

- **Slice 9.1: Declarative `showWhen` schema contract, `ShapeParams` & `SHAPE_SPECS` (first in `LAYER_SPECS`)**
  - **Target files:** `src/presets/schema.ts`, `src/presets/schema.test.ts`, `src/presets/layerSchemas.ts`, `src/presets/layerSchemas.test.ts`
  - **Verify:** `npm run typecheck && npm test && npm run build`
- **Slice 9.2: Core `ShapeLayer` WebGL2 renderer & GLSL shaders (8 base geometries, 8 effects, symmetry, anti-inversion, 6 propagation modes, audio envelopes & peak caps)**
  - **Target files:** `src/render/layers/shape.ts` [NEW], `src/render/shaders/shape.vert.glsl` [NEW], `src/render/shaders/shape.frag.glsl` [NEW], `src/render/__tests__/shapeLayer.test.ts` [NEW]
  - **Verify:** `npm run typecheck && npm test && npm run build`
- **Slice 9.3: Loader registration (`shape` first in `LAYER_FACTORIES`), legacy layer migration shim, and Global Director `shape` motion analyzer**
  - **Target files:** `src/presets/loader.ts`, `src/presets/loader.test.ts`, `src/presets/legacyShapeMigration.ts` [NEW], `src/render/globalDirector.ts`, `src/render/__tests__/globalDirector.test.ts`
  - **Verify:** `npm run typecheck && npm test && npm run build`
- **Slice 9.4: Studio conditional `showWhen` blade visibility, `'shape'` default add-layer type, and descriptive multi-layer `shape` labels**
  - **Target files:** `src/studio/studio.ts`, `src/studio/studio.test.ts`
  - **Verify:** `npm run typecheck && npm test && npm run build`
- **Slice 9.5: Built-in preset migration to `shape` and Stage 9 Showcase Preset Reel (`13`–`20`)**
  - **Target files:** `src/presets/builtin/index.ts`, `src/presets/builtin/crown.json`, `src/presets/builtin/flight.json`, `src/presets/builtin/bars.json`, `src/presets/builtin/01-curl-fluid-warp.json`, `src/presets/builtin/02-kaleidoscopic-mandala.json`, `src/presets/builtin/03-solarized-contour-rings.json`, `src/presets/builtin/04-mobius-dual-vortex.json`, `src/presets/builtin/05-rgb-aberration-vortex.json`, `src/presets/builtin/06-lissajous-vector-crt.json`, `src/presets/builtin/10-phyllotaxis-spiral-bloom.json`, `src/presets/builtin/13-solar-crown-eclipse.json` [NEW], `src/presets/builtin/14-sacred-orbit-mandala.json` [NEW], `src/presets/builtin/15-polar-spirograph-bloom.json` [NEW], `src/presets/builtin/16-hexagon-inward-portal.json` [NEW], `src/presets/builtin/17-corridor-led-equalizer.json` [NEW], `src/presets/builtin/18-star-burst-stream.json` [NEW], `src/presets/builtin/19-spiral-pearl-beads.json` [NEW], `src/presets/builtin/20-dual-rail-aurora-ark.json` [NEW], `src/presets/__tests__/presets.test.ts`
  - **Verify:** `npm run typecheck && npm test && npm run build`
