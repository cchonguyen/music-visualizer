#version 300 es
precision highp float;

// Final pass: blend up to two finished scenes, then apply the safety rules.
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uWA;      // weight of scene A (0..1)
uniform float uWB;      // weight of scene B (0..1)
uniform float uCap;     // estimated luminance cap from BrightnessLimiter
uniform float uSafety;  // 1.0 = apply limits, 0.0 = off (tests / debugging)
uniform int uStyle;     // transition style while two scenes blend (T1): 0 crossfade, 1 wipe, 2 dissolve, 3 zoom-through
uniform float uT;       // transition progress, 0 = all A, 1 = all B (only used when both weights > 0)

in vec2 vUv;
out vec4 outColor;

void main() {
  vec3 c;
  if (uStyle == 0 || uWA <= 0.0 || uWB <= 0.0) {
    c = texture(uA, vUv).rgb * uWA + texture(uB, vUv).rgb * uWB;
  } else if (uStyle == 1) {
    // Wipe: scene B arrives from the left, with a soft edge.
    float m = 1.0 - smoothstep(uT - 0.01, uT + 0.01, vUv.x);
    c = mix(texture(uA, vUv).rgb, texture(uB, vUv).rgb, m);
  } else if (uStyle == 2) {
    // Dissolve: random pixels change first, then the rest.
    float n = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
    float m = 1.0 - smoothstep(uT - 0.1, uT + 0.1, n);
    c = mix(texture(uA, vUv).rgb, texture(uB, vUv).rgb, m);
  } else {
    // Zoom-through: B grows out of the centre while A fades.
    vec2 uvB = 0.5 + (vUv - 0.5) / (0.6 + 0.4 * uT);
    c = texture(uA, vUv).rgb * (1.0 - uT) + texture(uB, uvB).rgb * uT;
  }

  if (uSafety > 0.5) {
    // Saturated red: where R/(R+G+B) >= 0.8, mix toward grey of the same total.
    float sum = c.r + c.g + c.b;
    if (sum > 0.0001) {
      float r = c.r / sum;
      if (r >= 0.8) {
        float a = (r - 0.79) / (r - 1.0 / 3.0);
        c = mix(c, vec3(sum / 3.0), a);
      }
    }
    // Luminance cap: scale down anything brighter than the cap.
    float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
    if (L > uCap) c *= uCap / max(L, 0.0001);
  }

  outColor = vec4(c, 1.0);
}
