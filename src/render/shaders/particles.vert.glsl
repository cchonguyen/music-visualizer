#version 300 es
// Treble sparkle streaks. Each instance is one stretched quad; no vertex buffers.
// Particles spawn near the vanishing point and fly outward. Each quad is aligned
// with its direction of motion, so it reads as a streak.
precision highp float;

const float PI = 3.14159265;
const float TAU = 6.2831853;
const vec2 CORNERS[4] = vec2[4](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0));

uniform float uPhase;       // integrated phase, never decreases
uniform float uAspect;      // target width / height
uniform float uSwirl;       // midrange drive, 0..1 (0 in Calm)
uniform float uEnergy;      // track-relative loudness, 0..1: sets streak length
uniform float uTwinkleTime; // integrated seconds, drives the twinkle
uniform vec2 uSway;         // shared figure-eight sway, clip units (same as the tunnel)
uniform float uCrown[48];   // radial crown heights 0..1 (crownStore); launch offset per bar

// Particles spawn at the inner rim of the tunnel (r = 0.16), so their origin moves
// with the rim: shifted by sway * (1 - 0.16). The tunnel hole and the emitter stay together.
const float INNER_RIM = 0.16;
const int CROWN_BINS = 48;

out float vMix;             // 0..1: picks accent A or B per particle
out vec2 vLocal;            // quad corner, -1..1 (x along the streak, y across it)
out float vTwinkle;         // per-particle sharp twinkle, 0..1
out float vFade;            // 0 at spawn and at the edge, 1 mid-life

// Per-particle hash in [0, 1). Same formula as hash01() in particleState.ts.
// Different salts give independent values for speed, angle, swirl and twinkle.
float hash01(float index, float salt) {
  return fract(sin(index * 12.9898 + salt * 78.233) * 43758.5453);
}

void main() {
  float id = float(gl_InstanceID);
  float seed = hash01(id, 0.0);                    // spawn offset along the life cycle
  float speed = mix(0.06, 0.16, hash01(id, 1.0));  // per-particle life rate
  float angleBase = hash01(id, 2.0) * TAU;         // starting direction
  float swirlDir = mix(-1.2, 1.2, hash01(id, 3.0)); // curl direction, sign varies per particle

  // Life comes from the phase accumulator, so motion never jumps when energy changes.
  float life = fract(uPhase * speed + seed);

  // Launch (P5): the particle leaves the tip of the crown bar in its angular bin.
  int bin = min(int(floor(fract(angleBase / TAU) * float(CROWN_BINS))), CROWN_BINS - 1);
  float launch = INNER_RIM + uCrown[bin];

  // Radius accelerates outward: r = mix(launch, 0.95, life^1.8).
  float radius = mix(launch, 0.95, pow(life, 1.8));
  // The swirl adds a small angular turn over the life, so trails bend gently.
  float angle = angleBase + swirlDir * uSwirl * life;
  vec2 dir = vec2(cos(angle), sin(angle));
  vec2 pos = dir * radius;

  // Motion direction = d(pos)/d(life): the radial part plus the swirl part.
  // The streak lies along this vector, so it points where the particle is going.
  float dRadius = (0.95 - launch) * 1.8 * pow(max(life, 1e-3), 0.8);
  vec2 vel = dRadius * dir + radius * swirlDir * uSwirl * vec2(-dir.y, dir.x);
  vec2 axis = normalize(vel);
  vec2 perp = vec2(-axis.y, axis.x);

  // Streak length grows with energy and with life (the streak stretches as it flies out).
  float streakLen = 0.006 + 0.025 * clamp(uEnergy, 0.0, 1.0) * life;
  // Half-width of the streak, 0.0025..0.005 per particle.
  float halfWidth = mix(0.0025, 0.005, seed);

  vLocal = CORNERS[gl_VertexID];
  // Head (x = 1) sits on the particle; the tail trails behind it along -axis.
  float t = vLocal.x * 0.5 + 0.5;
  vec2 origin = vec2(uSway.x * uAspect, uSway.y) * (1.0 - INNER_RIM);
  vec2 point = origin + pos - axis * streakLen * (1.0 - t) + perp * vLocal.y * halfWidth;

  // Fade in and out over the life, so streaks appear near the centre and vanish at the edge.
  vFade = sin(life * PI);

  // Twinkle: a sharp sine per particle, 6 to 14 rad/s, raised to a power so it flickers.
  float twRate = mix(6.0, 14.0, hash01(id, 4.0));
  float twPhase = hash01(id, 5.0) * TAU;
  float tw = 0.5 + 0.5 * sin(uTwinkleTime * twRate + twPhase);
  vTwinkle = tw * tw * tw * tw;

  // Aspect correction: x is scaled by 1/aspect so streaks keep their true shape.
  gl_Position = vec4(point.x / uAspect, point.y, 0.0, 1.0);
}
