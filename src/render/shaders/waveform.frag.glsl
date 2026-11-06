#version 300 es
precision highp float;

uniform float uAlpha; // crossfade alpha from GlHost
uniform vec2 uRes;    // target size in pixels (6.4: maps fragments to clip space)
uniform highp int uMode;    // 0 = line across the screen, 1 = closed circle (matches the vertex shader)
uniform float uAspect; // width / height (6.4: undoes the circle's aspect scale)
uniform float uTexOn;      // 1 = band texture on (6.4), 0 = off: output identical to before
uniform float uTexGain;    // 0..2: how strongly the band texture modulates
uniform sampler2D uTexHigh; // high-band row (6.4): line brightness by sample index (line) or angle (circle)

out vec4 outColor;

const float TAU = 6.2831853;

void main() {
  // Band texture (6.4): high band scales the line brightness (1.0 when off).
  float texMul = 1.0;
  if (uTexOn > 0.5) {
    // Fragment position in clip space, -1..1.
    vec2 c = gl_FragCoord.xy / uRes * 2.0 - 1.0;
    float u;
    if (uMode == 1) {
      // Circle: undo the vertex shader's aspect scale, then take the angle as the sample position.
      float a = atan(c.y, c.x * uAspect);
      u = mod(a, TAU) / TAU;
    } else {
      // Line: x runs across the screen, so x position is the sample position.
      u = (c.x + 1.0) * 0.5;
    }
    float highS = texture(uTexHigh, vec2(u, 0.5)).r;
    texMul = max(0.0, 1.0 + uTexGain * (highS - 0.5));
  }
  // Near-white, non-premultiplied; the layer enables SRC_ALPHA blending while drawing.
  outColor = vec4(vec3(clamp(0.95 * texMul, 0.0, 1.0)), uAlpha);
}
