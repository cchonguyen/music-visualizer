#version 300 es
precision highp float;

uniform int uShape;        // 0 dot, 1 ring, 2 diamond
uniform float uBrightness;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uLayerOpacity;
uniform float uDepth;

in float vNear;
in float vMix;
out vec4 fragColor;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float mask;
  if (uShape == 1) {
    float d = length(c);
    mask = smoothstep(0.55, 0.7, d) * (1.0 - smoothstep(0.88, 1.0, d));
  } else if (uShape == 2) {
    float d = abs(c.x) + abs(c.y);
    mask = 1.0 - smoothstep(0.8, 1.0, d);
  } else {
    float d = length(c);
    mask = 1.0 - smoothstep(0.55, 1.0, d);
  }
  // Far bodies are dimmer, scaled by the depth setting.
  float dim = mix(1.0, 0.35 + 0.65 * vNear, uDepth);
  vec3 col = mix(uColorA, uColorB, vMix) * uBrightness * dim;
  float a = clamp(mask, 0.0, 1.0) * uLayerOpacity;
  fragColor = vec4(col * a, a);
}
