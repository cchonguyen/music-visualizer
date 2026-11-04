#version 300 es
precision highp float;

// Plain copy of a texture, used to show the trail on the screen.
uniform sampler2D uSrc;

in vec2 vUv;
out vec4 outColor;

void main() {
  outColor = vec4(texture(uSrc, vUv).rgb, 1.0);
}
