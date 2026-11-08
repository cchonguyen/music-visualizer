#version 300 es
precision highp float;

// Post chain (slice E4) and bloom read-out (slice E5). Runs on the blended scenes, before the
// safety pass. Every setting has an identity value (hue 0, saturation 1, contrast 1, gamma 1,
// brightness 0, mirror 0, vignette 0, chroma 0, bloom 0), so the default output equals the input.
uniform sampler2D uImg;   // blended image
uniform sampler2D uBloom; // half-size blur of the image (E5)
uniform float uHue;       // radians
uniform float uSat;       // 0 = grey, 1 = unchanged
uniform float uContrast;  // 1 = unchanged
uniform float uGamma;     // 1 = unchanged
uniform float uBright;    // added after the grade
uniform float uMirror;    // 0 = off, 2..8 = kaleidoscope folds
uniform float uVignette;  // 0..1 darker edges
uniform float uChroma;    // red/blue split, in uv
uniform float uBloomAmt;  // 0 = off
uniform float uBloomThr;  // brightness above this glows
uniform float uCrtScanlines; // 0..1 (default 0, Slice 7.12)
uniform float uCrtBarrel;    // 0..0.2 (default 0, Slice 7.12)

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

  // CRT barrel distortion (Slice 7.12)
  if (uCrtBarrel > 0.0) {
    vec2 p = uv - 0.5;
    float dist = dot(p, p);
    uv = 0.5 + p * (1.0 + uCrtBarrel * dist * 4.0);
  }

  vec3 c = vec3(
    texture(uImg, uv + vec2(uChroma, 0.0)).r,
    texture(uImg, uv).g,
    texture(uImg, uv - vec2(uChroma, 0.0)).b
  );
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

  if (uBloomAmt > 0.0) {
    vec3 g = texture(uBloom, uv).rgb;
    c += max(g - uBloomThr, 0.0) * uBloomAmt;
  }

  // CRT scanlines (Slice 7.12)
  if (uCrtScanlines > 0.0) {
    float scanline = sin(vUv.y * 800.0) * 0.5 + 0.5;
    c *= 1.0 - uCrtScanlines * 0.5 * scanline;
  }

  float d = length(vUv - 0.5);
  c *= 1.0 - uVignette * smoothstep(0.35, 0.75, d);
  outColor = vec4(max(c, 0.0), 1.0);
}
