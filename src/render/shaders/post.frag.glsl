#version 300 es
precision highp float;

// Final pass (Slice 16.4): blend the scenes, run the post chain (slice E4) with the bloom read-out
// (slice E5), then apply the safety rules, all in one full-screen pass. The safety rules come last and
// no setting can turn them off. Every post setting has an identity value (hue 0, saturation 1, contrast 1,
// gamma 1, brightness 0, mirror 0, vignette 0, chroma 0, bloom 0), so the default output equals the input.
// The blend and safety blocks below are the same text as in composite.frag.glsl (checked by a test).

// Scene blend (inputs are the finished scene textures)
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uWA;      // weight of scene A (0..1)
uniform float uWB;      // weight of scene B (0..1)
uniform int uStyle;     // transition style while two scenes blend (T1): 0 crossfade, 1 wipe, 2 dissolve, 3 zoom-through
uniform float uT;       // transition progress, 0 = all A, 1 = all B (only used when both weights > 0)

// Safety (always applied)
uniform float uCap;     // estimated luminance cap from BrightnessLimiter
uniform float uCalm;    // 1.0 = Calm mode enabled, 0.0 = normal
uniform float uReversalDamp; // 0.0..1.0 damping from rapid reversals (> 3 reversals/sec)

uniform sampler2D uBloom; // half-size blur of the image (E5)
uniform sampler2D uBloom1; // quarter-size blur (Slice 18.7)
uniform sampler2D uBloom2; // eighth-size blur (Slice 18.7)
uniform vec3 uBloomW;      // weight of each blur level in the glow, adds to 1. (1, 0, 0) = the original glow
uniform float uBloomTintAmt; // 0 = glow keeps the picture colours
uniform float uBloomTintHue; // radians
uniform float uBloomPulse;   // how much the glow swells on a kick
uniform float uBeat;         // kick envelope, 0..1

// Colour map (Slice 18.8)
uniform sampler2D uMapA;    // first gradient, 256 x 1
uniform sampler2D uMapB;    // second gradient
uniform float uMapAmt;      // 0 = off
uniform float uMapMix;      // 0 = first gradient, 1 = second
uniform int uMapBy;         // 0 brightness, 1 distance from centre, 2 angle around centre
uniform float uHue;       // radians
uniform float uSat;       // 0 = grey, 1 = unchanged
uniform float uContrast;  // 1 = unchanged
uniform float uGamma;     // 1 = unchanged
uniform float uBright;    // added after the grade
uniform float uMirror;    // 0 = off, 2..8 = kaleidoscope folds
uniform float uVignette;  // 0..1 darker edges
// Vignette options (Slice 18.9). The defaults draw the classic dark oval vignette.
uniform int uVigShape;     // 0 oval (follows the screen), 1 round, 2 box
uniform float uVigSoft;    // width of the fade, 0.4 = the classic one
uniform int uVigBlend;     // 0 darken, 1 tint, 2 add, 3 hue shift
uniform vec3 uVigColour;   // black with darken = classic
uniform float uVigUseGrad; // 1 = colour from uVigGrad instead
uniform sampler2D uVigGrad;
uniform float uAspect;     // width / height of the picture
uniform float uChroma;    // red/blue split, in uv
uniform float uBloomAmt;  // 0 = off
uniform float uBloomThr;  // brightness above this glows

// Global Director uniforms (Sector 483, Slice 7.31)
uniform vec2 uCamPan;             // default (0.0, 0.0)
uniform float uCamZoom;           // default 1.0
uniform float uCamRoll;           // default 0.0
uniform vec2 uCamTilt;            // default (0.0, 0.0)
uniform vec3 uColorShadowTint;    // default (1.0, 1.0, 1.0)
uniform vec3 uColorHighlightTint; // default (1.0, 1.0, 1.0)
uniform float uColorSpatialSpread;// default 0.0
uniform float uColorGradAngle;    // default 0.0
uniform float uColorIntensity;    // default 0.0
uniform float uColorCycleAngle;   // default 0.0 (continuous hue drift)

in vec2 vUv;
out vec4 outColor;

// @blend-begin
// Scene textures may be half-float (Slice 16.7) and hold values above 1; the blend reads them clamped to 0..1.
vec3 sceneAt(sampler2D s, vec2 uv) {
  return min(texture(s, uv).rgb, vec3(1.0));
}

