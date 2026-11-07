#version 300 es
precision highp float;

uniform vec2 uRes;        // target size in pixels
uniform vec2 uCenter;     // shared sway offset, uv units (same centre rule as the tunnel)
uniform float uRadius;    // ring radius, in the tunnel's radius units
uniform float uFade;      // 1 at birth, 0 at the end of the ring's life
uniform vec3 uBase;       // optional base color (defaults to 0)
uniform vec3 uAccent;     // palette accent for the ring
uniform float uGlow;      // 0 = thin ring (default), 1 = soft radial glow field (V4)
uniform float uTexOn;     // 1 = band texture on (6.3), 0 = off: output identical to before
uniform float uTexGain;   // 0..2: how strongly the band texture modulates
uniform sampler2D uTexSub; // sub-band row, sampled by angle (ring edge brightness)
uniform float uLayerOpacity;

in vec2 vUv;
out vec4 outColor;

const float CORE_WIDTH = 0.008; // thin bright line
const float GLOW_WIDTH = 0.03;  // soft halo around it
const float TAU = 6.2831853;

void main() {
  // Same centre as the tunnel: the bend fades out toward the top and bottom rim.
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 scale = vec2(aspect, 1.0);
  vec2 p0 = (vUv - 0.5) * scale;
  float rim = clamp(2.0 * length(p0), 0.0, 1.0);
  vec2 p = p0 - uCenter * scale * (1.0 - rim);
  // uRadius is in clip units (screen edge = 1.0, as the particles use), so double the tunnel radius.
  float d = abs(2.0 * length(p) - uRadius);

  // Band texture (6.3): sub by angle sets the ring's edge brightness (1.0 when off).
  float texMul = 1.0;
  if (uTexOn > 0.5) {
    float subS = texture(uTexSub, vec2(atan(p.y, p.x) / TAU + 0.5, 0.5)).r;
    texMul = max(0.0, 1.0 + uTexGain * (subS - 0.5));
  }

  float core = exp(-pow(d / CORE_WIDTH, 2.0));
  float glow = exp(-pow(d / GLOW_WIDTH, 2.0)) * 0.25;
  float ring = (core + glow) * uFade;
  if (uGlow > 0.5) {
    // Glow field: a soft disc that grows to the ring radius and fades with the ring. It shares the kick's flash token.
    float disc = 1.0 - smoothstep(0.0, 1.0, 2.0 * length(p) / max(uRadius, 0.05));
    ring += 0.45 * disc * uFade;
  }
  vec3 accentCore = mix(uAccent, vec3(1.0), 0.6 * clamp(core, 0.0, 1.0));
  vec3 col = mix(uBase, accentCore, clamp(ring, 0.0, 1.0)) * clamp(ring, 0.0, 1.5) * texMul * uLayerOpacity;
  float a = clamp(ring * texMul, 0.0, 1.0) * uLayerOpacity;
  outColor = vec4(col, a);
}
