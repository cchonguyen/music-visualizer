#version 300 es
// Treble sparkle streaks. Each instance is one stretched quad; no vertex buffers.
// Particles spawn near the vanishing point and fly outward. Each quad is aligned
// with its direction of motion, so it reads as a streak.
precision highp float;

const float PI = 3.14159265;
const float TAU = 6.2831853;
const vec2 CORNERS[4] = vec2[4](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0));

uniform float uPhase;       // integrated phase, never decreases
uniform float uAspect;      // target width / height
uniform float uSwirl;       // midrange drive, 0..1 (0 in Calm)
uniform float uEnergy;      // track-relative loudness, 0..1: sets streak length
uniform float uTwinkleTime; // integrated seconds, drives the twinkle
uniform vec2 uSway;         // shared figure-eight sway, clip units (same as the tunnel)
uniform float uRotation;    // radians, turns the particle field about the screen centre (0 = none)
uniform float uZoom;        // scale about the screen centre, divide so >1 enlarges (1 = none)
uniform float uFar;         // outer radius in screen heights: hypot(aspect, 1) so the corners are reached
uniform float uSize;        // multiplies streak length and width (2 = doubled)
uniform float uFollow;      // 1 when the particles follow the scene (0 = off)
uniform vec2 uCentre;       // scene drift, added after the transform (height units)
uniform vec2 uStretch;      // scene stretch, applied after rotation (1 = none)
uniform float uWarp;        // scene wave warp (morph), 0..1, only used when following
uniform float uWarpScale;   // scene wave count
uniform float uWarpSpeed;   // scene wave speed
uniform float uTime;        // scene time in seconds
uniform int uMode;          // 0 = radial (default), 1 = phyllotaxis, 2 = starfield
uniform float uSubTwist;    // sub-bass twist for phyllotaxis
uniform float uFlowPhase;
uniform float uTwistPhase;
uniform float uDivergenceAngle; // divergence angle (e.g. 2.3999632 golden angle)
uniform float uPetalStretch;
uniform int uSeedShape;     // 0 = orb, 1 = petal, 2 = star
uniform float uKickEnv;
uniform float uBeatReactivity;
uniform sampler2D uTerrainTex;
uniform float uTerrainDisplace;
uniform float uTerrainWriteRow;
uniform float uFlash;       // high-band flash envelope, 0..1 (starfield sparkle bursts)
uniform float uCount;       // live particle count (the instance count drawn)
uniform int uSpawnArea;     // 0 = centre (default), 1 = ring, 2 = full screen, 3 = edges
uniform float uTwinkleRate; // multiplies the twinkle speed (1 = as before)
uniform float uTwinkleDepth;// 0..1: how far a twinkle dims a particle (0.55 = as before)

// Particles spawn at the inner rim of the tunnel (r = 0.16), so their origin moves
// with the rim: shifted by sway * (1 - 0.16). The tunnel hole and the emitter stay together.
const float INNER_RIM = 0.16;

out float vMix;             // 0..1: picks accent A or B per particle
out vec2 vLocal;            // quad corner, -1..1 (x along the streak, y across it)
out float vTwinkle;         // per-particle sharp twinkle, 0..1
out float vFade;            // 0 at spawn and at the edge, 1 mid-life

// Per-particle hash in [0, 1). Same formula as hash01() in particleState.ts.
// Different salts give independent values for speed, angle, swirl and twinkle.
float hash01(float index, float salt) {
  return fract(sin(index * 12.9898 + salt * 78.233) * 43758.5453);
}

