#version 300 es
precision highp float;

uniform float uPhase;        // flight phase from FlightState (integrated, monotonic)
uniform float uSub;          // norm.sub, 0..1 (track-relative bass, scaled by visual gain): ring crests
uniform float uLevel;        // env.sub, 0..1 (absolute bass, unscaled): full-screen pulse
uniform vec2 uRes;           // target size in pixels
uniform vec3 uBase;          // palette base (dim floor)
uniform vec3 uAccentA;       // palette accent A (ring stripes)
uniform vec3 uAccentB;       // palette accent B (soft glow on ring crests)
uniform float uRingContrast; // 0.5 normal, lower in calm
uniform float uRingDensity;  // rings per unit depth (0.5)
uniform float uBeat;         // 0..1 beat flash, decays after each beat (ring brightness only)
uniform vec2 uCenter;        // vanishing-point bend offset, uv units (figure-eight, calm = 0)
uniform float uRoll;         // ring roll angle, radians (integrated in JS)
uniform float uDensity;      // ring spacing, breathes with the bass
uniform float uHue;          // 0..1: mix from accent A to accent B (slow drift + treble)
uniform float uQuiet;        // 0..1: 1 in quiet passages, 0 when loud (smoothed in JS). Lifts the gaps.

in vec2 vUv;
out vec4 outColor;

const float TAU = 6.2831853;
const float HEX_AMOUNT = 0.05; // 6-sided ring shape, +/-5%

void main() {
  // Centred, aspect-correct coordinates: rings stay circular on any canvas.
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 scale = vec2(aspect, 1.0);
  vec2 p0 = (vUv - 0.5) * scale;
  // Bend: the vanishing point moves fully at the centre and not at all at the
  // top or bottom edge, so the outer rim stays put.
  float rim = clamp(2.0 * length(p0), 0.0, 1.0);
  vec2 p = p0 - uCenter * scale * (1.0 - rim);
  float radius = length(p);

  // 6-sided shape, rolled by uRoll. Rings are slightly hexagonal, not round.
  float angle = atan(p.y, p.x);
  float shaped = radius * (1.0 + HEX_AMOUNT * cos(6.0 * (angle - uRoll)));

  // Depth is capped near the centre so the vanishing point never strobes.
  float depth = 1.0 / max(shaped, 0.15);

  // Ring stripes, offset by the integrated flight phase.
  float wave = 0.5 + 0.5 * cos(TAU * (depth * uDensity - uPhase));
  // Sharp stripes (P1, 2026-11-04): only the crests carry colour, and the space
  // between rings falls to the near-black palette base. Calm (low contrast) keeps softer crests.
  // Crest width (P3): thin far away (centre), thick close up (edge).
  float sharp = mix(2.5, 4.0, clamp(uRingContrast * 2.0, 0.0, 1.0));
  float expo = mix(sharp * 1.5, sharp * 0.6, smoothstep(0.1, 0.6, shaped));
  float stripe = pow(wave, expo);
  // Quiet floor (patch 2026-11-04): crest bands never drop below 12% brightness, so faint
  // rings stay visible in near-silence. The gaps between rings (low wave) stay at the base colour.
  stripe = max(stripe, 0.12 * smoothstep(0.5, 0.9, wave));
  // Quiet-aware floor (C1, 2026-11-04): in quiet passages the gaps between rings also
  // hold a 12% tint, so the screen never goes fully dark. Loud passages keep the dark gaps.
  stripe = max(stripe, 0.12 * uQuiet);

  // Full-screen pulse stays small (15%): a large whole-screen brightness swing
  // risks breaking the WCAG 2.3.1 flash limit. The strong response is on the rings only.
  float pulse = 0.85 + 0.15 * clamp(uLevel, 0.0, 1.0);

  // Bass pushes the ring stripes up to 25% brighter. Bounded for the flash limit.
  float stripeGain = 0.75 + 0.25 * clamp(uSub, 0.0, 1.0);
  vec3 accent = mix(uAccentA, uAccentB, clamp(uHue, 0.0, 1.0));
  vec3 rings = mix(uBase, accent, stripe * stripeGain) * pulse;
  // Subtle accent B glow only where a stripe crest is near 1.
  rings += uAccentB * 0.15 * smoothstep(0.85, 1.0, stripe);
  // Beat flash: crests brighten on a beat. Brightness only, no camera movement.
  rings += accent * 0.45 * clamp(uBeat, 0.0, 1.0) * smoothstep(0.8, 1.0, stripe);
  // Ring response to the bass level (track-relative): crests light up with the bass.
  rings += accent * 0.5 * clamp(uSub, 0.0, 1.0) * smoothstep(0.75, 1.0, stripe);

  // Centre mask: blend into the dim floor colour at the vanishing point.
  float mask = smoothstep(0.02, 0.18, radius);
  vec3 col = mix(uBase, rings, mask);

  // No per-channel cap here (P1, 2026-11-04): the compositor's luminance cap limits brightness.
  outColor = vec4(col, 1.0);
}
