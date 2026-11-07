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
uniform int uMode;         // 0 = rings, 1 = orbitTriangles (Slice 7.12), 2 = polarGrid (Slice 7.12)
uniform float uTime;       // render time in seconds
uniform float uMid;        // mid band norm / energy

in vec2 vUv;
out vec4 outColor;

const int MAX_RINGS = 6;
const float TAU = 6.2831853;

float distToSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  // Centred, aspect-correct coordinates: rings stay circular on any canvas.
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(p);

  // Band texture (6.3): sub by angle sets the stroke brightness (1.0 when off).
  float texMul = 1.0;
  if (uTexOn > 0.5) {
    float subS = texture(uTexSub, vec2(atan(p.y, p.x) / TAU + 0.5, 0.5)).r;
    texMul = max(0.0, 1.0 + uTexGain * (subS - 0.5));
  }

  float ink = 0.0;

  if (uMode == 1) {
    // Mode 1: orbitTriangles (Preset 02)
    // 3 wireframe triangles orbiting at radius 0.4, scaled by u_mid
    float triScale = 0.08 + 0.14 * clamp(uMid, 0.0, 1.0);
    float width = max(uStroke, 0.003);
    for (int k = 0; k < 3; k++) {
      float orbitAngle = float(k) * (TAU / 3.0) + uTime * 0.75;
      vec2 center = vec2(cos(orbitAngle), sin(orbitAngle)) * 0.4;
      vec2 tp = p - center;
      float rot = -orbitAngle * 1.5;
      vec2 v0 = vec2(cos(rot), sin(rot)) * triScale;
      vec2 v1 = vec2(cos(rot + TAU / 3.0), sin(rot + TAU / 3.0)) * triScale;
      vec2 v2 = vec2(cos(rot + 2.0 * TAU / 3.0), sin(rot + 2.0 * TAU / 3.0)) * triScale;
      float d0 = distToSegment(tp, v0, v1);
      float d1 = distToSegment(tp, v1, v2);
      float d2 = distToSegment(tp, v2, v0);
      float d = min(d0, min(d1, d2));
      ink = max(ink, 1.0 - smoothstep(width * 0.5, width * 1.5, d));
    }
  } else if (uMode == 2) {
    // Mode 2: polarGrid (Preset 04)
    // Soft polar grid option
    float width = max(uStroke, 0.002);
    float ringSpacing = 0.08;
    float dR = abs(mod(r + ringSpacing * 0.5, ringSpacing) - ringSpacing * 0.5);
    float ringInk = 1.0 - smoothstep(width * 0.5, width * 1.8, dR);

    float numSpokes = 12.0;
    float thetaSpacing = TAU / numSpokes;
    float theta = atan(p.y, p.x);
    float dTheta = r * abs(mod(theta + thetaSpacing * 0.5, thetaSpacing) - thetaSpacing * 0.5);
    float spokeInk = 1.0 - smoothstep(width * 0.5, width * 1.8, dTheta);

    float fade = smoothstep(0.9, 0.1, r);
    ink = max(ringInk, spokeInk) * fade;
  } else {
    // Mode 0: concentric rings (default)
    float rr = r;
    if (uSides >= 2.5) {
      float seg = TAU / uSides;
      float a = mod(atan(p.y, p.x), seg) - seg * 0.5;
      rr = r * cos(seg * 0.5) / cos(a);
    }

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
