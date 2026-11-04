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

in vec2 vUv;
out vec4 outColor;

const float TAU = 6.2831853;

void main() {
  // Centred, aspect-correct coordinates: rings stay circular on any canvas.
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
  float radius = length(p);
  // NOTE(spec): angle = atan(p.y, p.x) is in the slice contract, but nothing in v1
  // reads it, so it is left out of the shader rather than compiled as dead code.

  // Depth is capped near the centre so the vanishing point never strobes.
  float depth = 1.0 / max(radius, 0.15);

  // Ring stripes, offset by the integrated flight phase.
  float wave = 0.5 + 0.5 * cos(TAU * (depth * uRingDensity - uPhase));
  // Contrast: at uRingContrast 0.5 the full 0..1 range is used; lower softens it.
  float stripe = 0.5 + (wave - 0.5) * (2.0 * uRingContrast);

  // Full-screen pulse stays small (15%): a large whole-screen brightness swing
  // risks breaking the WCAG 2.3.1 flash limit. The strong response is on the rings only.
  float pulse = 0.85 + 0.15 * clamp(uLevel, 0.0, 1.0);

  // Bass pushes the ring stripes up to 25% brighter. Bounded for the flash limit.
  float stripeGain = 0.75 + 0.25 * clamp(uSub, 0.0, 1.0);
  vec3 rings = mix(uBase, uAccentA, stripe * stripeGain) * pulse;
  // Subtle accent B glow only where a stripe crest is near 1.
  rings += uAccentB * 0.15 * smoothstep(0.85, 1.0, stripe);
  // Beat flash: crests brighten on a beat. Brightness only, no camera movement.
  rings += uAccentA * 0.45 * clamp(uBeat, 0.0, 1.0) * smoothstep(0.8, 1.0, stripe);
  // Ring response to the bass level (track-relative): crests light up with the bass.
  rings += uAccentA * 0.5 * clamp(uSub, 0.0, 1.0) * smoothstep(0.75, 1.0, stripe);

  // Centre mask: blend into the dim floor colour at the vanishing point.
  float mask = smoothstep(0.02, 0.18, radius);
  vec3 col = mix(uBase, rings, mask);

  // Keep the rings dim: never above about 0.5 per channel.
  col = min(col, vec3(0.5));
  outColor = vec4(col, 1.0);
}
