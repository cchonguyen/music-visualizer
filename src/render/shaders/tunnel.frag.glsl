#version 300 es
precision highp float;

uniform float uPhase;        // flight phase from FlightState / stepTunnel
uniform float uForwardPhase; // forward flight phase
uniform float uSub;          // norm.sub, 0..1 (track-relative bass)
uniform float uLevel;        // env.sub, 0..1 (absolute bass)
uniform vec2 uRes;           // target size in pixels
uniform vec3 uBase;          // palette base (dim floor)
uniform vec3 uAccentA;       // palette accent A
uniform vec3 uAccentB;       // palette accent B
uniform vec3 uAccentC;       // palette accent C
uniform float uRingContrast; // 0.5 normal, lower in calm
uniform float uRingDensity;  // rings per unit depth (0.5)
uniform float uBeat;         // beat flash
uniform vec2 uCenter;        // vanishing-point bend offset, uv units
uniform float uRoll;         // ring roll angle, radians
uniform float uRollPhase;    // roll angle
uniform float uDensity;      // ring spacing
uniform float uHue;          // 0..1: mix from accent A to accent B
uniform float uQuiet;        // 0..1: 1 in quiet passages, 0 when loud
uniform float uPattern;      // 0 rings, 1 grid, 2 spokes, 3 checker, 4 stripes
uniform float uSides;        // cross-section: 0 = classic/round rings, 3..12 = polygon
uniform float uTwist;        // spiral twist
uniform float uSpiral;       // spiral twist
uniform float uTexOn;        // 1 = band texture on, 0 = off
uniform float uTexGain;      // 0..2
uniform sampler2D uTexSub;
uniform sampler2D uTexMid;

uniform float uKick;         // 0..1 kick intensity
uniform float uMid;          // 0..1 norm.mid
uniform float uLayerOpacity; // 0..1 layer opacity
uniform float uHueSpread;    // 0..1 multi-color depth rainbow
uniform float uWallTexture;  // 0..1 cosmic star-streaks & wall glow
uniform float uZoomPunch;    // 0..1 kick FOV warp & depth ripple
uniform float uSwirlPulse;   // 0..1 mid corkscrew swirl

in vec2 vUv;
out vec4 fragColor;
#define outColor fragColor

const float TAU = 6.2831853;

