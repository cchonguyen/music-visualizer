#version 300 es
precision highp float;

// Scene feedback step: last frame, dimmed. Layers add their light on top after this.
uniform sampler2D uPrev;
uniform float uDecay; // 0.96–0.98 per frame

in vec2 vUv;
out vec4 outColor;

void main() {
  outColor = vec4(texture(uPrev, vUv).rgb * uDecay, 1.0);
}
