#version 300 es
precision highp float;

// Architecture layer (Slice 20.5). Simple 3D rooms drawn with analytic perspective in one fragment pass: each pixel
// is a ray from a camera in the middle of the room, and it is intersected with a floor, a ceiling and two walls
// by plain division. No ray marching, no loops. Grid lines on the floor and ceiling, pillars on the walls.
uniform vec2 uRes;
uniform float uTravel;       // integrated distance travelled, world units
uniform int uMode;           // 0 corridor (solid walls), 1 colonnade (pillars with gaps), 2 floor only
uniform float uHalfWidth;    // wall distance from the middle
uniform float uHalfHeight;   // floor and ceiling distance from the middle
uniform float uCell;         // grid cell size on floor and ceiling
uniform float uPillarGap;    // spacing of pillars along the wall
uniform float uLineWidth;    // grid line width as a fraction of a cell (slowly smoothed on the CPU)
uniform float uFog;          // 0..1 how quickly distant parts fade
uniform float uBrightness;
uniform float uHorizon;      // vertical shift of the horizon, -0.5..0.5
uniform vec3 uColorA;        // floor and ceiling lines
uniform vec3 uColorB;        // walls and pillars
uniform float uLayerOpacity;

in vec2 vUv;
out vec4 fragColor;

// Anti-aliased line from a repeating coordinate: 1 on the line, 0 away from it.
float gridLine(float coord, float cell, float width) {
  float f = coord / cell;
  float d = abs(fract(f - 0.5) - 0.5);           // distance to the nearest line in cells
  float aa = max(fwidth(f), 1e-4);
  float w = clamp(width, 0.005, 0.45);
  float line = 1.0 - smoothstep(w - aa, w + aa, d);
  // Where lines get narrower than a pixel, fade them out instead of shimmering.
  return line * (1.0 - smoothstep(0.25, 0.7, aa));
}

void main() {
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) * 2.0;
  p.y -= uHorizon * 2.0;

  // Distance along the ray to each surface. Rays parallel to a surface never hit it.
  float tFloor = abs(p.y) > 1e-3 ? uHalfHeight / abs(p.y) : 1e6;
  float tWall = (uMode != 2 && abs(p.x) > 1e-3) ? uHalfWidth / abs(p.x) : 1e6;

  // Derivatives need uniform control flow, so the floor lines are worked out before the branch.
  float floorLines = max(gridLine(p.x * tFloor, uCell, uLineWidth), gridLine(tFloor + uTravel, uCell, uLineWidth));

  vec3 col = vec3(0.0);
  float a = 0.0;
  float t;
  if (tFloor <= tWall) {
    // Floor (p.y < 0) or ceiling (p.y > 0). The floor is always drawn; the ceiling only in the two room modes.
    t = tFloor;
    if (uMode != 2 || p.y < 0.0) {
      col = uColorA * floorLines;
      a = floorLines;
    }
  } else {
    // Wall: a bright band in the middle of each repeat is a pillar. Colonnade leaves the gaps empty, corridor
    // fills them with a dim panel and marks where the wall meets the floor and ceiling.
    t = tWall;
    float along = t + uTravel;
    float band = smoothstep(0.30, 0.22, abs(fract(along / uPillarGap) - 0.5));
    float v = band;
    if (uMode == 0) {
      float yw = abs(p.y) * t / uHalfHeight;
      v = clamp(mix(0.18, 1.0, band) + smoothstep(0.82, 1.0, yw) * 0.5, 0.0, 1.0);
    }
    col = uColorB * v;
    a = v;
  }

  // Fog: distant surfaces fade out toward the horizon.
  float fog = exp(-t * uFog * 0.35);
  float k = a * fog;
  fragColor = vec4(col * fog * uBrightness * uLayerOpacity, clamp(k, 0.0, 1.0) * uLayerOpacity);
}
