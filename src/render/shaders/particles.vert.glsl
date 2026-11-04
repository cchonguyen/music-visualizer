#version 300 es
// Treble sparkle particles. Each instance is one quad; no vertex buffers.
// Particles start at the vanishing point (centre) and stream outward.
precision highp float;

const float PI = 3.14159265;
const float TAU = 6.2831853;
const vec2 CORNERS[4] = vec2[4](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0));

uniform float uPhase;   // integrated phase, never decreases
uniform float uAspect;  // target width / height

out vec2 vLocal;        // quad corner, -1..1
out float vTwinkle;     // per-particle twinkle, 0..1, staggered by seed

void main() {
  // Same seed formula as seedFor() in particleState.ts.
  float seed = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);

  // Angle uses its own hash. Reusing `seed` for both made particles line up into spirals.
  float angleSeed = fract(sin(float(gl_InstanceID) * 78.233 + 1.7) * 43758.5453);
  float angle = angleSeed * TAU;
  float life = fract(uPhase * 0.1 + seed);   // 0..1 along the path
  float radius = life * 0.9;
  vec2 centre = vec2(cos(angle), sin(angle)) * radius;

  // Fade in and out over the life, so particles appear at the centre and vanish at the edge.
  float envelope = sin(life * PI);
  // Sized up from 0.004–0.012 (measured: too small to read over the rings).
  float halfSize = mix(0.008, 0.024, seed) * envelope;

  // Twinkle: each particle flickers on its own timing (never all at once).
  vTwinkle = smoothstep(0.3, 1.0, fract(uPhase * 0.7 + seed * 3.0));

  vec2 local = CORNERS[gl_VertexID];
  vLocal = local;

  // Aspect correction: x is scaled by 1/aspect so sprites stay round.
  vec2 offset = local * halfSize * vec2(1.0 / uAspect, 1.0);
  vec2 clip = vec2(centre.x / uAspect, centre.y) + offset;
  gl_Position = vec4(clip, 0.0, 1.0);
}
