#version 300 es
precision highp float;

// One-row R32F texture holding the time-domain samples (-1..1).
uniform highp sampler2D uWave;
uniform int uCount;        // number of samples (>= 2)
uniform int uMode;         // 0 = line, 1 = circle, 2 = star7, 3 = lissajous
uniform float uAspect;     // width / height, keeps circle/star/knot round
uniform float uAmp;        // amplitude
uniform float uDelta;      // phase delta for lissajous
uniform float uRadius;     // circle / star radius
uniform float uThickness;  // line thickness
uniform float uRotPitch;   // 3D pitch rotation
uniform float uRotYaw;     // 3D yaw rotation

out float vEdge;
out float vPathU;

const float TAU = 6.283185307179586;

vec3 rot3(vec3 p, float pitch, float yaw) {
  // Rx(pitch)
  float cp = cos(pitch);
  float sp = sin(pitch);
  vec3 r1 = vec3(p.x, cp * p.y - sp * p.z, sp * p.y + cp * p.z);
  // Ry(yaw)
  float cy = cos(yaw);
  float sy = sin(yaw);
  return vec3(cy * r1.x + sy * r1.z, r1.y, -sy * r1.x + cy * r1.z);
}

vec2 getLinePos(int idx) {
  float x = float(idx) / float(uCount - 1) * 2.0 - 1.0;
  float s = texelFetch(uWave, ivec2(clamp(idx, 0, uCount - 1), 0), 0).r;
  return vec2(x, s * 0.8 * uAmp);
}

vec2 getCirclePos(int idx) {
  int sIdx = idx % uCount;
  float s = texelFetch(uWave, ivec2(sIdx, 0), 0).r;
  float a = float(idx) / float(uCount) * TAU;
  float r = uRadius + 0.22 * uAmp * s;
  return vec2(cos(a) * r / max(uAspect, 0.0001), sin(a) * r);
}

vec2 getStar7Pos(int idx) {
  int sIdx = idx % uCount;
  float s = texelFetch(uWave, ivec2(sIdx, 0), 0).r;
  float angle = float(idx) / float(uCount) * TAU;
  float r = uRadius + 0.065 * cos(7.0 * angle) + 0.22 * uAmp * s;
  return vec2(cos(angle) * r / max(uAspect, 0.0001), sin(angle) * r);
}

vec2 getLissajousPos(int idx) {
  float t = float(idx) / 1024.0 * TAU;
  int sampleIdx = int(float(idx % 1024) / 1024.0 * float(uCount)) % uCount;
  float s = texelFetch(uWave, ivec2(sampleIdx, 0), 0).r;
  float a = 3.0;
  float b = 2.0;
  float c = 5.0;
  vec3 knot = vec3(sin(a * t + uDelta), sin(b * t), cos(c * t));
  knot += normalize(knot) * (s * 0.12 * uAmp);
  vec3 p3 = rot3(knot, uRotPitch, uRotYaw);
  float depth = 2.2 - p3.z * 0.55;
  vec2 p2 = p3.xy * (1.35 * clamp(uAmp, 0.4, 1.8) / depth);
  p2.x /= max(uAspect * 0.65, 1.0);
  return p2;
}

void main() {
  int pointIdx = gl_VertexID / 2;
  float aSide = (gl_VertexID % 2 == 0) ? -1.0 : 1.0;

  vec2 pCurr;
  vec2 pNext;
  float u;

  if (uMode == 1) {
    pCurr = getCirclePos(pointIdx);
    pNext = getCirclePos(pointIdx + 1);
    u = float(pointIdx) / float(uCount);
  } else if (uMode == 2) {
    pCurr = getStar7Pos(pointIdx);
    pNext = getStar7Pos(pointIdx + 1);
    u = float(pointIdx) / float(uCount);
  } else if (uMode == 3) {
    pCurr = getLissajousPos(pointIdx);
    pNext = getLissajousPos(pointIdx + 1);
    u = float(pointIdx) / 1024.0;
  } else {
    // Mode 0: line
    pCurr = getLinePos(pointIdx);
    if (pointIdx < uCount - 1) {
      pNext = getLinePos(pointIdx + 1);
    } else {
      pNext = pCurr + (pCurr - getLinePos(pointIdx - 1));
    }
    u = float(pointIdx) / float(uCount - 1);
  }

  vec2 dir = pNext - pCurr;
  dir.x *= uAspect;
  float len = length(dir);
  vec2 tangent = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-tangent.y, tangent.x);
  normal.x /= max(uAspect, 0.0001);

  vec2 pos = pCurr + normal * (aSide * uThickness * 0.0032);
  gl_Position = vec4(pos, 0.0, 1.0);

  vEdge = aSide;
  vPathU = u;
}
