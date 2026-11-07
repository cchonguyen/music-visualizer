#version 300 es
precision highp float;

// Feedback warp (slice E1) with colour drift and blur (slice E3). Each frame, last frame's image
// is moved (zoom, rotate, drift, stretch, wave warp), tinted (hue drift), softened (blur) and dimmed.
// With the default settings (zoom 1, rotate 0, everything else 0, decay 0.92, fade 0.004) this is
// the same as the old decay pass, so the look is unchanged until a preset changes them.
uniform sampler2D uPrev;
uniform vec2 uCentre;     // centre of zoom and rotate, in uv (0,0 = screen middle)
uniform vec2 uDrift;      // slide per frame, in uv
uniform vec2 uStretch;    // stretch per axis (1 = none)
uniform float uZoom;      // > 1 pushes trails outward
uniform float uRot;       // radians per frame
uniform float uWarp;      // wave amount
uniform float uWarpScale; // wave count across the screen
uniform float uWarpSpeed; // wave speed
uniform float uTime;      // render clock, seconds
uniform float uAspect;    // width / height, keeps rotation round
uniform float uWrap;      // 0 = clamp at the edge, 1 = wrap around
uniform float uHueDrift;  // hue rotation per frame, radians
uniform float uBlur;      // 0..1 mix toward a 5-tap blur
uniform vec2 uTexel;      // 1 / size in pixels
uniform float uDecay;     // persistence per frame
uniform float uFade;      // subtracted per frame

// Slice 7.11 uniforms:
uniform int uWarpMode;          // 0: classic, 1: curl, 2: polarFold, 3: mobius, 4: rgbSplit
uniform float uKaleidoN;        // 4..16, default 6
uniform float uPortalRadius;    // 0.0..0.25, default 0.0
uniform float uRgbSplit;        // 0.0..0.08, default 0.0
uniform vec3 uDecayRgb;         // default vec3(1.0, 1.0, 1.0)
uniform float uSobel;           // 0.0..1.0, default 0.0
uniform float uSolarize;        // 0.0..1.0, default 0.0
uniform float uSolarizePhase;   // phase modulation for solarize
uniform float uMobiusPoleOffset;// 0.1..0.8, default 0.35
uniform float uMobiusPolePolarity; // +1.0 or -1.0, flipped on kickPulse
uniform float uWarpAmp;         // warp amplitude

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

// 2D curl noise advection field (divergence-free flow from potential field)
vec2 curlField(vec2 pos, float t, float scale) {
  float s = scale * TWO_PI;
  float dpsi_dy = -s * sin(s * pos.x + t) * sin(s * pos.y + t) + s * cos(2.0 * s * pos.y + 0.7 * t) * cos(2.0 * s * pos.x - 0.5 * t);
  float dpsi_dx =  s * cos(s * pos.x + t) * cos(s * pos.y + t) - s * sin(2.0 * s * pos.y + 0.7 * t) * sin(2.0 * s * pos.x - 0.5 * t);
  return vec2(dpsi_dy, -dpsi_dx);
}

