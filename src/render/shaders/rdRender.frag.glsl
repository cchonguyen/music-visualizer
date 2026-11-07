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

  // Coral ridges emerge where chemical V forms structures
  float ridge = smoothstep(0.12, 0.40, vVal);
  float peak = smoothstep(0.35, 0.55, vVal);

  // Embossed neon pink and cobalt palette
  vec3 baseCobalt = uColorCobalt * 0.45;
  vec3 ridgeColor = mix(uColorCobalt, uColorPink, ridge);
  vec3 col = mix(baseCobalt, ridgeColor, ridge);

  // Shading combination: ambient + diffuse
  vec3 shaded = col * (0.35 + 0.65 * diff);

  // Neon glow on ridge peaks
  shaded += uColorPink * (peak * 0.45);

  // Specular highlight
  shaded += vec3(1.0, 0.95, 0.98) * spec * (0.4 + 0.6 * ridge);

  fragColor = vec4(shaded * uBrightness, 1.0);
}
