#version 300 es
precision highp float;

// Decay pass: last frame's image, slightly dimmed, plus a dot at the bass level.
uniform sampler2D uPrev;
uniform float uDecay;     // 0.97: how much of last frame survives
uniform float uDotLevel;  // 0..1, from env.sub
uniform vec2 uDotPos;     // 0..1 screen position
uniform vec2 uRes;        // target size in pixels

in vec2 vUv;
out vec4 outColor;

void main() {
  vec3 prev = texture(uPrev, vUv).rgb * uDecay;
  vec2 p = vUv * uRes;
  vec2 c = uDotPos * uRes;
  float radius = 6.0 + 30.0 * uDotLevel;
  float d = length(p - c);
  float dot = smoothstep(radius, radius * 0.6, d) * uDotLevel;
  outColor = vec4(prev + vec3(dot), 1.0);
}
