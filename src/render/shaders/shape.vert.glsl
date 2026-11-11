#version 300 es
precision highp float;
precision highp int;

// 16 instance slots for propagation
uniform vec2 uInstOffset[16];
uniform vec4 uInstTransform[16]; // x: scale, y: rotation (rad), z: alpha, w: delay attenuation

uniform int uBaseShape;        // 0: centerLine, 1: edgeLine, 2: circle, 3: arc, 4: polygon, 5: star, 6: spiral, 7: figure8
uniform int uEdgeMode;         // 0: bottom, 1: top, 2: dualHorizontal, 3: dualVertical, 4: frame
uniform int uSides;            // 3..12
uniform float uStarInner;      // 0.2..0.9
uniform float uCornerRadius;   // 0..0.5
uniform float uArcSweep;       // 0.1..1.0
uniform float uSpiralTurns;    // 1..5
uniform float uSize;           // 0.1..2.0
uniform float uBasePulse;      // 0..1.0
uniform float uKickEnergy;     // 0..1.0
uniform vec2 uRes;
uniform float uAspect;         // width / height
uniform int uNormalMode;       // 0: radial, 1: perpendicular
uniform int uSymmetry;         // 0: wrap, 1: mirror, 2: repeat2, 3: repeat4
uniform int uExtrudeDir;       // 0: outward, 1: inward, 2: bilateral, 3: alternating
uniform int uEffectType;       // 0: solidLine, 1: pulsingLine, 2: waveform, 3: harmonicWave, 4: bars, 5: segmentedBars, 6: dots, 7: auroraFill
uniform int uSampleCount;      // 16..256
uniform float uEffectLength;   // 0.05..1.5
uniform float uThickness;      // 0.5..10.0
uniform int uPeakCaps;         // 0 or 1
uniform float uTime;
uniform int uIsRibbon;         // 1: ribbon (TRIANGLE_STRIP), 0: discrete quads

uniform sampler2D uAudioTex;
uniform sampler2D uPeakTex;

out vec2 vLocalUv;
out float vAudioAmp;
out float vPeakHold;
out float vAlpha;
out float vU;
out float vUAudio;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;

