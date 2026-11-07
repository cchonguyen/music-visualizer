#version 300 es
// Chladni Sand Layer vertex shader (Slice 7.14)
// Evaluates standing-wave potential f(x, y) = cos(n*PI*x)*cos(m*PI*y) - cos(m*PI*x)*cos(n*PI*y)
// and analytic spatial gradient (df/dx, df/dy), displacing 8,192 grains toward nodal lines.
precision highp float;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;

layout(location = 0) in vec4 aSeed; // vec4(x, y, hash1, hash2)

uniform float uAspect;
uniform float uTime;
uniform float u_mid;
uniform float u_centroid;
uniform float u_kickEnv;
uniform float uPointSize;
uniform float uAttraction;
uniform float uJitter;
uniform float uDpr;

out vec2 vHash;
out float vPotential;
out float vAlpha;

void main() {
  vec2 seedPos = aSeed.xy;
  float hash1 = aSeed.z;
  float hash2 = aSeed.w;
  vHash = vec2(hash1, hash2);

  // Smoothly morph harmonic modes (n, m) with u_mid and u_centroid
  float n = mix(2.0, 5.0, clamp(u_centroid, 0.0, 1.0)) + 0.4 * sin(uTime * 0.35);
  float m = mix(3.0, 7.0, clamp(u_mid, 0.0, 1.0)) + 0.4 * cos(uTime * 0.45);

  // Chladni standing wave potential:
  // f(x,y) = cos(n*PI*x)*cos(m*PI*y) - cos(m*PI*x)*cos(n*PI*y)
  float nx = n * PI * seedPos.x;
  float my = m * PI * seedPos.y;
  float mx = m * PI * seedPos.x;
  float ny = n * PI * seedPos.y;

  float cos_nx = cos(nx);
  float sin_nx = sin(nx);
  float cos_my = cos(my);
  float sin_my = sin(my);
  float cos_mx = cos(mx);
  float sin_mx = sin(mx);
  float cos_ny = cos(ny);
  float sin_ny = sin(ny);

  float f = cos_nx * cos_my - cos_mx * cos_ny;
  vPotential = abs(f);

  // Analytic spatial gradient:
  // df/dx = -n*PI*sin(n*PI*x)*cos(m*PI*y) + m*PI*sin(m*PI*x)*cos(n*PI*y)
  // df/dy = -m*PI*cos(n*PI*x)*sin(m*PI*y) + n*PI*cos(m*PI*x)*sin(n*PI*y)
  float df_dx = -n * PI * sin_nx * cos_my + m * PI * sin_mx * cos_ny;
  float df_dy = -m * PI * cos_nx * sin_my + n * PI * cos_mx * sin_ny;
  vec2 grad = vec2(df_dx, df_dy);
  float gradLen = length(grad);

  // Displace grain down the gradient toward nodal lines f(x, y) == 0
  vec2 dispDir = (gradLen > 0.001) ? (grad / gradLen) : vec2(0.0);
  float stepDist = clamp(f / (gradLen + 0.15), -0.28, 0.28);
  vec2 displaced = seedPos - dispDir * stepDist * uAttraction;

  // Radial Brownian jitter proportional to kickEnv
  float jitterAngle = hash1 * TAU + uTime * 4.0 + hash2 * 10.0;
  float jitterMag = (0.004 + 0.07 * u_kickEnv) * uJitter * hash2;
  vec2 jitter = vec2(cos(jitterAngle), sin(jitterAngle)) * jitterMag;
  displaced += jitter;

  // Keep inside visible plate area [-1, 1]
  displaced = clamp(displaced, -1.0, 1.0);

  // 1.5px–2.5px gl.POINTS
  gl_PointSize = mix(1.5, 2.5, hash1) * uPointSize * max(1.0, uDpr);

  // Soft boundary fade
  float edgeDist = max(abs(displaced.x), abs(displaced.y));
  vAlpha = 1.0 - smoothstep(0.92, 1.0, edgeDist);

  // Aspect-corrected position
  gl_Position = vec4(displaced.x / uAspect, displaced.y, 0.0, 1.0);
}
