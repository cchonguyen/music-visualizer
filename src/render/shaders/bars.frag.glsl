#version 300 es
precision highp float;

uniform sampler2D uBars;     // one-row R32F texture, BAR_COUNT values (0..1)
uniform vec3 uBase;          // palette base (background)
uniform vec3 uAccentA;       // palette accent A (left bars)
uniform vec3 uAccentB;       // palette accent B (right bars)
uniform float uTexOn;        // 1 = band texture on (6.3), 0 = off: output identical to before
uniform float uTexGain;      // 0..2: how strongly the band texture modulates
uniform sampler2D uTexMid;   // mid-band row, sampled by bar index (bar height)
uniform sampler2D uTexHigh;  // high-band row, sampled by bar index (bar brightness)

in vec2 vUv;
out vec4 outColor;

const float BAR_COUNT = 48.0;

void main() {
  float x = clamp(vUv.x, 0.0, 0.999999);
  float barIndex = floor(x * BAR_COUNT);
  float barU = (barIndex + 0.5) / BAR_COUNT;
  float height = texture(uBars, vec2(barU, 0.5)).r;

  // Band texture (6.3): mid scales the bar height, high scales the brightness (1.0 when off).
  float brightMul = 1.0;
  if (uTexOn > 0.5) {
    float midS = texture(uTexMid, vec2(barU, 0.5)).r;
    float highS = texture(uTexHigh, vec2(barU, 0.5)).r;
    height = clamp(height * (1.0 + uTexGain * (midS - 0.5)), 0.0, 1.0);
    brightMul = max(0.0, 1.0 + uTexGain * (highS - 0.5));
  }

  // Gap between bars: the first 8% of each bar's width is left dark.
  float inBar = fract(x * BAR_COUNT) > 0.08 ? 1.0 : 0.0;
  // Lit from the bottom up to 80% of the bar's height.
  float lit = (vUv.y < height * 0.8 && inBar > 0.5) ? 1.0 : 0.0;

  vec3 bar = mix(uAccentA, uAccentB, x) * 0.7 * brightMul;
  vec3 col = mix(uBase, bar, lit);
  // Keep the bars dim: never above 0.7 per channel.
  col = min(col, vec3(0.7));
  outColor = vec4(col, 1.0);
}
