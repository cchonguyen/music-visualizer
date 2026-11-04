// Color palettes for the visualizer (Stage 1, slice 1.14).
//
// Colours are stored as linear-ish 0..1 floats, the shape shaders consume.
// Hex is only the authoring format: keep it in one place and convert once.

export type PaletteName = 'neon' | 'ember' | 'coral' | 'bloom';

/** RGB channels as floats in [0, 1]. */
export type RGB = [number, number, number];

export interface Palette {
  name: PaletteName;
  base: RGB;
  accentA: RGB;
  accentB: RGB;
  accentC: RGB;
}

/** Converts '#rrggbb' to floats in [0, 1]. */
function hexToRgb(hex: string): RGB {
  const value = Number.parseInt(hex.slice(1), 16);
  return [
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
  ];
}

export const DEFAULT_PALETTE: PaletteName = 'neon';

export const PALETTE_ORDER: PaletteName[] = ['neon', 'ember', 'coral', 'bloom'];

const PALETTES: Record<PaletteName, Palette> = {
  neon: {
    name: 'neon',
    base: hexToRgb('#05060d'),
    accentA: hexToRgb('#22d3ee'), // cyan
    accentB: hexToRgb('#e879f9'), // magenta
    accentC: hexToRgb('#7c3aed'), // ultraviolet
  },
  ember: {
    name: 'ember',
    base: hexToRgb('#07060a'),
    accentA: hexToRgb('#f59e0b'), // amber
    accentB: hexToRgb('#34d399'), // emerald
    accentC: hexToRgb('#94a3b8'), // steel
  },
  coral: {
    name: 'coral',
    base: hexToRgb('#0a0306'),
    accentA: hexToRgb('#dc2626'), // crimson
    accentB: hexToRgb('#fb7185'), // coral
    accentC: hexToRgb('#fbbf24'), // amber
  },
  bloom: {
    name: 'bloom',
    base: hexToRgb('#0b1220'),
    accentA: hexToRgb('#67e8f9'), // cyan
    accentB: hexToRgb('#f0abfc'), // pale magenta
    accentC: hexToRgb('#e0f2fe'), // cold white
  },
};

function isPaletteName(name: string): name is PaletteName {
  return name in PALETTES;
}

/** Returns the named palette; unknown names fall back to neon. */
export function getPalette(name: string): Palette {
  return isPaletteName(name) ? PALETTES[name] : PALETTES[DEFAULT_PALETTE];
}

/** The next palette in PALETTE_ORDER, wrapping from last to first. */
export function nextPalette(name: PaletteName): PaletteName {
  const index = PALETTE_ORDER.indexOf(name);
  return PALETTE_ORDER[(index + 1) % PALETTE_ORDER.length] ?? DEFAULT_PALETTE;
}

/** Rec. 709 luminance weights applied directly to the stored 0..1 values. */
export function relativeLuminance(c: RGB): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
