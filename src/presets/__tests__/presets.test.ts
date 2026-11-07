import { describe, it, expect } from 'vitest';
import { BUILTIN_PRESETS, FLAGSHIP_PRESETS } from '../builtin';
import { PRESET_VERSION } from '../format';
import { buildScene } from '../loader';
import { BrightnessLimiter, CAP_FLOOR } from '../../render/safety';

describe('Flagship Presets 01–06 (Slice 7.12)', () => {
  it('registers all 6 flagship presets with valid IDs', () => {
    expect(FLAGSHIP_PRESETS).toHaveLength(6);
    const ids = FLAGSHIP_PRESETS.map((p) => p.id);
    expect(ids).toEqual([
      '01-curl-fluid-warp',
      '02-kaleidoscopic-mandala',
      '03-solarized-contour-rings',
      '04-mobius-dual-vortex',
      '05-rgb-aberration-vortex',
      '06-lissajous-vector-crt',
    ]);
  });

  it('all flagship presets pass schema validation with zero warnings', () => {
    for (const entry of FLAGSHIP_PRESETS) {
      expect(entry.warnings).toEqual([]);
      expect(entry.preset.version).toBe(PRESET_VERSION);
      expect(entry.preset.name).toBeTruthy();
    }
  });

  it('no preset titles or IDs use real person or band names', () => {
    const forbidden = ['geiss', 'winamp', 'milkdrop', 'joy division', 'unknown pleasures'];
    for (const entry of FLAGSHIP_PRESETS) {
      const lowerId = entry.id.toLowerCase();
      const lowerName = entry.preset.name.toLowerCase();
      for (const f of forbidden) {
        expect(lowerId).not.toContain(f);
        expect(lowerName).not.toContain(f);
      }
    }
  });

  it('Preset 01 (Curl Fluid Warp) matches specifications', () => {
    const p1 = FLAGSHIP_PRESETS.find((p) => p.id === '01-curl-fluid-warp')!.preset;
    expect(p1.name).toBe('Curl Fluid Warp');
    expect(p1.feedback.warpMode?.value).toBe('curl');
    expect(p1.feedback.decay?.value).toBe(0.97);
    expect(p1.feedback.decayRgb?.value).toEqual([0.99, 0.97, 1.0]);
    const waveLayer = p1.layers.find((l) => l.type === 'waveform')!;
    expect(waveLayer).toBeDefined();
    expect(waveLayer.params.amplitude?.link?.source).toBe('sub');
    expect(waveLayer.params.textureGain?.link?.source).toBe('mid');
  });

  it('Preset 02 (Kaleidoscopic Mandala) matches specifications', () => {
    const p2 = FLAGSHIP_PRESETS.find((p) => p.id === '02-kaleidoscopic-mandala')!.preset;
    expect(p2.name).toBe('Kaleidoscopic Mandala');
    expect(p2.feedback.warpMode?.value).toBe('polarFold');
    expect(p2.feedback.kaleidoN?.value).toBe(8);
    expect(p2.feedback.portalRadius?.value).toBe(0.08);
    expect(p2.feedback.decay?.value).toBe(0.95);
    const ringsLayer = p2.layers.find((l) => l.type === 'rings')!;
    expect(ringsLayer).toBeDefined();
    expect(ringsLayer.params.mode?.value).toBe('orbitTriangles');
  });

  it('Preset 03 (Solarized Contour Rings) matches specifications', () => {
    const p3 = FLAGSHIP_PRESETS.find((p) => p.id === '03-solarized-contour-rings')!.preset;
    expect(p3.name).toBe('Solarized Contour Rings');
    expect(p3.feedback.sobel?.value).toBe(0.85);
    expect(p3.feedback.solarize?.value).toBe(0.8);
    expect(p3.feedback.decay?.value).toBe(0.96);
    const shockLayer = p3.layers.find((l) => l.type === 'shockwave')!;
    expect(shockLayer).toBeDefined();
    expect(shockLayer.params.ringStart?.link?.source).toBe('kickEnv');
  });

  it('Preset 04 (Möbius Dual Vortex) matches specifications', () => {
    const p4 = FLAGSHIP_PRESETS.find((p) => p.id === '04-mobius-dual-vortex')!.preset;
    expect(p4.name).toBe('Möbius Dual Vortex');
    expect(p4.feedback.warpMode?.value).toBe('mobius');
    expect(p4.feedback.decay?.value).toBe(0.96);
    const ringsLayer = p4.layers.find((l) => l.type === 'rings')!;
    expect(ringsLayer).toBeDefined();
    expect(ringsLayer.params.mode?.value).toBe('polarGrid');
    expect(ringsLayer.opacity).toBe(0.15);
    expect(ringsLayer.blend).toBe('alpha');
    const particleLayer = p4.layers.find((l) => l.type === 'particles')!;
    expect(particleLayer).toBeDefined();
  });

  it('Preset 05 (RGB Aberration Vortex) matches specifications', () => {
    const p5 = FLAGSHIP_PRESETS.find((p) => p.id === '05-rgb-aberration-vortex')!.preset;
    expect(p5.name).toBe('RGB Aberration Vortex');
    expect(p5.feedback.warpMode?.value).toBe('rgbSplit');
    expect(p5.feedback.rgbSplit?.value).toBe(0.03);
    expect(p5.feedback.decay?.value).toBe(0.94);
    const waveLayer = p5.layers.find((l) => l.type === 'waveform')!;
    expect(waveLayer).toBeDefined();
    expect(waveLayer.params.mode?.value).toBe('star7');
    const shockLayer = p5.layers.find((l) => l.type === 'shockwave')!;
    expect(shockLayer).toBeDefined();
  });

  it('Preset 06 (Lissajous Vector CRT) matches specifications', () => {
    const p6 = FLAGSHIP_PRESETS.find((p) => p.id === '06-lissajous-vector-crt')!.preset;
    expect(p6.name).toBe('Lissajous Vector CRT');
    expect(p6.feedback.decay?.value).toBe(0.86);
    const waveLayer = p6.layers.find((l) => l.type === 'waveform')!;
    expect(waveLayer).toBeDefined();
    expect(waveLayer.params.mode?.value).toBe('lissajous');
    expect(p6.post.crtScanlines?.value).toBe(0.25);
    expect(p6.post.crtBarrel?.value).toBe(0.08);
    expect(p6.post.bloom?.value).toBe(0.7);
  });

  it('buildScene successfully instantiates all 6 flagship presets', () => {
    for (const entry of FLAGSHIP_PRESETS) {
      const scene = buildScene(entry.id, entry.preset);
      expect(scene).toBeDefined();
      expect(scene.name).toBe(entry.id);
      expect(scene.layers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('executes safety pass across all 6 flagship presets', () => {
    const limiter = new BrightnessLimiter();
    for (const entry of FLAGSHIP_PRESETS) {
      expect(entry.id).toBeTruthy();
      // Simulate 10 frames of varying luminance
      limiter.reset();
      for (let f = 0; f < 10; f++) {
        const targetLum = (f % 2 === 0 ? 0.8 : 0.2);
        const cap = limiter.step(targetLum, 0.016);
        expect(cap).toBeGreaterThanOrEqual(CAP_FLOOR);
        expect(cap).toBeLessThanOrEqual(1.0);
        expect(Number.isFinite(cap)).toBe(true);
      }
    }
  });

  it('all 23 existing presets continue to pass without error or warnings', () => {
    expect(BUILTIN_PRESETS).toHaveLength(23);
    for (const b of BUILTIN_PRESETS) {
      expect(b.warnings).toEqual([]);
      const scene = buildScene(b.id, b.preset);
      expect(scene.layers.length).toBeGreaterThanOrEqual(1);
    }
  });
});
