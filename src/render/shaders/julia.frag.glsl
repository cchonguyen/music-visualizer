#version 300 es
precision highp float;

// Julia set layer (Slice 20.3). One fragment pass, a fixed iteration cap chosen on the CPU from the target size.
// The constant c is built on the CPU from slowly smoothed mid and bass, so the set breathes and never flashes.
uniform vec2 uRes;
uniform vec2 uC;             // the Julia constant for this frame
uniform float uRot;          // view rotation, radians (integrated phase)
uniform float uZoom;
uniform int uMaxIter;        // 16..96
uniform float uBrightness;
uniform float uColourSpread;
uniform float uHueShift;     // integrated phase, shifts the colour ramp slowly
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uLayerOpacity;

in vec2 vUv;
out vec4 fragColor;

void main() {
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) * (2.8 / max(uZoom, 0.05));
  float cs = cos(uRot);
  float sn = sin(uRot);
  vec2 z = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);

  float iter = 0.0;
  float escaped = 0.0;
  float r2 = 0.0;
  for (int i = 0; i < 96; i++) {
    if (i >= uMaxIter) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + uC;
    r2 = dot(z, z);
    if (r2 > 256.0) {
      escaped = 1.0;
      break;
    }
    iter += 1.0;
  }

  // Smooth iteration count, so the bands do not step.
  float nu = iter;
  if (escaped > 0.5) nu = iter + 1.0 - log2(max(log2(max(r2, 1.0001)), 1e-4));
  float t = clamp(nu / float(uMaxIter), 0.0, 1.0);

  // Filaments near the set glow; the interior and the far outside are clear.
  float intensity = clamp(escaped * pow(t, 0.45) * 1.6, 0.0, 1.0);

  float ramp = fract(t * (0.5 + 2.0 * uColourSpread) + uHueShift);
  vec3 col = mix(uColorA, uColorB, 0.5 + 0.5 * cos(ramp * 6.283185307179586)) * uBrightness;

  float a = clamp(intensity, 0.0, 1.0) * uLayerOpacity;
  fragColor = vec4(col * a, a);
}
