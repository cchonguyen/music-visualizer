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
  if (uMirror >= 2.0) {
    vec2 p = uv - 0.5;
    float seg = 6.2831853 / uMirror;
    float a = mod(atan(p.y, p.x), seg);
    a = abs(a - seg * 0.5);
    uv = 0.5 + length(p) * vec2(cos(a), sin(a));
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

  if (uBloomAmt > 0.0) {
    vec3 g = texture(uBloom, vUv).rgb;
    c += max(g - uBloomThr, 0.0) * uBloomAmt;
  }

  float d = length(vUv - 0.5);
  c *= 1.0 - uVignette * smoothstep(0.35, 0.75, d);
  outColor = vec4(max(c, 0.0), 1.0);
}