vec3 blendAt(vec2 uv) {
  vec3 c;
  if (uStyle == 0 || uWA <= 0.0 || uWB <= 0.0) {
    c = sceneAt(uA, uv) * uWA + sceneAt(uB, uv) * uWB;
  } else if (uStyle == 1) {
    // Wipe: scene B arrives from the left, with a soft edge.
    float m = 1.0 - smoothstep(uT - 0.01, uT + 0.01, uv.x);
    c = mix(sceneAt(uA, uv), sceneAt(uB, uv), m);
  } else if (uStyle == 2) {
    // Dissolve: random pixels change first, then the rest.
    float n = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
    float m = 1.0 - smoothstep(uT - 0.1, uT + 0.1, n);
    c = mix(sceneAt(uA, uv), sceneAt(uB, uv), m);
  } else {
    // Zoom-through: B grows out of the centre while A fades.
    vec2 uvB = 0.5 + (uv - 0.5) / (0.6 + 0.4 * uT);
    c = sceneAt(uA, uv) * (1.0 - uT) + sceneAt(uB, uvB) * uT;
  }
  return c;
}
// @blend-end

// @safety-begin
vec3 applySafety(vec3 c) {
    // Saturated red: where R/(R+G+B) >= 0.8, mix toward grey of the same total.
    float sum = c.r + c.g + c.b;
    if (sum > 0.0001) {
      float r = c.r / sum;
      if (r >= 0.8) {
        float a = (r - 0.79) / (r - 1.0 / 3.0);
        c = mix(c, vec3(sum / 3.0), a);
      }
    }

    // High-frequency stripe guard (SYSTEM_SPEC.md:94):
    // Softly attenuate local contrast when spatial oscillations exceed safe thresholds.
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float dLuma = fwidth(luma);
    float stripeGuard = smoothstep(0.15, 0.45, dLuma);
    if (stripeGuard > 0.0) {
      c = mix(c, vec3(luma), stripeGuard * 0.6);
    }

    // Calm mode: dark-preserving highlight roll-off and cap peak saturation.
    if (uCalm > 0.5) {
      float contrastFactor = 0.5;
      c = c / (1.0 + c * (1.0 - contrastFactor)) * contrastFactor;
      float maxC = max(c.r, max(c.g, c.b));
      float minC = min(c.r, min(c.g, c.b));
      float sat = maxC > 0.0001 ? (maxC - minC) / maxC : 0.0;
      float maxSat = 0.75;
      if (sat > maxSat) {
        float curLuma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(curLuma), c, maxSat / sat);
      }
    }

    // Alternating dark/light frames (> 3 reversals/sec): increase damping toward black.
    if (uReversalDamp > 0.0) {
      c *= (1.0 - uReversalDamp * 0.35);
    }

    // Luminance cap: scale down anything brighter than the cap.
    float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
    if (L > uCap) c *= uCap / max(L, 0.0001);
  return c;
}
// @safety-end

vec3 hueRotate(vec3 c, float a) {
  vec3 k = vec3(0.57735);
  float cs = cos(a);
  float sn = sin(a);
  return c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs);
}

