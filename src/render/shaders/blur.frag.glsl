#version 300 es
precision highp float;

// Separable blur for bloom (slice E5). Run once horizontally, once vertically.
// uStep is one tap in uv. The taps are 0, ±1.3, ±2.6 steps.
uniform sampler2D uSrc;
uniform vec2 uStep;

in vec2 vUv;
out vec4 outColor;

void main() {
  vec3 c = texture(uSrc, vUv).rgb * 0.227;
  c += (texture(uSrc, vUv + uStep * 1.3).rgb + texture(uSrc, vUv - uStep * 1.3).rgb) * 0.316;
  c += (texture(uSrc, vUv + uStep * 2.6).rgb + texture(uSrc, vUv - uStep * 2.6).rgb) * 0.0703;
  outColor = vec4(c, 1.0);
}
