import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EXPERIENCE_MODES,
  EXPERIENCE_PROFILES,
  type ExperienceMode,
  CAMERA_MODES,
  CAMERA_MOVES,
  COLOR_MOODS,
  PALETTE_NAMES,
  AUTOCYCLE_PALETTES,
  TRIGGER_CADENCES,
  DEFAULT_DIRECTOR_SETTINGS,
  DIRECTOR_PALETTES,
  DIRECTOR_STORAGE_KEY,
  GlobalDirector,
  analyzePresetMotion,
  extractPresetMotionProfile,
  evaluateCameraMove,
  smoothstep,
  readDirectorSettings,
  saveDirectorSettings,
  sanitizeDirectorSettings,
  getGlobalDirector,
  resetGlobalDirector,
  type CameraMove,
} from '../globalDirector';
import {
  parsePreset,
  type Preset,
  type DirectorPaletteAsset,
  type ExperienceBundleAsset,
  type VisualizerAsset,
} from '../../presets/format';
import { clampDt, MAX_DT_SEC } from '../clock';
import { eligible, DEFAULT_CYCLE } from '../../presets/autoCycle';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe('GlobalDirector Engine & State Store (Slice 7.30)', () => {
  beforeEach(() => {
    globalThis.localStorage = createMemoryStorage();
    resetGlobalDirector();
    vi.restoreAllMocks();
  });

  describe('1. Default settings & localStorage persistence', () => {
    it('has exact default director settings matching spec', () => {
      expect(EXPERIENCE_MODES).toEqual(['cinematic', 'calm', 'minimal', 'colorWalk', 'custom']);
      expect(CAMERA_MODES).toEqual(['auto', 'craneSway', 'dutchRoll', 'breathingPush', 'horizonTilt', 'stillAnchor', 'off']);
      expect(CAMERA_MOVES).toEqual(['craneSway', 'dutchRoll', 'breathingPush', 'horizonTilt', 'stillAnchor']);
      expect(COLOR_MOODS).toEqual(['auto', 'native', 'cyberpunk', 'ember', 'biolum', 'vapor', 'prismatic']);
      expect(TRIGGER_CADENCES).toEqual(['section', 'beats32', 'beats64', 'beats128', 'timer45']);

      expect(DEFAULT_DIRECTOR_SETTINGS).toEqual({
        experienceMode: 'cinematic',
        cameraMode: 'auto',
        cameraIntensity: 0.65,
        colorMood: 'auto',
        colorIntensity: 0.45,
        triggerCadence: 'section',
      });
    });

    it('reads default settings when localStorage is empty', () => {
      const settings = readDirectorSettings();
      expect(settings).toEqual(DEFAULT_DIRECTOR_SETTINGS);
    });

    it('persists and restores settings to/from localStorage key mv.globalDirector', () => {
      const custom = {
        experienceMode: 'custom' as const,
        cameraMode: 'dutchRoll' as const,
        cameraIntensity: 0.8,
        colorMood: 'ember' as const,
        colorIntensity: 0.5,
        triggerCadence: 'timer45' as const,
      };
      saveDirectorSettings(custom);
      expect(localStorage.getItem(DIRECTOR_STORAGE_KEY)).toBe(JSON.stringify(custom));

      const restored = readDirectorSettings();
      expect(restored).toEqual(custom);
    });

    it('sanitizes invalid or corrupted settings safely', () => {
      const corrupted = sanitizeDirectorSettings({
        experienceMode: 'superHyper',
        cameraMode: 'invalidCamera',
        cameraIntensity: 5.0, // out of range
        colorMood: 'alienGlow',
        colorIntensity: -2.0, // out of range
        triggerCadence: 'every10Sec',
      });

      expect(corrupted.experienceMode).toBe('cinematic');
      expect(corrupted.cameraMode).toBe('auto');
      expect(corrupted.cameraIntensity).toBe(1.0); // clamped to 1.0
      expect(corrupted.colorMood).toBe('auto');
      expect(corrupted.colorIntensity).toBe(0.0); // clamped to 0.0
      expect(corrupted.triggerCadence).toBe('section');
    });

    it('updates settings on director instance and syncs to localStorage', () => {
      const director = new GlobalDirector();
      director.updateSettings({ cameraMode: 'breathingPush', cameraIntensity: 0.9 });

      expect(director.getSettings().cameraMode).toBe('breathingPush');
      expect(director.getSettings().cameraIntensity).toBe(0.9);

      const saved = JSON.parse(localStorage.getItem(DIRECTOR_STORAGE_KEY) || '{}');
      expect(saved.cameraMode).toBe('breathingPush');
      expect(saved.cameraIntensity).toBe(0.9);
    });

    it('manages singleton instance correctly via getGlobalDirector and resetGlobalDirector', () => {
      const inst1 = getGlobalDirector();
      const inst2 = getGlobalDirector();
      expect(inst1).toBe(inst2);

      resetGlobalDirector();
      const inst3 = getGlobalDirector();
      expect(inst3).not.toBe(inst1);
    });
  });

  describe('2. analyzePresetMotion', () => {
    it('returns planar weights for null or empty presets', () => {
      const weights = analyzePresetMotion(null);
      expect(weights).toEqual({
        craneSway: 1.0,
        dutchRoll: 1.0,
        breathingPush: 1.0,
        horizonTilt: 1.0,
        stillAnchor: 0.5,
      });
    });

    it('detects forward Z-flight in tunnel layer and favors craneSway/dutchRoll while suppressing breathingPush', () => {
      const preset: Partial<Preset> = {
        layers: [
          {
            type: 'tunnel',
            enabled: true,
            opacity: 1,
            blend: 'max',
            params: {},
          },
        ],
      };
      const weights = analyzePresetMotion(preset as Preset);
      expect(weights).toEqual({
        craneSway: 1.5,
        dutchRoll: 1.5,
        breathingPush: 0.2,
        horizonTilt: 1.0,
        stillAnchor: 0.6,
      });
    });

    it('detects forward Z-flight in spectralTerrain layer', () => {
      const preset: Partial<Preset> = {
        layers: [
          {
            type: 'spectralTerrain',
            enabled: true,
            opacity: 1,
            blend: 'max',
            params: {},
          },
        ],
      };
      const weights = analyzePresetMotion(preset as Preset);
      expect(weights.breathingPush).toBe(0.2);
      expect(weights.craneSway).toBe(1.5);
    });

    it('ignores disabled layers', () => {
      const preset: Partial<Preset> = {
        layers: [
          {
            type: 'tunnel',
            enabled: false,
            opacity: 1,
            blend: 'max',
            params: {},
          },
        ],
      };
      const weights = analyzePresetMotion(preset as Preset);
      expect(weights.breathingPush).toBe(1.0);
      expect(weights.craneSway).toBe(1.0);
    });

    it('detects rotational spin via feedback.rotate and suppresses dutchRoll while favoring horizonTilt and breathingPush', () => {
      const preset: Partial<Preset> = {
        feedback: {
          rotate: { value: 0.3 },
        },
        layers: [],
      };
      const weights = analyzePresetMotion(preset as Preset);
      expect(weights).toEqual({
        craneSway: 1.0,
        dutchRoll: 0.1,
        breathingPush: 1.5,
        horizonTilt: 1.5,
        stillAnchor: 0.6,
      });
    });

    it('detects rotational spin via feedback warpMode mobius or polarFold', () => {
      const mobiusPreset: Partial<Preset> = {
        feedback: {
          warpMode: { value: 'mobius' },
        },
      };
      expect(analyzePresetMotion(mobiusPreset as Preset).dutchRoll).toBe(0.1);

      const polarPreset: Partial<Preset> = {
        feedback: {
          warpMode: { value: 'polarFold' },
        },
      };
      expect(analyzePresetMotion(polarPreset as Preset).dutchRoll).toBe(0.1);
    });

    it('detects rotational spin in particles with phyllotaxis', () => {
      const preset: Partial<Preset> = {
        layers: [
          {
            type: 'particles',
            enabled: true,
            opacity: 1,
            blend: 'max',
            params: {
              mode: { value: 'phyllotaxis' },
            },
          },
        ],
      };
      const weights = analyzePresetMotion(preset as Preset);
      expect(weights.dutchRoll).toBe(0.1);
      expect(weights.horizonTilt).toBe(1.5);
    });

    it('detects rotational spin in rings with mandala mode', () => {
      const preset: Partial<Preset> = {
        layers: [
          {
            type: 'rings',
            enabled: true,
            opacity: 1,
            blend: 'max',
            params: {
              mode: { value: 'mandala' },
            },
          },
        ],
      };
      const weights = analyzePresetMotion(preset as Preset);
      expect(weights.dutchRoll).toBe(0.1);
    });

    it('combines Z-flight and spin by suppressing both conflicting moves and favoring craneSway and horizonTilt', () => {
      const preset: Partial<Preset> = {
        feedback: {
          rotate: { value: 0.25 },
        },
        layers: [
          {
            type: 'tunnel',
            enabled: true,
            opacity: 1,
            blend: 'max',
            params: {},
          },
        ],
      };
      const weights = analyzePresetMotion(preset as Preset);
      expect(weights).toEqual({
        craneSway: 1.5,
        dutchRoll: 0.1,
        breathingPush: 0.2,
        horizonTilt: 1.5,
        stillAnchor: 0.6,
      });
    });

    it('returns planar weights for geometric presets without Z-flight or spin', () => {
      const preset: Partial<Preset> = {
        layers: [
          {
            type: 'waveform',
            enabled: true,
            opacity: 1,
            blend: 'max',
            params: {},
          },
          {
            type: 'chladniSand',
            enabled: true,
            opacity: 1,
            blend: 'max',
            params: {
              plateMode: { value: 'fullscreen' },
            },
          },
        ],
      };
      const weights = analyzePresetMotion(preset as Preset);
      expect(weights).toEqual({
        craneSway: 1.0,
        dutchRoll: 1.0,
        breathingPush: 1.0,
        horizonTilt: 1.0,
        stillAnchor: 0.5,
      });
    });

    it('detects rotational spin in shape layer via spinSpeed', () => {
      const preset: Partial<Preset> = {
        layers: [
          {
            type: 'shape',
            enabled: true,
            opacity: 1,
            blend: 'max',
            params: {
              spinSpeed: { value: 0.8 },
            },
          },
        ],
      };
      const weights = analyzePresetMotion(preset as Preset);
      expect(weights.dutchRoll).toBe(0.1);
      expect(weights.horizonTilt).toBe(1.5);
      expect(weights.breathingPush).toBe(1.5);
    });

    it('detects rotational spin in shape layer via propMode orbit, polar, or spiral baseShape', () => {
      const orbitPreset: Partial<Preset> = {
        layers: [
          {
            type: 'shape',
            enabled: true,
            opacity: 1,
            blend: 'max',
            params: {
              propMode: { value: 'orbit' },
            },
          },
        ],
      };
      expect(analyzePresetMotion(orbitPreset as Preset).dutchRoll).toBe(0.1);

      const polarPreset: Partial<Preset> = {
        layers: [
          {
            type: 'shape',
            enabled: true,
            opacity: 1,
            blend: 'max',
            params: {
              propMode: { value: 'polar' },
            },
          },
        ],
      };
      expect(analyzePresetMotion(polarPreset as Preset).dutchRoll).toBe(0.1);

      const spiralPreset: Partial<Preset> = {
        layers: [
          {
            type: 'shape',
            enabled: true,
            opacity: 1,
            blend: 'max',
            params: {
              baseShape: { value: 'spiral' },
            },
          },
        ],
      };
      expect(analyzePresetMotion(spiralPreset as Preset).dutchRoll).toBe(0.1);
    });

    it('detects forward Z-flight in shape layer via propMode stream', () => {
      const preset: Partial<Preset> = {
        layers: [
          {
            type: 'shape',
            enabled: true,
            opacity: 1,
            blend: 'max',
            params: {
              propMode: { value: 'stream' },
            },
          },
        ],
      };
      const weights = analyzePresetMotion(preset as Preset);
      expect(weights.breathingPush).toBe(0.2);
      expect(weights.craneSway).toBe(1.5);
      expect(weights.dutchRoll).toBe(1.5);
    });

    it('detects both Z-flight and spin in shape layer with stream and spinSpeed', () => {
      const preset: Partial<Preset> = {
        layers: [
          {
            type: 'shape',
            enabled: true,
            opacity: 1,
            blend: 'max',
            params: {
              propMode: { value: 'stream' },
              spinSpeed: { value: 0.5 },
            },
          },
        ],
      };
      const weights = analyzePresetMotion(preset as Preset);
      expect(weights).toEqual({
        craneSway: 1.5,
        dutchRoll: 0.1,
        breathingPush: 0.2,
        horizonTilt: 1.5,
        stillAnchor: 0.6,
      });
    });

    it('extractPresetMotionProfile returns identical weights to analyzePresetMotion', () => {
      const preset: Partial<Preset> = {
        layers: [
          {
            type: 'shape',
            enabled: true,
            opacity: 1,
            blend: 'max',
            params: {
              propMode: { value: 'stream' },
            },
          },
        ],
      };
      expect(extractPresetMotionProfile(preset as Preset)).toEqual(analyzePresetMotion(preset as Preset));
    });
  });

  describe('3. Camera moves and inward zoom floor', () => {
    const allMoves: CameraMove[] = ['craneSway', 'dutchRoll', 'breathingPush', 'horizonTilt', 'stillAnchor'];

    it('evaluates all 5 moves mathematically according to Section 2.3', () => {
      const t = 10;
      const energy = 0.5;

      const crane = evaluateCameraMove('craneSway', t, energy);
      expect(crane.zoom).toBe(1.15);
      expect(crane.panX).toBeCloseTo(0.12 * Math.sin(0.35 * t));
      expect(crane.panY).toBeCloseTo(0.12 * Math.cos(0.28 * t));
      expect(crane.tiltX).toBeCloseTo(-0.15 * crane.panX);
      expect(crane.tiltY).toBeCloseTo(-0.15 * crane.panY);

      const dutch = evaluateCameraMove('dutchRoll', t, energy);
      expect(dutch.zoom).toBe(1.16);
      expect(dutch.roll).toBeCloseTo(0.42 * Math.sin(0.40 * t));
      expect(dutch.panX).toBeCloseTo(0.06 * Math.cos(0.20 * t));
      expect(dutch.panY).toBeCloseTo(0.06 * Math.sin(0.20 * t));

      const breath = evaluateCameraMove('breathingPush', t, energy);
      expect(breath.zoom).toBeCloseTo(1.08 + 0.42 * energy);
      expect(breath.roll).toBe(0);
      expect(breath.tiltX).toBe(0);

      const tilt = evaluateCameraMove('horizonTilt', t, energy);
      expect(tilt.zoom).toBe(1.16);
      expect(tilt.tiltX).toBeCloseTo(0.45 * Math.sin(0.25 * t));
      expect(tilt.tiltY).toBeCloseTo(0.60 * Math.cos(0.18 * t));

      const still = evaluateCameraMove('stillAnchor', t, energy);
      expect(still.zoom).toBe(1.04);
      expect(still.panX).toBe(0);
      expect(still.roll).toBe(0);
    });

    it('enforces inward zoom floor >= 1.02 across all 5 camera moves at active intensity', () => {
      for (const move of allMoves) {
        const director = new GlobalDirector({ cameraMode: move, cameraIntensity: 0.65 });
        director.advance(6.0); // complete initial morph
        const uniforms = director.getCameraUniforms();
        expect(uniforms.zoom).toBeGreaterThanOrEqual(1.02);
      }
    });

    it('returns exact identity when cameraMode is off', () => {
      const director = new GlobalDirector({ cameraMode: 'off', cameraIntensity: 0.7 });
      const uniforms = director.getCameraUniforms();
      expect(uniforms).toEqual({
        panX: 0,
        panY: 0,
        zoom: 1,
        roll: 0,
        tiltX: 0,
        tiltY: 0,
      });
    });

    it('returns exact identity when cameraIntensity is 0', () => {
      const director = new GlobalDirector({ cameraMode: 'craneSway', cameraIntensity: 0 });
      const uniforms = director.getCameraUniforms();
      expect(uniforms).toEqual({
        panX: 0,
        panY: 0,
        zoom: 1,
        roll: 0,
        tiltX: 0,
        tiltY: 0,
      });
    });
  });

  describe('4. 6-second velocity-continuous morphing', () => {
    it('implements smoothstep with C1 boundary conditions', () => {
      expect(smoothstep(0, 1, 0)).toBe(0);
      expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
      expect(smoothstep(0, 1, 1)).toBe(1);

      // Check derivative approaches zero at t=0 and t=1
      const eps = 1e-4;
      const d0 = (smoothstep(0, 1, eps) - smoothstep(0, 1, 0)) / eps;
      const d1 = (smoothstep(0, 1, 1) - smoothstep(0, 1, 1 - eps)) / eps;
      expect(d0).toBeCloseTo(0, 3);
      expect(d1).toBeCloseTo(0, 3);
    });

    it('morphs between moves over 6.0 seconds with zero jump at transition start', () => {
      const director = new GlobalDirector({ cameraMode: 'auto', cameraIntensity: 1.0 });
      director.advance(6.0); // finish initial setup on craneSway

      const preUniforms = director.getCameraUniforms();

      // Trigger transition to dutchRoll
      director.triggerMacro('dutchRoll');

      // Exactly at t=0 of transition:
      const postUniforms = director.getCameraUniforms();
      expect(postUniforms.panX).toBeCloseTo(preUniforms.panX, 6);
      expect(postUniforms.panY).toBeCloseTo(preUniforms.panY, 6);
      expect(postUniforms.roll).toBeCloseTo(preUniforms.roll, 6);
      expect(postUniforms.zoom).toBeCloseTo(preUniforms.zoom, 6);
      expect(postUniforms.tiltX).toBeCloseTo(preUniforms.tiltX, 6);
      expect(postUniforms.tiltY).toBeCloseTo(preUniforms.tiltY, 6);

      // Advance to midpoint t=3s: smoothstep(0, 1, 0.5) = 0.5 blend
      director.advance(3.0);
      const midUniforms = director.getCameraUniforms();
      const uFrom = evaluateCameraMove('craneSway', 9.0, 0);
      const uTo = evaluateCameraMove('dutchRoll', 9.0, 0);
      expect(midUniforms.roll).toBeCloseTo(0.5 * uFrom.roll + 0.5 * uTo.roll, 4);

      // Advance to t=6s: 100% dutchRoll
      director.advance(3.0);
      const endUniforms = director.getCameraUniforms();
      const uFinal = evaluateCameraMove('dutchRoll', 12.0, 0);
      expect(endUniforms.roll).toBeCloseTo(uFinal.roll, 4);
      expect(endUniforms.panX).toBeCloseTo(uFinal.panX, 4);
    });
  });

  describe('5. Macro trigger cadences', () => {
    it('section cadence requires 35s cooldown and triggers on flux or contrast hit', () => {
      const director = new GlobalDirector({ triggerCadence: 'section' });
      director.advance(6.0);

      const initialMove = director.getToMove();

      // Advance to 34s with high flux: should NOT trigger yet
      director.advance(28.0, { flux: 0.9 });
      expect(director.getElapsedSinceTriggerSec()).toBeCloseTo(34.0);
      expect(director.getToMove()).toBe(initialMove);

      // Advance past 35s with low flux/contrast: should NOT trigger yet
      director.advance(2.0, { flux: 0.1 }, 0.02);
      expect(director.getElapsedSinceTriggerSec()).toBeCloseTo(36.0);
      expect(director.getToMove()).toBe(initialMove);

      // Hit novelty threshold: contrast > 0.08
      director.advance(1.0, { flux: 0.1 }, 0.12);
      expect(director.getElapsedSinceTriggerSec()).toBe(0); // Triggered and reset!
      expect(director.getToMove()).not.toBe(initialMove);
    });

    it('section cadence triggers on 75s maximum fallback even without audio novelty', () => {
      const director = new GlobalDirector({ triggerCadence: 'section' });
      director.advance(6.0);
      const initialMove = director.getToMove();

      director.advance(68.0, { flux: 0.01 }, 0.0);
      expect(director.getElapsedSinceTriggerSec()).toBeCloseTo(74.0);
      expect(director.getToMove()).toBe(initialMove);

      // Step past 75s: fallback fires
      director.advance(1.5, { flux: 0.01 }, 0.0);
      expect(director.getElapsedSinceTriggerSec()).toBe(0);
      expect(director.getToMove()).not.toBe(initialMove);
    });

    it('beats32 cadence counts beats and triggers after 32 beats with 6s floor', () => {
      const director = new GlobalDirector({ triggerCadence: 'beats32' });
      director.advance(6.0);
      const initialMove = director.getToMove();

      // Fire 31 beats
      for (let i = 0; i < 31; i++) {
        director.advance(0.3, { kickPulse: true });
      }
      expect(director.getBeatCount()).toBe(31);
      expect(director.getToMove()).toBe(initialMove);

      // 32nd beat fires trigger
      director.advance(0.3, { kickPulse: true });
      expect(director.getBeatCount()).toBe(0);
      expect(director.getToMove()).not.toBe(initialMove);
    });

    it('beats cadence respects 6-second safety floor', () => {
      const director = new GlobalDirector({ triggerCadence: 'beats32' });
      // Fast beats arriving in under 6 seconds:
      for (let i = 0; i < 35; i++) {
        director.advance(0.1, { kickPulse: true });
      }
      // Total elapsed = 3.5s < 6.0s floor
      expect(director.getBeatCount()).toBe(35);

      // Now pass the 6s floor
      director.advance(2.6, { kickPulse: true });
      expect(director.getBeatCount()).toBe(0); // Triggered!
    });

    it('beats64 and beats128 trigger at their respective thresholds', () => {
      const dir64 = new GlobalDirector({ triggerCadence: 'beats64' });
      dir64.advance(6.0);
      for (let i = 0; i < 63; i++) {
        dir64.advance(0.2, { beat: true });
      }
      expect(dir64.getBeatCount()).toBe(63);
      dir64.advance(0.2, { beat: true });
      expect(dir64.getBeatCount()).toBe(0);

      const dir128 = new GlobalDirector({ triggerCadence: 'beats128' });
      dir128.advance(6.0);
      for (let i = 0; i < 127; i++) {
        dir128.advance(0.1, { kickPulse: true });
      }
      expect(dir128.getBeatCount()).toBe(127);
      dir128.advance(0.1, { kickPulse: true });
      expect(dir128.getBeatCount()).toBe(0);
    });

    it('timer45 triggers at 45 seconds', () => {
      const director = new GlobalDirector({ triggerCadence: 'timer45' });
      director.advance(6.0);
      const initialMove = director.getToMove();

      director.advance(38.0);
      expect(director.getElapsedSinceTriggerSec()).toBeCloseTo(44.0);
      expect(director.getToMove()).toBe(initialMove);

      director.advance(1.5);
      expect(director.getElapsedSinceTriggerSec()).toBe(0);
      expect(director.getToMove()).not.toBe(initialMove);
    });
  });

  describe('6. Curated color palettes and auto-cycle', () => {
    it('defines all 6 curated palettes with exact tint values', () => {
      expect(Object.keys(DIRECTOR_PALETTES)).toEqual(PALETTE_NAMES);

      expect(DIRECTOR_PALETTES.native).toEqual({
        shadowTint: [1.0, 1.0, 1.0],
        highlightTint: [1.0, 1.0, 1.0],
        spatialSpread: 0.0,
      });

      expect(DIRECTOR_PALETTES.cyberpunk).toEqual({
        shadowTint: [0.0, 0.9, 1.0],
        highlightTint: [1.0, 0.0, 0.5],
        spatialSpread: 0.45,
      });

      expect(DIRECTOR_PALETTES.ember).toEqual({
        shadowTint: [0.1, 0.04, 0.2],
        highlightTint: [1.0, 0.67, 0.0],
        spatialSpread: 0.4,
      });

      expect(DIRECTOR_PALETTES.biolum).toEqual({
        shadowTint: [0.0, 0.17, 0.21],
        highlightTint: [0.0, 1.0, 0.67],
        spatialSpread: 0.35,
      });

      expect(DIRECTOR_PALETTES.vapor).toEqual({
        shadowTint: [0.17, 0.04, 0.22],
        highlightTint: [1.0, 0.47, 0.66],
        spatialSpread: 0.5,
      });

      expect(DIRECTOR_PALETTES.prismatic).toEqual({
        shadowTint: [0.0, 0.2, 0.8],
        highlightTint: [1.0, 0.33, 0.2],
        spatialSpread: 0.8,
      });
    });

    it('returns identity when colorMood is native or intensity is 0', () => {
      const nativeDir = new GlobalDirector({ colorMood: 'native', colorIntensity: 0.5 });
      const uniforms = nativeDir.getColorUniforms();
      expect(uniforms.intensity).toBe(0);
      expect(uniforms.shadowTint).toEqual([1, 1, 1]);
      expect(uniforms.highlightTint).toEqual([1, 1, 1]);
      expect(uniforms.spatialSpread).toBe(0);

      const zeroDir = new GlobalDirector({ colorMood: 'cyberpunk', colorIntensity: 0 });
      expect(zeroDir.getColorUniforms().intensity).toBe(0);
    });

    it('auto-cycles through curated palettes excluding native', () => {
      const director = new GlobalDirector({ colorMood: 'auto' });
      expect(AUTOCYCLE_PALETTES).not.toContain('native');
      expect(director.getToPalette()).toBe('cyberpunk');

      // Cycle 1: cyberpunk -> ember
      director.triggerMacro();
      expect(director.getToPalette()).toBe('ember');

      // Cycle 2: ember -> biolum
      director.triggerMacro();
      expect(director.getToPalette()).toBe('biolum');

      // Cycle 3: biolum -> vapor
      director.triggerMacro();
      expect(director.getToPalette()).toBe('vapor');

      // Cycle 4: vapor -> prismatic
      director.triggerMacro();
      expect(director.getToPalette()).toBe('prismatic');

      // Cycle 5: prismatic -> cyberpunk (wraps around without native)
      director.triggerMacro();
      expect(director.getToPalette()).toBe('cyberpunk');
    });

    it('advances gradAngle continuously at 0.025 rad/s and wraps at 2pi', () => {
      const director = new GlobalDirector();
      director.advance(10.0);
      expect(director.getGradAngle()).toBeCloseTo(0.25, 4);

      // Advance past 2pi
      director.advance(300.0);
      expect(director.getGradAngle()).toBeGreaterThanOrEqual(0);
      expect(director.getGradAngle()).toBeLessThan(2 * Math.PI);
    });
  });

  describe('7. Calm mode attenuation', () => {
    it('attenuates cameraIntensity to max 0.25 and applies 0.25 roll/tilt damping', () => {
      const activeDir = new GlobalDirector({
        cameraMode: 'dutchRoll',
        cameraIntensity: 1.0,
      });
      activeDir.advance(6.0);
      const activeUniforms = activeDir.getCameraUniforms();

      const calmDir = new GlobalDirector({
        cameraMode: 'dutchRoll',
        cameraIntensity: 1.0,
      });
      calmDir.setCalm(true);
      calmDir.advance(6.0);
      const calmUniforms = calmDir.getCameraUniforms();

      expect(calmDir.isCalm()).toBe(true);

      // In calm mode:
      // effectiveIntensity = 0.25 (scaled from 1.0 -> 0.25)
      // pan is scaled by 0.25
      expect(calmUniforms.panX).toBeCloseTo(activeUniforms.panX * 0.25, 4);

      // roll & tilt are scaled by effectiveIntensity * 0.25 = 0.25 * 0.25 = 0.0625 of raw!
      // vs active which was 1.0 of raw.
      expect(calmUniforms.roll).toBeCloseTo(activeUniforms.roll * 0.0625, 4);
    });
  });

  describe('8. Preset motion weights interpolation over 4.0s', () => {
    it('smoothly interpolates weights over 4.0s when preset changes', () => {
      const director = new GlobalDirector();
      expect(director.getCurrentPresetWeights().breathingPush).toBe(1.0);

      const tunnelPreset: Partial<Preset> = {
        layers: [
          {
            type: 'tunnel',
            enabled: true,
            opacity: 1,
            blend: 'max',
            params: {},
          },
        ],
      };

      director.notifyPresetChanged(tunnelPreset as Preset);
      expect(director.getTargetPresetWeights().breathingPush).toBe(0.2);

      // At t=0, current weights still at 1.0
      expect(director.getCurrentPresetWeights().breathingPush).toBe(1.0);

      // At t=2s (midpoint), smoothstep(0, 1, 0.5) = 0.5: blend 1.0 and 0.2 -> 0.6
      director.advance(2.0);
      expect(director.getCurrentPresetWeights().breathingPush).toBeCloseTo(0.6, 3);

      // At t=4s, weights reach target 0.2
      director.advance(2.0);
      expect(director.getCurrentPresetWeights().breathingPush).toBeCloseTo(0.2, 3);
    });
  });

  describe('9. isActive() status', () => {
    it('returns true when camera or color grading is active', () => {
      const director = new GlobalDirector();
      expect(director.isActive()).toBe(true);

      director.updateSettings({ cameraMode: 'off', colorMood: 'ember' });
      expect(director.isActive()).toBe(true);

      director.updateSettings({ cameraMode: 'horizonTilt', colorMood: 'native' });
      expect(director.isActive()).toBe(true);
    });

    it('returns false when both camera and color are identity/off', () => {
      const director = new GlobalDirector({ cameraMode: 'off', colorMood: 'native' });
      expect(director.isActive()).toBe(false);

      director.updateSettings({ cameraMode: 'craneSway', cameraIntensity: 0, colorMood: 'cyberpunk', colorIntensity: 0 });
      expect(director.isActive()).toBe(false);
    });
  });

  describe('10. Slice 8.1: Experience Modes, Calm Consolidation & Asset Schema', () => {
    it('applies experience mode profiles correctly (cinematic, calm, minimal, colorWalk, custom)', () => {
      expect(EXPERIENCE_PROFILES.cinematic.cameraIntensity).toBe(0.65);
      expect(EXPERIENCE_PROFILES.calm.cameraIntensity).toBe(0.25);
      expect(EXPERIENCE_PROFILES.minimal.cameraIntensity).toBe(0.0);
      expect(EXPERIENCE_PROFILES.colorWalk.cameraIntensity).toBe(0.20);

      const director = new GlobalDirector();
      expect(director.getExperienceMode()).toBe('cinematic');

      // Calm mode
      director.setExperienceMode('calm');
      expect(director.getExperienceMode()).toBe('calm');
      expect(director.isCalm()).toBe(true);
      expect(director.getSettings().cameraMode).toBe('auto');
      expect(director.getSettings().cameraIntensity).toBe(0.25);
      expect(director.getSettings().colorMood).toBe('biolum');
      expect(director.getSettings().colorIntensity).toBe(0.30);

      // Minimal mode
      director.setExperienceMode('minimal');
      expect(director.getExperienceMode()).toBe('minimal');
      expect(director.isCalm()).toBe(false);
      expect(director.getSettings().cameraMode).toBe('off');
      expect(director.getSettings().cameraIntensity).toBe(0.0);
      expect(director.getSettings().colorMood).toBe('native');
      expect(director.getSettings().colorIntensity).toBe(0.0);

      // ColorWalk mode
      director.setExperienceMode('colorWalk');
      expect(director.getExperienceMode()).toBe('colorWalk');
      expect(director.isCalm()).toBe(false);
      expect(director.getSettings().cameraMode).toBe('stillAnchor');
      expect(director.getSettings().cameraIntensity).toBe(0.20);
      expect(director.getSettings().colorMood).toBe('auto');
      expect(director.getSettings().colorIntensity).toBe(0.70);

      // Cinematic mode
      director.setExperienceMode('cinematic');
      expect(director.getExperienceMode()).toBe('cinematic');
      expect(director.isCalm()).toBe(false);
      expect(director.getSettings().cameraMode).toBe('auto');
      expect(director.getSettings().cameraIntensity).toBe(0.65);
      expect(director.getSettings().colorMood).toBe('auto');
      expect(director.getSettings().colorIntensity).toBe(0.45);

      // Custom mode: preserves existing manual settings
      director.updateSettings({ cameraMode: 'dutchRoll', cameraIntensity: 0.85 });
      director.setExperienceMode('custom');
      expect(director.getExperienceMode()).toBe('custom');
      expect(director.getSettings().cameraMode).toBe('dutchRoll');
      expect(director.getSettings().cameraIntensity).toBe(0.85);
    });

    it('cycles experience modes sequentially through cinematic -> calm -> minimal -> colorWalk -> cinematic', () => {
      const director = new GlobalDirector();
      director.setExperienceMode('cinematic');

      expect(director.cycleExperienceMode()).toBe('calm');
      expect(director.getExperienceMode()).toBe('calm');
      expect(director.isCalm()).toBe(true);

      expect(director.cycleExperienceMode()).toBe('minimal');
      expect(director.getExperienceMode()).toBe('minimal');
      expect(director.isCalm()).toBe(false);

      expect(director.cycleExperienceMode()).toBe('colorWalk');
      expect(director.getExperienceMode()).toBe('colorWalk');
      expect(director.isCalm()).toBe(false);

      expect(director.cycleExperienceMode()).toBe('cinematic');
      expect(director.getExperienceMode()).toBe('cinematic');
      expect(director.isCalm()).toBe(false);

      // Cycling from custom defaults to cinematic
      director.setExperienceMode('custom');
      expect(director.cycleExperienceMode()).toBe('cinematic');
      expect(director.getExperienceMode()).toBe('cinematic');
    });

    it('syncs setCalm() with experienceMode bidirectionally', () => {
      const director = new GlobalDirector();
      expect(director.getExperienceMode()).toBe('cinematic');
      expect(director.isCalm()).toBe(false);

      // setCalm(true) from cinematic switches experienceMode to calm
      director.setCalm(true);
      expect(director.isCalm()).toBe(true);
      expect(director.getExperienceMode()).toBe('calm');

      // setCalm(false) from calm switches experienceMode to cinematic
      director.setCalm(false);
      expect(director.isCalm()).toBe(false);
      expect(director.getExperienceMode()).toBe('cinematic');

      // setCalm(true) from minimal switches to calm
      director.setExperienceMode('minimal');
      expect(director.isCalm()).toBe(false);
      director.setCalm(true);
      expect(director.isCalm()).toBe(true);
      expect(director.getExperienceMode()).toBe('calm');

      // setCalm(false) when already cinematic remains cinematic
      director.setCalm(false);
      expect(director.getExperienceMode()).toBe('cinematic');
      director.setCalm(false);
      expect(director.getExperienceMode()).toBe('cinematic');
    });

    it('notifies subscribers and onExperienceChange listener on mode changes', () => {
      const director = new GlobalDirector();
      const subscribedModes: ExperienceMode[] = [];
      const onCallbackModes: ExperienceMode[] = [];

      const unsubscribe = director.subscribeExperienceChange((mode) => {
        subscribedModes.push(mode);
      });
      director.onExperienceChange = (mode) => {
        onCallbackModes.push(mode);
      };

      director.setExperienceMode('calm');
      expect(subscribedModes).toEqual(['calm']);
      expect(onCallbackModes).toEqual(['calm']);

      director.setExperienceMode('minimal');
      expect(subscribedModes).toEqual(['calm', 'minimal']);
      expect(onCallbackModes).toEqual(['calm', 'minimal']);

      // Unsubscribe works
      unsubscribe();
      director.setExperienceMode('colorWalk');
      expect(subscribedModes).toEqual(['calm', 'minimal']); // unchanged
      expect(onCallbackModes).toEqual(['calm', 'minimal', 'colorWalk']);
    });

    it('suppresses transient burst flares during calm mode', () => {
      const director = new GlobalDirector({ experienceMode: 'calm' });
      director.advance(6.0); // complete palette morph to biolum

      // Transient kick and flux onset frame
      director.advance(0.1, { kickPulse: true, flux: 0.8 }, 0.5);
      const colorUniforms = director.getColorUniforms();

      // In calm mode burstIntensity remains 0, so spatialSpread should be at base palette spatialSpread
      const biolumDef = DIRECTOR_PALETTES.biolum;
      expect(colorUniforms.spatialSpread).toBeCloseTo(biolumDef.spatialSpread, 3);
    });

    it('filters eligible auto-cycle candidates when calmOnly is true', () => {
      const candidates = [
        { id: 'preset-1', tags: ['calm'] },
        { id: 'preset-2', tags: ['energetic'] },
        { id: 'preset-3', tags: ['calm', 'ambient'] },
        { id: 'preset-4', tags: ['skip', 'calm'] },
        { id: 'preset-5', tags: [] },
      ];

      // Normal cycle (calmOnly false)
      const normalIds = eligible(candidates, { ...DEFAULT_CYCLE, calmOnly: false });
      expect(normalIds).toEqual(['preset-1', 'preset-2', 'preset-3', 'preset-5']);

      // calmOnly: true with >= 2 calm candidates -> only calm candidates (excluding skip)
      const calmIds = eligible(candidates, { ...DEFAULT_CYCLE, calmOnly: true });
      expect(calmIds).toEqual(['preset-1', 'preset-3']);

      // Graceful fallback when fewer than 2 candidates have calm tag
      const scarceCandidates = [
        { id: 'preset-1', tags: ['calm'] },
        { id: 'preset-2', tags: ['energetic'] },
        { id: 'preset-3', tags: [] },
      ];
      const fallbackIds = eligible(scarceCandidates, { ...DEFAULT_CYCLE, calmOnly: true });
      expect(fallbackIds).toEqual(['preset-1', 'preset-2', 'preset-3']);

      // Graceful fallback when 0 candidates have calm tag
      const noCalmCandidates = [
        { id: 'preset-a', tags: ['fast'] },
        { id: 'preset-b', tags: ['bright'] },
      ];
      const noCalmFallback = eligible(noCalmCandidates, { ...DEFAULT_CYCLE, calmOnly: true });
      expect(noCalmFallback).toEqual(['preset-a', 'preset-b']);
    });

    it('preserves directorProfile in parsePreset and validates polymorphic asset structures', () => {
      const dummyRegistry = {
        feedback: [],
        post: [],
        layers: {
          testLayer: [],
        },
      };

      const raw = {
        version: 1,
        name: 'Director Test Preset',
        tags: ['calm'],
        transition: { style: 'crossfade', seconds: 0.5 },
        feedback: {},
        layers: [{ type: 'testLayer', enabled: true, opacity: 1, blend: 'max', params: {} }],
        post: {},
        directorProfile: {
          cameraMode: 'horizonTilt',
          colorMood: 'ember',
          colorIntensity: 0.65,
        },
      };

      const result = parsePreset(raw, dummyRegistry);
      expect(result.preset.directorProfile).toEqual({
        cameraMode: 'horizonTilt',
        colorMood: 'ember',
        colorIntensity: 0.65,
      });

      // Polymorphic asset interfaces compile and validate cleanly
      const paletteAsset: DirectorPaletteAsset = {
        kind: 'mv-director-palette',
        version: 1,
        id: 'aurora-borealis',
        name: 'Aurora Borealis',
        shadowTint: [0.0, 0.2, 0.4],
        highlightTint: [0.2, 0.9, 0.7],
        spatialSpread: 0.6,
      };
      expect(paletteAsset.kind).toBe('mv-director-palette');

      const bundleAsset: ExperienceBundleAsset = {
        kind: 'mv-experience-bundle',
        version: 1,
        name: 'Chill Vibes Pack',
        presets: [result.preset],
        directorPalettes: [paletteAsset],
        directorSettings: {
          experienceMode: 'calm',
          cameraMode: 'auto',
        },
      };
      expect(bundleAsset.kind).toBe('mv-experience-bundle');
      expect(bundleAsset.presets?.[0]?.directorProfile?.colorMood).toBe('ember');

      const polymorphicList: VisualizerAsset[] = [result.preset, paletteAsset, bundleAsset];
      expect(polymorphicList).toHaveLength(3);
    });
  });
  describe('Slice 14.7: time step clamp', () => {
    it('a 5 s frame gap, clamped as main.ts does, advances no more than the clamp limit', () => {
      const big = new GlobalDirector();
      const limit = new GlobalDirector();
      big.advance(clampDt(5));
      limit.advance(MAX_DT_SEC);
      expect(big.getGradAngle()).toBeCloseTo(limit.getGradAngle(), 12);
      expect(big.getGradAngle()).toBeCloseTo(MAX_DT_SEC * 0.025, 12);
    });

    it('a normal 1/60 s step is unchanged', () => {
      const d = new GlobalDirector();
      d.advance(clampDt(1 / 60));
      expect(d.getGradAngle()).toBeCloseTo((1 / 60) * 0.025, 12);
    });

    it('negative and NaN steps do nothing once clamped', () => {
      const d = new GlobalDirector();
      d.advance(clampDt(-1));
      d.advance(clampDt(NaN));
      expect(d.getGradAngle()).toBe(0);
    });
  });
});
