#version 300 es
// Radial crown (Stage 2, P5): 48 thin bars around the tunnel rim, one per bin.
// Each pixel checks the bar in its own angular bin and its two neighbours.
precision highp float;

const int BARS = 48;
const float TAU = 6.2831853;
const float R0 = 0.16;      // bars start at this radius (clip units, screen edge = 1)
const float MAX_LEN = 0.5;  // a bar at full height reaches R0 + 0.5

uniform vec2 uRes;          // target size in pixels (sets the aspect ratio)
uniform vec2 uCentre;       // vanishing point, aspect-corrected clip units (sway applied)
uniform float uHeights[48]; // bar heights 0..1, from crownStore
uniform vec3 uAccent;       // palette accent (A, or the swapped colour)
uniform float uTexOn;      // 1 = band texture on (6.4), 0 = off: output identical to before
uniform float uTexGain;    // 0..2: how strongly the band texture modulates
uniform sampler2D uTexMid; // mid-band row, sampled by angle (bar brightness)
uniform float uLayerOpacity;
uniform float uSize;

in vec2 vUv;
out vec4 outColor;

// Light from bar i at a point with radius r and angle theta, about 0..1.
float barLight(float r, float theta, int i) {
  float h = uHeights[i];
  float ti = (float(i) + 0.5) / float(BARS) * TAU;
  float dth = theta - ti;
  // Position along and across the bar's radial line.
  float along = r * cos(dth);
  float across = r * sin(dth);
  float len = MAX_LEN * h;
  // Distance past the end of the segment, so the bar has a clean tip.
  float past = max(max(R0 - along, along - (R0 + len)), 0.0);
  float d = length(vec2(across, past));
  float core = 1.0 - smoothstep(0.0015, 0.0045, d);   // thin bright stroke
  float glow = exp(-d * d / (0.01 * 0.01));          // soft halo
  // Fade out bars that are almost silent, so they do not show as dots.
  return (0.7 * core + 0.3 * glow) * smoothstep(0.0, 0.05, h);
}

void main() {
  float aspect = uRes.x / max(uRes.y, 1.0);
  // Aspect-correct clip coordinates: the screen height spans -1..1, x is scaled by aspect,
  // so bars stay round on a 16:9 canvas.
  vec2 q = ((vUv * 2.0 - 1.0) * vec2(aspect, 1.0) - uCentre) / max(uSize, 0.1);
  float r = length(q);
  if (r < R0 - 0.02 || r > R0 + MAX_LEN + 0.02) {
    outColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }
  float theta = atan(q.y, q.x);
  if (theta < 0.0) theta += TAU;
  int bin = int(floor(theta / TAU * float(BARS))) % BARS;

  // Check the bin and both neighbours: the glow can reach across a bin edge.
  float light = barLight(r, theta, bin);
  light = max(light, barLight(r, theta, (bin + 1) % BARS));
  light = max(light, barLight(r, theta, (bin + BARS - 1) % BARS));

  // Band texture (6.4): mid by angle scales the bar light (1.0 when off).
  float texMul = 1.0;
  if (uTexOn > 0.5) {
    float midS = texture(uTexMid, vec2(theta / TAU, 0.5)).r;
    texMul = max(0.0, 1.0 + uTexGain * (midS - 0.5));
  }

  // Boosted base intensity so crown has strong visual presence when layered.
  vec3 col = uAccent * 0.95 * light * texMul * uLayerOpacity;
  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  outColor = vec4(col, a);
}
