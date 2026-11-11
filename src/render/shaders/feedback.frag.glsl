#version 300 es
precision highp float;

// Feedback warp overhaul (Slice 7.22): Multi-octave Simplex curl (4 flow styles),
// mirror-continuous mandala with radial fold & wallpaper tiling,
// dynamic wandering Möbius dipole flow, and luminance-gated topographic solarize.
uniform sampler2D uPrev;

// The trail buffer may be half-float (Slice 16.7), where values can pass 1. Reading it clamped to 0..1 keeps the
// loop exactly as it was with 8-bit buffers (which clamp on every write), with finer steps between 0 and 1.
vec4 prevTex(vec2 uv) {
  return min(texture(uPrev, uv), vec4(1.0));
}
uniform vec2 uCentre;     // centre of zoom and rotate, in uv (0,0 = screen middle)
uniform vec2 uDrift;      // slide per 1/60 s, in uv (scaled by uDt)
uniform vec2 uStretch;    // stretch per axis (1 = none)
uniform float uZoom;      // > 1 pushes trails outward, per 1/60 s
uniform float uRot;       // radians per 1/60 s
uniform float uWarp;      // wave amount
uniform float uWarpScale; // wave count across the screen
uniform float uWarpSpeed; // wave speed
uniform float uTime;      // render clock, seconds
uniform float uDt;        // clamped time step, seconds (Slice 14.6)
uniform float uAspect;    // width / height, keeps rotation round
uniform float uWrap;      // 0 = clamp at the edge, 1 = wrap around
uniform float uHueDrift;  // hue rotation per frame, radians
uniform float uBlur;      // 0..1 mix toward a 5-tap blur
uniform vec2 uTexel;      // 1 / size in pixels
uniform float uDecay;     // persistence per 1/60 s (applied as pow(decay, dt * 60))
uniform float uFade;      // subtracted per 1/60 s

// Slice 7.11 / 7.22 uniforms:
uniform int uWarpMode;          // 0: classic, 1: curl, 2: polarFold, 3: mobius, 4: rgbSplit
uniform float uKaleidoN;        // 4..16, default 6
uniform float uPortalRadius;    // 0.0..0.25, default 0.0
uniform float uRgbSplit;        // 0.0..0.08, default 0.0
uniform vec3 uDecayRgb;         // default vec3(1.0, 1.0, 1.0)
uniform float uSobel;           // 0.0..1.0, default 0.0
uniform float uSolarize;        // 0.0..1.0, default 0.0
uniform float uSolarizePhase;   // phase modulation for solarize
uniform float uMobiusPoleOffset;// 0.2..0.85, default 0.48
uniform float uWarpAmp;         // warp amplitude

// Slice 7.22 uniforms:
uniform int uCurlOctaves;       // 1..3, default 2
uniform float uCurlTurbulence;  // 0.0..1.0, default 0.45
uniform int uCurlFlowPattern;   // 0: plumes, 1: eddies, 2: outflow, 3: inflow

uniform float uRadialFold;      // 0.0..1.0, default 0.0
uniform float uMandalaTile;     // 0.0..1.0, default 0.0
uniform float uMandalaCounterSpin; // -1.0..1.0, default 0.25
uniform float uMandalaKickFlare;// 0.0..1.0, default 0.35

uniform float uContourFreq;     // 2.0..16.0, default 7.85
uniform float uContourWidth;    // 0.1..1.0, default 0.45
uniform float uColorSpread;     // 0.0..1.0, default 0.65

uniform vec2 uMobiusPoleA;      // live moving pole A
uniform vec2 uMobiusPoleB;      // live moving pole B
uniform float uMobiusFlow;      // 0.0..2.0, default 0.85
uniform float uMobiusSwirl;     // -2.0..2.0, default 0.65
uniform int uMobiusMode;        // 0: auto, 1: dipoleFlow, 2: doubleVortex, 3: figureEight, 4: breathingOrbit

// Audio modulation uniforms:
uniform float uHigh;

// Warp field (Slice 18.2): a small texture of displacement drawn from the preset's operator stack.
// uWarpFieldOn is 0 when the stack is empty, and then the lookup is skipped (the picture is as before).
uniform sampler2D uField;
uniform float uWarpFieldOn;

