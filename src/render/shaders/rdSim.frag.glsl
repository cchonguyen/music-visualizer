#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uState;
uniform vec2 uTexelSize;
uniform float uDt;
uniform float uDu;
uniform float uDv;
uniform float uFeed;
uniform float uKill;
uniform float u_mid;
uniform float u_centroid;
uniform float u_kickEnv;
uniform float uInjectRing;

void main() {
  vec2 uv = vUv;
  vec4 current = texture(uState, uv);
  float u = current.r;
  float v = current.g;

  // 9-point Laplacian kernel:
  // Center: -1.0
  // Direct orthogonal neighbors: 0.20
  // Diagonal corner neighbors: 0.05
  vec2 dx = vec2(uTexelSize.x, 0.0);
  vec2 dy = vec2(0.0, uTexelSize.y);

  vec2 n_up    = texture(uState, uv + dy).rg;
  vec2 n_down  = texture(uState, uv - dy).rg;
  vec2 n_left  = texture(uState, uv - dx).rg;
  vec2 n_right = texture(uState, uv + dx).rg;

  vec2 n_tl = texture(uState, uv - dx + dy).rg;
  vec2 n_tr = texture(uState, uv + dx + dy).rg;
  vec2 n_bl = texture(uState, uv - dx - dy).rg;
  vec2 n_br = texture(uState, uv + dx - dy).rg;

  vec2 lap = ((n_up + n_down + n_left + n_right) * 0.20
           + (n_tl + n_tr + n_bl + n_br) * 0.05
           - vec2(u, v)) * 4.2;

  // Respect user u_feed and u_kill sliders directly with subtle audio modulation
  float F = clamp(uFeed + (u_mid - 0.35) * 0.008, 0.015, 0.095);
  float K = clamp(uKill + (u_centroid - 0.5) * 0.005, 0.040, 0.075);

  // Reaction-diffusion Gray-Scott simulation
  // Du = 0.16, Dv = 0.08 by default
  float uvv = u * v * v;
  float du_dt = uDu * lap.r - uvv + F * (1.0 - u);
  float dv_dt = uDv * lap.g + uvv - (F + K) * v;

  float nextU = clamp(u + du_dt * uDt, 0.0, 1.0);
  float nextV = clamp(v + dv_dt * uDt, 0.0, 1.0);

  // Inject fresh chemical V along a central ring whenever kickPulse or kickEnv > 0.7 fires
  if (uInjectRing > 0.0) {
    vec2 p = uv - vec2(0.5);
    float dist = length(p);
    if (dist >= 0.15 && dist <= 0.23) {
      float noise = fract(sin(dot(vUv * 64.0, vec2(12.9898, 78.233)) + u_kickEnv * 7.1) * 43758.5453);
      float ringMask = smoothstep(0.04, 0.0, abs(dist - 0.19)) * (0.6 + 0.4 * noise);
      nextV = mix(nextV, 0.5 * (0.8 + 0.4 * noise), ringMask * clamp(uInjectRing, 0.0, 1.0));
      nextU = mix(nextU, 0.5, ringMask * clamp(uInjectRing, 0.0, 1.0) * 0.5);
    }
  }

  // Gently damp V near the outer border so coral ridges constantly branch and never lock into a flat full-screen sheet
  float border = smoothstep(0.0, 0.06, min(uv.x, min(uv.y, min(1.0 - uv.x, 1.0 - uv.y))));
  nextV *= (0.90 + 0.10 * border);

  fragColor = vec4(nextU, nextV, 0.0, 1.0);
}
