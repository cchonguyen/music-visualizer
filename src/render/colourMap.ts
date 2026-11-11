// Colour map (Slice 18.8): the finished picture is recoloured through a gradient. The gradient is read by
// brightness, by distance from the centre, or by angle around it. Two gradients can be mixed, and the mix is an
// ordinary number setting, so it can swing on its own (morph), follow the music (audio link) or jump on a
// trigger (reactions). Each gradient is a 256 by 1 texture built once from a few colour stops.

export type Stop = readonly [number, number, number, number]; // position 0..1, then r, g, b in 0..1

/** Built-in gradients. Names are stored in presets, so never rename one. Order is the order shown in the Studio. */
export const GRADIENTS: Readonly<Record<string, readonly Stop[]>> = {
  heat: [[0, 0, 0, 0], [0.3, 0.7, 0.05, 0.02], [0.6, 1, 0.5, 0.05], [0.85, 1, 0.9, 0.3], [1, 1, 1, 0.9]],
  ice: [[0, 0, 0, 0.05], [0.35, 0.05, 0.2, 0.6], [0.7, 0.2, 0.8, 1], [1, 0.9, 1, 1]],
  sunset: [[0, 0.1, 0.02, 0.2], [0.3, 0.55, 0.08, 0.5], [0.6, 0.95, 0.35, 0.25], [1, 1, 0.9, 0.55]],
  forest: [[0, 0, 0.02, 0], [0.4, 0.03, 0.3, 0.1], [0.75, 0.4, 0.8, 0.2], [1, 0.9, 1, 0.7]],
  ocean: [[0, 0, 0.03, 0.12], [0.4, 0.02, 0.3, 0.5], [0.75, 0.1, 0.75, 0.8], [1, 0.85, 1, 0.95]],
  neon: [[0, 0.05, 0, 0.15], [0.35, 0.5, 0.05, 0.9], [0.7, 0.05, 0.8, 1], [1, 0.5, 1, 0.8]],
  ember: [[0, 0, 0, 0], [0.4, 0.4, 0.02, 0.02], [0.75, 0.9, 0.35, 0.05], [1, 1, 0.8, 0.25]],
  candy: [[0, 0.3, 0.1, 0.4], [0.35, 0.9, 0.3, 0.65], [0.7, 0.75, 0.6, 1], [1, 0.7, 0.95, 1]],
  mono: [[0, 0, 0, 0], [1, 1, 1, 1]],
  aurora: [[0, 0, 0.08, 0.1], [0.35, 0.05, 0.6, 0.4], [0.65, 0.45, 0.35, 0.85], [1, 0.95, 0.5, 0.8]],
  toxic: [[0, 0, 0, 0], [0.45, 0.35, 0.05, 0.5], [0.8, 0.5, 0.95, 0.15], [1, 0.9, 1, 0.5]],
  rosegold: [[0, 0.08, 0.03, 0.04], [0.4, 0.55, 0.25, 0.28], [0.75, 0.9, 0.6, 0.5], [1, 1, 0.9, 0.8]],
};

export const GRADIENT_NAMES: readonly string[] = Object.keys(GRADIENTS);
export const GRADIENT_DEFAULT_A = 'heat';
export const GRADIENT_DEFAULT_B = 'ice';
export const GRADIENT_WIDTH = 256;

/** What the gradient is read by. The position in this list is the number the shader switches on. */
export const COLOUR_MAP_INDEXES = ['brightness', 'distance', 'angle'] as const;
export type ColourMapIndex = (typeof COLOUR_MAP_INDEXES)[number];

/** Shader number for an index name. Unknown names read by brightness. */
export function colourMapIndexNumber(name: unknown): number {
  const i = (COLOUR_MAP_INDEXES as readonly string[]).indexOf(String(name));
  return i < 0 ? 0 : i;
}

/** A known gradient name, or the default for anything else (an old or hand-edited preset). */
export function gradientNameOr(name: unknown, fallback: string): string {
  return typeof name === 'string' && name in GRADIENTS ? name : fallback;
}

/** Colour of a gradient at t (0..1), blended linearly between its stops. */
export function sampleGradient(name: string, t: number): [number, number, number] {
  const stops = GRADIENTS[name] ?? GRADIENTS[GRADIENT_DEFAULT_A]!;
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const first = stops[0]!;
  if (x <= first[0]) return [first[1], first[2], first[3]];
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i]!;
    if (x <= b[0]) {
      const a = stops[i - 1]!;
      const k = b[0] === a[0] ? 1 : (x - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
    }
  }
  const last = stops[stops.length - 1]!;
  return [last[1], last[2], last[3]];
}

/** The 256 by 1 RGBA bytes of a gradient. */
export function gradientBytes(name: string): Uint8Array {
  const out = new Uint8Array(GRADIENT_WIDTH * 4);
  for (let i = 0; i < GRADIENT_WIDTH; i++) {
    const [r, g, b] = sampleGradient(name, i / (GRADIENT_WIDTH - 1));
    out[i * 4] = Math.round(r * 255);
    out[i * 4 + 1] = Math.round(g * 255);
    out[i * 4 + 2] = Math.round(b * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Gradient textures for one GL context. Each is made the first time it is asked for and kept until dispose. */
export class ColourMapTextures {
  private readonly gl: WebGL2RenderingContext;
  private readonly textures = new Map<string, WebGLTexture>();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  /** The texture for a gradient name (unknown names give the default gradient). */
  texture(name: string): WebGLTexture {
    const key = name in GRADIENTS ? name : GRADIENT_DEFAULT_A;
    const have = this.textures.get(key);
    if (have) return have;
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('could not create colour map texture');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, GRADIENT_WIDTH, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, gradientBytes(key));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.textures.set(key, tex);
    return tex;
  }

  get count(): number {
    return this.textures.size;
  }

  dispose(): void {
    for (const tex of this.textures.values()) this.gl.deleteTexture(tex);
    this.textures.clear();
  }
}
