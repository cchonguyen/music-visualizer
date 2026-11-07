#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float u_mid;
uniform float u_sub;
uniform float u_kickEnv;
uniform float uScale;
uniform float uSpeed;
uniform float uLineWidth;
uniform float uBrightness;
uniform vec3 uBase;
uniform vec3 uAccent;

in vec2 vUv;
out vec4 outColor;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;

// Spatial frequency cap enforcing SYSTEM_SPEC.md:94 to prevent high-frequency flashing and aliasing
const float MAX_SPATIAL_FREQ = 75.0;

// Analytical derivative-based (fwidth) anti-aliasing with Nyquist roll-off
float evaluateGrid(float phase, float width) {
  float fw = fwidth(phase);
  // Roll off toward flat average when spatial frequency approaches Nyquist limit
  float nyquistFade = clamp(1.0 - fw * 0.35, 0.0, 1.0);

  // Normalized phase in [0, 1)
  float p = fract(phase / TAU);
  float d = abs(p - 0.5);
  float hw = width * 0.5;
  float edgeWidth = max(fw / TAU, 0.001);
  float stripe = 1.0 - smoothstep(hw - edgeWidth, hw + edgeWidth, d);

  return mix(width, stripe, nyquistFade);
}

void main() {
  vec2 aspect = vec2(uRes.x / max(uRes.y, 1.0), 1.0);
  vec2 uv = (vUv - 0.5) * aspect;
  float r = length(uv);

  // Enforce spatial frequency cap (SYSTEM_SPEC.md:94)
  float baseFreq = clamp(uScale, 4.0, MAX_SPATIAL_FREQ);

  float t = uTime * uSpeed;

  // Grid 1: concentric wave interference grid with radial phase-inversion ring driven by kickEnv
  float ringRadius = clamp(u_kickEnv * 0.85, 0.0, 1.2);
  float ringDist = abs(r - ringRadius);
  float inversion = smoothstep(0.12, 0.0, ringDist) * PI;

  float wave1 = sin(r * 8.0 - t * 2.0) * 0.15;
  float phi1 = (r * baseFreq + wave1) * TAU + inversion;

  // Grid 2: frequency ratio (<= 0.08 delta) modulated with u_sub
  float freqDelta = clamp(u_sub, 0.0, 1.0) * 0.08;
  float freq2 = baseFreq * (1.0 + freqDelta);

  // Modulate grid 2 offset with u_mid
  vec2 offset2 = vec2(
    sin(t * 0.6) * 0.1 + cos(t * 0.3) * 0.05,
    cos(t * 0.5) * 0.1 + sin(t * 0.4) * 0.05
  ) * clamp(u_mid * 1.5, 0.0, 0.5);
  vec2 uv2 = uv - offset2;
  float r2 = length(uv2);
  float wave2 = cos(r2 * 7.0 + t * 1.5) * 0.12;
  float phi2 = (r2 * freq2 + wave2) * TAU;

  // Analytical fwidth anti-aliased grids
  float w = clamp(uLineWidth, 0.1, 0.9);
  float grid1 = evaluateGrid(phi1, w);
  float grid2 = evaluateGrid(phi2, w);

  // Combined via smoothed XOR: abs(grid1 - grid2)
  float moire = abs(grid1 - grid2);
  moire = clamp(moire, 0.0, 1.0);

  // Apply palette colors and brightness
  vec3 col = mix(uBase, uAccent, moire) * uBrightness;
  outColor = vec4(col, 1.0);
}