void main() {
  vec2 p = vUv - 0.5 - uCentre;
  p.x *= uAspect; // rotate in screen space, not stretched uv space
  float cs = cos(-uRot);
  float sn = sin(-uRot);
  p = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);
  p.x /= uAspect;
  p /= uZoom;
  p /= uStretch;

  // Warp modes (Slice 7.11)
  if (uWarpMode == 1) {
    // 'curl': 2D simplex/sine curl-noise advection (uWarpAmp)
    float amp = uWarpAmp > 0.0 ? uWarpAmp : (uWarp > 0.0 ? uWarp : 1.0);
    p.x *= uAspect;
    p += amp * 0.01 * curlField(p, uTime * uWarpSpeed, uWarpScale);
    p.x /= uAspect;
  } else if (uWarpMode == 2) {
    // 'polarFold': Fold polar angle theta via abs(mod(theta, TWO_PI / uKaleidoN) - PI / uKaleidoN)
    // and apply center portal mask smoothstep(0.0, uPortalRadius, r)
    p.x *= uAspect;
    float r = length(p);
    float theta = atan(p.y, p.x);
    float foldedTheta = abs(mod(theta, TWO_PI / uKaleidoN) - PI / uKaleidoN);
    float portalMask = uPortalRadius > 1e-5 ? smoothstep(0.0, uPortalRadius, r) : 1.0;
    p = vec2(cos(foldedTheta), sin(foldedTheta)) * (r * portalMask);
    p.x /= uAspect;
  } else if (uWarpMode == 3) {
    // 'mobius': Complex-plane transformation f(z) = (a*z + b) / (c*z + d)
    // with denominator magnitude guarded by max(denomMag, 1e-4) to prevent NaNs at singularities;
    // flip pole polarity when kickPulse fires.
    p.x *= uAspect;
    vec2 pole = vec2(uMobiusPoleOffset * uMobiusPolePolarity, 0.0);
    vec2 b = -pole;
    vec2 c = pole;
    vec2 d = vec2(1.0, 0.0);
    vec2 num = p + b;
    vec2 denom = vec2(c.x * p.x - c.y * p.y + d.x, c.x * p.y + c.y * p.x + d.y);
    float denomMag = length(denom);
    float safeDenomMag = max(denomMag, 1e-4);
    denom = denom * (safeDenomMag / max(denomMag, 1e-7));
    float denomMagSq = safeDenomMag * safeDenomMag;
    p = vec2(num.x * denom.x + num.y * denom.y, num.y * denom.x - num.x * denom.y) / denomMagSq;
    p.x /= uAspect;
  } else if (uWarpMode == 4) {
    // 'rgbSplit': Tangential curl vec2(-p.y, p.x) / max(length(p), 0.05)
    p.x *= uAspect;
    vec2 tang = vec2(-p.y, p.x) / max(length(p), 0.05);
    p += tang * (uRgbSplit > 0.0 ? uRgbSplit * 0.5 : 0.01);
    p.x /= uAspect;
  } else {
    // 'classic': wave warp
    float w = sin(uTime * uWarpSpeed + p.y * uWarpScale * TWO_PI) + cos(uTime * uWarpSpeed + p.x * uWarpScale * TWO_PI);
    p += uWarp * 0.02 * vec2(w, -w);
  }

  p -= uDrift;
  vec2 uv = p + 0.5 + uCentre;
  uv = mix(clamp(uv, 0.0, 1.0), fract(uv), uWrap);

  // Fetch color from previous frame
  vec3 c;
  if (uWarpMode == 4 && uRgbSplit > 0.0) {
    // 3-tap sampling of uPrev (Red at zoom + uRgbSplit, Green at zoom, Blue at zoom - uRgbSplit with rotational offset)
    float rotOffset = uRgbSplit * 1.5;
    float csR = cos(-rotOffset);
    float snR = sin(-rotOffset);
    vec2 pR = vec2(csR * p.x - snR * p.y, snR * p.x + csR * p.y) / (1.0 + uRgbSplit);
    vec2 uvR = mix(clamp(pR + 0.5 + uCentre, 0.0, 1.0), fract(pR + 0.5 + uCentre), uWrap);

    vec2 uvG = uv;

    float csB = cos(rotOffset);
    float snB = sin(rotOffset);
    vec2 pB = vec2(csB * p.x - snB * p.y, snB * p.x + csB * p.y) * (1.0 + uRgbSplit);
    vec2 uvB = mix(clamp(pB + 0.5 + uCentre, 0.0, 1.0), fract(pB + 0.5 + uCentre), uWrap);

    c = vec3(
      texture(uPrev, uvR).r,
      texture(uPrev, uvG).g,
      texture(uPrev, uvB).b
    );
  } else {
    c = texture(uPrev, uv).rgb;
  }

  if (uBlur > 0.0) {
    vec3 n = texture(uPrev, uv + vec2(uTexel.x, 0.0) * 1.5).rgb
           + texture(uPrev, uv - vec2(uTexel.x, 0.0) * 1.5).rgb
           + texture(uPrev, uv + vec2(0.0, uTexel.y) * 1.5).rgb
           + texture(uPrev, uv - vec2(0.0, uTexel.y) * 1.5).rgb;
    c = mix(c, (c + n) * 0.2, uBlur);
  }

  // Post-fetch transforms
  if (uSobel > 0.0) {
    // 3x3 Sobel edge-magnitude sample
    vec3 s00 = texture(uPrev, uv + vec2(-uTexel.x, -uTexel.y)).rgb;
    vec3 s01 = texture(uPrev, uv + vec2(-uTexel.x,  0.0     )).rgb;
    vec3 s02 = texture(uPrev, uv + vec2(-uTexel.x,  uTexel.y)).rgb;
    vec3 s10 = texture(uPrev, uv + vec2( 0.0,      -uTexel.y)).rgb;
    vec3 s12 = texture(uPrev, uv + vec2( 0.0,       uTexel.y)).rgb;
    vec3 s20 = texture(uPrev, uv + vec2( uTexel.x, -uTexel.y)).rgb;
    vec3 s21 = texture(uPrev, uv + vec2( uTexel.x,  0.0     )).rgb;
    vec3 s22 = texture(uPrev, uv + vec2( uTexel.x,  uTexel.y)).rgb;

    vec3 gx = (s20 + 2.0 * s21 + s22) - (s00 + 2.0 * s01 + s02);
    vec3 gy = (s02 + 2.0 * s12 + s22) - (s00 + 2.0 * s10 + s20);
    vec3 sobelEdge = sqrt(gx * gx + gy * gy);
    c = mix(c, sobelEdge, uSobel);
  }

  if (uSolarize > 0.0) {
    // 0.5 + 0.5 * sin(col.rgb * 6.28318 * 1.25 + uSolarizePhase)
    vec3 solar = 0.5 + 0.5 * sin(c * 6.28318 * 1.25 + uSolarizePhase);
    c = mix(c, solar, uSolarize);
  }

  c = hueRotate(c, uHueDrift);

  // Per-channel chromatic decay (uDecay * uDecayRgb)
  vec3 decay = uDecay * uDecayRgb;
  outColor = vec4(max(c * decay - uFade, 0.0), 1.0);
}
