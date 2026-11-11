#version 300 es
precision highp float;

// Blend up to two finished scenes, then apply the safety rules. Used on its own when no post effect is set,
// and for the half-size blend that feeds bloom (safety off). The same blend and safety blocks are repeated in
// post.frag.glsl, which does all three in one pass; compositor.test.ts checks the two copies stay identical.
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uWA;      // weight of scene A (0..1)
uniform float uWB;      // weight of scene B (0..1)
uniform float uCap;     // estimated luminance cap from BrightnessLimiter
uniform float uSafety;  // 1.0 = apply limits, 0.0 = off (tests / debugging)
uniform int uStyle;     // transition style while two scenes blend (T1): 0 crossfade, 1 wipe, 2 dissolve, 3 zoom-through
uniform float uT;       // transition progress, 0 = all A, 1 = all B (only used when both weights > 0)
uniform float uCalm;    // 1.0 = Calm mode enabled, 0.0 = normal
uniform float uReversalDamp; // 0.0..1.0 damping from rapid reversals (> 3 reversals/sec)

in vec2 vUv;
out vec4 outColor;

// @blend-begin
// Scene textures may be half-float (Slice 16.7) and hold values above 1; the blend reads them clamped to 0..1.
vec3 sceneAt(sampler2D s, vec2 uv) {
  return min(texture(s, uv).rgb, vec3(1.0));
}

vec3 blendAt(vec2 uv) {
  vec3 c;
  if (uStyle == 0 || uWA <= 0.0 || uWB <= 0.0) {
    c = sceneAt(uA, uv) * uWA + sceneAt(uB, uv) * uWB;
  } else if (uStyle == 1) {
    // Wipe: scene B arrives from the left, with a soft edge.
    float m = 1.0 - smoothstep(uT - 0.01, uT + 0.01, uv.x);
    c = mix(sceneAt(uA, uv), sceneAt(uB, uv), m);
  } else if (uStyle == 2) {
    // Dissolve: random pixels change first, then the rest.
    float n = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
    float m = 1.0 - smoothstep(uT - 0.1, uT + 0.1, n);
    c = mix(sceneAt(uA, uv), sceneAt(uB, uv), m);
  } else {
    // Zoom-through: B grows out of the centre while A fades.
    vec2 uvB = 0.5 + (uv - 0.5) / (0.6 + 0.4 * uT);
    c = sceneAt(uA, uv) * (1.0 - uT) + sceneAt(uB, uvB) * uT;
  }
  return c;
}
// @blend-end

// @safety-begin
vec3 applySafety(vec3 c) {
    // Saturated red: where R/(R+G+B) >= 0.8, mix toward grey of the same total.
    float sum = c.r + c.g + c.b;
    if (sum > 0.0001) {
      float r = c.r / sum;
      if (r >= 0.8) {
        float a = (r - 0.79) / (r - 1.0 / 3.0);
        c = mix(c, vec3(sum / 3.0), a);
      }
    }

    // High-frequency stripe guard (SYSTEM_SPEC.md:94):
    // Softly attenuate local contrast when spatial oscillations exceed safe thresholds.
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float dLuma = fwidth(luma);
    float stripeGuard = smoothstep(0.15, 0.45, dLuma);
    if (stripeGuard > 0.0) {
      c = mix(c, vec3(luma), stripeGuard * 0.6);
    }

    // Calm mode: dark-preserving highlight roll-off and cap peak saturation.
    if (uCalm > 0.5) {
      float contrastFactor = 0.5;
      c = c / (1.0 + c * (1.0 - contrastFactor)) * contrastFactor;
      float maxC = max(c.r, max(c.g, c.b));
      float minC = min(c.r, min(c.g, c.b));
      float sat = maxC > 0.0001 ? (maxC - minC) / maxC : 0.0;
      float maxSat = 0.75;
      if (sat > maxSat) {
        float curLuma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(curLuma), c, maxSat / sat);
      }
    }

    // Alternating dark/light frames (> 3 reversals/sec): increase damping toward black.
    if (uReversalDamp > 0.0) {
      c *= (1.0 - uReversalDamp * 0.35);
    }

    // Luminance cap: scale down anything brighter than the cap.
    float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
    if (L > uCap) c *= uCap / max(L, 0.0001);
  return c;
}
// @safety-end

void main() {
  vec3 c = blendAt(vUv);
  if (uSafety > 0.5) c = applySafety(c);
  outColor = vec4(c, 1.0);
}
