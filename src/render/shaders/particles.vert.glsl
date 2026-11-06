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
uniform float uRotation;    // radians, turns the particle field about the screen centre (0 = none)
uniform float uZoom;        // scale about the screen centre, divide so >1 enlarges (1 = none)
uniform float uFar;         // outer radius in screen heights: hypot(aspect, 1) so the corners are reached
uniform float uSize;        // multiplies streak length and width (2 = doubled)

// Particles spawn at the inner rim of the tunnel (r = 0.16), so their origin moves
// with the rim: shifted by sway * (1 - 0.16). The tunnel hole and the emitter stay together.
const float INNER_RIM = 0.16;

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

  // Spawn (C3): every particle starts at the crown bar tips, r = 0.16.
  // Radius follows tunnel depth: depth = 1/r is linear in life, so r = 1 / mix(1/0.16, 1/uFar, life).
  float depthNear = 1.0 / INNER_RIM;
  float depthFar = 1.0 / uFar;
  float radius = 1.0 / mix(depthNear, depthFar, life);
  // The swirl adds a small angular turn over the life, so trails bend gently.
  float angle = angleBase + swirlDir * uSwirl * life;
  vec2 dir = vec2(cos(angle), sin(angle));
  vec2 pos = dir * radius;

  // Motion direction = d(pos)/d(life): the radial part plus the swirl part.
  // The streak lies along this vector, so it points where the particle is going.
  // dr/dlife = (depthNear - depthFar) * r^2: the same flow speed as the tunnel rings.
  float dRadius = (depthNear - depthFar) * radius * radius;
  vec2 vel = dRadius * dir + radius * swirlDir * uSwirl * vec2(-dir.y, dir.x);
  vec2 axis = normalize(vel);
  vec2 perp = vec2(-axis.y, axis.x);

  // Streak length grows with energy and with life (the streak stretches as it flies out).
  float streakLen = (0.006 + 0.025 * clamp(uEnergy, 0.0, 1.0) * life) * uSize;
  // Half-width of the streak, 0.0025..0.005 per particle.
  float halfWidth = mix(0.0025, 0.005, seed) * uSize;

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
  // Transform (4.7): rotate, then zoom. Done on the height-normalised point, before the
  // aspect divide, so the rotation is a true rotation on a wide screen. Defaults (0, 1) are identity.
  float c = cos(uRotation);
  float s = sin(uRotation);
  vec2 turned = vec2(c * point.x - s * point.y, s * point.x + c * point.y) / uZoom;
  gl_Position = vec4(turned.x / uAspect, turned.y, 0.0, 1.0);
}
