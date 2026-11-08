#version 300 es
// FerrofluidLayer vertex shader (Slice 7.15)
// 3D curl/harmonic lobe displacement & magnetic spike extrusion on 4-subdivision icosahedron.
precision highp float;

layout(location = 0) in vec3 aPosition; // Unit sphere vertex (||aPosition|| == 1.0)

uniform float uAspect;
uniform float uTime;
uniform float u_sub;
uniform float u_mid;
uniform float u_kickEnv;
uniform float uRadius;
uniform float uSpikeAmp;
uniform float uSpikeFreq;
uniform float uSpikeSharp;
uniform float uRotSpeed;

out vec3 vNormal;    // View-space perturbed surface normal
out vec3 vView;      // View-space direction to eye
out float vSpike;    // Local spike height
out float vHeight;   // Local total surface height above base
out vec3 vLocalPos;  // Displaced model-space position

// Ashima Arts / Stefan Gustavson Simplex 3D Noise
vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Organic fluid lobes & sharp magnetic spike extrusion on unit sphere direction
vec3 displace(vec3 dir) {
  float baseRadius = uRadius * (1.0 + 0.35 * clamp(u_sub, 0.0, 1.0));
  float uSub = clamp(u_sub, 0.0, 1.0);
  float uMid = clamp(u_mid, 0.0, 1.0);

  // Low-order 3D spherical-harmonic / signed simplex fluid lobes
  float lobe2 = snoise(dir * 1.35 + vec3(uTime * 0.38, -uTime * 0.31, uTime * 0.27));
  float lobe3 = sin(dir.x * 2.5 + uTime * 0.7) * cos(dir.y * 2.2 - uTime * 0.55) * sin(dir.z * 2.5 + uTime * 0.6);
  float fluidBody = baseRadius * (1.0 + (0.22 * lobe2 + 0.14 * lobe3) * (0.65 + 0.6 * uSub + 0.4 * uMid));

  // Spike spatial frequency controlled by mid-band
  float spikeFreq = uSpikeFreq * mix(2.6, 6.2, uMid);

  // Sharpness exponent driven by kick envelope
  float sharpExp = mix(uSpikeSharp, uSpikeSharp + 3.0, clamp(u_kickEnv, 0.0, 1.0));
  float kickVal = clamp(u_kickEnv, 0.0, 1.0);

  vec3 c1 = dir * spikeFreq + vec3(0.0, uTime * 0.35, 0.0);
  vec3 c2 = dir * (spikeFreq * 2.1) - vec3(uTime * 0.25, 0.0, uTime * 0.25);

  float n1 = snoise(c1);
  float n2 = 0.5 * snoise(c2);
  float raw = (n1 + n2) * 0.5 + 0.5;

  // Sharp magnetic spike extrusion: power curve transforms harmonic mounds into sharp cones
  float sharp = pow(clamp(raw, 0.0, 1.0), sharpExp);
  float extrusion = uSpikeAmp * (0.15 + 1.25 * kickVal) * sharp;

  return dir * (fluidBody + extrusion);
}

void main() {
  vec3 p = normalize(aPosition);

  // Orthonormal tangent basis on sphere at p
  vec3 up = abs(p.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 T1 = normalize(cross(up, p));
  vec3 T2 = normalize(cross(p, T1));

  // Finite differences along tangent vectors
  float eps = 0.015;
  vec3 p1 = normalize(p + eps * T1);
  vec3 p2 = normalize(p + eps * T2);

  vec3 pos0 = displace(p);
  vec3 pos1 = displace(p1);
  vec3 pos2 = displace(p2);

  vec3 v1 = pos1 - pos0;
  vec3 v2 = pos2 - pos0;
  vec3 perturbedNormal = normalize(cross(v1, v2));
  if (dot(perturbedNormal, p) < 0.0) {
    perturbedNormal = -perturbedNormal;
  }

  // 3D rotation matrix
  float rotY = uTime * uRotSpeed;
  float rotX = 0.35 + 0.15 * sin(uTime * (uRotSpeed * 0.7));

  float cy = cos(rotY);
  float sy = sin(rotY);
  mat3 mRotY = mat3(
    cy, 0.0, sy,
    0.0, 1.0, 0.0,
    -sy, 0.0, cy
  );

  float cx = cos(rotX);
  float sx = sin(rotX);
  mat3 mRotX = mat3(
    1.0, 0.0, 0.0,
    0.0, cx, -sx,
    0.0, sx, cx
  );

  mat3 rotMatrix = mRotX * mRotY;

  vec3 worldPos = rotMatrix * pos0;
  vec3 worldNormal = normalize(rotMatrix * perturbedNormal);

  vec3 eyePos = vec3(0.0, 0.0, 2.4);
  vec3 V = normalize(eyePos - worldPos);

  vNormal = worldNormal;
  vView = V;
  vHeight = length(pos0) - uRadius;
  vSpike = vHeight;
  vLocalPos = pos0;

  // Perspective projection
  float dist = eyePos.z - worldPos.z;
  float fov = 1.85;
  float near = 0.5;
  float far = 5.0;
  float z_ndc = (dist - near) / (far - near) * 2.0 - 1.0;

  gl_Position = vec4(
    (worldPos.x * fov) / uAspect,
    worldPos.y * fov,
    z_ndc * dist,
    dist
  );
}
