#version 300 es
// FerrofluidLayer fragment shader (Slice 7.15, Slice 7.36)
// Procedural studio MatCap Chrome reflection gradient mapped to (vNormal.x, vNormal.y)
// + palette-infused metallic body + high-contrast Fresnel Rim Halo pow(1.0 - NdotV, 3.0)
// and Reinhard highlight roll-off.
precision highp float;

in vec3 vNormal;    // View-space surface normal
in vec3 vView;      // View-space direction to eye
in float vSpike;    // Local spike displacement
in float vHeight;   // Local surface height above base
in vec3 vLocalPos;

uniform float uBrightness;
uniform float uFresnelGain;
uniform float uLayerOpacity;
uniform vec3 uColorPrimary;
uniform vec3 uColorSecondary;

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

  // 2. Color palette infusion into metallic body & midtones:
  float NdotV = max(dot(V, N), 0.0);
  float fresnel = pow(1.0 - NdotV, 3.0);

  // Dynamic cyan/amber split along normal orientation & curvature
  float rimGradient = clamp(0.5 + 0.5 * (N.y * 0.85 + N.x * 0.55), 0.0, 1.0);
  vec3 rimColor = mix(uColorPrimary, uColorSecondary, rimGradient);

  // Body tint modulated by surface curvature vHeight and normal angle
  float heightMix = clamp(vHeight * 3.5, 0.0, 1.0);
  vec3 bodyTint = mix(uColorPrimary, uColorSecondary, clamp(0.5 + 0.5 * N.y + 0.25 * sin(vHeight * 8.0), 0.0, 1.0));

  // Obsidian magnetite base infused with deep subtle palette tone
  vec3 fluidBase = vec3(0.02, 0.025, 0.035) + bodyTint * (0.07 + 0.14 * heightMix * (1.0 - NdotV * 0.5));

  // Midtone reflections infused with iridescent metallic sheen
  float midtoneSheen = keyLight * 0.55 + fillLight * 0.75 + horizonBand * 0.65 + zebraReflect * 0.45;
  vec3 midtoneTint = mix(bodyTint, rimColor, 0.35) * midtoneSheen * 1.2;

  // Specular highlights
  vec3 chromeSpec = vec3(0.95, 0.97, 1.0) * (keyLight * 2.2 + fillLight * 0.55 + tipGleam * 1.2);

  vec3 matcapChrome = fluidBase + midtoneTint + chromeSpec;

  // High-contrast Fresnel rim halo
  vec3 fresnelHalo = rimColor * (fresnel * uFresnelGain * 2.2);

  // Composite raw color
  vec3 rawColor = (matcapChrome + fresnelHalo) * uBrightness;

  // Smooth Reinhard-style highlight roll-off so specular peaks stay rich and iridescent
  vec3 col = rawColor / (1.0 + rawColor * 0.45) * 1.25;

  float alpha = clamp(uLayerOpacity * mix(0.92, 1.0, fresnel), 0.0, 1.0);
  outColor = vec4(col, alpha);
}
