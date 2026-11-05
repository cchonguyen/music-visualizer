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
uniform int uShape;        // 0 streak, 1 dot, 2 star, 3 ring

out vec4 fragColor;

void main() {
  // Soft edge across the streak: 1 on the centre line, 0 at the sides.
  // NOTE(spec): written as 1 - smoothstep(0, 1, d) because GLSL leaves smoothstep undefined when edge0 >= edge1.
  float across = 1.0 - smoothstep(0.0, 1.0, abs(vLocal.y));
  // Brighter toward the head (x = 1), so the streak reads as moving.
  float along = smoothstep(0.0, 1.0, vLocal.x * 0.5 + 0.5);
  float shape = across * along;

  float r = length(vLocal);
  if (uShape == 1) {
    // Dot: soft round disc.
    shape = 1.0 - smoothstep(0.0, 1.0, r);
  } else if (uShape == 2) {
    // Star: four points along the axes (thin where x*y is near 0), with a faint disc core.
    float points = (1.0 - smoothstep(0.0, 0.08, abs(vLocal.x * vLocal.y))) * (1.0 - smoothstep(0.0, 1.0, r));
    float disc = (1.0 - smoothstep(0.0, 0.25, r)) * 0.35;
    shape = max(points, disc);
  } else if (uShape == 3) {
    // Ring: annulus around radius 0.6, width 0.2.
    float band = 1.0 - smoothstep(0.0, 0.1, abs(r - 0.6));
    shape = band;
  }

  // White core near the middle of the quad, fading to the accent colour outward.
  float core = 1.0 - smoothstep(0.0, 0.6, r);
  vec3 tint = mix(uAccent, uAccentA, step(0.5, vMix));
  vec3 colour = mix(tint, vec3(1.0), core);

  float level = clamp(uSparkle, 0.0, 1.0) * vTwinkle * vFade;
  vec3 out_colour = colour * shape * uBrightness * level;
  fragColor = vec4(min(out_colour, vec3(0.9)), 1.0);
}
