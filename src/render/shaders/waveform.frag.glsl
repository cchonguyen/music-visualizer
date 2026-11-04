#version 300 es
precision highp float;

uniform float uAlpha; // crossfade alpha from GlHost

out vec4 outColor;

void main() {
  // Near-white, non-premultiplied; the layer enables SRC_ALPHA blending while drawing.
  outColor = vec4(0.95, 0.95, 0.95, uAlpha);
}
