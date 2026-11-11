import { describe, it, expect, vi } from 'vitest';
import {
  COLOUR_MAP_INDEXES, ColourMapTextures, GRADIENTS, GRADIENT_NAMES, GRADIENT_WIDTH,
  colourMapIndexNumber, gradientBytes, gradientNameOr, sampleGradient,
} from './colourMap';

function mockGl() {
  const gl = {
    TEXTURE_2D: 0x0de1, RGBA: 0x1908, RGBA8: 0x8058, UNSIGNED_BYTE: 0x1401, LINEAR: 0x2601,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, CLAMP_TO_EDGE: 0x812f,
    createTexture: vi.fn().mockImplementation(() => ({})),
    deleteTexture: vi.fn(), bindTexture: vi.fn(), texParameteri: vi.fn(), texImage2D: vi.fn(),
  };
  return gl as unknown as WebGL2RenderingContext & typeof gl;
}

describe('built-in gradients', () => {
  it('there are twelve, with unique names', () => {
    expect(GRADIENT_NAMES).toHaveLength(12);
    expect(new Set(GRADIENT_NAMES).size).toBe(12);
  });

  it('every gradient has stops in order from 0 to 1 and colours in range', () => {
    for (const name of GRADIENT_NAMES) {
      const stops = GRADIENTS[name]!;
      expect(stops[0]![0], name).toBe(0);
      expect(stops[stops.length - 1]![0], name).toBe(1);
      for (let i = 1; i < stops.length; i++) expect(stops[i]![0], name).toBeGreaterThan(stops[i - 1]![0]);
      for (const stop of stops) for (const c of stop.slice(1)) expect(c >= 0 && c <= 1, name).toBe(true);
    }
  });
});

describe('sampleGradient', () => {
  it('returns the end colours at 0 and 1, and blends between stops', () => {
    expect(sampleGradient('mono', 0)).toEqual([0, 0, 0]);
    expect(sampleGradient('mono', 1)).toEqual([1, 1, 1]);
    const mid = sampleGradient('mono', 0.5);
    expect(mid[0]).toBeCloseTo(0.5, 9);
    expect(mid[2]).toBeCloseTo(0.5, 9);
  });

  it('clamps t and falls back to the default gradient for unknown names', () => {
    expect(sampleGradient('mono', -3)).toEqual([0, 0, 0]);
    expect(sampleGradient('mono', 9)).toEqual([1, 1, 1]);
    expect(sampleGradient('mono', NaN)).toEqual([0, 0, 0]);
    expect(sampleGradient('nope', 1)).toEqual(sampleGradient('heat', 1));
  });
});

describe('gradientBytes', () => {
  it('is 256 pixels of opaque RGBA that match the gradient ends', () => {
    const b = gradientBytes('heat');
    expect(b).toHaveLength(GRADIENT_WIDTH * 4);
    expect(Array.from(b.slice(0, 4))).toEqual([0, 0, 0, 255]);
    const end = sampleGradient('heat', 1).map((v) => Math.round(v * 255));
    expect(Array.from(b.slice(-4, -1))).toEqual(end);
    for (let i = 3; i < b.length; i += 4) expect(b[i]).toBe(255);
  });

  it('mono rises evenly from black to white', () => {
    const b = gradientBytes('mono');
    for (let i = 1; i < GRADIENT_WIDTH; i++) expect(b[i * 4]!).toBeGreaterThanOrEqual(b[(i - 1) * 4]!);
    expect(b[(GRADIENT_WIDTH - 1) * 4]).toBe(255);
  });
});

describe('names and indexes', () => {
  it('index names map to the shader numbers, and unknown ones read by brightness', () => {
    expect(COLOUR_MAP_INDEXES.map((n) => colourMapIndexNumber(n))).toEqual([0, 1, 2]);
    expect(colourMapIndexNumber('nope')).toBe(0);
    expect(colourMapIndexNumber(undefined)).toBe(0);
  });

  it('gradientNameOr keeps known names and replaces the rest', () => {
    expect(gradientNameOr('ice', 'heat')).toBe('ice');
    expect(gradientNameOr('nope', 'heat')).toBe('heat');
    expect(gradientNameOr(5, 'heat')).toBe('heat');
  });
});

describe('ColourMapTextures', () => {
  it('builds a gradient texture once and reuses it', () => {
    const gl = mockGl();
    const tex = new ColourMapTextures(gl);
    const a = tex.texture('ice');
    expect(tex.texture('ice')).toBe(a);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(gl.texImage2D.mock.calls[0]![3]).toBe(GRADIENT_WIDTH);
    expect(gl.texImage2D.mock.calls[0]![4]).toBe(1);
  });

  it('an unknown name shares the default gradient texture', () => {
    const tex = new ColourMapTextures(mockGl());
    expect(tex.texture('nope')).toBe(tex.texture('heat'));
    expect(tex.count).toBe(1);
  });

  it('dispose deletes every texture', () => {
    const gl = mockGl();
    const tex = new ColourMapTextures(gl);
    tex.texture('ice');
    tex.texture('heat');
    tex.dispose();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(tex.count).toBe(0);
  });
});
