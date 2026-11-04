import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PALETTE,
  PALETTE_ORDER,
  getPalette,
  nextPalette,
  relativeLuminance,
  type RGB,
} from './palette';

describe('palettes', () => {
  it('keeps every base darker than all of its accents', () => {
    for (const name of PALETTE_ORDER) {
      const palette = getPalette(name);
      const base = relativeLuminance(palette.base);
      expect(base).toBeLessThan(relativeLuminance(palette.accentA));
      expect(base).toBeLessThan(relativeLuminance(palette.accentB));
      expect(base).toBeLessThan(relativeLuminance(palette.accentC));
    }
  });

  it('keeps every channel of every colour within [0, 1]', () => {
    const checkColour = (colour: RGB) => {
      for (const channel of colour) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    };
    for (const name of PALETTE_ORDER) {
      const palette = getPalette(name);
      checkColour(palette.base);
      checkColour(palette.accentA);
      checkColour(palette.accentB);
      checkColour(palette.accentC);
    }
  });

  it('falls back to neon for unknown names', () => {
    expect(getPalette('nope').name).toBe('neon');
  });

  it('defaults to neon', () => {
    expect(DEFAULT_PALETTE).toBe('neon');
  });
});

describe('nextPalette', () => {
  it('visits all four names and wraps back to the start', () => {
    const start = PALETTE_ORDER[0] ?? DEFAULT_PALETTE;
    const visited: string[] = [start];
    let current = start;
    for (let i = 0; i < PALETTE_ORDER.length; i++) {
      current = nextPalette(current);
      visited.push(current);
    }
    expect(new Set(visited.slice(0, PALETTE_ORDER.length)).size).toBe(PALETTE_ORDER.length);
    expect(current).toBe(start);
  });
});
