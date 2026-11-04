#version 300 es
precision highp float;

uniform int uCount;        // number of rings, 0..6
uniform float uNorm;       // mean of norm.sub/mid/high, 0..1 (ring brightness)
uniform float uStroke;     // stroke half-width in UV-height units
uniform float uAspect;     // target width / height
uniform vec3 uBase;        // palette base (background)
uniform vec3 uAccent;      // palette accent B (ring colour)

in vec2 vUv;
out vec4 outColor;

const int MAX_RINGS = 6;

void main() {
  // Centred, aspect-correct coordinates: rings stay circular on any canvas.
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(p);

  float ink = 0.0;
  for (int i = 0; i < MAX_RINGS; i++) {
    if (i >= uCount) break;
    // Ring i sits at (i+1)/(count+1) * 0.45 of the half-height.
    float ringRadius = float(i + 1) / float(uCount + 1) * 0.45;
    float d = abs(r - ringRadius);
    ink = max(ink, 1.0 - smoothstep(uStroke * 0.5, uStroke, d));
  }

  // Louder norm makes the strokes a little brighter; the ceiling keeps them dim.
  float brightness = 0.6 + 0.4 * clamp(uNorm, 0.0, 1.0);
  vec3 col = mix(uBase, uAccent * brightness, ink);
  // Keep the rings dim: never above 0.7 per channel.
  col = min(col, vec3(0.7));
  outColor = vec4(col, 1.0);
}
