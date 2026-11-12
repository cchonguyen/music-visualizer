// Legacy Layer Migration Shim (Sector 485, Slice 9.3)
// Translates legacy layers ('crown', 'waveform', 'bars', 'rings', 'shockwave')
// into unified 'shape' LayerEntry representations.
import type { LayerEntry, Preset, Setting, Settings } from './format';
import { SHAPE_DEFAULTS, type ShapeParams } from './layerSchemas';

const LEGACY_LAYER_TYPES = new Set(['crown', 'waveform', 'bars', 'rings', 'shockwave']);

function extractVal(setting: Setting | undefined): unknown {
  return setting?.value;
}

function toSettings(shape: ShapeParams, origParams?: Settings): Settings {
  const result: Settings = {};
  for (const [key, val] of Object.entries(shape)) {
    const orig = origParams?.[key];
    result[key] = {
      value: val,
      link: orig?.link,
      morph: orig?.morph,
    };
  }
  return result;
}

/**
 * Maps a single legacy layer entry ('crown', 'waveform', 'bars', 'rings', 'shockwave')
 * to an equivalent unified 'shape' layer entry. Non-legacy layers are returned untouched.
 */
export function migrateLegacyLayerToShape(layer: LayerEntry): LayerEntry {
  if (!LEGACY_LAYER_TYPES.has(layer.type)) {
    return layer;
  }

  const p = layer.params ?? {};
  let shape: ShapeParams;

  switch (layer.type) {
    case 'crown': {
      const sizeVal = extractVal(p.size);
      const size = typeof sizeVal === 'number' ? sizeVal * 0.225 : 0.45;
      shape = {
        ...SHAPE_DEFAULTS,
        baseShape: 'circle',
        effectType: 'bars',
        sampleCount: 48,
        effectLength: 0.35,
        thickness: 3.0,
        barGap: 0.25,
        extrudeDirection: 'outward',
        symmetry: 'wrap',
        normalMode: 'radial',
        propMode: 'single',
        size,
        audioSource: 'spectrum',
        colorMode: 'palette',
        glow: 0.6,
      };
      break;
    }

    case 'waveform': {
      const mode = String(extractVal(p.mode) ?? 'line');
      const baseShape =
        mode === 'line'
          ? 'centerLine'
          : mode === 'circle'
          ? 'circle'
          : mode === 'star7'
          ? 'star'
          : mode === 'lissajous'
          ? 'knot3d'
          : 'centerLine';
      const amp = typeof extractVal(p.amplitude) === 'number' ? Number(extractVal(p.amplitude)) : 1.0;
      // Legacy band texture is on by default. Shape's version (Slice 19.9b) takes one strength, 0 for off.
      const texOn = extractVal(p.texture) !== false;
      const texGain = typeof extractVal(p.textureGain) === 'number' ? Number(extractVal(p.textureGain)) : 1;
      const radius = typeof extractVal(p.radius) === 'number' ? Number(extractVal(p.radius)) : (mode === 'line' ? 0.8 : 0.45);
      const thick = typeof extractVal(p.thickness) === 'number' ? Number(extractVal(p.thickness)) : 2.0;
      const colMode = String(extractVal(p.colorMode) ?? 'white');

      shape = {
        ...SHAPE_DEFAULTS,
        baseShape,
        sides: mode === 'star7' ? 7 : 6,
        starInner: 0.5,
        effectType: 'waveform',
        size: radius,
        thickness: thick,
        // 256 points follow the trace sample by sample. 64 stretched over the curve smoothed the peaks away.
        sampleCount: 256,
        attackMs: 5,
        releaseMs: 40,
        effectLength: 0.5 * amp,
        reactivity: amp,
        extrudeDirection: 'bilateral',
        symmetry: 'wrap',
        propMode: 'single',
        // The signed trace keeps silence flat, like the legacy line. The unsigned waveform source drew silence at half height.
        audioSource: 'scope',
        bandTexture: texOn ? Math.min(2, Math.max(0, texGain)) : 0,
        colorMode: colMode === 'white' ? 'solid' : colMode === 'gradient' ? 'frequencyGradient' : 'palette',
        solidColor: '#ffffff',
      };
      break;
    }

    case 'bars': {
      shape = {
        ...SHAPE_DEFAULTS,
        baseShape: 'edgeLine',
        edgeMode: 'bottom',
        effectType: 'bars',
        sampleCount: 64,
        effectLength: 0.35,
        thickness: 3.0,
        barGap: 0.2,
        extrudeDirection: 'outward',
        symmetry: 'wrap',
        propMode: 'single',
        audioSource: 'spectrum',
        colorMode: 'palette',
      };
      break;
    }

    case 'rings': {
      const sides = typeof extractVal(p.sides) === 'number' ? Number(extractVal(p.sides)) : 0;
      const maxRings = typeof extractVal(p.maxRings) === 'number' ? Number(extractVal(p.maxRings)) : 4;
      const strokeBase = typeof extractVal(p.strokeBase) === 'number' ? Number(extractVal(p.strokeBase)) : 0.0035;

      shape = {
        ...SHAPE_DEFAULTS,
        baseShape: sides > 0 ? 'polygon' : 'circle',
        sides: sides > 0 ? sides : 4,
        effectType: 'pulsingLine',
        propMode: 'concentric',
        propCount: Math.min(16, Math.max(1, maxRings)),
        propSpacing: 0.2,
        propSpeed: 0.5,
        propDirection: 'outward',
        thickness: Math.max(1.0, strokeBase * 500),
        audioSource: 'sub',
        colorMode: 'palette',
      };
      break;
    }

    case 'shockwave': {
      const ringSec = typeof extractVal(p.ringSec) === 'number' ? Number(extractVal(p.ringSec)) : 0.35;
      const style = String(extractVal(p.style) ?? 'ring');

      shape = {
        ...SHAPE_DEFAULTS,
        baseShape: 'circle',
        effectType: 'solidLine',
        propMode: 'shockwave',
        propSpeed: ringSec > 0 ? Math.max(0.1, 0.35 / ringSec) : 0.65,
        thickness: style === 'glow' ? 6.0 : 3.0,
        glow: style === 'glow' ? 1.5 : 0.8,
        audioSource: 'sub',
        colorMode: 'palette',
      };
      break;
    }

    default:
      return layer;
  }

  const migratedParams = toSettings(shape, p);

  // Preserve links from legacy parameter names if not directly matched
  if (p.amplitude?.link && migratedParams.reactivity && !migratedParams.reactivity.link) {
    migratedParams.reactivity.link = p.amplitude.link;
  }
  if (p.radius?.link && migratedParams.size && !migratedParams.size.link) {
    migratedParams.size.link = p.radius.link;
  }
  if (layer.type === 'waveform' && p.textureGain?.link && migratedParams.bandTexture && !migratedParams.bandTexture.link) {
    migratedParams.bandTexture.link = p.textureGain.link;
  }

  return {
    type: 'shape',
    enabled: layer.enabled,
    opacity: layer.opacity,
    blend: layer.blend,
    trails: layer.trails,
    params: migratedParams,
  };
}

