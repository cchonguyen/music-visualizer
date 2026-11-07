#version 300 es
precision highp float;

// One-row R32F texture holding the time-domain samples (-1..1).
uniform highp sampler2D uWave;
uniform int uCount; // number of samples (>= 2)
uniform int uMode;  // 0 = line, 1 = circle, 2 = star7 (Slice 7.12), 3 = lissajous (Slice 7.12)
uniform float uAspect; // width / height, keeps the circle/star/knot round
uniform float uAmp;    // amplitude
uniform float uDelta;  // phase delta for lissajous

const float TAU = 6.2831853;

vec2 getStarVertex(int k) {
  float theta = float(k) * (TAU / 14.0);
  float rad = (k % 2 == 0) ? 0.45 : 0.20;
  return vec2(cos(theta), sin(theta)) * rad;
}

void main() {
  if (uMode == 1) {
    // Circle: the waveform wraps once around a ring. The strip has uCount + 1 vertices, so it closes.
    int i = gl_VertexID % uCount;
    float s = texelFetch(uWave, ivec2(i, 0), 0).r;
    float a = float(gl_VertexID) / float(uCount) * TAU;
    float r = 0.45 + 0.2 * uAmp * s;
    gl_Position = vec4(cos(a) * r / max(uAspect, 0.0001), sin(a) * r, 0.0, 1.0);
    return;
  }
  if (uMode == 2) {
    // star7: 7-pointed wireframe star in the center whose vertices jitter along raw waveform data
    int i = gl_VertexID % uCount;
    float s = texelFetch(uWave, ivec2(i, 0), 0).r;
    float param = float(gl_VertexID) / float(uCount);
    float segPos = param * 14.0;
    int segIdx = int(floor(segPos)) % 14;
    float u = fract(segPos);
    vec2 pA = getStarVertex(segIdx);
    vec2 pB = getStarVertex((segIdx + 1) % 14);
    vec2 basePos = mix(pA, pB, u);
    vec2 edge = pB - pA;
    vec2 edgeNorm = normalize(vec2(-edge.y, edge.x));
    vec2 pos = basePos + edgeNorm * (s * 0.12 * uAmp);
    gl_Position = vec4(pos.x / max(uAspect, 0.0001), pos.y, 0.0, 1.0);
    return;
  }
  if (uMode == 3) {
    // lissajous: 1,024-vertex gl.LINE_STRIP evaluating 3D parametric knot
    // x(t) = sin(a*t + delta), y(t) = sin(b*t), z(t) = cos(c*t)
    // projected to 2D with raw waveform displacement perpendicular to the tangent
    float t = float(gl_VertexID) / 1024.0 * TAU;
    int sampleIdx = int(float(gl_VertexID) / 1024.0 * float(uCount)) % uCount;
    float s = texelFetch(uWave, ivec2(sampleIdx, 0), 0).r;
    float a = 3.0;
    float b = 2.0;
    float c = 5.0;
    float x = sin(a * t + uDelta);
    float y = sin(b * t);
    float z = cos(c * t);
    // Projection to 2D
    float depth = 2.4 - z * 0.5;
    vec2 p2 = vec2(x, y) * (0.42 / depth);
    // Tangent derivative dx/dt, dy/dt
    vec2 tangent = vec2(a * cos(a * t + uDelta), b * cos(b * t));
    float tLen = length(tangent);
    vec2 normal = tLen > 0.0001 ? vec2(-tangent.y, tangent.x) / tLen : vec2(0.0, 1.0);
    p2 += normal * (s * 0.12 * uAmp);
    gl_Position = vec4(p2.x / max(uAspect, 0.0001), p2.y, 0.0, 1.0);
    return;
  }

  int i = gl_VertexID;
  // Spread vertices evenly across the full width of clip space.
  float x = float(i) / float(uCount - 1) * 2.0 - 1.0;
  // Unscaled sample, only the 0.8 vertical margin so peaks stay on screen.
  float s = texelFetch(uWave, ivec2(i, 0), 0).r;
  gl_Position = vec4(x, s * 0.8 * uAmp, 0.0, 1.0);
}
