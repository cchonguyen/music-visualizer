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

in vec2 vUv;
out vec4 outColor;

// Rotates colour around the grey axis (hue shift that keeps brightness). Angle 0 = no change.
vec3 hueRotate(vec3 c, float a) {
  vec3 k = vec3(0.57735);
  float cs = cos(a);
  float sn = sin(a);
  return c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs);
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
  float w = sin(uTime * uWarpSpeed + p.y * uWarpScale * 6.2831853) + cos(uTime * uWarpSpeed + p.x * uWarpScale * 6.2831853);
  p += uWarp * 0.02 * vec2(w, -w);
  p -= uDrift;
  vec2 uv = p + 0.5 + uCentre;
  uv = mix(clamp(uv, 0.0, 1.0), fract(uv), uWrap);

  vec3 c = texture(uPrev, uv).rgb;
  if (uBlur > 0.0) {
    vec3 n = texture(uPrev, uv + vec2(uTexel.x, 0.0) * 1.5).rgb
           + texture(uPrev, uv - vec2(uTexel.x, 0.0) * 1.5).rgb
           + texture(uPrev, uv + vec2(0.0, uTexel.y) * 1.5).rgb
           + texture(uPrev, uv - vec2(0.0, uTexel.y) * 1.5).rgb;
    c = mix(c, (c + n) * 0.2, uBlur);
  }
  c = hueRotate(c, uHueDrift);
  outColor = vec4(max(c * uDecay - uFade, 0.0), 1.0);
}