/** Alias matching Section 5.1 specification */
export const migrateLegacyLayerEntry = migrateLegacyLayerToShape;

/**
 * Maps an array of layers, translating any legacy layers to unified 'shape' layers.
 */
export function migrateLegacyLayers(layers: LayerEntry[]): LayerEntry[] {
  return layers.map(migrateLegacyLayerToShape);
}

/**
 * Waveform modes that Shape now matches (Slice 19.10, legacy-layer audit). Lissajous stays on the legacy layer
 * until its before and after have been compared, and Bars and Rings keep their legacy layers for the same reason.
 */
const SHAPE_READY_WAVEFORM_MODES = new Set(['line', 'circle', 'star7']);

/** True for a Waveform layer in a mode that Shape covers. */
export function isShapeReadyWaveform(layer: LayerEntry): boolean {
  return layer.type === 'waveform' && SHAPE_READY_WAVEFORM_MODES.has(String(extractVal(layer.params?.mode) ?? 'line'));
}

/**
 * Migrates the Waveform layers (line, circle, star7) of a parsed preset to Shape layers. Every other layer is
 * left as it is, and a preset without such a layer comes back as the same object. The saved file is never touched.
 */
export function migrateWaveformsInPreset<T extends { preset: Preset }>(parsed: T): T {
  if (!parsed.preset.layers.some(isShapeReadyWaveform)) return parsed;
  const layers = parsed.preset.layers.map((l) => (isShapeReadyWaveform(l) ? migrateLegacyLayerToShape(l) : l));
  return { ...parsed, preset: { ...parsed.preset, layers } };
}
