#version 300 es
// Soft radial sparkle. Output is additive (blend SRC_ALPHA, ONE) and kept dim:
// brightness is capped below the bass pulse.
precision highp float;

in vec2 vLocal;
in float vTwinkle;

uniform vec3 uAccent;      // palette accentB
uniform float uSparkle;    // 0..1: frame.env.high plus flash, calm-scaled
uniform float uBrightness; // default 0.6

out vec4 fragColor;

void main() {
  // Radial falloff: 1 at the centre, 0 at the quad edge.
  // NOTE(spec): written as 1 - smoothstep(0, 1, d) because GLSL leaves smoothstep undefined when edge0 >= edge1.
  float a = 1.0 - smoothstep(0.0, 1.0, length(vLocal));
  float level = clamp(uSparkle, 0.0, 1.0) * vTwinkle;
  vec3 colour = uAccent * a * uBrightness * level;
  fragColor = vec4(min(colour, vec3(0.9)), 1.0);
}
