#version 300 es
precision highp float;

uniform vec2 uRes;        // target size in pixels
uniform vec2 uCenter;     // shared sway offset, uv units (same centre rule as the tunnel)
uniform float uRadius;    // ring radius, in the tunnel's radius units
uniform float uFade;      // 1 at birth, 0 at the end of the ring's life
uniform vec3 uAccent;     // palette accent for the ring

in vec2 vUv;
out vec4 outColor;

const float CORE_WIDTH = 0.008; // thin bright line
const float GLOW_WIDTH = 0.03;  // soft halo around it

void main() {
  // Same centre as the tunnel: the bend fades out toward the top and bottom rim.
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 scale = vec2(aspect, 1.0);
  vec2 p0 = (vUv - 0.5) * scale;
  float rim = clamp(2.0 * length(p0), 0.0, 1.0);
  vec2 p = p0 - uCenter * scale * (1.0 - rim);
  float d = abs(length(p) - uRadius);

  float core = exp(-pow(d / CORE_WIDTH, 2.0));
  float glow = exp(-pow(d / GLOW_WIDTH, 2.0)) * 0.25;
  // The core is pushed toward white (a small bright feature may reach white, owner decision 2026-11-04).
  vec3 col = mix(uAccent, vec3(1.0), 0.6) * core * uFade + uAccent * glow * uFade;
  outColor = vec4(col, 1.0);
}
