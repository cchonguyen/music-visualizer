#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uColorPink;
uniform vec3 uColorCobalt;
uniform float uBrightness;
uniform float uSpecular;
uniform float uLayerOpacity;

void main() {
  // Sample state texture linearly
  vec4 state = texture(uState, vUv);
  float uVal = state.r;
  float vVal = state.g;

  // Compute surface normals from V gradients using screen-space derivatives
  float dv_dx = dFdx(vVal);
  float dv_dy = dFdy(vVal);

  float bumpScale = 45.0;
  vec3 normal = normalize(vec3(-dv_dx * bumpScale, -dv_dy * bumpScale, 1.0));

  // Lighting directions
  vec3 lightDir = normalize(vec3(-0.5, 0.6, 1.0));
  vec3 viewDir = vec3(0.0, 0.0, 1.0);

  // Diffuse shading
  float diff = max(dot(normal, lightDir), 0.0);

  // Specular Blinn-Phong highlight
  vec3 halfVec = normalize(lightDir + viewDir);
  float specAngle = max(dot(normal, halfVec), 0.0);
  float spec = pow(specAngle, 28.0) * uSpecular;

  // Rich 3-stop gradient:
  // dark transparent background (vVal < 0.06)
  // uColorCobalt along the outer coral troughs/slopes (smoothstep(0.05, 0.24, vVal))
  // uColorPink on the active growing ridge crests (smoothstep(0.22, 0.42, vVal))
  float trough = smoothstep(0.05, 0.24, vVal);
  float crest = smoothstep(0.22, 0.42, vVal);

  vec3 baseCobalt = uColorCobalt * 0.45;
  vec3 col = mix(baseCobalt, uColorCobalt, trough);
  col = mix(col, uColorPink, crest);

  // Shading combination: ambient + diffuse
  vec3 shaded = col * (0.35 + 0.65 * diff);

  // 3D normal specular highlight
  shaded += vec3(1.0, 0.95, 0.98) * spec * (0.3 + 0.7 * crest);

  shaded *= uBrightness;

  // Multiply output col *= mask * uLayerOpacity where mask = smoothstep(0.03, 0.12, vVal)
  // so empty chemical background (vVal ≈ 0) is transparent (alpha = 0) and layers cleanly with trails
  float mask = smoothstep(0.03, 0.12, vVal);
  float effectiveAlpha = mask * uLayerOpacity;
  shaded *= effectiveAlpha;

  fragColor = vec4(shaded, effectiveAlpha);
}