in vec2 vUv;
out vec4 outColor;

const float PI = 3.141592653589793;
const float TWO_PI = 6.283185307179586;

// Rotates colour around the grey axis (hue shift that keeps brightness). Angle 0 = no change.
vec3 hueRotate(vec3 c, float a) {
  vec3 k = vec3(0.57735);
  float cs = cos(a);
  float sn = sin(a);
  return c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs);
}

// 2D rotation matrix
mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}

// 5-tap neighborhood blur of previous frame
vec3 blurPrev(vec2 coord, float blurAmount) {
  vec3 base = prevTex( coord).rgb;
  vec3 neighbors = prevTex( coord + vec2(uTexel.x, 0.0) * 1.5).rgb
                 + prevTex( coord - vec2(uTexel.x, 0.0) * 1.5).rgb
                 + prevTex( coord + vec2(0.0, uTexel.y) * 1.5).rgb
                 + prevTex( coord - vec2(0.0, uTexel.y) * 1.5).rgb;
  return mix(base, (base + neighbors) * 0.2, blurAmount);
}

// 2D Simplex Noise (Ian McEwan, Ashima Arts)
vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187,
                      0.366025403784439,
                     -0.577350269189626,
                      0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
        + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// Retain curlField helper
vec2 curlField(vec2 pos, float t, float scale) {
  float s = scale * TWO_PI;
  float dpsi_dy = -s * sin(s * pos.x + t) * sin(s * pos.y + t) + s * cos(2.0 * s * pos.y + 0.7 * t) * cos(2.0 * s * pos.x - 0.5 * t);
  float dpsi_dx =  s * cos(s * pos.x + t) * cos(s * pos.y + t) - s * sin(2.0 * s * pos.y + 0.7 * t) * sin(2.0 * s * pos.x - 0.5 * t);
  return vec2(dpsi_dy, -dpsi_dx);
}

// Time-varying potential field blending two counter-rotating layers
float curlPotential(vec2 p, float t) {
  vec2 p1 = rot2(t * 0.18) * p;
  vec2 p2 = rot2(-t * 0.14) * p + vec2(sin(t * 0.35), cos(t * 0.29)) * 1.4;
  return snoise(p1) * 0.55 + snoise(p2) * 0.45;
}

// Multi-octave Simplex stream-function curl noise
vec2 curlNoise(vec2 pos, float t, int octaves, float turbulence, float high) {
  vec2 vel = vec2(0.0);
  float freq = 1.0;
  float amp = 1.0;
  float eps = 0.01;
  float turbWeight = turbulence * (0.5 + high * 0.8);

  for (int i = 0; i < 3; i++) {
    if (i >= octaves) break;
    float weight = (i == 0) ? 1.0 : turbWeight * amp;
    vec2 p = pos * freq;
    float ti = t * (0.6 + 0.4 * float(i + 1));
    float n1 = curlPotential(p + vec2(0.0, eps), ti);
    float n2 = curlPotential(p - vec2(0.0, eps), ti);
    float n3 = curlPotential(p + vec2(eps, 0.0), ti);
    float n4 = curlPotential(p - vec2(eps, 0.0), ti);
    vec2 c = vec2((n1 - n2) / (2.0 * eps), -(n3 - n4) / (2.0 * eps));
    vel += c * weight;
    freq *= 2.1;
    amp *= 0.5;
  }
  return vel;
}

// Complex arithmetic helpers for Möbius dipole step
vec2 cMul(vec2 c1, vec2 c2) {
  return vec2(c1.x * c2.x - c1.y * c2.y, c1.x * c2.y + c1.y * c2.x);
}

vec2 cDiv(vec2 c1, vec2 c2) {
  float d = max(dot(c2, c2), 1e-7);
  return vec2(c1.x * c2.x + c1.y * c2.y, c1.y * c2.x - c1.x * c2.y) / d;
}

vec2 cLog(vec2 z) {
  float r = max(length(z), 1e-7);
  return vec2(log(r), atan(z.y, z.x));
}

