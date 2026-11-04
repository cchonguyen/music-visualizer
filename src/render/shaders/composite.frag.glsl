#version 300 es
precision highp float;

// Final pass: blend up to two finished scenes, then apply the safety rules.
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uWA;      // weight of scene A (0..1)
uniform float uWB;      // weight of scene B (0..1)
uniform float uCap;     // estimated luminance cap from BrightnessLimiter
uniform float uSafety;  // 1.0 = apply limits, 0.0 = off (tests / debugging)

in vec2 vUv;
out vec4 outColor;

void main() {
  vec3 c = texture(uA, vUv).rgb * uWA + texture(uB, vUv).rgb * uWB;

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
