#version 300 es
precision highp float;

// One-row R32F texture holding the time-domain samples (-1..1).
uniform highp sampler2D uWave;
uniform int uCount; // number of samples (>= 2)

void main() {
  int i = gl_VertexID;
  // Spread vertices evenly across the full width of clip space.
  float x = float(i) / float(uCount - 1) * 2.0 - 1.0;
  // Unscaled sample, only the 0.8 vertical margin so peaks stay on screen.
  float s = texelFetch(uWave, ivec2(i, 0), 0).r;
  gl_Position = vec4(x, s * 0.8, 0.0, 1.0);
}
