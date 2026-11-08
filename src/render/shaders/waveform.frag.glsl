#version 300 es
precision highp float;

in float vEdge;
in float vPathU;

uniform float uAlpha;        // legacy crossfade alpha
uniform float uLayerOpacity; // layer opacity
uniform vec2 uRes;           // target size in pixels (maps fragments to clip space)
uniform highp int uMode;     // 0 = line across the screen, 1 = closed circle, 2 = star7, 3 = lissajous
uniform float uAspect;       // width / height (undoes the circle's aspect scale)
uniform float uTexOn;        // 1 = band texture on, 0 = off: output identical to before
uniform float uTexGain;      // 0..2: how strongly the band texture modulates
uniform sampler2D uTexHigh;  // high-band row
uniform sampler2D uWave;     // raw waveform R32F texture
uniform int uColorMode;      // 0 = 'white', 1 = 'palette', 2 = 'gradient'
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uTime;

out vec4 fragColor;

const float TAU = 6.283185307179586;

void main() {
  float u = clamp(vPathU, 0.0, 1.0);

  // Band texture (6.4): high band scales the line brightness (1.0 when off).
  float texMul = 1.0;
  if (uTexOn > 0.5) {
    float highS = texture(uTexHigh, vec2(clamp(u, 0.0, 1.0), 0.5)).r;
    texMul = max(0.0, 1.0 + uTexGain * (highS - 0.5));
  }

  // Audio displacement amplitude at current path position
  float s = texture(uWave, vec2(clamp(u, 0.0, 1.0), 0.5)).r;
  float amp = clamp(abs(s), 0.0, 1.0);

  vec3 col;
  if (uColorMode == 0) {
    // Mode 0: 'white' (keep current behavior)
    col = vec3(clamp(0.95 * texMul, 0.0, 1.0));
  } else if (uColorMode == 1) {
    // Mode 1: 'palette' (blend uColorA and uColorB along the waveform path)
    float mixFactor = clamp(u + (amp - 0.5) * 0.35, 0.0, 1.0);
    vec3 palCol = mix(uColorA, uColorB, mixFactor);
    col = clamp(palCol * (0.85 + 0.3 * amp) * texMul, 0.0, 1.0);
  } else {
    // Mode 2: 'gradient'
    // Map low audio amplitudes to electric cyan/cobalt vec3(0.08, 0.78, 1.0)
    // and high-energy peaks to fiery orange/magenta vec3(1.0, 0.32, 0.65)
    // with a white-hot core so Curl fluid warp plumes billow with multi-color ink
    vec3 lowCol = vec3(0.08, 0.78, 1.0);
    vec3 peakCol = vec3(1.0, 0.32, 0.65);
    vec3 whiteHot = vec3(1.0, 1.0, 1.0);

    float t = smoothstep(0.12, 0.75, amp);
    vec3 gradCol = mix(lowCol, peakCol, t);
    float coreG = smoothstep(0.68, 0.98, amp);
    col = clamp(mix(gradCol, whiteHot, coreG * 0.75) * texMul, 0.0, 1.0);
  }

  // Anti-aliased cross-section profile
  float dist = abs(vEdge);
  float core = exp(-dist * dist * 4.5);
  float halo = smoothstep(1.0, 0.0, dist) * 0.55;
  float profile = clamp(core + halo, 0.0, 1.0);

  float layerOp = uLayerOpacity > 0.0 ? uLayerOpacity : (uAlpha > 0.0 ? uAlpha : uLayerOpacity);
  col *= profile * layerOp;
  fragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0));
}
