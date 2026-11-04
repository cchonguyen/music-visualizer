#version 300 es
precision highp float;

// Scene feedback step: last frame, dimmed. Layers add their light on top after this.
uniform sampler2D uPrev;
uniform float uDecay; // 0.92 per frame: trails shrink quickly
uniform float uFade;  // 0.004 per frame, subtracted: trails clear to black (~300 ms)

in vec2 vUv;
out vec4 outColor;

void main() {
  outColor = vec4(max(texture(uPrev, vUv).rgb * uDecay - uFade, 0.0), 1.0);
}