void evaluateBaseCurve(
  float u,
  float effSize,
  out vec2 P0,
  out vec2 T0,
  out vec2 N0
) {
  if (uBaseShape == 0) {
    // centerLine
    P0 = vec2((2.0 * u - 1.0) * effSize * uAspect, 0.0);
    T0 = vec2(1.0, 0.0);
    N0 = vec2(0.0, 1.0);
  } else if (uBaseShape == 1) {
    // edgeLine
    float railW = 0.92 * uAspect * effSize;
    float railH = 0.92 * effSize;
    if (uEdgeMode == 0) {
      // bottom rail (canonical normal points into screen)
      P0 = vec2((2.0 * u - 1.0) * railW, -railH);
      T0 = vec2(1.0, 0.0);
      N0 = vec2(0.0, 1.0);
    } else if (uEdgeMode == 1) {
      // top rail
      P0 = vec2((2.0 * u - 1.0) * railW, railH);
      T0 = vec2(-1.0, 0.0);
      N0 = vec2(0.0, -1.0);
    } else if (uEdgeMode == 2) {
      // dualHorizontal
      if (u < 0.5) {
        float subU = u * 2.0;
        P0 = vec2((2.0 * subU - 1.0) * railW, -railH);
        T0 = vec2(1.0, 0.0);
        N0 = vec2(0.0, 1.0);
      } else {
        float subU = (u - 0.5) * 2.0;
        P0 = vec2((2.0 * subU - 1.0) * railW, railH);
        T0 = vec2(-1.0, 0.0);
        N0 = vec2(0.0, -1.0);
      }
    } else if (uEdgeMode == 3) {
      // dualVertical
      if (u < 0.5) {
        float subU = u * 2.0;
        P0 = vec2(-railW, (2.0 * subU - 1.0) * railH);
        T0 = vec2(0.0, 1.0);
        N0 = vec2(1.0, 0.0);
      } else {
        float subU = (u - 0.5) * 2.0;
        P0 = vec2(railW, (2.0 * subU - 1.0) * railH);
        T0 = vec2(0.0, -1.0);
        N0 = vec2(-1.0, 0.0);
      }
    } else {
      // frame: 4 rails
      if (u < 0.25) {
        float fu = u / 0.25;
        P0 = vec2(mix(-railW, railW, fu), -railH);
        T0 = vec2(1.0, 0.0);
        N0 = vec2(0.0, 1.0);
      } else if (u < 0.5) {
        float fu = (u - 0.25) / 0.25;
        P0 = vec2(railW, mix(-railH, railH, fu));
        T0 = vec2(0.0, 1.0);
        N0 = vec2(-1.0, 0.0);
      } else if (u < 0.75) {
        float fu = (u - 0.5) / 0.25;
        P0 = vec2(mix(railW, -railW, fu), railH);
        T0 = vec2(-1.0, 0.0);
        N0 = vec2(0.0, -1.0);
      } else {
        float fu = (u - 0.75) / 0.25;
        P0 = vec2(-railW, mix(railH, -railH, fu));
        T0 = vec2(0.0, -1.0);
        N0 = vec2(1.0, 0.0);
      }
    }
  } else if (uBaseShape == 2) {
    // circle
    float theta = TAU * u;
    P0 = effSize * vec2(cos(theta), sin(theta));
    T0 = vec2(-sin(theta), cos(theta));
    N0 = vec2(cos(theta), sin(theta));
  } else if (uBaseShape == 3) {
    // arc
    float theta = ((u - 0.5) * uArcSweep) * TAU + (0.5 * PI);
    P0 = effSize * vec2(cos(theta), sin(theta));
    T0 = vec2(-sin(theta), cos(theta));
    N0 = vec2(cos(theta), sin(theta));
  } else if (uBaseShape == 4) {
    // polygon
    int K = clamp(uSides, 3, 12);
    float s = u * float(K);
    int k = int(floor(s)) % K;
    float f = fract(s);
    int kNext = (k + 1) % K;
    int kPrev = (k - 1 + K) % K;
    float a0 = TAU * float(k) / float(K);
    float a1 = TAU * float(kNext) / float(K);
    float aP = TAU * float(kPrev) / float(K);
    vec2 Vk = effSize * vec2(cos(a0), sin(a0));
    vec2 Vnext = effSize * vec2(cos(a1), sin(a1));
    vec2 Vprev = effSize * vec2(cos(aP), sin(aP));

    float cr = min(0.45, uCornerRadius);
    if (cr > 0.001 && f < cr) {
      float t = 0.5 + 0.5 * (f / cr);
      vec2 p0 = mix(Vk, Vprev, cr);
      vec2 p2 = mix(Vk, Vnext, cr);
      P0 = mix(mix(p0, Vk, t), mix(Vk, p2, t), t);
    } else if (cr > 0.001 && f > (1.0 - cr)) {
      float t = 0.5 * ((f - (1.0 - cr)) / cr);
      int kNext2 = (kNext + 1) % K;
      float a2 = TAU * float(kNext2) / float(K);
      vec2 Vnext2 = effSize * vec2(cos(a2), sin(a2));
      vec2 p0 = mix(Vnext, Vk, cr);
      vec2 p2 = mix(Vnext, Vnext2, cr);
      P0 = mix(mix(p0, Vnext, t), mix(Vnext, p2, t), t);
    } else {
      P0 = mix(Vk, Vnext, f);
    }
    vec2 diff = Vnext - Vk;
    float lenDiff = length(diff);
    T0 = (lenDiff > 0.0001) ? (diff / lenDiff) : vec2(1.0, 0.0);
    N0 = vec2(-T0.y, T0.x);
  } else if (uBaseShape == 5) {
    // star
    int K = clamp(uSides, 3, 12);
    int Npts = 2 * K;
    float s = u * float(Npts);
    int k = int(floor(s)) % Npts;
    float f = fract(s);
    int kNext = (k + 1) % Npts;
    int kPrev = (k - 1 + Npts) % Npts;

    float rk = ((k % 2) == 0) ? effSize : (effSize * uStarInner);
    float rNext = (((k + 1) % 2) == 0) ? effSize : (effSize * uStarInner);
    float rPrev = (((k - 1 + Npts) % 2) == 0) ? effSize : (effSize * uStarInner);

    float a0 = TAU * float(k) / float(Npts);
    float a1 = TAU * float(kNext) / float(Npts);
    float aP = TAU * float(kPrev) / float(Npts);

    vec2 Vk = rk * vec2(cos(a0), sin(a0));
    vec2 Vnext = rNext * vec2(cos(a1), sin(a1));
    vec2 Vprev = rPrev * vec2(cos(aP), sin(aP));

    float cr = min(0.45, uCornerRadius);
    if (cr > 0.001 && f < cr) {
      float t = 0.5 + 0.5 * (f / cr);
      vec2 p0 = mix(Vk, Vprev, cr);
      vec2 p2 = mix(Vk, Vnext, cr);
      P0 = mix(mix(p0, Vk, t), mix(Vk, p2, t), t);
    } else if (cr > 0.001 && f > (1.0 - cr)) {
      float t = 0.5 * ((f - (1.0 - cr)) / cr);
      int kNext2 = (kNext + 1) % Npts;
      float rNext2 = (((kNext + 1) % 2) == 0) ? effSize : (effSize * uStarInner);
      float a2 = TAU * float(kNext2) / float(Npts);
      vec2 Vnext2 = rNext2 * vec2(cos(a2), sin(a2));
      vec2 p0 = mix(Vnext, Vk, cr);
      vec2 p2 = mix(Vnext, Vnext2, cr);
      P0 = mix(mix(p0, Vnext, t), mix(Vnext, p2, t), t);
    } else {
      P0 = mix(Vk, Vnext, f);
    }
    vec2 diff = Vnext - Vk;
    float lenDiff = length(diff);
    T0 = (lenDiff > 0.0001) ? (diff / lenDiff) : vec2(1.0, 0.0);
    N0 = vec2(-T0.y, T0.x);
  } else if (uBaseShape == 6) {
    // Logarithmic spiral: r(theta) = a * exp(b * theta)
    // Parameterized by u in [0, 1]: theta = TAU * uSpiralTurns * u
    // r(u) = effSize * exp(-k * (1.0 - u)), where k controls geometric expansion
    float theta = TAU * uSpiralTurns * u;
    float k = 3.0;
    float r = effSize * exp(-k * (1.0 - u));
    P0 = r * vec2(cos(theta), sin(theta));
    // Tangent dr/du = r * (k * (cos, sin) + TAU * uSpiralTurns * (-sin, cos))
    vec2 dr = k * vec2(cos(theta), sin(theta)) + TAU * uSpiralTurns * vec2(-sin(theta), cos(theta));
    float lenDr = length(dr);
    T0 = (lenDr > 0.0001) ? (dr / lenDr) : vec2(cos(theta), sin(theta));
    N0 = vec2(-T0.y, T0.x);
  } else {
    // figure8
    float theta = TAU * u;
    P0 = effSize * vec2(sin(theta), 0.55 * sin(2.0 * theta));
    vec2 dr = effSize * vec2(cos(theta), 1.1 * cos(2.0 * theta));
    float lenDr = length(dr);
    T0 = (lenDr > 0.0001) ? (dr / lenDr) : vec2(1.0, 0.0);
    N0 = vec2(-T0.y, T0.x);
  }

  // Normal mode selection
  if (uBaseShape >= 2) {
    if (uNormalMode == 0) { // radial
      float lenP = length(P0);
      if (lenP > 0.0001) {
        N0 = P0 / lenP;
      }
    }
  }
}

