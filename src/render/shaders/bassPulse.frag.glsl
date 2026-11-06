#version 300 es
precision highp float;

uniform float uSub;   // env.sub, 0..1 (absolute level, not normalized)
uniform float uAlpha; // crossfade alpha from GlHost
uniform float uAspect; // target width / height (6.4: angle for the texture)
uniform float uTexOn;      // 1 = band texture on (6.4), 0 = off: output identical to before
uniform float uTexGain;    // 0..2: how strongly the band texture modulates
uniform sampler2D uTexSub; // sub-band row, sampled by angle (pulse brightness)

in vec2 vUv;
out vec4 outColor;

const float TAU = 6.2831853;

void main() {
  // 0.06 floor keeps the tracer dim, never black; the 0.25 span keeps the
  // brightness change well under the WCAG flash limit.
  float g = 0.06 + 0.25 * clamp(uSub, 0.0, 1.0);
  // Band texture (6.4): sub by angle scales the pulse brightness (1.0 when off).
  if (uTexOn > 0.5) {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    float subS = texture(uTexSub, vec2(atan(p.y, p.x) / TAU + 0.5, 0.5)).r;
    g *= max(0.0, 1.0 + uTexGain * (subS - 0.5));
  }
  g = min(g, 1.0);
  // Premultiplied output (rgb scaled by alpha) so it composites correctly
  // even though this layer does not enable blending.
  outColor = vec4(vec3(g), 1.0) * uAlpha;
}
