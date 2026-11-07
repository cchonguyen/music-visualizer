#version 300 es
precision highp float;

uniform int uCount;        // number of rings, 0..6
uniform float uNorm;       // mean of norm.sub/mid/high, 0..1 (ring brightness)
uniform float uStroke;     // stroke half-width in UV-height units
uniform float uAspect;     // target width / height
uniform vec3 uBase;        // palette base (background)
uniform vec3 uAccent;      // palette accent B (ring colour)
uniform float uSides;      // 0 = circles, 3..12 = regular polygons (V3)
uniform float uFilled;     // 0 = outline strokes, 1 = filled shapes (V3)
uniform float uTexOn;      // 1 = band texture on (6.3), 0 = off: output identical to before
uniform float uTexGain;    // 0..2: how strongly the band texture modulates
uniform sampler2D uTexSub; // sub-band row, sampled by angle (stroke brightness)
uniform sampler2D uTexMid; // mid-band row, sampled by ring radius (stroke width)

in vec2 vUv;
out vec4 outColor;

const int MAX_RINGS = 6;
const float TAU = 6.2831853;

void main() {
  // Centred, aspect-correct coordinates: rings stay circular on any canvas.
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(p);
  // Shape distance: the circle radius, or the polygon's edge distance for uSides 3..12.
  float rr = r;
  if (uSides >= 2.5) {
    float seg = TAU / uSides;
    float a = mod(atan(p.y, p.x), seg) - seg * 0.5;
    rr = r * cos(seg * 0.5) / cos(a);
  }

  // Band texture (6.3): sub by angle sets the stroke brightness (1.0 when off).
  float texMul = 1.0;
  if (uTexOn > 0.5) {
    float subS = texture(uTexSub, vec2(atan(p.y, p.x) / TAU + 0.5, 0.5)).r;
    texMul = max(0.0, 1.0 + uTexGain * (subS - 0.5));
  }

  float ink = 0.0;
  for (int i = 0; i < MAX_RINGS; i++) {
    if (i >= uCount) break;
    // Ring i sits at (i+1)/(count+1) * 0.45 of the half-height.
    float ringRadius = float(i + 1) / float(uCount + 1) * 0.45;
    // Band texture (6.3): mid sets this ring's stroke width by its radius (uStroke when off).
    float width = uStroke;
    if (uTexOn > 0.5) {
      float midS = textureLod(uTexMid, vec2(clamp(ringRadius / 0.45, 0.0, 1.0), 0.5), 0.0).r;
      width = max(0.0001, uStroke * (1.0 + uTexGain * (midS - 0.5)));
    }
    if (uFilled > 0.5) {
      // Filled: each ring fills its shape at a dim level, so the rings stack into a solid pattern.
      ink = max(ink, (1.0 - smoothstep(ringRadius - width, ringRadius, rr)) * 0.35);
    } else {
      float d = abs(rr - ringRadius);
      ink = max(ink, 1.0 - smoothstep(width * 0.5, width, d));
    }
  }

  if (ink <= 0.0) {
    outColor = vec4(0.0);
    return;
  }

  // Louder norm makes the strokes a little brighter; the ceiling keeps them dim.
  float brightness = 0.6 + 0.4 * clamp(uNorm, 0.0, 1.0);
  vec3 col = min(uAccent * brightness * texMul, vec3(0.7));
  outColor = vec4(col, ink);
}
