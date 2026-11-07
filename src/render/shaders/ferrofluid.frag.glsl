#version 300 es
// FerrofluidLayer fragment shader (Slice 7.15)
// Procedural studio MatCap Chrome reflection gradient mapped to (vNormal.x, vNormal.y)
// + high-contrast cyan/amber Fresnel Rim Halo pow(1.0 - max(dot(V, vNormal), 0.0), 3.0).
precision highp float;

in vec3 vNormal;    // View-space surface normal
in vec3 vView;      // View-space direction to eye
in float vSpike;    // Local spike displacement
in vec3 vLocalPos;

uniform float uBrightness;
uniform float uFresnelGain;
uniform float uLayerOpacity;

out vec4 outColor;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vView);

  // View-space normal projection for MatCap Chrome reflection
  vec2 matcapUv = N.xy * 0.5 + 0.5;

  // 1. Procedural Studio MatCap Chrome reflections:
  // Overhead key softbox light reflection
  vec2 dKey = (matcapUv - vec2(0.58, 0.72)) * vec2(1.3, 2.8);
  float keyLight = exp(-35.0 * dot(dKey, dKey));

  // Secondary fill rim reflection
  vec2 dFill = (matcapUv - vec2(0.32, 0.28)) * vec2(2.2, 1.2);
  float fillLight = exp(-45.0 * dot(dFill, dFill));

  // Studio horizon reflection band
  float horizonBand = exp(-28.0 * N.y * N.y) * 0.45;

  // Chrome metallic zebra striping (studio environment reflections)
  float zebra = sin(N.y * 11.0 + N.x * 5.0);
  float zebraReflect = pow(clamp(0.5 + 0.5 * zebra, 0.0, 1.0), 5.0) * 0.35;

  // Specular sheen on sharp spike tips
  float tipGleam = pow(clamp(N.z * 0.5 + 0.5, 0.0, 1.0), 8.0) * 0.25;

  // Obsidian / deep glossy black magnetite base fluid
  vec3 fluidBase = vec3(0.025, 0.03, 0.04);

  // Chrome specular highlight composite
  vec3 chromeSpec = vec3(0.94, 0.97, 1.0) * (keyLight * 2.2 + fillLight * 1.1 + horizonBand + zebraReflect + tipGleam);
  vec3 matcapChrome = fluidBase + chromeSpec;

  // 2. High-contrast Cyan / Amber Fresnel Rim Halo:
  float NdotV = max(dot(V, N), 0.0);
  float fresnel = pow(1.0 - NdotV, 3.0);

  // Dynamic cyan/amber split along rim orientation
  float rimGradient = clamp(0.5 + 0.5 * (N.y * 0.85 + N.x * 0.55), 0.0, 1.0);
  vec3 cyanColor = vec3(0.06, 0.90, 0.98);
  vec3 amberColor = vec3(1.0, 0.58, 0.08);
  vec3 rimColor = mix(cyanColor, amberColor, rimGradient);

  vec3 fresnelHalo = rimColor * (fresnel * uFresnelGain * 2.2);

  // 3. Composite color and alpha
  vec3 finalColor = (matcapChrome + fresnelHalo) * uBrightness;
  float alpha = clamp(uLayerOpacity * mix(0.92, 1.0, fresnel), 0.0, 1.0);

  outColor = vec4(finalColor, alpha);
}
