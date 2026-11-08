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
uniform float uHue;        // total hue rotation in turns (shift + drift), combined on the CPU
uniform float uTexOn;      // 1 = band texture on (6.2), 0 = off: output identical to before
uniform float uTexGain;    // 0..2: how strongly the band texture modulates
uniform sampler2D uTexHigh; // high-band waveform row (6.2)
uniform float uKickEnv;
uniform float uBeatReactivity;

out vec4 fragColor;

// NOTE(spec): luminance-preserving hue rotation (the standard RGB rotation matrix about the grey axis).
vec3 rotateHue(vec3 c, float angle) {
  float ca = cos(angle);
  float sa = sin(angle);
  mat3 m = mat3(
    vec3(0.213 + ca * 0.787 - sa * 0.213, 0.213 - ca * 0.213 + sa * 0.143, 0.213 - ca * 0.213 - sa * 0.787),
    vec3(0.715 - ca * 0.715 - sa * 0.715, 0.715 + ca * 0.285 + sa * 0.140, 0.715 - ca * 0.715 + sa * 0.715),
    vec3(0.072 - ca * 0.072 + sa * 0.928, 0.072 - ca * 0.072 - sa * 0.283, 0.072 + ca * 0.928 + sa * 0.072)
  );
  return clamp(m * c, 0.0, 1.0);
}

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
  float mixT = smoothstep(0.15, 0.85, vMix);
  vec3 midTone = (uAccent + uAccentA) * 0.5;
  vec3 baseGradient = mixT < 0.5 ? mix(uAccent, midTone, mixT * 2.0) : mix(midTone, uAccentA, (mixT - 0.5) * 2.0);
  vec3 irid = 0.5 + 0.5 * cos(6.2831853 * (mixT + vec3(0.0, 0.33, 0.67)));
  vec3 tint = mix(baseGradient, irid, 0.15);
  vec3 colour = mix(tint, vec3(1.0), core);

  // NOTE(spec): hue shift is skipped at uHue == 0.0 so the default output is unchanged.
  if (uHue != 0.0) {
    colour = rotateHue(colour, uHue * 6.2831853);
  }

  float level = clamp(uSparkle, 0.0, 1.0) * vTwinkle * vFade;
  // Band texture (6.2): the high band sets sparkle brightness. vTwinkle is the per-particle
  // coordinate (vMix is not written by the vertex shader). Off = factor 1.0, output unchanged.
  if (uTexOn > 0.5) {
    level *= max(0.0, 1.0 + uTexGain * (texture(uTexHigh, vec2(vTwinkle, 0.5)).r - 0.5));
  }
  float beatGlow = 1.0 + 0.35 * uKickEnv * uBeatReactivity;
  vec3 out_colour = colour * shape * uBrightness * level * beatGlow;
  float a = clamp(max(out_colour.r, max(out_colour.g, out_colour.b)), 0.0, 1.0);
  fragColor = vec4(min(out_colour, vec3(0.95)), a);
}
