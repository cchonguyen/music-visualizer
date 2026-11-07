#version 300 es
// Chladni Sand Layer vertex shader (Slice 7.14, Slice 7.28)
// Evaluates standing-wave potential f(x, y) = cos(n*PI*x)*cos(m*PI*y) - cos(m*PI*x)*cos(n*PI*y)
// and analytic spatial gradient (df_dx, df_dy) via 3-step damped Newton-Raphson convergence.
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
uniform float uScale;
uniform int uPlateMode; // 0 = fullscreen, 1 = isometricPlate, 2 = radialMandala
uniform float uModeN1;
uniform float uModeM1;
uniform float uModeN2;
uniform float uModeM2;
uniform float uModeMorph;
uniform float uNodalSharpness;

out vec2 vHash;
out float vPotential;
out float vNodeDist;
out float vAlpha;

void evalWave(vec2 pos, float n, float m, int plateMode, out float f, out vec2 grad) {
  if (plateMode == 2) {
    // 2 (radialMandala): polar coordinate standing wave cos(n * theta) * cos(m * r * PI)
    float r = length(pos);
    float theta = atan(pos.y, pos.x);
    float cn = cos(n * theta);
    float sn = sin(n * theta);
    float cm = cos(m * r * PI);
    float sm = sin(m * r * PI);
    f = cn * cm;
    float df_dr = -m * PI * cn * sm;
    float df_dtheta = -n * sn * cm;
    float rSafe = max(r, 0.0001);
    float cosT = pos.x / rSafe;
    float sinT = pos.y / rSafe;
    float df_dx = df_dr * cosT - (df_dtheta / rSafe) * sinT;
    float df_dy = df_dr * sinT + (df_dtheta / rSafe) * cosT;
    grad = vec2(df_dx, df_dy);
  } else {
    // 0 (fullscreen) and 1 (isometricPlate): Chladni square plate formula
    float nx = n * PI * pos.x;
    float my = m * PI * pos.y;
    float mx = m * PI * pos.x;
    float ny = n * PI * pos.y;

    float cos_nx = cos(nx);
    float sin_nx = sin(nx);
    float cos_my = cos(my);
    float sin_my = sin(my);
    float cos_mx = cos(mx);
    float sin_mx = sin(mx);
    float cos_ny = cos(ny);
    float sin_ny = sin(ny);

    f = cos_nx * cos_my - cos_mx * cos_ny;
    float df_dx = -n * PI * sin_nx * cos_my + m * PI * sin_mx * cos_ny;
    float df_dy = -m * PI * cos_nx * sin_my + n * PI * cos_mx * sin_ny;
    grad = vec2(df_dx, df_dy);
  }
}

void main() {
  vec2 seedPos = aSeed.xy;
  float hash1 = aSeed.z;
  float hash2 = aSeed.w;
  vHash = vec2(hash1, hash2);

  float s = max(uScale, 0.01);
  vec2 p;
  if (uPlateMode == 1) {
    // 1 (isometricPlate): square plate [-1, 1]
    p = seedPos / s;
  } else if (uPlateMode == 2) {
    // 2 (radialMandala): uniform polar disk distribution
    float rSeed = sqrt(hash1) * 0.95;
    float thetaSeed = hash2 * TAU;
    p = vec2(rSeed * cos(thetaSeed), rSeed * sin(thetaSeed)) / s;
  } else {
    // 0 (fullscreen): evaluated in vec2(seed.x * uAspect, seed.y) / uScale
    p = vec2(seedPos.x * uAspect, seedPos.y) / s;
  }

  // Radial Brownian jitter proportional to kickEnv
  float jitterAngle = hash1 * TAU + uTime * 4.0 + hash2 * 10.0;
  float jitterMag = (0.004 + 0.07 * u_kickEnv) * uJitter * hash2;
  vec2 jitter = vec2(cos(jitterAngle), sin(jitterAngle)) * jitterMag;
  p += jitter;

  // 3-step damped Newton-Raphson root-finding toward nodal lines f(p) == 0
  float settleWeight = uAttraction;
  for (int step = 0; step < 3; step++) {
    float f1, f2;
    vec2 grad1, grad2;
    evalWave(p, uModeN1, uModeM1, uPlateMode, f1, grad1);
    evalWave(p, uModeN2, uModeM2, uPlateMode, f2, grad2);

    float f = mix(f1, f2, uModeMorph);
    vec2 grad = mix(grad1, grad2, uModeMorph);

    p -= f * grad / (dot(grad, grad) + 0.35) * (0.28 * uNodalSharpness * settleWeight);
  }

  // Final potential and nodal distance abs(f) after convergence
  float finalF1, finalF2;
  vec2 finalGrad1, finalGrad2;
  evalWave(p, uModeN1, uModeM1, uPlateMode, finalF1, finalGrad1);
  evalWave(p, uModeN2, uModeM2, uPlateMode, finalF2, finalGrad2);
  float finalF = mix(finalF1, finalF2, uModeMorph);
  vNodeDist = abs(finalF);
  vPotential = abs(finalF);

  // Apply projection according to plateMode
  vec2 clipPos;
  if (uPlateMode == 1) {
    // 1 (isometricPlate): 45° diamond plate with 3D perspective foreshortening (y * 0.68)
    float cos45 = 0.70710678;
    float sin45 = 0.70710678;
    vec2 rotP = vec2(p.x * cos45 - p.y * sin45, p.x * sin45 + p.y * cos45);
    rotP.y *= 0.68;
    clipPos = vec2(rotP.x / uAspect, rotP.y);

    float plateDist = max(abs(p.x * s), abs(p.y * s));
    vAlpha = 1.0 - smoothstep(0.92, 1.0, plateDist);
  } else if (uPlateMode == 2) {
    // 2 (radialMandala): circular plate boundary
    clipPos = vec2(p.x / uAspect, p.y);
    float r = length(p * s);
    vAlpha = 1.0 - smoothstep(0.92, 1.0, r);
  } else {
    // 0 (fullscreen): mapped back to full clip-space vec2(p.x / uAspect, p.y) (filling 16:9 edge-to-edge)
    clipPos = vec2(p.x / uAspect, p.y);
    float edgeDist = max(abs(clipPos.x), abs(clipPos.y));
    vAlpha = 1.0 - smoothstep(0.97, 1.03, edgeDist);
  }

  // 1.5px–2.5px gl.POINTS
  gl_PointSize = mix(1.5, 2.5, hash1) * uPointSize * max(1.0, uDpr);

  gl_Position = vec4(clipPos.x, clipPos.y, 0.0, 1.0);
}