void main() {
  int propIdx = 0;
  int sampleIdx = 0;
  float u = 0.0;
  float side = 0.0;

  if (uIsRibbon == 1) {
    propIdx = gl_InstanceID;
    int vertId = gl_VertexID;
    int segIdx = vertId / 2;
    side = (vertId % 2 == 0) ? -1.0 : 1.0;
    u = clamp(float(segIdx) / float(max(1, uSampleCount)), 0.0, 1.0);
    sampleIdx = segIdx;
  } else {
    propIdx = gl_InstanceID / max(1, uSampleCount);
    sampleIdx = gl_InstanceID % max(1, uSampleCount);
    u = (float(sampleIdx) + 0.5) / float(max(1, uSampleCount));
  }

  // Symmetry mapping to audio coordinate uAudio
  float uAudio = u;
  if (uSymmetry == 1) { // mirror: 0 -> 1 -> 0
    uAudio = 1.0 - abs(2.0 * u - 1.0);
  } else if (uSymmetry == 2) { // repeat2
    uAudio = fract(2.0 * u);
  } else if (uSymmetry == 3) { // repeat4
    uAudio = 1.0 - abs(2.0 * fract(2.0 * u) - 1.0);
  }
  uAudio = clamp(uAudio, 0.0, 1.0);

  // Sample audio amplitude and peak hold (ceiling matches SHAPE_AMP_MAX in shape.ts)
  const float AMP_MAX = 10.0;
  float audioAmp = min(texture(uAudioTex, vec2(uAudio, 0.5)).r, AMP_MAX);
  float peakHold = min(texture(uPeakTex, vec2(uAudio, 0.5)).r, AMP_MAX);

  // Apply instance audio delay attenuation
  float delayScale = uInstTransform[propIdx].w;
  audioAmp *= delayScale;
  peakHold *= delayScale;

  float effSize = uSize * (1.0 + uBasePulse * uKickEnergy);

  vec2 P0, T0, N0;
  evaluateBaseCurve(u, effSize, P0, T0, N0);

  // Maximum amplitude for quad sizing
  float maxAmp = (uPeakCaps == 1 && (uEffectType == 4 || uEffectType == 5)) ? max(audioAmp, peakHold) : audioAmp;
  if (uEffectType == 0) { // solidLine
    maxAmp = 0.0;
  }
  // Scale element size & effect amplitude as it goes toward the center on spirals
  float spiralScale = (uBaseShape == 6) ? clamp(length(P0) / effSize, 0.15, 1.0) : 1.0;
  float delta = maxAmp * uEffectLength * spiralScale;

  if (uEffectType == 3) { // harmonicWave
    delta += 0.15 * sin(u * 16.0 * PI + uTime * 4.0) * audioAmp * uEffectLength;
  }

  // Extrusion vector computation
  int dir = uExtrudeDir;
  if (dir == 3) { // alternating
    dir = (sampleIdx % 2 == 0) ? 0 : 1;
  }

  // Center anti-inversion clamping for inward extrusion + rhythmic alternating scale
  float maxInward = 0.92 * length(P0);
  // Rhythmic height decimation on inward extrusion to prevent visual crowding at center
  float inwardDecimate = 1.0;
  if (dir == 1 || (uExtrudeDir == 3 && (sampleIdx % 2 != 0))) {
    // 1 of every 2 bars is full height, intermediate bars are 0.55x height
    inwardDecimate = (sampleIdx % 2 == 0) ? 1.0 : 0.55;
  }
  float clampedDelta = min(max(0.0, delta * inwardDecimate), maxInward);

  vec2 extrudeBase = P0;
  vec2 extrudeTip = P0;

  if (dir == 0) { // outward
    extrudeTip = P0 + delta * N0;
  } else if (dir == 1) { // inward
    extrudeTip = P0 - clampedDelta * N0;
  } else if (dir == 2) { // bilateral
    extrudeBase = P0 - 0.5 * delta * N0;
    extrudeTip = P0 + 0.5 * delta * N0;
  }

  vec2 P;
  if (uIsRibbon == 1) {
    if (uEffectType == 7) { // auroraFill
      float tSide = (side + 1.0) * 0.5;
      P = mix(extrudeBase, extrudeTip, tSide);
      vLocalUv = vec2(side, tSide);
    } else {
      // Line/wave ribbons
      float halfWidth = 0.003 * uThickness * spiralScale;
      vec2 ribNorm = (uBaseShape <= 1) ? N0 : vec2(-T0.y, T0.x);
      P = extrudeTip + side * halfWidth * ribNorm;
      vLocalUv = vec2(side, 0.5);
    }
  } else {
    // Discrete elements (bars, segmentedBars, dots)
    int vertId = gl_VertexID;
    float barWidth = (effSize / float(max(1, uSampleCount))) * 0.5 * (uThickness / 3.0) * spiralScale;
    vec2 widthOffset = T0 * barWidth;

    if (uEffectType == 6) { // dots
      vec2 qCorner = vec2(
        (vertId == 0 || vertId == 2) ? -1.0 : 1.0,
        (vertId == 0 || vertId == 1) ? -1.0 : 1.0
      );
      float dotRadius = 0.008 * uThickness * spiralScale;
      P = extrudeTip + qCorner.x * T0 * dotRadius + qCorner.y * N0 * dotRadius;
      vLocalUv = qCorner;
    } else {
      // bars or segmentedBars
      vec2 qCorner;
      if (vertId == 0) {
        P = extrudeBase - widthOffset;
        qCorner = vec2(-1.0, 0.0);
      } else if (vertId == 1) {
        P = extrudeBase + widthOffset;
        qCorner = vec2(1.0, 0.0);
      } else if (vertId == 2) {
        P = extrudeTip - widthOffset;
        qCorner = vec2(-1.0, 1.0);
      } else {
        P = extrudeTip + widthOffset;
        qCorner = vec2(1.0, 1.0);
      }
      vLocalUv = qCorner;
    }
  }

  // Apply propagation instance affine transform (scale, rotation, offset)
  float instScale = uInstTransform[propIdx].x;
  float instRot = uInstTransform[propIdx].y;
  float instAlpha = uInstTransform[propIdx].z;

  P *= instScale;
  float cosR = cos(instRot);
  float sinR = sin(instRot);
  P = vec2(P.x * cosR - P.y * sinR, P.x * sinR + P.y * cosR);
  P += uInstOffset[propIdx];

  // Screen aspect mapping: normalize X by target aspect
  gl_Position = vec4(P.x / uAspect, P.y, 0.0, 1.0);

  // Colour uses the size of the signal; the scope source can be negative.
  vAudioAmp = abs(audioAmp);
  vPeakHold = peakHold;
  vAlpha = instAlpha;
  vU = u;
  vUAudio = uAudio;
}
