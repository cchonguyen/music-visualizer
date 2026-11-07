#version 300 es
precision highp float;

layout(location = 0) in vec2 aVertex; // x = binIndex (0..127), y = isSkirtBottom (0.0 = top, 1.0 = bottom)

uniform sampler2D uHistoryTex; // TEXTURE5 private 128x64 ring-buffer texture
uniform int uHeadRow;          // 0..63
uniform int uRidgeIndex;       // 0..63 (0 = back/horizon, 63 = front/foreground)
uniform float uRidgeCount;     // 64.0
uniform float uElevationScale; // peak height scale
uniform float uTerrainWidth;   // terrain width scale
uniform float uHorizonY;       // horizon Y coordinate
uniform float uForegroundY;    // foreground Y coordinate
uniform vec3 uAccent;
uniform vec3 uBase;
uniform float uBrightness;
uniform int uIsSkirtPass;      // 1 = occlusion skirt pass, 0 = glowing line pass

out vec4 vColor;

void main() {
  float binIndex = aVertex.x;
  float isSkirtBottom = aVertex.y;

  // Normalized depth t in [0.0, 1.0]: 0.0 is back (horizon), 1.0 is front (foreground)
  float t = float(uRidgeIndex) / max(uRidgeCount - 1.0, 1.0);

  // Ring buffer history mapping:
  // Ridge 63 (foreground) reads latest history row: (uHeadRow - 1 + 64) % 64
  // Ridge 0 (horizon) reads oldest history row: (uHeadRow - 64 + 64) % 64 = uHeadRow % 64
  int offsetFromHead = int(uRidgeCount) - 1 - uRidgeIndex;
  int row = ((uHeadRow - 1 - offsetFromHead) % int(uRidgeCount) + int(uRidgeCount)) % int(uRidgeCount);

  float u = (binIndex + 0.5) / 128.0;
  float v = (float(row) + 0.5) / uRidgeCount;

  // Sample elevation from private history texture
  float h = texture(uHistoryTex, vec2(u, v)).r;

  // Horizontal position centered in [-1.0, 1.0]
  float xNorm = (binIndex / 127.0) * 2.0 - 1.0;

  // Taper terrain edges cleanly toward zero (pulsar ridge profile)
  float window = sin(clamp(binIndex / 127.0, 0.0, 1.0) * 3.14159265);
  window = pow(window, 2.0);

  float elevation = h * window * uElevationScale;

  // Perspective width convergence toward horizon
  float depthScale = mix(0.42, 1.0, t);
  float xPos = xNorm * depthScale * uTerrainWidth;

  // Baseline vertical placement
  float yBase = mix(uHorizonY, uForegroundY, t);

  // Peak height with perspective scaling
  float peakPerspective = mix(0.2, 0.75, t);
  float yTop = yBase + elevation * peakPerspective;

  // Skirt extends downward to cleanly occlude background peaks
  float yBottom = yBase - 0.04;

  float yPos = mix(yTop, yBottom, isSkirtBottom);

  gl_Position = vec4(xPos, yPos, 0.0, 1.0);

  // Ridge coloration
  float depthFade = mix(0.5, 1.0, t);
  vec3 lineColor = mix(uBase, uAccent, clamp(elevation * 2.5, 0.0, 1.0)) * uBrightness * depthFade;

  if (uIsSkirtPass == 1) {
    // Dark opaque occlusion skirt: solid black/near-black with full alpha
    vColor = vec4(0.012, 0.012, 0.016, 1.0);
  } else {
    // Glowing ridge line
    vColor = vec4(lineColor, 1.0);
  }
}
