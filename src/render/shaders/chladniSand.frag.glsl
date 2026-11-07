#version 300 es
// Chladni Sand Layer fragment shader (Slice 7.14)
// Renders grains as warm gold/amber circular points with subtle sparkle variation.
precision highp float;

in vec2 vHash;
in float vPotential;
in float vAlpha;

uniform vec3 uColor;       // warm gold/amber
uniform float uBrightness;

out vec4 fragColor;

void main() {
  // Circular point sprite
  vec2 coord = gl_PointCoord - vec2(0.5);
  float r = length(coord);
  if (r > 0.5) {
    discard;
  }
  float softAlpha = 1.0 - smoothstep(0.2, 0.5, r);

  // Subtle grain sparkle variation from seed hash
  float grainShine = mix(0.85, 1.25, vHash.x);

  // Core brightness with warm gold/amber tint
  vec3 col = uColor * grainShine * uBrightness;

  fragColor = vec4(col, softAlpha * vAlpha);
}
