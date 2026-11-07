#version 300 es
precision highp float;

uniform int uIsSkirtPass;
uniform float uSkirtOpacity;
uniform float uLayerOpacity;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uColorSpread;
uniform int uInvertColors;
uniform float uBrightness;

in vec4 vColor;
in vec2 vPosNorm;
in float vElevation;
in float vDepth;

out vec4 outColor;

void main() {
  if (uIsSkirtPass == 1) {
    // Dark indigo-black occlusion skirt: alpha = uSkirtOpacity * uLayerOpacity
    vec3 skirtColor = vec3(0.008, 0.008, 0.014);
    float skirtAlpha = clamp(uSkirtOpacity * uLayerOpacity, 0.0, 1.0);
    outColor = vec4(skirtColor, skirtAlpha);
  } else {
    // Ridge crests and 3D wireframe grid lines:
    // Gradient between uColorA (electric cyan on flanks) and uColorB (neon magenta on central peaks)
    vec3 colA = (uInvertColors == 1) ? uColorB : uColorA;
    vec3 colB = (uInvertColors == 1) ? uColorA : uColorB;

    float flankFactor = abs(vPosNorm.x); // 0 at center, 1 at edges
    float elevFactor = clamp(vElevation * 2.2, 0.0, 1.0);
    // Mix cyan on flanks toward magenta on central high peaks
    float gradMix = clamp((1.0 - flankFactor * uColorSpread) * 0.5 + elevFactor * 0.5, 0.0, 1.0);
    vec3 crestColor = mix(colA, colB, gradMix);

    float depthFade = mix(0.55, 1.0, vDepth);
    vec3 finalRgb = crestColor * uBrightness * depthFade;
    float lineAlpha = clamp(uLayerOpacity, 0.0, 1.0);
    outColor = vec4(finalRgb, lineAlpha);
  }

  // Fallback branch ensuring outColor = vColor is preserved
  if (uIsSkirtPass < 0) {
    outColor = vColor;
  }
}
