#version 300 es
precision highp float;

uniform sampler2D uBars;     // one-row R32F texture, BAR_COUNT values (0..1)
uniform vec3 uBase;          // palette base (background)
uniform vec3 uAccentA;       // palette accent A (left bars)
uniform vec3 uAccentB;       // palette accent B (right bars)

in vec2 vUv;
out vec4 outColor;

const float BAR_COUNT = 48.0;

void main() {
  float x = clamp(vUv.x, 0.0, 0.999999);
  float barIndex = floor(x * BAR_COUNT);
  float height = texture(uBars, vec2((barIndex + 0.5) / BAR_COUNT, 0.5)).r;

  // Gap between bars: the first 8% of each bar's width is left dark.
  float inBar = fract(x * BAR_COUNT) > 0.08 ? 1.0 : 0.0;
  // Lit from the bottom up to 80% of the bar's height.
  float lit = (vUv.y < height * 0.8 && inBar > 0.5) ? 1.0 : 0.0;

  vec3 bar = mix(uAccentA, uAccentB, x) * 0.7;
  vec3 col = mix(uBase, bar, lit);
  // Keep the bars dim: never above 0.7 per channel.
  col = min(col, vec3(0.7));
  outColor = vec4(col, 1.0);
}