void main() {
  float id = float(gl_InstanceID);

  if (uMode == 1) {
    // Phyllotaxis spiral bloom (Slice 7.14, Slice 7.29)
    // Continuous outward index: seeds continuously birth at the center and bloom outward
    float uIdx = mod(id + uFlowPhase * 24.0, uCount);
    float normR = sqrt(uIdx / uCount);

    // Travelling kick ripple wave
    float kickWave = sin(normR * 12.0 - uFlowPhase * 4.0) * uKickEnv;

    // Full-viewport radius: hypot(aspect, 1.0) * 1.05
    float r = normR * uFar;

    // Spiral angle with smooth mid twist and subtle radial distortion
    float theta = uIdx * uDivergenceAngle + uTwistPhase + 0.06 * sin(normR * 8.0 - uFlowPhase * 2.0);
    vec2 dir = vec2(cos(theta), sin(theta));
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 pos = dir * r;

    vLocal = CORNERS[gl_VertexID];

    // Coherent spiral-arm brightness wave along 8 and 13 Fibonacci parastichies (Slice 7.33)
    float armWave = 0.5 + 0.5 * sin(theta * 8.0 - normR * 18.0 + uFlowPhase * 2.5) * cos(theta * 5.0 + normR * 12.0 - uTwistPhase * 2.0);
    float quadSize = mix(0.016, 0.028, armWave) * uSize * (0.75 + 0.45 * normR);

    // Shape and orient each instanced quad according to uSeedShape:
    // 0 (orb): isotropic circular quad.
    // 1 (petal): radially oriented seed stretched along (cos(theta), sin(theta)) by uPetalStretch.
    // 2 (star): 4-pointed star flare.
    vec2 quadOffset = vec2(0.0);
    if (uSeedShape == 0) {
      quadOffset = (vec2(1.0, 0.0) * vLocal.x + vec2(0.0, 1.0) * vLocal.y) * quadSize;
    } else if (uSeedShape == 1) {
      quadOffset = (dir * (vLocal.x * uPetalStretch) + perp * vLocal.y) * quadSize;
    } else {
      float starScale = 1.0 + 0.25 * kickWave;
      quadOffset = (dir * vLocal.x + perp * vLocal.y) * quadSize * starScale;
    }

    vec2 origin = vec2(uSway.x * uAspect, uSway.y) * 0.2;
    vec2 center = origin + pos;
    if (uTerrainDisplace > 0.001) {
      float uCoord = clamp(center.x * 0.5 + 0.5, 0.0, 1.0);
      float tDepth = clamp((0.35 - center.y) / 0.9, 0.0, 1.0);
      float row = mod(mod(uTerrainWriteRow - (1.0 - tDepth) * 64.0, 64.0) + 64.0, 64.0);
      float vCoord = (row + 0.5) / 64.0;
      float terrainHeight = texture(uTerrainTex, vec2(uCoord, vCoord)).r;
      center.y += terrainHeight * uTerrainDisplace * 0.42;
    }
    vec2 point = center + quadOffset;

    // Smooth fade at birth and outer edge
    vFade = smoothstep(0.0, 0.05, normR) * (1.0 - smoothstep(0.88, 1.0, normR));

    // vMix maps warm golden-amber core to electric cyan/emerald at outer petals
    vMix = clamp(normR * 0.82 + 0.18 * kickWave, 0.0, 1.0);

    vTwinkle = mix(0.72, 1.15, armWave);

    float cosR = cos(uRotation);
    float sinR = sin(uRotation);
    vec2 turned = (vec2(cosR * point.x - sinR * point.y, sinR * point.x + cosR * point.y) * uStretch) / uZoom + uCentre;
    gl_Position = vec4(turned.x / uAspect, turned.y, 0.0, 1.0);
    return;
  }

  if (uMode == 2) {
    // Starfield: each star has a fixed direction and flies toward the viewer. Depth z goes from 1 (far)
    // to 0.04 (near); the perspective divide pos = anchor * 0.25 / z sweeps it from the centre out past the edge.
    // Nearer stars are bigger, brighter and leave longer streaks. uPhase is energy-driven, so loud music flies faster.
    float sSeed = hash01(id, 0.0);
    float sLife = fract(uPhase * mix(0.06, 0.16, hash01(id, 1.0)) + sSeed);
    float z = max(0.04, 1.0 - sLife);
    float a = hash01(id, 2.0) * TAU;
    float rr = 0.15 + 0.85 * sqrt(hash01(id, 7.0));
    vec2 anchor = vec2(cos(a), sin(a)) * rr * vec2(uAspect, 1.0);
    vec2 sPos = anchor * (0.25 / z);
    vec2 sAxis = normalize(sPos);
    vec2 sPerp = vec2(-sAxis.y, sAxis.x);
    float near = sLife;
    float sSize = (0.4 + 1.6 * near) * uSize;
    float sLen = (0.004 + 0.05 * near * near * (0.3 + clamp(uEnergy, 0.0, 1.0))) * uSize;
    float sHalf = mix(0.0015, 0.003, hash01(id, 6.0)) * sSize;
    vLocal = CORNERS[gl_VertexID];
    float st = vLocal.x * 0.5 + 0.5;
    vec2 sPoint = sPos - sAxis * sLen * (1.0 - st) + sPerp * vLocal.y * sHalf;
    vMix = hash01(id, 6.0);
    vFade = smoothstep(0.0, 0.12, sLife) * smoothstep(0.0, 0.06, z);
    float stw = 0.5 + 0.5 * sin(uTwinkleTime * mix(6.0, 14.0, hash01(id, 4.0)) * uTwinkleRate + hash01(id, 5.0) * TAU);
    float burst = (hash01(id, 10.0) < 0.4 * uFlash) ? 1.8 : 1.0;
    vTwinkle = (1.0 - uTwinkleDepth * (1.0 - stw * stw)) * mix(0.35, 1.0, near) * burst;
    float sc = cos(uRotation);
    float ss = sin(uRotation);
    vec2 sTurned = (vec2(sc * sPoint.x - ss * sPoint.y, ss * sPoint.x + sc * sPoint.y) * uStretch) / uZoom + uCentre;
    gl_Position = vec4(sTurned.x / uAspect, sTurned.y, 0.0, 1.0);
    return;
  }

  float seed = hash01(id, 0.0);                    // spawn offset along the life cycle
  vec2 aSeed = vec2(seed, hash01(id, 6.0));
  vMix = aSeed.y;
  float speed = mix(0.06, 0.16, hash01(id, 1.0));  // per-particle life rate
  float angleBase = hash01(id, 2.0) * TAU;         // starting direction
  float swirlDir = mix(-1.2, 1.2, hash01(id, 3.0)); // curl direction, sign varies per particle

  // Life comes from the phase accumulator, so motion never jumps when energy changes.
  float life = fract(uPhase * speed + seed);

  // Spawn (C3): the centre area starts every particle at the crown bar tips, r = 0.16.
  // Radius follows tunnel depth: depth = 1/r is linear in life, so r = 1 / mix(1/0.16, 1/uFar, life).
  // The ring area starts them further out, on a ring around the centre.
  float spawnRim = (uSpawnArea == 1) ? 0.4 : INNER_RIM;
  float depthNear = 1.0 / spawnRim;
  float depthFar = 1.0 / uFar;
  float radius = (1.0 / mix(depthNear, depthFar, life)) * 2.1;
  // The swirl adds a small angular turn over the life, so trails bend gently.
  float angle = angleBase + swirlDir * uSwirl * life;
  vec2 dir = vec2(cos(angle), sin(angle));
  vec2 pos;
  vec2 vel;
  if (uSpawnArea == 2) {
    // Full screen: each particle sits at its own spot and drifts slowly outward.
    vec2 anchor = vec2((hash01(id, 7.0) * 2.0 - 1.0) * uAspect, hash01(id, 8.0) * 2.0 - 1.0);
    pos = anchor + dir * life * 0.25;
    vel = dir * 0.25;
  } else if (uSpawnArea == 3) {
    // Edges: start on the screen border and drift in towards the centre.
    vec2 onEdge = dir / max(abs(dir.x) / uAspect, abs(dir.y));
    pos = onEdge * (1.0 - 0.75 * life);
    vel = -onEdge * 0.75;
  } else {
    pos = dir * radius;
    // Motion direction = d(pos)/d(life): the radial part plus the swirl part.
    // dr/dlife = (depthNear - depthFar) * r^2: the same flow speed as the tunnel rings.
    float dRadius = (depthNear - depthFar) * radius * radius;
    vel = dRadius * dir + radius * swirlDir * uSwirl * vec2(-dir.y, dir.x);
  }
  // Morph (follow scene): the scene's wave warp moves each particle sideways as it travels.
  float wave = uFollow * uWarp * 0.06 * sin(uTime * uWarpSpeed + life * TAU * uWarpScale + seed * TAU);
  pos += vec2(-dir.y, dir.x) * wave;

  // The streak lies along the motion vector, so it points where the particle is going.
  vec2 axis = normalize(vel);
  vec2 perp = vec2(-axis.y, axis.x);

  // Streak length grows with energy and with life (the streak stretches as it flies out).
  float streakLen = (0.006 + 0.025 * clamp(uEnergy, 0.0, 1.0) * life) * uSize;
  // Half-width of the streak, 0.0025..0.005 per particle.
  float halfWidth = mix(0.0025, 0.005, seed) * uSize;

  vLocal = CORNERS[gl_VertexID];
  // Head (x = 1) sits on the particle; the tail trails behind it along -axis.
  float t = vLocal.x * 0.5 + 0.5;
  vec2 origin = vec2(uSway.x * uAspect, uSway.y) * (1.0 - INNER_RIM);
  vec2 center = origin + pos;
  if (uTerrainDisplace > 0.001) {
    float uCoord = clamp(center.x * 0.5 + 0.5, 0.0, 1.0);
    float tDepth = clamp((0.35 - center.y) / 0.9, 0.0, 1.0);
    float row = mod(mod(uTerrainWriteRow - (1.0 - tDepth) * 64.0, 64.0) + 64.0, 64.0);
    float vCoord = (row + 0.5) / 64.0;
    float terrainHeight = texture(uTerrainTex, vec2(uCoord, vCoord)).r;
    center.y += terrainHeight * uTerrainDisplace * 0.42;
  }
  vec2 point = center - axis * streakLen * (1.0 - t) + perp * vLocal.y * halfWidth;

  // Widen edge fade so streaks stay visible right up to the edge of the 16:9 viewport
  vFade = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.85, 1.0, life));

  // Twinkle: softened so flow-field and radial particles stay smoothly visible as they drift
  float twRate = mix(6.0, 14.0, hash01(id, 4.0)) * uTwinkleRate;
  float twPhase = hash01(id, 5.0) * TAU;
  float tw = 0.5 + 0.5 * sin(uTwinkleTime * twRate + twPhase);
  vTwinkle = 1.0 - uTwinkleDepth * (1.0 - tw * tw);

  // Aspect correction: x is scaled by 1/aspect so streaks keep their true shape.
  // Transform (4.7): rotate, then zoom. Done on the height-normalised point, before the
  // aspect divide, so the rotation is a true rotation on a wide screen. Defaults (0, 1) are identity.
  float c = cos(uRotation);
  float s = sin(uRotation);
  // Follow (2026-11-06): stretch and drift from the scene are identity when the switch is off.
  vec2 turned = (vec2(c * point.x - s * point.y, s * point.x + c * point.y) * uStretch) / uZoom + uCentre;
  gl_Position = vec4(turned.x / uAspect, turned.y, 0.0, 1.0);
}
