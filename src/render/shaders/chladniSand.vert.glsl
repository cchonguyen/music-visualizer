#version 300 es
// Chladni Sand Layer vertex shader (Slice 7.14, Slice 7.28, Slice 7.36)
// Evaluates standing-wave potentials across square, polar, hexagonal, triangular, star, and morphing plates
// with analytic spatial gradients via 3-step damped Newton-Raphson convergence.
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
uniform int uPlateMode; // 0 = fullscreen, 1 = isometricPlate, 2 = radialMandala, 3 = hexagon, 4 = triangle, 5 = starMandala, 6 = morph
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

void evalSquare(vec2 pos, float n, float m, out float f, out vec2 grad) {
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

void evalPolar(vec2 pos, float n, float m, out float f, out vec2 grad) {
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
}

// 3-axis trilinear wave evaluation
void evalTrilinear(vec2 p, float n, float m, float triAsym, out float f, out vec2 grad) {
  vec2 e1 = vec2(1.0, 0.0);
  vec2 e2 = vec2(-0.5, 0.8660254037844386);
  vec2 e3 = vec2(-0.5, -0.8660254037844386);

  float u1 = dot(p, e1);
  float u2 = dot(p, e2);
  float u3 = dot(p, e3);

  float c1n = cos(n * PI * u1);
  float s1n = sin(n * PI * u1);
  float c1m = cos(m * PI * u1);
  float s1m = sin(m * PI * u1);

  float c2n = cos(n * PI * u2);
  float s2n = sin(n * PI * u2);
  float c2m = cos(m * PI * u2);
  float s2m = sin(m * PI * u2);

  float c3n = cos(n * PI * u3);
  float s3n = sin(n * PI * u3);
  float c3m = cos(m * PI * u3);
  float s3m = sin(m * PI * u3);

  f = c1n * c2m + c2n * c3m + triAsym * c3n * c1m;

  float df_du1 = -n * PI * s1n * c2m - triAsym * m * PI * c3n * s1m;
  float df_du2 = -m * PI * c1n * s2m - n * PI * s2n * c3m;
  float df_du3 = -m * PI * c2n * s3m - triAsym * n * PI * s3n * c1m;

  grad = df_du1 * e1 + df_du2 * e2 + df_du3 * e3;
}

// Dihedral star / kaleidoscope folded wave
void evalStarMandala(vec2 pos, float n, float m, out float f, out vec2 grad) {
  float r = length(pos);
  float rSafe = max(r, 0.0001);
  float theta = atan(pos.y, pos.x);

  const float SECTORS = 6.0;
  float alpha = TAU / SECTORS;
  float halfAlpha = 0.5 * alpha;
  float thetaMod = mod(theta, alpha);
  if (thetaMod < 0.0) thetaMod += alpha;
  float thetaDiff = thetaMod - halfAlpha;
  float thetaFold = abs(thetaDiff);
  float sTheta = (thetaDiff >= 0.0) ? 1.0 : -1.0;

  float thetaF = thetaFold * SECTORS;
  float cn = cos(n * thetaF);
  float sn = sin(n * thetaF);
  float cm = cos(m * r * PI);
  float sm = sin(m * r * PI);

  f = cn * cm;

  float df_dr = -m * PI * cn * sm;
  float df_dtheta = -n * sn * (SECTORS * sTheta) * cm;

  float cosT = pos.x / rSafe;
  float sinT = pos.y / rSafe;
  float df_dx = df_dr * cosT - (df_dtheta / rSafe) * sinT;
  float df_dy = df_dr * sinT + (df_dtheta / rSafe) * cosT;
  grad = vec2(df_dx, df_dy);
}

// 16-second temporal morphing between plate geometries
void evalMorph(vec2 pos, float n, float m, float t, out float f, out vec2 grad) {
  float cycleTime = mod(t, 16.0);
  float stage = floor(cycleTime / 4.0);
  float frac = fract(cycleTime / 4.0);
  float tMorph = smoothstep(0.12, 0.88, frac);

  float fA = 0.0;
  vec2 gradA = vec2(0.0);
  float fB = 0.0;
  vec2 gradB = vec2(0.0);

  if (stage < 0.5) {
    evalSquare(pos, n, m, fA, gradA);
    evalTrilinear(pos, n, m, 1.0, fB, gradB);
  } else if (stage < 1.5) {
    evalTrilinear(pos, n, m, 1.0, fA, gradA);
    evalTrilinear(pos, n, m, -1.0, fB, gradB);
  } else if (stage < 2.5) {
    evalTrilinear(pos, n, m, -1.0, fA, gradA);
    evalStarMandala(pos, n, m, fB, gradB);
  } else {
    evalStarMandala(pos, n, m, fA, gradA);
    evalSquare(pos, n, m, fB, gradB);
  }

  f = mix(fA, fB, tMorph);
  grad = mix(gradA, gradB, tMorph);
}

void evalWave(vec2 pos, float n, float m, int plateMode, out float f, out vec2 grad) {
  if (plateMode == 2) {
    evalPolar(pos, n, m, f, grad);
  } else if (plateMode == 3) {
    evalTrilinear(pos, n, m, 1.0, f, grad);
  } else if (plateMode == 4) {
    evalTrilinear(pos, n, m, -1.0, f, grad);
  } else if (plateMode == 5) {
    evalStarMandala(pos, n, m, f, grad);
  } else if (plateMode == 6) {
    evalMorph(pos, n, m, uTime, f, grad);
  } else {
    evalSquare(pos, n, m, f, grad);
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
  } else if (uPlateMode == 2 || uPlateMode == 5) {
    // 2 (radialMandala) & 5 (starMandala): uniform polar disk distribution
    float rSeed = sqrt(hash1) * 0.95;
    float thetaSeed = hash2 * TAU;
    p = vec2(rSeed * cos(thetaSeed), rSeed * sin(thetaSeed)) / s;
  } else if (uPlateMode == 3 || uPlateMode == 4 || uPlateMode == 6) {
    // 3 (hexagon), 4 (triangle), 6 (morph): square-bounded seeds covering polygon
    p = seedPos / s;
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
  } else if (uPlateMode == 3) {
    // 3 (hexagon): regular hexagonal plate boundary
    clipPos = vec2(p.x / uAspect, p.y);
    vec2 pAbs = abs(p * s);
    float hexDist = max(dot(pAbs, vec2(0.8660254, 0.5)), pAbs.y);
    vAlpha = 1.0 - smoothstep(0.90, 0.96, hexDist);
  } else if (uPlateMode == 4) {
    // 4 (triangle): equilateral triangular plate boundary
    clipPos = vec2(p.x / uAspect, p.y);
    float triDist = max(-p.y * s, max(0.8660254 * abs(p.x * s) + 0.5 * p.y * s, 0.0));
    vAlpha = 1.0 - smoothstep(0.85, 0.95, triDist);
  } else if (uPlateMode == 5) {
    // 5 (starMandala): 6-pointed star boundary
    clipPos = vec2(p.x / uAspect, p.y);
    float r = length(p * s);
    float theta = atan(p.y, p.x);
    float rStar = 0.88 + 0.10 * cos(6.0 * theta);
    vAlpha = 1.0 - smoothstep(rStar - 0.05, rStar + 0.02, r);
  } else if (uPlateMode == 6) {
    // 6 (morph): morphing boundary SDF
    clipPos = vec2(p.x / uAspect, p.y);
    float cycleTime = mod(uTime, 16.0);
    float stage = floor(cycleTime / 4.0);
    float frac = fract(cycleTime / 4.0);
    float tMorph = smoothstep(0.12, 0.88, frac);

    float dSq = max(abs(clipPos.x), abs(clipPos.y));
    float aSq = 1.0 - smoothstep(0.97, 1.03, dSq);

    vec2 pAbs = abs(p * s);
    float dHex = max(dot(pAbs, vec2(0.8660254, 0.5)), pAbs.y);
    float aHex = 1.0 - smoothstep(0.90, 0.96, dHex);

    float dTri = max(-p.y * s, max(0.8660254 * abs(p.x * s) + 0.5 * p.y * s, 0.0));
    float aTri = 1.0 - smoothstep(0.85, 0.95, dTri);

    float r = length(p * s);
    float theta = atan(p.y, p.x);
    float rStar = 0.88 + 0.10 * cos(6.0 * theta);
    float aStar = 1.0 - smoothstep(rStar - 0.05, rStar + 0.02, r);

    float aA = 0.0;
    float aB = 0.0;
    if (stage < 0.5) {
      aA = aSq; aB = aHex;
    } else if (stage < 1.5) {
      aA = aHex; aB = aTri;
    } else if (stage < 2.5) {
      aA = aTri; aB = aStar;
    } else {
      aA = aStar; aB = aSq;
    }
    vAlpha = mix(aA, aB, tMorph);
  } else {
    // 0 (fullscreen): mapped back to full clip-space
    clipPos = vec2(p.x / uAspect, p.y);
    float edgeDist = max(abs(clipPos.x), abs(clipPos.y));
    vAlpha = 1.0 - smoothstep(0.97, 1.03, edgeDist);
  }

  // 1.5px–2.5px gl.POINTS
  gl_PointSize = mix(1.5, 2.5, hash1) * uPointSize * max(1.0, uDpr);

  gl_Position = vec4(clipPos.x, clipPos.y, 0.0, 1.0);
}
