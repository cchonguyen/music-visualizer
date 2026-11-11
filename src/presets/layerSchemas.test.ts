import { describe, it, expect } from "vitest";
import { assertValidSpec, defaultsFor } from "./schema";
import {
  BARS_DEFAULTS, BARS_SPECS, BASS_PULSE_DEFAULTS, BASS_PULSE_SPECS, CROWN_DEFAULTS, CROWN_SPECS, LAYER_SPECS, PARTICLE_DEFAULTS, PARTICLE_SPECS,
  RINGS_DEFAULTS, RINGS_SPECS, SHAPE_DEFAULTS, SHAPE_SPECS, SHOCKWAVE_DEFAULTS, SHOCKWAVE_SPECS, TUNNEL_DEFAULTS, TUNNEL_SPECS,
  WAVEFORM_DEFAULTS, WAVEFORM_SPECS, WAVEFORM_SCHEMA, POST_SPECS, FEEDBACK_SPECS, CHLADNI_PLATE_MODE_SPEC,
} from "./layerSchemas";

describe("layer schemas", () => {
  it("every built-in spec is internally valid", () => {
    for (const specs of Object.values(LAYER_SPECS)) {
      specs.forEach(assertValidSpec);
    }
  });

  // Pins the real exported defaults. If one of these changes, the look of presets that rely on it
  // changes too, so this test must be updated on purpose.
  it("pins the shipped layer defaults", () => {
    expect(TUNNEL_DEFAULTS).toEqual({
      ringDensity: 0.5, beatAttackSec: 0.08, ringContrast: 0.5, ringContrastCalm: 0.25, pattern: 'rings', sides: 0, twist: 0,
      texture: false, textureGain: 1, flightMode: 'dropReverse', reverseOnBreakdown: true, hueSpread: 0.55, wallTexture: 0.55,
      zoomPunch: 0, swirlPulse: 0.35, horizonDrift: 0.4, beatReactivity: 0.5,
    });
    expect(PARTICLE_DEFAULTS).toEqual({ brightness: 1.0, calmSparkleScale: 0.3, flashSparkleScale: 0.2, swirlGain: 1, shape: 'streak', rotation: 0, zoom: 1, hueShift: 0, hueDrift: 0, texture: true, textureGain: 1, size: 2, followScene: false, beatReactivity: 1.0 });
    expect(CROWN_DEFAULTS.rimFactor).toBe(1 - 0.16);
    expect(RINGS_DEFAULTS).toEqual({ maxRings: 6, maxRingsCalm: 3, strokeBase: 0.0035, strokeNormGain: 0.01, sides: 0, style: 'outline', texture: true, textureGain: 1 });
    expect(SHOCKWAVE_DEFAULTS).toEqual({ ringStart: 0.16, ringEnd: 0.95, ringSec: 0.35, style: 'ring', texture: true, textureGain: 1 });
    expect(BARS_DEFAULTS).toEqual({ texture: true, textureGain: 1 });
    expect(BASS_PULSE_DEFAULTS).toEqual({ texture: true, textureGain: 1 });
    expect(WAVEFORM_DEFAULTS).toEqual({ mode: 'line', amplitude: 1, radius: 0.45, thickness: 2.0, texture: true, textureGain: 1, colorMode: 'white' });
  });

  it.each([
    ["shape", SHAPE_SPECS, SHAPE_DEFAULTS],
    ["tunnel", TUNNEL_SPECS, TUNNEL_DEFAULTS],
    ["particles", PARTICLE_SPECS, PARTICLE_DEFAULTS],
    ["crown", CROWN_SPECS, CROWN_DEFAULTS],
    ["rings", RINGS_SPECS, RINGS_DEFAULTS],
    ["shockwave", SHOCKWAVE_SPECS, SHOCKWAVE_DEFAULTS],
    ["bars", BARS_SPECS, BARS_DEFAULTS],
    ["bassPulse", BASS_PULSE_SPECS, BASS_PULSE_DEFAULTS],
    ["waveform", WAVEFORM_SPECS, WAVEFORM_DEFAULTS],
  ])("%s: schema defaults match the layer's typed defaults", (_name, specs, defaults) => {
    expect(defaultsFor(specs)).toEqual(defaults);
  });

  it("exposes radius and thickness sliders in WAVEFORM_SCHEMA", () => {
    expect(WAVEFORM_SCHEMA.radius).toMatchObject({
      name: 'radius',
      default: 0.45,
      min: 0.15,
      max: 0.95,
      step: 0.01,
    });
    expect(WAVEFORM_SCHEMA.thickness).toMatchObject({
      name: 'thickness',
      default: 2.0,
      min: 0.5,
      max: 5.0,
      step: 0.1,
    });
  });

  it("registers shape as the FIRST entry in LAYER_SPECS", () => {
    expect(Object.keys(LAYER_SPECS)[0]).toBe("shape");
  });

  it("every layer type is registered including shape", () => {
    expect(Object.keys(LAYER_SPECS).sort()).toEqual([
      "bars",
      "bassPulse",
      "crown",
      "particles",
      "rings",
      "shape",
      "shockwave",
      "tunnel",
      "waveform",
    ]);
  });

  it("SHAPE_SPECS covers all 5 orthogonal categories and validates correctly", () => {
    expect(SHAPE_SPECS.length).toBe(37);
    SHAPE_SPECS.forEach(assertValidSpec);

    const groups = new Set(SHAPE_SPECS.map(s => s.group));
    expect(groups).toEqual(new Set(['Base', 'Effect', 'Direction', 'Propagation', 'Audio & Style']));

    // Category 1: Base
    const baseSpecs = SHAPE_SPECS.filter(s => s.group === 'Base');
    expect(baseSpecs.map(s => s.name)).toEqual([
      'baseShape', 'edgeMode', 'sides', 'starInner', 'cornerRadius', 'arcSweep',
      'spiralTurns', 'size', 'posX', 'posY', 'rotation', 'spinSpeed', 'basePulse',
    ]);

    // Category 2: Effect
    const effectSpecs = SHAPE_SPECS.filter(s => s.group === 'Effect');
    expect(effectSpecs.map(s => s.name)).toEqual([
      'effectType', 'sampleCount', 'effectLength', 'thickness', 'barGap', 'ledSegments', 'peakCaps',
    ]);

    // Category 3: Direction
    const directionSpecs = SHAPE_SPECS.filter(s => s.group === 'Direction');
    expect(directionSpecs.map(s => s.name)).toEqual([
      'extrudeDirection', 'symmetry', 'normalMode',
    ]);

    // Category 4: Propagation
    const propSpecs = SHAPE_SPECS.filter(s => s.group === 'Propagation');
    expect(propSpecs.map(s => s.name)).toEqual([
      'propMode', 'propCount', 'propSpacing', 'propSpeed', 'propDirection', 'propSelfSpin', 'propDelay',
    ]);

    // Category 5: Audio & Style
    const audioSpecs = SHAPE_SPECS.filter(s => s.group === 'Audio & Style');
    expect(audioSpecs.map(s => s.name)).toEqual([
      'audioSource', 'reactivity', 'attackMs', 'releaseMs', 'colorMode', 'solidColor', 'glow',
    ]);
  });

  it("SHAPE_SPECS defines declarative showWhen conditional visibility rules", () => {
    const specMap = new Map(SHAPE_SPECS.map(s => [s.name, s]));

    // Conditional parameters
    expect(specMap.get('edgeMode')?.showWhen).toEqual({ baseShape: 'edgeLine' });
    expect(specMap.get('sides')?.showWhen).toEqual({ baseShape: ['polygon', 'star'] });
    expect(specMap.get('starInner')?.showWhen).toEqual({ baseShape: 'star' });
    expect(specMap.get('cornerRadius')?.showWhen).toEqual({ baseShape: ['polygon', 'star', 'edgeLine'] });
    expect(specMap.get('arcSweep')?.showWhen).toEqual({ baseShape: 'arc' });
    expect(specMap.get('spiralTurns')?.showWhen).toEqual({ baseShape: 'spiral' });

    expect(specMap.get('sampleCount')?.showWhen).toEqual({
      effectType: ['waveform', 'harmonicWave', 'bars', 'segmentedBars', 'dots', 'auroraFill'],
    });
    expect(specMap.get('effectLength')?.showWhen).toEqual({
      effectType: ['pulsingLine', 'waveform', 'harmonicWave', 'bars', 'segmentedBars', 'dots', 'auroraFill'],
    });
    expect(specMap.get('barGap')?.showWhen).toEqual({ effectType: ['bars', 'segmentedBars'] });
    expect(specMap.get('ledSegments')?.showWhen).toEqual({ effectType: 'segmentedBars' });
    expect(specMap.get('peakCaps')?.showWhen).toEqual({ effectType: ['bars', 'segmentedBars'] });

    expect(specMap.get('extrudeDirection')?.showWhen).toEqual({
      effectType: ['waveform', 'harmonicWave', 'bars', 'segmentedBars', 'dots', 'auroraFill'],
    });
    expect(specMap.get('normalMode')?.showWhen).toEqual({
      baseShape: ['polygon', 'star', 'spiral', 'figure8', 'arc'],
    });

    expect(specMap.get('propCount')?.showWhen).toEqual({ propMode: ['concentric', 'stream', 'orbit', 'polar'] });
    expect(specMap.get('propSpacing')?.showWhen).toEqual({ propMode: ['concentric', 'orbit', 'polar'] });
    expect(specMap.get('propSpeed')?.showWhen).toEqual({ propMode: ['shockwave', 'stream', 'orbit', 'polar'] });
    expect(specMap.get('propDirection')?.showWhen).toEqual({
      propMode: ['concentric', 'shockwave', 'stream', 'orbit', 'polar'],
    });
    expect(specMap.get('propSelfSpin')?.showWhen).toEqual({ propMode: ['orbit', 'polar'] });
    expect(specMap.get('propDelay')?.showWhen).toEqual({ propMode: ['concentric', 'stream', 'orbit', 'polar'] });

    expect(specMap.get('solidColor')?.showWhen).toEqual({ colorMode: 'solid' });

    // Always-visible parameters
    expect(specMap.get('baseShape')?.showWhen).toBeUndefined();
    expect(specMap.get('size')?.showWhen).toBeUndefined();
    expect(specMap.get('posX')?.showWhen).toBeUndefined();
    expect(specMap.get('posY')?.showWhen).toBeUndefined();
    expect(specMap.get('rotation')?.showWhen).toBeUndefined();
    expect(specMap.get('spinSpeed')?.showWhen).toBeUndefined();
    expect(specMap.get('basePulse')?.showWhen).toBeUndefined();
    expect(specMap.get('effectType')?.showWhen).toBeUndefined();
    expect(specMap.get('thickness')?.showWhen).toBeUndefined();
    expect(specMap.get('symmetry')?.showWhen).toBeUndefined();
    expect(specMap.get('propMode')?.showWhen).toBeUndefined();
    expect(specMap.get('audioSource')?.showWhen).toBeUndefined();
    expect(specMap.get('reactivity')?.showWhen).toBeUndefined();
    expect(specMap.get('attackMs')?.showWhen).toBeUndefined();
    expect(specMap.get('releaseMs')?.showWhen).toBeUndefined();
    expect(specMap.get('colorMode')?.showWhen).toBeUndefined();
    expect(specMap.get('glow')?.showWhen).toBeUndefined();
  });

  describe("Parameter Descriptors & Warning Schema Contracts", () => {
    it("description strings are present and non-empty across all layer schemas, POST_SPECS, and FEEDBACK_SPECS", () => {
      for (const [layerName, specs] of Object.entries(LAYER_SPECS)) {
        for (const spec of specs) {
          expect(
            spec.description,
            `Layer "${layerName}" param "${spec.name}" missing description`
          ).toBeDefined();
          expect(typeof spec.description).toBe("string");
          expect(spec.description!.trim().length).toBeGreaterThan(0);
        }
      }

      for (const spec of POST_SPECS) {
        expect(spec.description, `POST_SPECS param "${spec.name}" missing description`).toBeDefined();
        expect(typeof spec.description).toBe("string");
        expect(spec.description!.trim().length).toBeGreaterThan(0);
      }

      for (const spec of FEEDBACK_SPECS) {
        expect(spec.description, `FEEDBACK_SPECS param "${spec.name}" missing description`).toBeDefined();
        expect(typeof spec.description).toBe("string");
        expect(spec.description!.trim().length).toBeGreaterThan(0);
      }

      expect(CHLADNI_PLATE_MODE_SPEC.description).toBeDefined();
      expect(typeof CHLADNI_PLATE_MODE_SPEC.description).toBe("string");
      expect(CHLADNI_PLATE_MODE_SPEC.description!.trim().length).toBeGreaterThan(0);
    });

    it("flags mirror and chroma in POST_SPECS with intense: true and exact warning string", () => {
      const EXPECTED_WARNING =
        "Intense visual transform. Highly sensitive to small adjustments — use with care.";

      for (const name of ["mirror", "chroma"]) {
        const spec = POST_SPECS.find((s) => s.name === name);
        expect(spec, `Parameter "${name}" should exist in POST_SPECS`).toBeDefined();
        expect(spec!.intense).toBe(true);
        expect(spec!.warning).toBe(EXPECTED_WARNING);
      }
    });

    it("positions intense parameters at the bottom of the Shape group in POST_SPECS", () => {
      const shapeSpecs = POST_SPECS.filter((s) => s.group === "Shape");
      const intenseIndices = shapeSpecs
        .map((s, idx) => (s.intense ? idx : -1))
        .filter((idx) => idx !== -1);
      const nonIntenseIndices = shapeSpecs
        .map((s, idx) => (!s.intense ? idx : -1))
        .filter((idx) => idx !== -1);

      expect(intenseIndices.length).toBeGreaterThan(0);
      expect(nonIntenseIndices.length).toBeGreaterThan(0);
      const minIntenseIndex = Math.min(...intenseIndices);
      const maxNonIntenseIndex = Math.max(...nonIntenseIndices);
      expect(minIntenseIndex).toBeGreaterThan(maxNonIntenseIndex);
    });
  });
});

