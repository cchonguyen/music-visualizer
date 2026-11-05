#version 300 es
precision highp float;

// One-row R32F texture holding the time-domain samples (-1..1).
uniform highp sampler2D uWave;
uniform int uCount; // number of samples (>= 2)
uniform int uMode;  // 0 = line across the screen, 1 = closed circle (V5)
uniform float uAspect; // width / height, keeps the circle round
uniform float uAmp;    // amplitude

void main() {
  if (uMode == 1) {
    // Circle: the waveform wraps once around a ring. The strip has uCount + 1 vertices, so it closes.
    int i = gl_VertexID % uCount;
    float s = texelFetch(uWave, ivec2(i, 0), 0).r;
    float a = float(gl_VertexID) / float(uCount) * 6.2831853;
    float r = 0.45 + 0.2 * uAmp * s;
    gl_Position = vec4(cos(a) * r / max(uAspect, 0.0001), sin(a) * r, 0.0, 1.0);
    return;
  }
  int i = gl_VertexID;
  // Spread vertices evenly across the full width of clip space.
  float x = float(i) / float(uCount - 1) * 2.0 - 1.0;
  // Unscaled sample, only the 0.8 vertical margin so peaks stay on screen.
  float s = texelFetch(uWave, ivec2(i, 0), 0).r;
  gl_Position = vec4(x, s * 0.8 * uAmp, 0.0, 1.0);
}
