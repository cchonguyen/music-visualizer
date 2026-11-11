#version 300 es
precision highp float;

// Warp field (Slice 18.2). Draws a small texture of screen displacement once per frame from a stack of up to
// four operators. The feedback pass reads it with one lookup. Output rg holds the displacement in uv units,
// stored as 0.5 + d / (2 * RANGE) so it works in 8-bit buffers as well as half-float ones.
uniform int uOpCount;
uniform int uOpType[4];      // 0 radial, 1 swirl, 2 ripple, 3 stripes, 4 stretch, 5 tile, 6 tunnel, 7 sphere, 8 curl
uniform float uOpAmount[4];  // signed, -1..1
uniform float uOpScale[4];
uniform float uOpSpeed[4];
uniform vec2 uOpCentre[4];   // in uv, 0,0 = screen middle
uniform vec3 uOpExtra[4];    // curl noise only: octaves, turbulence, flow style (0 plumes, 1 eddies, 2 outflow, 3 inflow)
uniform float uHigh;         // treble level, 0..1, adds turbulence to curl noise
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

// 2D rotation matrix
mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}

// 2D Simplex Noise (Ian McEwan, Ashima Arts)
vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187,
                      0.366025403784439,
                     -0.577350269189626,
                      0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
        + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// Time-varying potential field blending two counter-rotating layers
float curlPotential(vec2 p, float t) {
  vec2 p1 = rot2(t * 0.18) * p;
  vec2 p2 = rot2(-t * 0.14) * p + vec2(sin(t * 0.35), cos(t * 0.29)) * 1.4;
  return snoise(p1) * 0.55 + snoise(p2) * 0.45;
}

// Multi-octave Simplex stream-function curl noise
vec2 curlNoise(vec2 pos, float t, int octaves, float turbulence, float high) {
  vec2 vel = vec2(0.0);
  float freq = 1.0;
  float amp = 1.0;
  float eps = 0.01;
  float turbWeight = turbulence * (0.5 + high * 0.8);

  for (int i = 0; i < 3; i++) {
    if (i >= octaves) break;
    float weight = (i == 0) ? 1.0 : turbWeight * amp;
    vec2 p = pos * freq;
    float ti = t * (0.6 + 0.4 * float(i + 1));
    float n1 = curlPotential(p + vec2(0.0, eps), ti);
    float n2 = curlPotential(p - vec2(0.0, eps), ti);
    float n3 = curlPotential(p + vec2(eps, 0.0), ti);
    float n4 = curlPotential(p - vec2(eps, 0.0), ti);
    vec2 c = vec2((n1 - n2) / (2.0 * eps), -(n3 - n4) / (2.0 * eps));
    vel += c * weight;
    freq *= 2.1;
    amp *= 0.5;
  }
  return vel;
}

// Curl noise, moved here from the feedback shader's Curl warp mode (Slice 18.5). Same maths, evaluated on the
// small field instead of every pixel. q is in aspect-corrected space; the result is a velocity.
vec2 curlOperator(vec2 q, float scale, float t, vec3 extra) {
  vec2 vel = curlNoise(q * (scale * 2.0), t, int(extra.x + 0.5), extra.y, uHigh);
  vec2 radial = length(q) > 1e-4 ? normalize(q) : vec2(0.0, 1.0);
  int flow = int(extra.z + 0.5);
  if (flow == 0) {
    vec2 flowVec = vec2(sin(uTime * 0.22 + q.y * 2.5), cos(uTime * 0.17 + q.x * 2.5)) * 0.22 + radial * (0.18 * sin(uTime * 0.31));
    vel = vel * 0.75 + flowVec;
  } else if (flow == 1) {
    vel = vel * 1.1;
  } else if (flow == 2) {
    vel = vel * 0.5 + radial * 0.85;
  } else {
    vec2 tang = vec2(-radial.y, radial.x);
    vel = vel * 0.5 - radial * 0.75 + tang * 0.65;
  }
  return vel;
}

// Displacement (in aspect-corrected space) the operator adds to the sample position at q.
vec2 operatorAt(int type, vec2 q, float amount, float scale, float speed, vec3 extra) {
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
  } else if (type == 4) {
    // Stretch and squish: pulls the picture wide while squeezing it tall, then back, on a slow beat.
    float pulse = 0.5 + 0.5 * sin(t * TWO_PI);
    return vec2(q.x, -q.y) * pulse * amount;
  } else if (type == 5) {
    // Tile and mirror: nudges every point toward its place in a mirrored grid of `scale` tiles across.
    vec2 g = q * scale + 0.5;
    vec2 folded = (abs(mod(g + 1.0, 2.0) - 1.0) - 0.5) / scale;
    return (folded - q) * amount;
  } else if (type == 6) {
    // Tunnel perspective: pulls toward the centre faster near the edges, with a twist set by speed.
    float rs = r * scale;
    float curve = 0.3 + 2.0 * rs * rs;
    return -(q + vec2(-q.y, q.x) * 0.4 * speed) * curve * amount;
  } else if (type == 7) {
    // Sphere bulge: magnifies the middle like a lens (negative amount pinches it).
    float lens = 1.0 - clamp(r * scale * 2.0, 0.0, 1.0);
    return -q * lens * lens * 2.0 * amount;
  } else if (type == 8) {
    // Curl noise: swirling smoke-like flow. 0.032 / STRENGTH keeps the old Curl mode's strength.
    return curlOperator(q, scale, t, extra) * (0.032 / STRENGTH) * amount;
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
    vec2 v = operatorAt(uOpType[i], q, uOpAmount[i], uOpScale[i], uOpSpeed[i], uOpExtra[i]);
    v.x /= uAspect;
    d += v;
  }
  d *= STRENGTH * tick;
  outColor = vec4(clamp(d / (2.0 * RANGE) + 0.5, 0.0, 1.0), 0.5, 1.0);
}
