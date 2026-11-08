#version 300 es
// Chladni Sand Layer fragment shader (Slice 7.14, Slice 7.28)
// Settled nodal grains glow warm incandescent gold/white while excited antinode grains
// shimmer electric cyan/amber (uGrainWarmth), scaled by uLayerOpacity.
precision highp float;

in vec2 vHash;
in float vPotential;
in float vNodeDist;
in float vAlpha;

uniform vec3 uColor;        // warm gold/amber base
uniform float uBrightness;
uniform float uGrainWarmth;  // 0..1: cyan vs warm amber
uniform float uLayerOpacity;

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

  // Nodal grains glow warm incandescent gold/white
  vec3 nodalCol = mix(vec3(1.0, 0.86, 0.45), uColor, 0.35);

  // Excited antinode grains shimmer electric cyan/amber based on uGrainWarmth
  vec3 cyanShimmer = vec3(0.12, 0.82, 0.96);
  vec3 amberShimmer = vec3(0.96, 0.52, 0.16);
  vec3 antinodeCol = mix(cyanShimmer, amberShimmer, clamp(uGrainWarmth, 0.0, 1.0));

  // Nodal factor: grains close to nodal line (vNodeDist near 0) glow gold/white
  float nodalFactor = 1.0 - smoothstep(0.02, 0.35, vNodeDist);
  vec3 grainColor = mix(antinodeCol, nodalCol, nodalFactor);

  // Core brightness with grain sparkle
  vec3 col = grainColor * grainShine * uBrightness;
  float alpha = softAlpha * vAlpha * uLayerOpacity;

  fragColor = vec4(col, alpha);
}