void main() {
  vec2 uv = vUv;

  // 2.5D Global Camera transform (Sector 483, Slice 7.31)
  if (uCamZoom != 1.0 || uCamRoll != 0.0 || dot(uCamPan, uCamPan) > 0.0 || dot(uCamTilt, uCamTilt) > 0.0) {
    vec2 p0 = uv - 0.5;
    float cr = cos(uCamRoll);
    float sr = sin(uCamRoll);
    vec2 p1 = vec2(p0.x * cr - p0.y * sr, p0.x * sr + p0.y * cr);
    vec2 p2 = p1 / max(0.2, 1.0 + p1.x * uCamTilt.x + p1.y * uCamTilt.y);
    vec2 p3 = (p2 / max(0.5, uCamZoom)) - uCamPan;
    vec2 camUv = p3 + 0.5;
    vec2 mUv = mod(camUv, 2.0);
    uv = mix(mUv, 2.0 - mUv, step(1.0, mUv));
  }

  if (uMirror >= 2.0) {
    vec2 p = uv - 0.5;
    float seg = 6.2831853 / uMirror;
    float a = mod(atan(p.y, p.x), seg);
    a = abs(a - seg * 0.5);
    uv = 0.5 + length(p) * vec2(cos(a), sin(a));
  }

  vec3 c;
  if (uChroma != 0.0) {
    c = vec3(
      blendAt(uv + vec2(uChroma, 0.0)).r,
      blendAt(uv).g,
      blendAt(uv - vec2(uChroma, 0.0)).b
    );
  } else {
    c = blendAt(uv);
  }
  c = hueRotate(c, uHue);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = (c - 0.5) * uContrast + 0.5;
  c = pow(max(c, 0.0), vec3(1.0 / uGamma));
  c += uBright;

  // Luminance-Preserving Split-Tone & Rotating Spatial Gradient (Sector 483, Slice 7.31)
  float Y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (Y > 1e-5 && uColorIntensity > 0.0) {
    vec2 gradDir = vec2(cos(uColorGradAngle), sin(uColorGradAngle));
    float s = dot(vUv - 0.5, gradDir);
    float tTone = clamp(Y + s * uColorSpatialSpread, 0.0, 1.0);
    vec3 shadowT = hueRotate(uColorShadowTint, uColorCycleAngle * 0.7);
    vec3 highlightT = hueRotate(uColorHighlightTint, uColorCycleAngle);
    vec3 tint = mix(shadowT, highlightT, tTone);
    vec3 tinted = mix(c, c * tint * 2.2, uColorIntensity);
    float Ytint = dot(tinted, vec3(0.2126, 0.7152, 0.0722));
    c = tinted * (Y / max(1e-4, Ytint));
  }

  if (uMapAmt > 0.0) {
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float t = clamp(lum, 0.0, 1.0);
    if (uMapBy == 1) {
      t = clamp(length(vUv - 0.5) * 1.41421356, 0.0, 1.0);
    } else if (uMapBy == 2) {
      // A triangle wave around the circle, so the gradient has no seam where the angle wraps.
      vec2 dv = vUv - 0.5;
      t = abs(fract(atan(dv.y, dv.x) / 6.28318531 + 0.5) * 2.0 - 1.0);
    }
    vec3 mapped = texture(uMapA, vec2(t, 0.5)).rgb;
    if (uMapMix > 0.0) mapped = mix(mapped, texture(uMapB, vec2(t, 0.5)).rgb, uMapMix);
    // Brightness reads replace the colour. Distance and angle keep the picture's light and dark.
    if (uMapBy != 0) mapped *= clamp(lum * 1.6, 0.0, 1.0);
    c = mix(c, mapped, uMapAmt);
  }

  if (uBloomAmt > 0.0) {
    vec3 g = texture(uBloom, uv).rgb * uBloomW.x;
    if (uBloomW.y > 0.0) g += texture(uBloom1, uv).rgb * uBloomW.y;
    if (uBloomW.z > 0.0) g += texture(uBloom2, uv).rgb * uBloomW.z;
    vec3 glow = max(g - uBloomThr, 0.0);
    if (uBloomTintAmt > 0.0) {
      // Move the glow toward one colour, keeping its brightness.
      vec3 tc = 0.5 + 0.5 * cos(uBloomTintHue + vec3(0.0, 2.0944, 4.1888));
      float gl = dot(glow, vec3(0.2126, 0.7152, 0.0722));
      glow = mix(glow, vec3(gl) * tc * 1.8, uBloomTintAmt);
    }
    c += glow * uBloomAmt * (1.0 + uBloomPulse * uBeat);
  }

  vec2 vp = vUv - 0.5;
  float d = length(vp);
  if (uVigShape == 1) {
    // Round: a true circle, scaled so the corners stay at the same distance as the oval.
    d = length(vp * vec2(uAspect, 1.0)) / sqrt(uAspect * uAspect + 1.0) * 1.41421356;
  } else if (uVigShape == 2) {
    d = max(abs(vp.x), abs(vp.y)) * 1.41421356;
  }
  if (uVignette > 0.0) {
    // The fade is centred on 0.55 and uVigSoft wide: 0.4 gives smoothstep(0.35, 0.75) like before.
    float k = uVignette * smoothstep(0.55 - uVigSoft * 0.5, 0.55 + uVigSoft * 0.5, d);
    vec3 vc = uVigColour;
    if (uVigUseGrad > 0.5) vc = texture(uVigGrad, vec2(clamp(d / 0.70710678, 0.0, 1.0), 0.5)).rgb;
    if (uVigBlend == 0) {
      c *= mix(vec3(1.0), vc, k);
    } else if (uVigBlend == 1) {
      c = mix(c, vc, k);
    } else if (uVigBlend == 2) {
      c += vc * k;
    } else {
      c = hueRotate(c, k * 3.14159265);
    }
  }
  // The safety rules read the finished picture. Clamp first: the post chain can push values past 1.
  c = clamp(c, 0.0, 1.0);
  c = applySafety(c);
  outColor = vec4(c, 1.0);
}
