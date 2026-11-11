#version 300 es
precision highp float;

// Warp field (Slice 18.2). Draws a small texture of screen displacement once per frame from a stack of up to
// four operators. The feedback pass reads it with one lookup. Output rg holds the displacement in uv units,
// stored as 0.5 + d / (2 * RANGE) so it works in 8-bit buffers as well as half-float ones.
uniform int uOpCount;
uniform int uOpType[4];      // 0 radial, 1 swirl, 2 ripple, 3 stripes
uniform float uOpAmount[4];  // signed, -1..1
uniform float uOpScale[4];
uniform float uOpSpeed[4];
uniform vec2 uOpCentre[4];   // in uv, 0,0 = screen middle
uniform float uTime;
uniform float uDt;           // clamped time step, seconds
uniform float uAspect;

in vec2 vUv;
out vec4 outColor;

const float TWO_PI = 6.283185307179586;
// Largest displacement one frame can hold, in uv. Every operator is scaled to fit well inside it.
const float RANGE = 0.5;
// Displacement of a full-strength operator per 1/60 s, in uv.
const float STRENGTH = 0.03;

// Displacement (in aspect-corrected space) the operator adds to the sample position at q.
vec2 operatorAt(int type, vec2 q, float amount, float scale, float speed) {
  float r = length(q);
  vec2 dir = q / max(r, 0.02);
  float t = uTime * speed;
  if (type == 0) {
    // Radial: positive amount pulls the middle in and pushes the edges out. Negative reverses it.
    float edge = clamp(r * scale * 1.4, 0.0, 1.0);
    return -dir * (edge * 2.0 - 1.0) * amount;
  } else if (type == 1) {
    // Swirl: turns the picture around the centre, strongest near it.
    float fall = exp(-pow(r * scale * 1.5, 2.0));
    return vec2(-q.y, q.x) * 2.0 * fall * amount;
  } else if (type == 2) {
    // Ripple: rings travelling out from the centre.
    return dir * sin(r * scale * TWO_PI * 3.0 - t * TWO_PI) * amount;
  } else if (type == 3) {
    // Stripes: horizontal bands that slide sideways.
    return vec2(sin(q.y * scale * TWO_PI * 2.0 + t * TWO_PI), 0.0) * amount;
  }
  return vec2(0.0);
}

void main() {
  float tick = max(uDt * 60.0, 1e-4);
  vec2 d = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= uOpCount) break;
    vec2 q = vUv - 0.5 - uOpCentre[i];
    q.x *= uAspect;
    vec2 v = operatorAt(uOpType[i], q, uOpAmount[i], uOpScale[i], uOpSpeed[i]);
    v.x /= uAspect;
    d += v;
  }
  d *= STRENGTH * tick;
  outColor = vec4(clamp(d / (2.0 * RANGE) + 0.5, 0.0, 1.0), 0.5, 1.0);
}
