#version 300 es
precision highp float;

layout(location = 0) in vec2 aVertex; // x = binIndex (0..127), y = isSkirtBottom (or ridgeIdx for grid lines)

uniform sampler2D uHistoryTex; // TEXTURE5 private 128x64 ring-buffer texture
uniform int uHeadRow;          // 0..63
uniform int uRidgeIndex;       // 0..63 (0 = back/horizon, 63 = front/foreground)
uniform float uRidgeCount;     // 64.0
uniform float uElevationScale; // peak height scale
uniform float uTerrainWidth;   // terrain width scale
uniform float uHorizonY;       // horizon Y coordinate
uniform float uForegroundY;    // foreground Y coordinate
uniform float uBrightness;
uniform float uLineThickness;  // 0.5..4.0
uniform int uRidgeShape;       // 0 = smooth, 1 = rounded, 2 = pointed, 3 = stepped
uniform int uLayoutMode;       // 0 = fullHorizon, 1 = centerPeak, 2 = canyon
uniform int uIsSkirtPass;      // 1 = skirt pass, 0 = ridge line pass, 2 = longitudinal grid lines
uniform vec3 uAccent;
uniform vec3 uBase;

out vec4 vColor;
out vec2 vPosNorm;
out float vElevation;
out float vDepth;

void main() {
  float binIndex = aVertex.x;
  float attrY = aVertex.y;

  // When uIsSkirtPass == 2 (longitudinal grid lines), attrY holds the ridge index (0..63).
  // Otherwise, uRidgeIndex is the active ridge, and attrY is isSkirtBottom (0.0 or 1.0).
  float ridgeIdx = (uIsSkirtPass == 2) ? attrY : float(uRidgeIndex);
  float isSkirtBottom = (uIsSkirtPass == 2) ? 0.0 : attrY;

  // Normalized depth t in [0.0, 1.0]: 0.0 is back (horizon), 1.0 is front (foreground)
  float t = ridgeIdx / max(uRidgeCount - 1.0, 1.0);

  // Ring buffer history mapping:
  int offsetFromHead = int(uRidgeCount) - 1 - int(ridgeIdx);
  int row = ((uHeadRow - 1 - offsetFromHead) % int(uRidgeCount) + int(uRidgeCount)) % int(uRidgeCount);

  float u = (binIndex + 0.5) / 128.0;
  float v = (float(row) + 0.5) / uRidgeCount;

  // 5-tap smoothed spectrum along frequency axis
  float du = 1.0 / 128.0;
  float h0 = texture(uHistoryTex, vec2(clamp(u - 2.0 * du, 0.0, 1.0), v)).r;
  float h1 = texture(uHistoryTex, vec2(clamp(u - 1.0 * du, 0.0, 1.0), v)).r;
  float h2 = texture(uHistoryTex, vec2(u, v)).r;
  float h3 = texture(uHistoryTex, vec2(clamp(u + 1.0 * du, 0.0, 1.0), v)).r;
  float h4 = texture(uHistoryTex, vec2(clamp(u + 2.0 * du, 0.0, 1.0), v)).r;
  float h = (h0 * 0.10 + h1 * 0.20 + h2 * 0.40 + h3 * 0.20 + h4 * 0.10);

  // Subtle ambient travelling sine wave ensures visible ridge contours even during silence (Slice 7.33)
  float uNorm = u;
  int uRow = row;
  h += 0.035 * sin(uNorm * 10.0 + float(uRow) * 0.35);

  // Shape smoothed spectrum with uRidgeShape
  if (uRidgeShape == 1) {
    // 1 = rounded: sqrt
    h = sqrt(clamp(h, 0.0, 1.0));
  } else if (uRidgeShape == 2) {
    // 2 = pointed: pow(x, 1.85)
    h = pow(clamp(h, 0.0, 1.0), 1.85) * 1.35;
  } else if (uRidgeShape == 3) {
    // 3 = stepped: terrace quantization
    h = floor(h * 5.0 + 0.5) / 5.0;
  }

  // Horizontal position centered in [-1.0, 1.0]
  float xNorm = (binIndex / 127.0) * 2.0 - 1.0;

  // Horizontal envelope according to uLayoutMode:
  // 0 = fullHorizon (wide plateau envelope)
  // 1 = centerPeak (Gaussian bell curve)
  // 2 = canyon (bimodal twin-wall valley)
  float window = 1.0;
  if (uLayoutMode == 1) {
    // centerPeak: Gaussian bell curve focused on center
    window = exp(-pow(xNorm * 2.4, 2.0));
  } else if (uLayoutMode == 2) {
    // canyon: twin side walls with central valley
    window = (1.0 - exp(-pow(xNorm * 3.2, 2.0))) * clamp(1.0 - pow(abs(xNorm), 4.0), 0.0, 1.0);
  } else {
    // fullHorizon: wide plateau envelope
    window = clamp(1.0 - pow(abs(xNorm), 4.0), 0.0, 1.0);
  }

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

  float perspectiveScale = mix(0.42, 1.0, t);
  float ribbonHalfThick = max(uLineThickness * 0.0055 * perspectiveScale, 0.0028);

  float yPos;
  if (uIsSkirtPass == 1) {
    yPos = mix(yTop, yBottom, isSkirtBottom);
  } else if (uIsSkirtPass == 2) {
    yPos = yTop;
  } else {
    // Quad strip line ribbon: offset vertically
    yPos = yTop + (isSkirtBottom < 0.5 ? ribbonHalfThick : -ribbonHalfThick);
  }

  gl_Position = vec4(xPos, yPos, 0.0, 1.0);

  // Legacy vertex color for compatibility
  float depthFade = mix(0.5, 1.0, t);
  vec3 lineColor = mix(uBase, uAccent, clamp(elevation * 2.5, 0.0, 1.0)) * uBrightness * depthFade;
  vColor = (uIsSkirtPass == 1) ? vec4(vec3(0.005), 0.12) : vec4(lineColor, 1.0);

  vPosNorm = vec2(xNorm, isSkirtBottom);
  vElevation = elevation;
  vDepth = t;
}