void main() {
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 scale = vec2(aspect, 1.0);
  vec2 p0 = (vUv - 0.5) * scale;

  float rim = clamp(2.0 * length(p0), 0.0, 1.0);
  vec2 p = p0 - uCenter * scale * (1.0 - rim);
  vec2 q = p;

  float forwardPhase = (uForwardPhase != 0.0) ? uForwardPhase : uPhase;
  float rollPhase = (uRollPhase != 0.0) ? uRollPhase : uRoll;
  float spiral = (uSpiral != 0.0) ? uSpiral : uTwist;

  // When uSides < 2.5 (sides == 0 round rings), keep r = length(q) perfectly circular (zero polygonal wobble).
  float r;
  if (uSides < 2.5) {
    r = length(q);
  } else {
    float seg = TAU / uSides;
    float aSeg = mod(atan(q.y, q.x) - rollPhase, seg) - seg * 0.5;
    r = length(q) * cos(seg * 0.5) / cos(aSeg);
  }

  // Kick FOV warp jump + travelling shockwave ripple (uZoomPunch)
  float rMod = max(r * (1.0 - uKick * uZoomPunch * 0.22), 0.025);
  float z = 0.28 / rMod + forwardPhase + uKick * uZoomPunch * 0.35 * sin(0.28 / rMod * 3.0 - forwardPhase * 4.0);

  // Mid-band corkscrew swirl & twist (uSwirlPulse) (spiral + uMid * uSwirlPulse * 0.9) / max(rMod, 0.08)
  float a = atan(q.y, q.x) + rollPhase + (spiral + uMid * uSwirlPulse * 0.9) / max(rMod, 0.28);

  // Seamless angular wrapping
  float aNorm = fract(a / 6.2831853);

  // Multi-Color Depth Rainbow (uHueSpread)
  float ringIdx = floor(z * 1.6);
  vec3 rainbow = 0.55 + 0.45 * cos(6.2831853 * (ringIdx * 0.14 * uHueSpread + rollPhase * 0.15 + vec3(0.0, 0.33, 0.67)));
  float hueT = fract(z * 0.25 * max(uHueSpread, 0.1) - forwardPhase * 0.15);
  vec3 triAccent = hueT < 0.333333
    ? mix(uAccentA, uAccentB, hueT * 3.0)
    : (hueT < 0.666667
      ? mix(uAccentB, uAccentC, (hueT - 0.333333) * 3.0)
      : mix(uAccentC, uAccentA, (hueT - 0.666667) * 3.0));
  vec3 ringCol = mix(triAccent, rainbow, uHueSpread);

  // Cosmic Star-Streaks & Wall Glow (uWallTexture)
  float streak = pow(max(0.0, sin(a * 24.0 + floor(z * 2.0) * 1.9)), 6.0) * smoothstep(0.05, 0.45, r) * smoothstep(0.1, 0.9, uWallTexture) * uWallTexture;
  float wallNebula = (0.5 + 0.5 * sin(a * 6.0 - z * 1.2)) * 0.18 * uWallTexture;

  // Wall pattern
  float ringWave = 0.5 + 0.5 * cos(TAU * (z * uRingDensity * 2.0));
  float spokeWave = 0.5 + 0.5 * cos(12.0 * a + spiral * TAU * z);
  float streakWave = 0.5 + 0.5 * cos(TAU * (q.x * uDensity * 2.0 - forwardPhase));
  int pattern = int(uPattern + 0.5);
  float wave = ringWave;
  if (pattern == 1) wave = 0.5 * (ringWave + spokeWave);
  else if (pattern == 2) wave = spokeWave;
  else if (pattern == 3) wave = ringWave * spokeWave;
  else if (pattern == 4) wave = streakWave;

  float sharp = mix(2.5, 4.0, clamp(uRingContrast * 2.0, 0.0, 1.0));
  float expo = mix(sharp * 1.5, sharp * 0.6, smoothstep(0.1, 0.6, rMod));
  float stripe = pow(wave, expo);
  stripe = max(stripe, 0.12 * smoothstep(0.5, 0.9, wave));
  stripe = max(stripe, 0.12 * uQuiet);

  // Band texture (6.2)
  float texMul = 1.0;
  if (uTexOn > 0.5) {
    float midS = texture(uTexMid, vec2(fract(z * 0.5), 0.5)).r;
    float subS = texture(uTexSub, vec2(aNorm, 0.5)).r;
    stripe = clamp(0.5 + (stripe - 0.5) * (1.0 + uTexGain * (midS - 0.5)), 0.0, 1.0);
    texMul = max(0.0, 1.0 + uTexGain * (subS - 0.5));
  }

  float pulse = 0.85 + 0.15 * clamp(uLevel, 0.0, 1.0);
  float stripeGain = 0.75 + 0.25 * clamp(uSub, 0.0, 1.0);
  vec3 baseAccent = mix(uAccentA, uAccentB, clamp(uHue, 0.0, 1.0));
  vec3 chosenAccent = (pattern == 0) ? ringCol : baseAccent;
  vec3 rings = mix(uBase * stripe, chosenAccent, stripe * stripeGain) * pulse;
  rings += uAccentB * 0.15 * smoothstep(0.85, 1.0, stripe);
  // Soft ambient rim glow on beat swell instead of harsh strobe
  rings += chosenAccent * 0.30 * clamp(uBeat, 0.0, 1.0) * (smoothstep(0.4, 1.0, stripe) * 0.6 + smoothstep(0.15, 0.85, rim) * 0.4);
  rings += chosenAccent * 0.5 * clamp(uSub, 0.0, 1.0) * smoothstep(0.75, 1.0, stripe);
  rings *= texMul;

  // Add star-streaks and nebula wall glow
  vec3 streakCol = mix(uAccentB, uAccentC, 0.5 + 0.5 * sin(z * 2.0));
  vec3 nebulaCol = mix(uAccentA, uAccentC, 0.5 + 0.5 * cos(a * 3.0));
  rings += streak * streakCol * (0.8 + 0.4 * uSub);
  rings += wallNebula * nebulaCol * (0.6 + 0.4 * uLevel);

  // Centre vanishing-point mask
  float mask = smoothstep(0.02, 0.18, r);
  vec3 col = rings * mask;

  // Proportional stencil alpha
  float ringLuma = clamp(stripe, 0.0, 1.0);
  float alpha = clamp(ringLuma + wallNebula + streak, 0.0, 1.0) * uLayerOpacity * mask;
  fragColor = vec4(col * uLayerOpacity, alpha);
}
