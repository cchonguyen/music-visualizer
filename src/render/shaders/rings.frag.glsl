#version 300 es
precision highp float;

uniform int uCount;        // number of rings, 0..6
uniform float uNorm;       // mean of norm.sub/mid/high, 0..1 (ring brightness)
uniform float uStroke;     // stroke half-width in UV-height units
uniform float uAspect;     // target width / height
uniform vec3 uBase;        // palette base (background)
uniform vec3 uAccent;      // palette accent B (ring colour)
uniform vec3 uColorA;      // neon cyan
uniform vec3 uColorB;      // neon magenta/pink
uniform float uSides;      // 0 = circles, 3..12 = regular polygons (V3)
uniform float uFilled;     // 0 = outline strokes, 1 = filled shapes (V3)
uniform float uTexOn;      // 1 = band texture on (6.3), 0 = off: output identical to before
uniform float uTexGain;    // 0..2: how strongly the band texture modulates
uniform sampler2D uTexSub; // sub-band row, sampled by angle (stroke brightness)
uniform sampler2D uTexMid; // mid-band row, sampled by ring radius (stroke width)
uniform int uMode;         // 0 = rings, 1 = orbitTriangles (Slice 7.12), 2 = polarGrid (Slice 7.12)
uniform int uSeedMode;     // alias for uMode
uniform float uTime;       // render time in seconds
uniform float uMid;        // mid band norm / energy
uniform float uKick;       // kick pulse / kick env
uniform float uLayerOpacity;

in vec2 vUv;
out vec4 fragColor;

const int MAX_RINGS = 6;
const float TAU = 6.2831853;

float distToSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// 3-tier counter-rotating stained-glass Mandala seed lattice
void orbitTriangles(vec2 p, float time, float kick, out vec3 col, out float alpha) {
  vec3 colA = length(uColorA) > 0.01 ? uColorA : vec3(0.133, 0.827, 0.933);
  vec3 colB = length(uColorB) > 0.01 ? uColorB : (length(uAccent) > 0.01 ? uAccent : vec3(0.910, 0.475, 0.976));

  float r = length(p);
  float width = max(uStroke, 0.0035);

  // --- Tier 1: Inner Star at r = 0.24 ---
  // Counter-rotating at rot1 = time * 0.45
  float rot1 = time * 0.45;
  float c1 = cos(-rot1);
  float s1 = sin(-rot1);
  vec2 p1 = vec2(p.x * c1 - p.y * s1, p.x * s1 + p.y * c1);

  float sector6 = TAU / 6.0;
  float aFold1 = abs(mod(atan(p1.y, p1.x) + sector6 * 0.5, sector6) - sector6 * 0.5);
  vec2 pFold1 = vec2(cos(aFold1), sin(aFold1)) * r;

  float rStarOut = 0.24 * (1.0 + 0.12 * kick);
  float rStarIn  = 0.12 * (1.0 + 0.08 * kick);
  vec2 vStarIn = vec2(cos(TAU / 12.0), sin(TAU / 12.0)) * rStarIn;
  vec2 vStarOut = vec2(rStarOut, 0.0);

  float dStarEdge = distToSegment(pFold1, vStarOut, vStarIn);
  float dHub = abs(r - 0.06 * (1.0 + 0.1 * kick));
  float dSpoke = distToSegment(pFold1, vec2(0.06, 0.0), vStarOut);
  float dStar = min(dStarEdge, min(dHub, dSpoke));
  float inkStar = 1.0 - smoothstep(width * 0.5, width * 1.5, dStar);

  // --- Tier 2: Middle 6-Chevron Diamond Ring at r = 0.56 ---
  // Counter-rotating at rot2 = -time * 0.35
  float rot2 = -time * 0.35;
  float c2 = cos(-rot2);
  float s2 = sin(-rot2);
  vec2 p2 = vec2(p.x * c2 - p.y * s2, p.x * s2 + p.y * c2);

  float aFold2 = abs(mod(atan(p2.y, p2.x) + sector6 * 0.5, sector6) - sector6 * 0.5);
  vec2 pFold2 = vec2(cos(aFold2), sin(aFold2)) * r;

  float rMid = 0.56 * (1.0 + 0.06 * kick);
  float dMidRadial = 0.085 * (1.0 + 0.2 * uMid);
  vec2 vMidOut = vec2(rMid + dMidRadial, 0.0);
  vec2 vMidIn  = vec2(rMid - dMidRadial, 0.0);
  vec2 vMidLat = vec2(rMid * cos(TAU / 24.0), rMid * sin(TAU / 24.0));
  vec2 vChevron = vec2((rMid - 0.02) * cos(sector6 * 0.5), (rMid - 0.02) * sin(sector6 * 0.5));

  float dMidEdge1 = distToSegment(pFold2, vMidOut, vMidLat);
  float dMidEdge2 = distToSegment(pFold2, vMidIn, vMidLat);
  float dMidChev  = distToSegment(pFold2, vMidLat, vChevron);
  float dMidRing  = abs(r - rMid);
  float dDiamonds = min(min(dMidEdge1, dMidEdge2), min(dMidChev, dMidRing));
  float inkDiamonds = 1.0 - smoothstep(width * 0.5, width * 1.5, dDiamonds);

  // --- Tier 3: Outer 12-Ray Crystal Spikes reaching r = 0.98 ---
  // Counter-rotating at rot3 = time * 0.22
  float rot3 = time * 0.22;
  float c3 = cos(-rot3);
  float s3 = sin(-rot3);
  vec2 p3 = vec2(p.x * c3 - p.y * s3, p.x * s3 + p.y * c3);

  float sector12 = TAU / 12.0;
  float aFold3 = abs(mod(atan(p3.y, p3.x) + sector12 * 0.5, sector12) - sector12 * 0.5);
  vec2 pFold3 = vec2(cos(aFold3), sin(aFold3)) * r;

  float rOuter = 0.98 * (1.0 + 0.04 * kick);
  vec2 vSpikeTip = vec2(rOuter, 0.0);
  vec2 vSpikeBase = vec2(0.66 * cos(TAU / 36.0), 0.66 * sin(TAU / 36.0));
  vec2 vSpikeNotch = vec2(0.63, 0.0);
  vec2 vSpikeBridge = vec2(0.66 * cos(sector12 * 0.5), 0.66 * sin(sector12 * 0.5));

  float dSpikeEdge   = distToSegment(pFold3, vSpikeTip, vSpikeBase);
  float dSpikeBase   = distToSegment(pFold3, vSpikeBase, vSpikeNotch);
  float dSpikeSpine  = distToSegment(pFold3, vSpikeNotch, vSpikeTip);
  float dSpikeBridge = distToSegment(pFold3, vSpikeBase, vSpikeBridge);
  float dSpikes = min(min(dSpikeEdge, dSpikeBase), min(dSpikeSpine, dSpikeBridge));
  float inkSpikes = (1.0 - smoothstep(width * 0.5, width * 1.5, dSpikes)) * smoothstep(1.05, 0.98, r);

  // Stained-glass alternating colors:
  // Tier 1 & 3: uColorA (neon cyan)
  // Tier 2: uColorB (neon magenta/pink)
  float inkCyan = max(inkStar, inkSpikes);
  float inkMag = inkDiamonds;

  col = colA * inkCyan + colB * inkMag;
  float totalInk = inkCyan + inkMag;
  if (totalInk > 1.0) {
    col /= totalInk;
  }
  alpha = clamp(max(inkCyan, inkMag), 0.0, 1.0);
}

