#version 300 es
precision highp float;

// Orbit layer (Slice 20.4). No vertex buffers: each point is one body, placed from gl_VertexID. Bodies ride tilted
// circular orbits in 3D, turned together by a slow yaw, and are projected with a gentle perspective so far bodies
// are small and dim and near bodies are large and bright.
uniform vec2 uRes;
uniform int uOrbits;       // 1..5
uniform int uPerOrbit;     // bodies on each orbit
uniform float uRadius;     // fraction of half the screen height
uniform float uTilt;       // radians
uniform float uDepth;      // 0..1 perspective strength
uniform float uPhase;      // integrated orbit angle, radians
uniform float uYaw;        // integrated turn of the whole system, radians
uniform float uSize;       // body diameter as a fraction of screen height
uniform float uReact;      // 0..2 size pulse from the music
uniform float uKick;       // 0..1 kick envelope
uniform float uBands[16];  // log-spaced spectrum slices, 0..1

out float vNear;           // 0 far .. 1 near
out float vMix;            // 0..1 along the orbits, picks the colour

const float TAU = 6.283185307179586;

mat3 rotX(float a) { float c = cos(a); float s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a); float s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a); float s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

void main() {
  int id = gl_VertexID;
  int orbit = id % uOrbits;
  int k = id / uOrbits;
  float o = float(orbit);
  float fo = o / max(float(uOrbits - 1), 1.0);

  // Inner orbits are quicker, alternate orbits go the other way.
  float dir = (orbit % 2 == 0) ? 1.0 : -1.0;
  float angle = dir * uPhase * (1.0 + 0.45 * (1.0 - fo)) + TAU * float(k) / float(uPerOrbit) + o * 0.7;
  float r = uRadius * (0.4 + 0.6 * float(orbit + 1) / float(uOrbits));

  vec3 p = vec3(cos(angle), sin(angle), 0.0) * r;
  float tilt = uTilt * (0.55 + 0.45 * fo) * dir;
  p = rotY(uYaw + o * 0.5) * rotZ(o * 0.9) * rotX(tilt) * p;

  // z > 0 is away from the viewer.
  float s = 1.0 / (1.0 + uDepth * p.z * 0.6);
  vec2 screen = vec2(p.x * s / (uRes.x / uRes.y), p.y * s);
  gl_Position = vec4(screen, 0.0, 1.0);

  float band = uBands[(id * 7) % 16];
  float pulse = 1.0 + uReact * (0.9 * band + 0.5 * uKick);
  float px = uSize * uRes.y * mix(1.0, s, uDepth) * pulse;
  gl_PointSize = clamp(px, 2.0, 64.0);

  vNear = clamp(0.5 + 0.5 * (s - 1.0) / max(0.4, 0.6 * uDepth + 0.4) + 0.25, 0.0, 1.0);
  vMix = clamp(0.7 * fo + 0.3 * float(k) / float(uPerOrbit), 0.0, 1.0);
}
