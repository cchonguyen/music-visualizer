#version 300 es
// Streak sparkle. A white-hot core fades to the palette accent across the streak,
// and the head is brighter than the tail. Output is additive (blend SRC_ALPHA, ONE)
// and kept dim: brightness is capped below the bass pulse.
precision highp float;

in vec2 vLocal;     // x along the streak (-1 tail .. 1 head), y across it
in float vTwinkle;
in float vMix;
in float vFade;

uniform vec3 uAccent;      // palette accentB
uniform vec3 uAccentA;     // palette accentA
uniform float uSparkle;    // 0..1: treble level plus flash, calm-scaled
uniform float uBrightness; // default 0.6

out vec4 fragColor;

void main() {
  // Soft edge across the streak: 1 on the centre line, 0 at the sides.
  // NOTE(spec): written as 1 - smoothstep(0, 1, d) because GLSL leaves smoothstep undefined when edge0 >= edge1.
  float across = 1.0 - smoothstep(0.0, 1.0, abs(vLocal.y));
  // Brighter toward the head (x = 1), so the streak reads as moving.
  float along = smoothstep(0.0, 1.0, vLocal.x * 0.5 + 0.5);
  float shape = across * along;

  // White core near the middle of the quad, fading to the accent colour outward.
  float core = 1.0 - smoothstep(0.0, 0.6, length(vLocal));
  vec3 tint = mix(uAccent, uAccentA, step(0.5, vMix));
  vec3 colour = mix(tint, vec3(1.0), core);

  float level = clamp(uSparkle, 0.0, 1.0) * vTwinkle * vFade;
  vec3 out_colour = colour * shape * uBrightness * level;
  fragColor = vec4(min(out_colour, vec3(0.9)), 1.0);
}
