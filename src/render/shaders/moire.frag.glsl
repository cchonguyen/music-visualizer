#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float u_mid;
uniform float u_sub;
uniform float u_kickEnv;
uniform float uKickEnv;
uniform float uScale;
uniform float uSpeed;
uniform float uLineWidth;
uniform float uBrightness;
uniform vec3 uBase;
uniform vec3 uAccent;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uContrast;
uniform float uWaveShape;
uniform float uColorSpread;
uniform int uPatternMode;
uniform float uAudioWarp;
uniform float uLayerOpacity;
uniform sampler2D uSceneTex;
uniform int uHasSceneTex;

in vec2 vUv;
out vec4 fragColor;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;

// Spatial frequency cap enforcing SYSTEM_SPEC.md:94 to prevent high-frequency flashing and aliasing
const float MAX_SPATIAL_FREQ = 75.0;

// Analytical derivative-based (fwidth) anti-aliasing with Nyquist roll-off
float evaluateGrid(float phase, float width) {
  float fw = fwidth(phase);
  // Roll off toward flat average when spatial frequency approaches Nyquist limit (Slice 7.35 wide sweet spot)
  float nyquistFade = clamp(1.0 - fw * 0.12, 0.22, 1.0);

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

  // Enforce spatial frequency cap (SYSTEM_SPEC.md:94)
  float baseFreq = clamp(uScale, 4.0, MAX_SPATIAL_FREQ);

  float t = uTime * uSpeed;
  float kick = max(u_kickEnv, uKickEnv);

  // Frequency ratio (<= 0.08 delta) modulated with u_sub (Slice 7.35: min detuning max(freqDelta, 0.045))
  float freqDelta = clamp(u_sub, 0.0, 1.0) * 0.08;
  float effDelta = max(freqDelta, 0.045);
  float freq1 = baseFreq;
  float freq2 = baseFreq * (1.0 + effDelta);

  // Centers locked: frozen separation and zeroed midOffset so interference centers don't wobble or jitter
  float sep = 0.18;
  vec2 midOffset = vec2(0.0);

  vec2 c1 = vec2(-sep, 0.0) + midOffset;
  vec2 c2 = vec2(sep, 0.0) - midOffset;

  vec2 p1 = uv - c1;
  vec2 p2 = uv - c2;
  float r1 = length(p1);
  float r2 = length(p2);
  float theta1 = atan(p1.y, p1.x);
  float theta2 = atan(p2.y, p2.x);

  // Radial phase-inversion ring & kick radial ripple
  float ringRadius = clamp(kick * 0.85, 0.0, 1.2);
  float inversion1 = smoothstep(0.12, 0.0, abs(r1 - ringRadius)) * PI;
  float inversion2 = smoothstep(0.12, 0.0, abs(r2 - ringRadius)) * PI;

  float kickRipple1 = kick * uAudioWarp * 2.2 * sin(r1 * 10.0 - t * 6.0);
  float kickRipple2 = kick * uAudioWarp * 2.2 * sin(r2 * 10.0 - t * 6.0);

  float phi1 = 0.0;
  float phi2 = 0.0;

  if (uPatternMode == 0) {
    // 0 (starburstLoom): Concentric rings + angular radial spokes creating the woven diamond starburst center from Mockup 07
    float wave1 = sin(r1 * 8.0 - t * 2.0) * 0.15;
    float wave2 = cos(r2 * 7.0 + t * 1.5) * 0.12;
    float spokes1 = sin(theta1 * 8.0 + t * 0.8) * 0.35;
    float spokes2 = sin(theta2 * 8.0 - t * 0.8) * 0.35;
    phi1 = (r1 * freq1 + wave1 + spokes1) * TAU + inversion1 + kickRipple1;
    phi2 = (r2 * freq2 + wave2 + spokes2) * TAU + inversion2 + kickRipple2;
  } else if (uPatternMode == 1) {
    // 1 (twinCircles): Dual displaced concentric ripples
    float wave1 = sin(r1 * 8.0 - t * 2.0) * 0.15;
    float wave2 = cos(r2 * 7.0 + t * 1.5) * 0.12;
    phi1 = (r1 * freq1 + wave1) * TAU + inversion1 + kickRipple1;
    phi2 = (r2 * freq2 + wave2) * TAU + inversion2 + kickRipple2;
  } else if (uPatternMode == 2) {
    // 2 (doubleSpirals): Counter-rotating logarithmic spirals
    float spiralTurns = 6.0;
    float wave1 = sin(r1 * 6.0 - t * 2.0) * 0.1;
    float wave2 = cos(r2 * 6.0 + t * 1.8) * 0.1;
    phi1 = (r1 * freq1 + wave1) * TAU + theta1 * spiralTurns + t * 3.0 + inversion1 + kickRipple1;
    phi2 = (r2 * freq2 + wave2) * TAU - theta2 * spiralTurns - t * 3.0 + inversion2 + kickRipple2;
  } else {
    // 3 (warpedCrossGrid): Crossed wave grating / hyperbolic curved diagonal line gratings rotating in opposition
    float ang = t * 0.25;
    vec2 rot1 = vec2(uv.x * cos(ang) - uv.y * sin(ang), uv.x * sin(ang) + uv.y * cos(ang));
    vec2 rot2 = vec2(uv.x * cos(-ang) - uv.y * sin(-ang), uv.x * sin(-ang) + uv.y * cos(-ang));
    float warp1 = sin(rot1.y * 6.0 + t) * 0.12 + (rot1.x * rot1.y) * 0.5;
    float warp2 = cos(rot2.x * 6.0 - t) * 0.12 - (rot2.x * rot2.y) * 0.5;
    phi1 = (rot1.x * freq1 + warp1) * TAU + kickRipple1;
    phi2 = (rot2.y * freq2 + warp2) * TAU + kickRipple2;
  }

  // Analytical fwidth anti-aliased grids
  float w = clamp(uLineWidth, 0.1, 0.9);
  float grid1 = evaluateGrid(phi1, w);
  float grid2 = evaluateGrid(phi2, w);

  // Combined via smoothed XOR: abs(grid1 - grid2)
  float moireCrisp = abs(grid1 - grid2);

  // Smooth cosine interference:
  float moireSmooth = 0.5 + 0.5 * cos(phi1 - phi2);

  // Contrast & Softness: blend between smooth cosine interference and anti-aliased ribbons via uWaveShape
  float moire = mix(moireSmooth, moireCrisp, clamp(uWaveShape, 0.0, 1.0));
  moire = clamp(moire, 0.0, 1.0);
  float interference = moire;

  // Two-tone palette color gradient controlled by uColorSpread
  float beatPhase = 0.5 + 0.5 * cos((phi1 + phi2) * 0.5);
  vec3 fringeCol = mix(uColorA, uColorB, clamp(beatPhase * uColorSpread, 0.0, 1.0));
  vec3 col = fringeCol * uBrightness;
  vec3 moireCol = col;

  // Slice 7.35: Feedback trail buffer refraction & modulation (uSceneTex)
  vec2 moireGrad = vec2(dFdx(interference), dFdy(interference));
  if (uHasSceneTex == 1) {
    vec3 bg = texture(uSceneTex, vUv + moireGrad * (0.018 + 0.025 * uAudioWarp)).rgb;
    vec3 woven = bg * mix(0.55, 1.65, interference) + moireCol * (0.35 + 0.65 * clamp(length(bg) * 1.5, 0.25, 1.0));
    col = woven;
  }

  // Stencil alpha: dark troughs emit alpha = 0 so underlying layers show through cleanly!
  float a = clamp(moire * uContrast, 0.0, 1.0) * uLayerOpacity;
  fragColor = vec4(col * a, a);
}
