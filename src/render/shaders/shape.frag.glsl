#version 300 es
precision highp float;
precision highp int;

in vec2 vLocalUv;
in float vAudioAmp;
in float vPeakHold;
in float vAlpha;
in float vU;
in float vUAudio;

out vec4 fragColor;

uniform int uEffectType;       // 0: solidLine, 1: pulsingLine, 2: waveform, 3: harmonicWave, 4: bars, 5: segmentedBars, 6: dots, 7: auroraFill
uniform int uColorMode;        // 0: solid, 1: palette, 2: frequencyGradient, 3: amplitudeHot
uniform vec3 uSolidColor;
uniform vec3 uBaseColor;
uniform vec3 uAccentA;
uniform vec3 uAccentB;
uniform float uBarGap;         // 0..0.8
uniform int uLedSegments;      // 2..24
uniform int uPeakCaps;         // 0 or 1
uniform float uGlow;           // 0..2.0
uniform float uLayerOpacity;   // 0..1.0

vec3 spectralColor(float t) {
  // Rainbow spectral gradient: 0 (bass/magenta) -> blue -> cyan -> green -> yellow -> white (treble)
  vec3 a = vec3(0.5, 0.5, 0.5);
  vec3 b = vec3(0.5, 0.5, 0.5);
  vec3 c = vec3(1.0, 1.0, 1.0);
  vec3 d = vec3(0.0, 0.33, 0.67);
  return clamp(a + b * cos(6.2831853 * (c * t + d)), 0.0, 1.0);
}

vec3 hotColor(float h) {
  // Thermal heatmap gradient: 0 = deep navy/purple, 0.33 = electric cyan, 0.66 = neon yellow, 1.0 = blazing white
  if (h < 0.33) {
    return mix(vec3(0.04, 0.04, 0.18), vec3(0.0, 0.85, 0.95), h / 0.33);
  } else if (h < 0.7) {
    return mix(vec3(0.0, 0.85, 0.95), vec3(1.0, 0.92, 0.12), (h - 0.33) / 0.37);
  } else {
    return mix(vec3(1.0, 0.92, 0.12), vec3(1.0, 1.0, 1.0), (h - 0.7) / 0.3);
  }
}

void main() {
  float alpha = 1.0;
  bool isCap = false;

  if (uEffectType == 4 || uEffectType == 5) {
    // bars (4) or segmentedBars (5)
    float qx = abs(vLocalUv.x);
    if (qx > (1.0 - uBarGap)) {
      discard;
    }

    float qy = vLocalUv.y;
    float maxAmp = (uPeakCaps == 1) ? max(vAudioAmp, vPeakHold) : vAudioAmp;
    float barRatio = (maxAmp > 0.001) ? clamp(vAudioAmp / maxAmp, 0.0, 1.0) : 0.0;
    float peakRatio = (maxAmp > 0.001) ? clamp(vPeakHold / maxAmp, 0.0, 1.0) : 0.0;

    bool inBody = (qy <= barRatio);
    if (uPeakCaps == 1 && vPeakHold > 0.02) {
      if (abs(qy - peakRatio) <= 0.04) {
        isCap = true;
      }
    }

    if (!inBody && !isCap) {
      discard;
    }

    // Segmented bar ticks
    if (inBody && uEffectType == 5 && barRatio > 0.01) {
      float segPhase = fract((qy / barRatio) * float(uLedSegments));
      if (segPhase > 0.82) {
        discard;
      }
    }

    alpha = 1.0;
  } else if (uEffectType == 6) {
    // dots: circular glowing disks
    float r = length(vLocalUv);
    if (r > 1.0) {
      discard;
    }
    alpha = 1.0 - smoothstep(0.75, 1.0, r);
  } else if (uEffectType == 7) {
    // auroraFill: smooth gradient from base (y=0) to tip (y=1)
    float qy = vLocalUv.y;
    alpha = smoothstep(0.0, 0.12, qy) * (1.0 - 0.45 * qy);
  } else {
    // continuous ribbons (solidLine, pulsingLine, waveform, harmonicWave)
    float dist = abs(vLocalUv.x);
    if (dist > 1.0) {
      discard;
    }
    alpha = 1.0 - smoothstep(0.75, 1.0, dist);
  }

  // Base color evaluation
  vec3 col;
  if (uColorMode == 0) {
    // solid
    col = uSolidColor;
  } else if (uColorMode == 1) {
    // palette
    vec3 accent = mix(uAccentA, uAccentB, vUAudio);
    col = mix(uBaseColor, accent, 0.8 + 0.2 * vAudioAmp);
  } else if (uColorMode == 2) {
    // frequencyGradient
    col = spectralColor(vUAudio);
  } else {
    // amplitudeHot
    float hot = (uEffectType == 4 || uEffectType == 5) ? vLocalUv.y : vAudioAmp;
    col = hotColor(hot);
  }

  // Floating peak cap highlights pure white/accent
  if (isCap) {
    col = mix(col, vec3(1.0, 1.0, 1.0), 0.85);
    alpha = 1.0;
  }

  // Configurable glow enhancement
  col += col * (uGlow * 0.75);

  float finalAlpha = alpha * vAlpha * uLayerOpacity;
  if (finalAlpha < 0.003) {
    discard;
  }

  fragColor = vec4(col, finalAlpha);
}
