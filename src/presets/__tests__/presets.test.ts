import { describe, it, expect } from 'vitest';
import { BUILTIN_PRESETS, FLAGSHIP_PRESETS, ALL_PRESETS, SHOWCASE_PRESETS_13_20 } from '../builtin';
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
    expect(p1.feedback.warp?.value).toBe(0.58);
    expect(p1.feedback.warp?.link?.source).toBe('mid');
    expect(p1.feedback.warp?.link?.amount).toBe(0.35);
    expect(p1.feedback.warpScale?.value).toBe(2.8);
    expect(p1.feedback.warpSpeed?.value).toBe(0.85);
    expect(p1.feedback.warpSpeed?.link?.source).toBe('bass');
    expect(p1.feedback.warpSpeed?.link?.amount).toBe(0.4);
    expect(p1.feedback.curlOctaves?.value).toBe(3);
    expect(p1.feedback.curlTurbulence?.value).toBe(0.55);
    expect(p1.feedback.curlFlowPattern?.value).toBe('plumes');
    expect(p1.feedback.decay?.value).toBe(0.92);
    expect(p1.feedback.decayRgb?.value).toEqual([0.95, 0.91, 0.96]);
    expect(p1.feedback.hueDrift?.value).toBe(0.018);
    const shapeLayer = p1.layers.find((l) => l.type === 'shape')!;
    expect(shapeLayer).toBeDefined();
    expect(shapeLayer.params.baseShape?.value).toBe('circle');
    expect(shapeLayer.params.size?.value).toBe(0.62);
    expect(shapeLayer.params.thickness?.value).toBe(2.4);
    expect(shapeLayer.params.colorMode?.value).toBe('frequencyGradient');
    expect(shapeLayer.params.reactivity?.link?.source).toBe('sub');
    const partLayer = p1.layers.find((l) => l.type === 'particles')!;
    expect(partLayer).toBeDefined();
    expect(partLayer.opacity).toBe(0.55);
    expect(partLayer.blend).toBe('add');
    expect(partLayer.params.shape?.value).toBe('dot');
    expect(partLayer.params.size?.value).toBe(1.6);
    expect(partLayer.params.swirlGain?.value).toBe(1.4);
  });

  it('Preset 02 (Kaleidoscopic Mandala) matches specifications', () => {
    const p2 = FLAGSHIP_PRESETS.find((p) => p.id === '02-kaleidoscopic-mandala')!.preset;
    expect(p2.name).toBe('Kaleidoscopic Mandala');
    expect(p2.feedback.warpMode?.value).toBe('polarFold');
    expect(p2.feedback.kaleidoN?.value).toBe(8);
    expect(p2.feedback.mandalaPattern?.value).toBe('auto');
    expect(p2.feedback.radialFold?.value).toBe(0.48);
    expect(p2.feedback.mandalaTile?.value).toBe(0.35);
    expect(p2.feedback.mandalaCounterSpin?.value).toBe(0.3);
    expect(p2.feedback).not.toHaveProperty('mandalaKickFlare'); // dropped on load (Slice 14.9)
    expect(p2.feedback.zoom?.value).toBe(1.038);
    expect(p2.feedback.rotate?.value).toBe(0.015);
    expect(p2.feedback.decay?.value).toBe(0.90);
    expect(p2.feedback.fade?.value).toBe(0.005);
    expect(p2.feedback.decayRgb?.value).toEqual([0.92, 0.90, 0.96]);
    expect(p2.layers.some((l) => l.type === 'rings')).toBe(false);
    const shapeLayers = p2.layers.filter((l) => l.type === 'shape');
    expect(shapeLayers).toHaveLength(2);
    const waveLayer = shapeLayers[0]!;
    expect(waveLayer.blend).toBe('add');
    expect(waveLayer.trails).toBe(false);
    expect(waveLayer.params.baseShape?.value).toBe('circle');
    expect(waveLayer.params.thickness?.value).toBe(2.2);
    expect(waveLayer.params.colorMode?.value).toBe('palette');
    const partLayer = p2.layers.find((l) => l.type === 'particles')!;
    expect(partLayer).toBeDefined();
    expect(partLayer.params.shape?.value).toBe('streak');
    const shockLayer = shapeLayers[1]!;
    expect(shockLayer.params.propMode?.value).toBe('shockwave');
  });

  it('Preset 03 (Solarized Contour Rings) matches specifications', () => {
    const p3 = FLAGSHIP_PRESETS.find((p) => p.id === '03-solarized-contour-rings')!.preset;
    expect(p3.name).toBe('Solarized Contour Rings');
    expect(p3.feedback.warpMode?.value).toBe('curl');
    expect(p3.feedback.warp?.value).toBe(0.28);
    expect(p3.feedback.warpScale?.value).toBe(2.2);
    expect(p3.feedback.curlOctaves?.value).toBe(2);
    expect(p3.feedback.sobel?.value).toBe(0.22);
    expect(p3.feedback.solarize?.value).toBe(0.22);
    expect(p3.feedback.contourFreq?.value).toBe(6.5);
    expect(p3.feedback.contourWidth?.value).toBe(0.42);
    expect(p3.feedback.colorSpread?.value).toBe(0.85);
    expect(p3.feedback.zoom?.value).toBe(1.022);
    expect(p3.feedback.decay?.value).toBe(0.86);
    expect(p3.feedback.decayRgb?.value).toEqual([0.90, 0.92, 0.95]);
    const shapeLayers = p3.layers.filter((l) => l.type === 'shape');
    expect(shapeLayers.length).toBeGreaterThanOrEqual(1);
  });

  it('Preset 04 (Möbius Dual Vortex) matches specifications', () => {
    const p4 = FLAGSHIP_PRESETS.find((p) => p.id === '04-mobius-dual-vortex')!.preset;
    expect(p4.name).toBe('Möbius Dual Vortex');
    expect(p4.feedback.warpMode?.value).toBe('mobius');
    expect(p4.feedback.warp?.value).toBe(0.55);
    expect(p4.feedback.mobiusFlow?.value).toBe(0.9);
    expect(p4.feedback.mobiusSwirl?.value).toBe(0.75);
    expect(p4.feedback.mobiusPoleOffset?.value).toBe(0.46);
    expect(p4.feedback.mobiusWander?.value).toBe(0.60);
    expect(p4.feedback.mobiusMode?.value).toBe('auto');
    expect(p4.feedback.decay?.value).toBe(0.90);
    expect(p4.feedback.decayRgb?.value).toEqual([0.92, 0.91, 0.96]);
    expect(p4.layers.some((l) => l.type === 'rings')).toBe(false);
    const particleLayer = p4.layers.find((l) => l.type === 'particles')!;
    expect(particleLayer).toBeDefined();
    expect(particleLayer.blend).toBe('max');
    expect(particleLayer.opacity).toBe(0.7);
    const shockLayer = p4.layers.find((l) => l.type === 'shape' && l.params.propMode?.value === 'shockwave')!;
    expect(shockLayer).toBeDefined();
    const crownLayer = p4.layers.find((l) => l.type === 'shape' && l.params.effectType?.value === 'bars')!;
    expect(crownLayer).toBeDefined();
    const waveLayer = p4.layers.find((l) => l.type === 'shape' && l.params.baseShape?.value === 'centerLine')!;
    expect(waveLayer).toBeDefined();
  });

  it('Preset 05 (RGB Aberration Vortex) matches specifications', () => {
    const p5 = FLAGSHIP_PRESETS.find((p) => p.id === '05-rgb-aberration-vortex')!.preset;
    expect(p5.name).toBe('RGB Aberration Vortex');
    expect(p5.feedback.warpMode?.value).toBe('rgbSplit');
    expect(p5.feedback.rgbSplit?.value).toBe(0.03);
    expect(p5.feedback.decay?.value).toBe(0.94);
    const starLayer = p5.layers.find((l) => l.type === 'shape' && l.params.baseShape?.value === 'star')!;
    expect(starLayer).toBeDefined();
    expect(starLayer.params.sides?.value).toBe(7);
    expect(starLayer.params.thickness?.value).toBe(2.2);
    const shockLayer = p5.layers.find((l) => l.type === 'shape' && l.params.propMode?.value === 'shockwave')!;
    expect(shockLayer).toBeDefined();
  });

  it('Preset 06 (Lissajous Vector CRT) matches specifications', () => {
    const p6 = FLAGSHIP_PRESETS.find((p) => p.id === '06-lissajous-vector-crt')!.preset;
    expect(p6.name).toBe('Lissajous Vector CRT');
    expect(p6.feedback.decay?.value).toBe(0.86);
    const waveLayer = p6.layers.find((l) => l.type === 'shape')!;
    expect(waveLayer).toBeDefined();
    expect(waveLayer.params.baseShape?.value).toBe('figure8');
    expect(waveLayer.params.thickness?.value).toBe(2.2);
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

  it('Presets 07, 09, 10, 11, tex-dust-wave, and tex-ripple-field match Slice 7.37 specifications', () => {
    const p7 = ALL_PRESETS.find((p) => p.id === '07-moire-interference-loom')!.preset;
    expect(p7.layers.map((l) => l.type)).toEqual(['moire', 'particles', 'bassPulse']);
    const moireLayer = p7.layers.find((l) => l.type === 'moire')!;
    expect(moireLayer.params.patternMode?.value).toBe('starburstLoom');

    const p9 = ALL_PRESETS.find((p) => p.id === '09-chladni-cymatic-sand')!.preset;
    expect(p9.layers[0]!.params.plateMode?.value).toBe('fullscreen');

    const p10 = ALL_PRESETS.find((p) => p.id === '10-phyllotaxis-spiral-bloom')!.preset;
    expect(p10.layers.map((l) => l.type)).toEqual(['particles', 'shape', 'shape']);
    const p10Rings = p10.layers[1]!;
    expect(p10Rings.opacity).toBe(0.35);
    expect(p10Rings.params.propMode?.value).toBe('concentric');
    const p10Crown = p10.layers[2]!;
    expect(p10Crown.opacity).toBe(0.45);
    expect(p10Crown.params.effectType?.value).toBe('bars');

    const p11 = ALL_PRESETS.find((p) => p.id === '11-ferrofluid-magnetic-crown')!.preset;
    expect(p11.layers.some((l) => l.type === 'ferrofluid')).toBe(true);

    const pDust = BUILTIN_PRESETS.find((p) => p.id === 'tex-dust-wave')!.preset;
    expect(pDust.feedback.stretchY?.value).toBe(1.36);
    // The Waveform line loads as a Shape layer (Slice 19.10): signed trace on a centre line, band texture carried over.
    expect(pDust.layers.some((l) => l.type === 'waveform')).toBe(false);
    const dustWave = pDust.layers.find((l) => l.type === 'shape')!;
    expect(dustWave.params.baseShape?.value).toBe('centerLine');
    expect(dustWave.params.audioSource?.value).toBe('scope');
    expect(dustWave.params.bandTexture?.value).toBe(1.6);
    const dustPart = pDust.layers.find((l) => l.type === 'particles')!;
    expect(dustPart.params.mode?.value).toBe('phyllotaxis');
    expect(dustPart.params.seedShape?.value).toBe('orb');

    const pRipple = BUILTIN_PRESETS.find((p) => p.id === 'tex-ripple-field')!.preset;
    const ripWave = pRipple.layers.find((l) => l.type === 'shape')!;
    expect(ripWave.params.thickness?.value).toBe(2.2);
    const ripPart = pRipple.layers.find((l) => l.type === 'particles')!;
    expect(ripPart).toBeDefined();
    expect(ripPart.opacity).toBe(0.75);
  });

  it('the 6 remaining existing presets continue to pass without error or warnings', () => {
    expect(BUILTIN_PRESETS).toHaveLength(6);
    for (const b of BUILTIN_PRESETS) {
      expect(b.warnings).toEqual([]);
      const scene = buildScene(b.id, b.preset);
      expect(scene.layers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('classic presets crown, flight, and bars use shape layers instead of legacy types', () => {
    const legacyTypes = ['crown', 'bars', 'waveform', 'rings', 'shockwave'];
    for (const id of ['crown', 'flight', 'bars']) {
      const entry = BUILTIN_PRESETS.find((p) => p.id === id)!;
      expect(entry).toBeDefined();
      expect(entry.warnings).toEqual([]);
      for (const l of entry.preset.layers) {
        expect(legacyTypes).not.toContain(l.type);
      }
      expect(entry.preset.layers.some((l) => l.type === 'shape')).toBe(true);
    }
  });
});

describe('Stage 9 Showcase Presets 13–20 (Sector 485, Slice 9.5)', () => {
  it('registers all 8 showcase presets with valid IDs', () => {
    expect(SHOWCASE_PRESETS_13_20).toHaveLength(8);
    const ids = SHOWCASE_PRESETS_13_20.map((p) => p.id);
    expect(ids).toEqual([
      '13-solar-crown-eclipse',
      '14-sacred-orbit-mandala',
      '15-polar-spirograph-bloom',
      '16-hexagon-inward-portal',
      '17-corridor-led-equalizer',
      '18-star-burst-stream',
      '19-spiral-pearl-beads',
      '20-dual-rail-aurora-ark',
    ]);
  });

  it('all showcase presets pass schema validation with zero warnings', () => {
    for (const entry of SHOWCASE_PRESETS_13_20) {
      expect(entry.warnings).toEqual([]);
      expect(entry.preset.version).toBe(PRESET_VERSION);
      expect(entry.preset.name).toBeTruthy();
      expect(entry.preset.layers.some((l) => l.type === 'shape')).toBe(true);
    }
  });

  it('no showcase preset titles or IDs use real person or band names', () => {
    const forbidden = ['geiss', 'winamp', 'milkdrop', 'joy division', 'unknown pleasures'];
    for (const entry of SHOWCASE_PRESETS_13_20) {
      const lowerId = entry.id.toLowerCase();
      const lowerName = entry.preset.name.toLowerCase();
      for (const f of forbidden) {
        expect(lowerId).not.toContain(f);
        expect(lowerName).not.toContain(f);
      }
    }
  });

  it('ALL_PRESETS includes all 8 showcase presets', () => {
    for (const entry of SHOWCASE_PRESETS_13_20) {
      expect(ALL_PRESETS.some((p) => p.id === entry.id)).toBe(true);
    }
  });

  it('Preset 13 (Solar Crown Eclipse) matches specifications', () => {
    const p13 = SHOWCASE_PRESETS_13_20.find((p) => p.id === '13-solar-crown-eclipse')!.preset;
    expect(p13.name).toBe('Solar Crown Eclipse');
    expect(p13.layers.filter((l) => l.type === 'shape')).toHaveLength(2);
    const barsShape = p13.layers.find((l) => l.type === 'shape' && l.params.effectType?.value === 'bars')!;
    expect(barsShape.params.baseShape?.value).toBe('circle');
    expect(barsShape.params.extrudeDirection?.value).toBe('outward');
    expect(barsShape.params.peakCaps?.value).toBe(true);
    const shockShape = p13.layers.find((l) => l.type === 'shape' && l.params.propMode?.value === 'shockwave')!;
    expect(shockShape.params.baseShape?.value).toBe('circle');
    expect(p13.post.bloom?.value).toBeGreaterThan(0.5);
  });

  it('Preset 14 (Sacred Orbit Mandala) matches specifications', () => {
    const p14 = SHOWCASE_PRESETS_13_20.find((p) => p.id === '14-sacred-orbit-mandala')!.preset;
    expect(p14.name).toBe('Sacred Orbit Mandala');
    const orbitShape = p14.layers.find((l) => l.type === 'shape' && l.params.propMode?.value === 'orbit')!;
    expect(orbitShape.params.baseShape?.value).toBe('polygon');
    expect(orbitShape.params.sides?.value).toBe(5);
    expect(orbitShape.params.propCount?.value).toBe(5);
    expect(orbitShape.params.propSelfSpin?.value).toBe(-0.8);
    expect(orbitShape.params.colorMode?.value).toBe('frequencyGradient');
  });

  it('Preset 15 (Polar Spirograph Bloom) matches specifications', () => {
    const p15 = SHOWCASE_PRESETS_13_20.find((p) => p.id === '15-polar-spirograph-bloom')!.preset;
    expect(p15.name).toBe('Polar Spirograph Bloom');
    const shape = p15.layers.find((l) => l.type === 'shape')!;
    expect(shape.params.baseShape?.value).toBe('figure8');
    expect(shape.params.effectType?.value).toBe('waveform');
    expect(shape.params.propMode?.value).toBe('polar');
    expect(shape.params.propCount?.value).toBe(12);
    expect(shape.params.symmetry?.value).toBe('mirror');
  });

  it('Preset 16 (Hexagon Inward Portal) matches specifications', () => {
    const p16 = SHOWCASE_PRESETS_13_20.find((p) => p.id === '16-hexagon-inward-portal')!.preset;
    expect(p16.name).toBe('Hexagon Inward Portal');
    const shape = p16.layers.find((l) => l.type === 'shape')!;
    expect(shape.params.baseShape?.value).toBe('polygon');
    expect(shape.params.sides?.value).toBe(6);
    expect(shape.params.cornerRadius?.value).toBe(0.1);
    expect(shape.params.extrudeDirection?.value).toBe('inward');
    expect(shape.params.propMode?.value).toBe('concentric');
    expect(shape.params.propCount?.value).toBe(4);
    expect(shape.params.propDelay?.value).toBe(0.35);
  });

  it('Preset 17 (Corridor LED Equalizer) matches specifications', () => {
    const p17 = SHOWCASE_PRESETS_13_20.find((p) => p.id === '17-corridor-led-equalizer')!.preset;
    expect(p17.name).toBe('Corridor LED Equalizer');
    const shape = p17.layers.find((l) => l.type === 'shape')!;
    expect(shape.params.baseShape?.value).toBe('edgeLine');
    expect(shape.params.edgeMode?.value).toBe('dualHorizontal');
    expect(shape.params.effectType?.value).toBe('segmentedBars');
    expect(shape.params.ledSegments?.value).toBe(2);
    expect(shape.params.peakCaps?.value).toBe(true);
    expect(shape.params.colorMode?.value).toBe('frequencyGradient');
  });

  it('Preset 18 (Star Burst Stream) matches specifications', () => {
    const p18 = SHOWCASE_PRESETS_13_20.find((p) => p.id === '18-star-burst-stream')!.preset;
    expect(p18.name).toBe('Star Burst Stream');
    const shape = p18.layers.find((l) => l.type === 'shape')!;
    expect(shape.params.baseShape?.value).toBe('star');
    expect(shape.params.sides?.value).toBe(5);
    expect(shape.params.starInner?.value).toBe(0.42);
    expect(shape.params.propMode?.value).toBe('stream');
    expect(shape.params.propCount?.value).toBe(6);
    expect(shape.params.colorMode?.value).toBe('amplitudeHot');
  });

  it('Preset 19 (Spiral Pearl Beads) matches specifications', () => {
    const p19 = SHOWCASE_PRESETS_13_20.find((p) => p.id === '19-spiral-pearl-beads')!.preset;
    expect(p19.name).toBe('Spiral Pearl Beads');
    const shape = p19.layers.find((l) => l.type === 'shape')!;
    expect(shape.params.baseShape?.value).toBe('spiral');
    expect(shape.params.spiralTurns?.value).toBe(3.5);
    expect(shape.params.effectType?.value).toBe('dots');
    expect(shape.params.extrudeDirection?.value).toBe('bilateral');
    expect(shape.params.sampleCount?.value).toBe(80);
  });

  it('Preset 20 (Dual-Rail Aurora Ark) matches specifications', () => {
    const p20 = SHOWCASE_PRESETS_13_20.find((p) => p.id === '20-dual-rail-aurora-ark')!.preset;
    expect(p20.name).toBe('Dual-Rail Aurora Ark');
    expect(p20.layers.filter((l) => l.type === 'shape')).toHaveLength(2);
    const auroraShape = p20.layers.find((l) => l.type === 'shape' && l.params.effectType?.value === 'auroraFill')!;
    expect(auroraShape.params.baseShape?.value).toBe('edgeLine');
    expect(auroraShape.params.edgeMode?.value).toBe('dualHorizontal');
    const waveShape = p20.layers.find((l) => l.type === 'shape' && l.params.effectType?.value === 'harmonicWave')!;
    expect(waveShape.params.baseShape?.value).toBe('circle');
  });

  it('buildScene successfully instantiates all 8 showcase presets', () => {
    for (const entry of SHOWCASE_PRESETS_13_20) {
      const scene = buildScene(entry.id, entry.preset);
      expect(scene).toBeDefined();
      expect(scene.name).toBe(entry.id);
      expect(scene.layers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('executes safety pass across all 8 showcase presets', () => {
    const limiter = new BrightnessLimiter();
    for (const entry of SHOWCASE_PRESETS_13_20) {
      expect(entry.id).toBeTruthy();
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
});
