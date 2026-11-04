#version 300 es
precision highp float;

uniform float uSub;   // env.sub, 0..1 (absolute level, not normalized)
uniform float uAlpha; // crossfade alpha from GlHost

out vec4 outColor;

void main() {
  // 0.06 floor keeps the tracer dim, never black; the 0.25 span keeps the
  // brightness change well under the WCAG flash limit.
  float g = 0.06 + 0.25 * clamp(uSub, 0.0, 1.0);
  // Premultiplied output (rgb scaled by alpha) so it composites correctly
  // even though this layer does not enable blending.
  outColor = vec4(vec3(g), 1.0) * uAlpha;
}