vec2 cExp(vec2 w) {
  float r = exp(clamp(w.x, -12.0, 12.0));
  return vec2(r * cos(w.y), r * sin(w.y));
}

void main() {
  // Rates are authored per 1/60 s. tick is 1.0 at 60 Hz, 0.5 at 120 Hz.
  float tick = max(uDt * 60.0, 1e-4);
  float zoom = pow(max(uZoom, 1e-4), tick);
  float rotAngle = uRot * tick;
  vec2 p = vUv - 0.5 - uCentre;
  p.x *= uAspect; // rotate in screen space, not stretched uv space
  float cs = cos(-rotAngle);
  float sn = sin(-rotAngle);
  p = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);
  p.x /= uAspect;
  p /= zoom;
  p /= uStretch;

  // Warp modes
  if (uWarpMode == 1) {
    // Multi-octave Simplex curl with 4 flow styles
    p.x *= uAspect;
    vec2 samplePos = p * (uWarpScale * 2.0);
    vec2 vel = curlNoise(samplePos, uTime * uWarpSpeed, uCurlOctaves, uCurlTurbulence, uHigh);
    vec2 radial = length(p) > 1e-4 ? normalize(p) : vec2(0.0, 1.0);

    if (uCurlFlowPattern == 0) {
      // 0 ('plumes'): slowly precessing, breathing flow vector
      vec2 flowVec = vec2(sin(uTime * 0.22 + p.y * 2.5), cos(uTime * 0.17 + p.x * 2.5)) * 0.22 + radial * (0.18 * sin(uTime * 0.31));
      vel = vel * 0.75 + flowVec;
    } else if (uCurlFlowPattern == 1) {
      // 1 ('eddies'): balanced stationary whirlpools
      vel = vel * 1.1;
    } else if (uCurlFlowPattern == 2) {
      // 2 ('outflow'): radial outward expansion
      vel = vel * 0.5 + radial * 0.85;
    } else if (uCurlFlowPattern == 3) {
      // 3 ('inflow'): inward vortex suction
      vec2 tang = vec2(-radial.y, radial.x);
      vel = vel * 0.5 - radial * 0.75 + tang * 0.65;
    }

    float warpAmt = max(uWarpAmp, 0.0); // 0 means no warp (Slice 15.3)
    p += vel * (warpAmt * 0.032 * tick);
    p.x /= uAspect;
  } else if (uWarpMode == 2) {
    // Kaleidoscopic Mandala with radial fold & wallpaper tiling
    p.x *= uAspect;

    // Wallpaper / Fractal crystal tiling
    if (uMandalaTile > 0.001) {
      vec2 gridP = p * 1.5;
      vec2 tiledP = abs(mod(gridP + 1.0, 2.0) - 1.0) - 0.5;
      p = mix(p, tiledP, uMandalaTile);
    }

    float r = length(p);
    float theta = atan(p.y, p.x) + uTime * uMandalaCounterSpin * 0.5;
    float foldedTheta = abs(mod(theta, TWO_PI / uKaleidoN) - PI / uKaleidoN);

    // Concentric radial accordion folding
    if (uRadialFold > 0.001) {
      float accordion = abs(sin(r * 10.0 - uTime * 0.8));
      r = mix(r, accordion * 0.35 + 0.05, uRadialFold * 0.6);
    }

    float portalMask = uPortalRadius > 1e-5 ? smoothstep(0.0, uPortalRadius, r) : 1.0;
    p = vec2(cos(foldedTheta), sin(foldedTheta)) * (r * portalMask);
    p.x /= uAspect;
  } else if (uWarpMode == 3) {
    // Smooth Incremental Möbius Dipole Flow with dynamic moving poles & Jacobian compensation
    p.x *= uAspect;
    vec2 a = uMobiusPoleA;
    vec2 b = uMobiusPoleB;
    if (distance(a, b) < 1e-3) {
      a = vec2(-uMobiusPoleOffset, 0.0);
      b = vec2(uMobiusPoleOffset, 0.0);
    }
    float poleOff = max(distance(a, b) * 0.5, uMobiusPoleOffset);
    float centerBoost = mix(2.4, 1.0, smoothstep(0.0, poleOff * 1.2, length(p)));

    int mMode = (uMobiusMode == 0) ? int(mod(floor(uTime / 14.0), 4.0)) : (uMobiusMode - 1);
    float flowFactor = uMobiusFlow;
    float swirlFactor = uMobiusSwirl;
    if (mMode == 0) {
      // 0: dipole source-to-sink arc
      flowFactor *= 1.35;
      swirlFactor *= 0.25;
    } else if (mMode == 1) {
      // 1: counter-rotating double vortex
      flowFactor *= 0.30;
      swirlFactor *= 1.40;
    } else if (mMode == 2) {
      // 2: lemniscate figure-eight cross-flow
      float crossPhase = sin(uTime * 0.75);
      flowFactor *= (0.85 + 0.45 * crossPhase);
      swirlFactor *= (crossPhase >= 0.0 ? 1.15 : -1.15);
    } else {
      // 3: breathing orbital exchange
      float breathe = 0.5 + 0.5 * sin(uTime * 0.95);
      flowFactor *= mix(0.5, 1.3, breathe);
      swirlFactor *= mix(1.3, 0.5, breathe);
    }

    vec2 za = p - a;
    vec2 zb = p - b;
    vec2 zeta = cDiv(za, zb);
    vec2 w = cLog(zeta);

    float warpAmt = max(uWarpAmp, 0.0); // 0 means no warp (Slice 15.3)
    w += vec2(flowFactor, swirlFactor) * (0.115 * centerBoost * warpAmt * tick);

    vec2 expW = cExp(w);
    vec2 num = a - cMul(b, expW);
    vec2 den = vec2(1.0, 0.0) - expW;
    p = cDiv(num, den);
    p.x /= uAspect;
  } else if (uWarpMode == 4) {
    // 'rgbSplit': Tangential curl with temporal swirl wave
    p.x *= uAspect;
    float swirlWave = 1.0 + 0.45 * sin(length(p) * 6.0 - uTime * uWarpSpeed * 1.2);
    vec2 tang = vec2(-p.y, p.x) / max(length(p), 0.05);
    p += tang * ((uRgbSplit > 0.0 ? uRgbSplit * 0.5 : 0.01) * swirlWave);
    p.x /= uAspect;
  } else {
    // 'classic': wave warp
    float w = sin(uTime * uWarpSpeed + p.y * uWarpScale * TWO_PI) + cos(uTime * uWarpSpeed + p.x * uWarpScale * TWO_PI);
    p += uWarp * 0.02 * tick * vec2(w, -w);
  }

  // Warp field: one lookup, added to the sample position. Stored as 0.5 + d / (2 * 0.5), so 0.5 is no change.
  if (uWarpFieldOn > 0.5) {
    p += texture(uField, vUv).rg - 0.5;
  }

  p -= uDrift * tick;
  vec2 uv = p + 0.5 + uCentre;
  uv = mix(clamp(uv, 0.0, 1.0), fract(uv), uWrap);

  // Fetch color from previous frame
  vec3 c;
  bool rgbSplitOn = (uWarpMode == 4 && uRgbSplit > 0.0);
  vec2 uvR = uv;
  vec2 uvB = uv;
  if (rgbSplitOn) {
    // 3-tap sampling of uPrev with temporal swirl variety & dynamic chromatic displacement
    float splitAngle = uRgbSplit * (1.5 + 0.6 * sin(uTime * 0.65 + length(p) * 4.0));
    vec2 dispAxis = vec2(cos(uTime * 0.42), sin(uTime * 0.42)) * uRgbSplit * 0.35 * (0.5 + 0.5 * sin(uTime * 0.9));

    float csR = cos(-splitAngle);
    float snR = sin(-splitAngle);
    vec2 pR = vec2(csR * p.x - snR * p.y, snR * p.x + csR * p.y) / (1.0 + uRgbSplit) + dispAxis;
    uvR = mix(clamp(pR + 0.5 + uCentre, 0.0, 1.0), fract(pR + 0.5 + uCentre), uWrap);

    vec2 uvG = uv;

    float csB = cos(splitAngle);
    float snB = sin(splitAngle);
    vec2 pB = vec2(csB * p.x - snB * p.y, snB * p.x + csB * p.y) * (1.0 + uRgbSplit) - dispAxis;
    uvB = mix(clamp(pB + 0.5 + uCentre, 0.0, 1.0), fract(pB + 0.5 + uCentre), uWrap);

    c = vec3(
      prevTex( uvR).r,
      prevTex( uvG).g,
      prevTex( uvB).b
    );
  } else {
    c = prevTex( uv).rgb;
  }

  if (uBlur > 0.0) {
    if (rgbSplitOn) {
      // Blur each channel around its own split coordinate so the split survives the blur.
      c = vec3(blurPrev(uvR, uBlur).r, blurPrev(uv, uBlur).g, blurPrev(uvB, uBlur).b);
    } else {
      c = blurPrev(uv, uBlur);
    }
  }

  // Post-fetch transforms
  if (uSobel > 0.0) {
    // 3x3 Sobel edge-magnitude sample
    vec3 s00 = prevTex( uv + vec2(-uTexel.x, -uTexel.y)).rgb;
    vec3 s01 = prevTex( uv + vec2(-uTexel.x,  0.0     )).rgb;
    vec3 s02 = prevTex( uv + vec2(-uTexel.x,  uTexel.y)).rgb;
    vec3 s10 = prevTex( uv + vec2( 0.0,      -uTexel.y)).rgb;
    vec3 s12 = prevTex( uv + vec2( 0.0,       uTexel.y)).rgb;
    vec3 s20 = prevTex( uv + vec2( uTexel.x, -uTexel.y)).rgb;
    vec3 s21 = prevTex( uv + vec2( uTexel.x,  0.0     )).rgb;
    vec3 s22 = prevTex( uv + vec2( uTexel.x,  uTexel.y)).rgb;

    vec3 gx = (s20 + 2.0 * s21 + s22) - (s00 + 2.0 * s01 + s02);
    vec3 gy = (s02 + 2.0 * s12 + s22) - (s00 + 2.0 * s10 + s20);
    vec3 sobelEdge = sqrt(gx * gx + gy * gy);
    c = mix(c, sobelEdge, uSobel);
  }

  if (uSolarize > 0.001) {
    // Luminance-Gated Topographic Solarize with wide, silky contour range
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    float smoothLum = dot(blurPrev(uv, max(uBlur, 0.35)), vec3(0.299, 0.587, 0.114));
    float gate = smoothstep(0.035, 0.14, lum);
    float phase = uSolarizePhase;
    float effFreq = uContourFreq * mix(1.0, 0.55, uSolarize * uSolarize);
    float band = mix(0.62, 1.18, pow(0.5 + 0.5 * sin(smoothLum * effFreq * 3.14159265 + phase), mix(3.2, 1.1, uContourWidth)));

    // 3-stop neon palette (cyan -> magenta -> gold/emerald controlled by uColorSpread)
    vec3 colCyan = vec3(0.05, 0.85, 1.0);
    vec3 colMagenta = vec3(1.0, 0.1, 0.7);
    vec3 colGold = vec3(1.0, 0.85, 0.15);
    vec3 colEmerald = vec3(0.1, 0.95, 0.55);
    vec3 colWarm = mix(colGold, colEmerald, uColorSpread * 0.5);

    float palT = fract(smoothLum * 2.0 + phase * 0.1);
    vec3 palCol;
    if (palT < 0.5) {
      palCol = mix(colCyan, colMagenta, palT * 2.0);
    } else {
      palCol = mix(colMagenta, colWarm, (palT - 0.5) * 2.0);
    }
    vec3 isolineCol = mix(c, palCol, uColorSpread) * band;
    vec3 solarized = mix(c, isolineCol, gate);
    c = mix(c, solarized, uSolarize);
  }

  c = hueRotate(c, uHueDrift * tick);

  // Per-channel chromatic decay (uDecay * uDecayRgb)
  // Decay is pow(decay, dt * 60): same result at 60 Hz as the old per-frame decay.
  vec3 decay = pow(max(uDecay * uDecayRgb, vec3(0.0)), vec3(tick));
  outColor = vec4(max(c * decay - uFade * tick, 0.0), 1.0);
}