float orbitTriangles(vec2 p, float time, float kick) {
  vec3 c;
  float a;
  orbitTriangles(p, time, kick, c, a);
  return a;
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

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  int activeMode = (uSeedMode == 1 || uMode == 1) ? 1 : uMode;

  if (activeMode == 1) {
    // Mode 1: orbitTriangles / stained-glass lattice (Preset 02)
    orbitTriangles(p, uTime, uKick, col, alpha);
    col *= texMul;
  } else if (activeMode == 2) {
    // Mode 2: polarGrid (Preset 04)
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
    float ink = max(ringInk, spokeInk) * fade;

    float brightness = 0.6 + 0.4 * clamp(uNorm, 0.0, 1.0);
    col = min(uAccent * brightness * texMul, vec3(0.7));
    alpha = ink;
  } else {
    // Mode 0: concentric rings (default)
    float rr = r;
    if (uSides >= 2.5) {
      float seg = TAU / uSides;
      float a = mod(atan(p.y, p.x), seg) - seg * 0.5;
      rr = r * cos(seg * 0.5) / cos(a);
    }

    float ink = 0.0;
    for (int i = 0; i < MAX_RINGS; i++) {
      if (i >= uCount) break;
      float ringRadius = float(i + 1) / float(uCount + 1) * 0.45;
      float width = uStroke;
      if (uTexOn > 0.5) {
        float midS = textureLod(uTexMid, vec2(clamp(ringRadius / 0.45, 0.0, 1.0), 0.5), 0.0).r;
        width = max(0.0001, uStroke * (1.0 + uTexGain * (midS - 0.5)));
      }
      if (uFilled > 0.5) {
        ink = max(ink, (1.0 - smoothstep(ringRadius - width, ringRadius, rr)) * 0.35);
      } else {
        float d = abs(rr - ringRadius);
        ink = max(ink, 1.0 - smoothstep(width * 0.5, width, d));
      }
    }

    float brightness = 0.6 + 0.4 * clamp(uNorm, 0.0, 1.0);
    col = min(uAccent * brightness * texMul, vec3(0.7));
    alpha = ink;
  }

  if (alpha <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  float layerOp = uLayerOpacity > 0.0 ? uLayerOpacity : 1.0;
  fragColor = vec4(col * layerOp, clamp(alpha, 0.0, 1.0) * layerOp);
}
