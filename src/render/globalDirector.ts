// Global Director — Camera & Color Evolution Engine (Sector 483, Slice 7.30)
// Autonomous virtual cinematographer and colorist operating in the Compositor stage.

import type { Preset } from '../presets/format';
import type { AudioFrame } from '../audio/types';

export const EXPERIENCE_MODES = [
  'cinematic',
  'calm',
  'minimal',
  'colorWalk',
  'custom',
] as const;
export type ExperienceMode = (typeof EXPERIENCE_MODES)[number];

export interface ExperienceProfile {
  cameraMode: CameraMode;
  cameraIntensity: number;
  colorMood: ColorMood;
  colorIntensity: number;
  calm: boolean;
}

export const EXPERIENCE_PROFILES: Readonly<Record<Exclude<ExperienceMode, 'custom'>, ExperienceProfile>> = {
  cinematic: {
    cameraMode: 'auto',
    cameraIntensity: 0.65,
    colorMood: 'auto',
    colorIntensity: 0.45,
    calm: false,
  },
  calm: {
    cameraMode: 'auto',
    cameraIntensity: 0.25,
    colorMood: 'biolum',
    colorIntensity: 0.30,
    calm: true,
  },
  minimal: {
    cameraMode: 'off',
    cameraIntensity: 0.0,
    colorMood: 'native',
    colorIntensity: 0.0,
    calm: false,
  },
  colorWalk: {
    cameraMode: 'stillAnchor',
    cameraIntensity: 0.20,
    colorMood: 'auto',
    colorIntensity: 0.70,
    calm: false,
  },
};

export const CAMERA_MODES = [
  'auto',
  'craneSway',
  'dutchRoll',
  'breathingPush',
  'horizonTilt',
  'stillAnchor',
  'off',
] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export const CAMERA_MOVES = [
  'craneSway',
  'dutchRoll',
  'breathingPush',
  'horizonTilt',
  'stillAnchor',
] as const;
export type CameraMove = Exclude<CameraMode, 'auto' | 'off'>;

export const COLOR_MOODS = [
  'auto',
  'native',
  'cyberpunk',
  'ember',
  'biolum',
  'vapor',
  'prismatic',
] as const;
export type ColorMood = (typeof COLOR_MOODS)[number];

export const PALETTE_NAMES = [
  'native',
  'cyberpunk',
  'ember',
  'biolum',
  'vapor',
  'prismatic',
] as const;
export type PaletteName = Exclude<ColorMood, 'auto'>;

export const AUTOCYCLE_PALETTES: readonly PaletteName[] = [
  'cyberpunk',
  'ember',
  'biolum',
  'vapor',
  'prismatic',
] as const;

export const TRIGGER_CADENCES = [
  'section',
  'beats32',
  'beats64',
  'beats128',
  'timer45',
] as const;
export type TriggerCadence = (typeof TRIGGER_CADENCES)[number];

export interface GlobalDirectorSettings {
  experienceMode: ExperienceMode;
  cameraMode: CameraMode;
  cameraIntensity: number; // 0..1, default 0.65
  colorMood: ColorMood;
  colorIntensity: number; // 0..1, default 0.45
  triggerCadence: TriggerCadence;
}

export interface CameraUniforms {
  panX: number;
  panY: number;
  zoom: number;
  roll: number;
  tiltX: number;
  tiltY: number;
}

export interface ColorUniforms {
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  spatialSpread: number;
  gradAngle: number;
  intensity: number;
  cycleAngle: number;
}

export type PresetMotionWeights = Record<CameraMove, number>;

export const DEFAULT_DIRECTOR_SETTINGS: Readonly<GlobalDirectorSettings> = {
  experienceMode: 'cinematic',
  cameraMode: 'auto',
  cameraIntensity: 0.65,
  colorMood: 'auto',
  colorIntensity: 0.45,
  triggerCadence: 'section',
};

export interface PaletteDef {
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  spatialSpread: number;
}

export const DIRECTOR_PALETTES: Readonly<Record<PaletteName, PaletteDef>> = {
  native: {
    shadowTint: [1.0, 1.0, 1.0],
    highlightTint: [1.0, 1.0, 1.0],
    spatialSpread: 0.0,
  },
  cyberpunk: {
    shadowTint: [0.0, 0.9, 1.0],
    highlightTint: [1.0, 0.0, 0.5],
    spatialSpread: 0.45,
  },
  ember: {
    shadowTint: [0.1, 0.04, 0.2],
    highlightTint: [1.0, 0.67, 0.0],
    spatialSpread: 0.4,
  },
  biolum: {
    shadowTint: [0.0, 0.17, 0.21],
    highlightTint: [0.0, 1.0, 0.67],
    spatialSpread: 0.35,
  },
  vapor: {
    shadowTint: [0.17, 0.04, 0.22],
    highlightTint: [1.0, 0.47, 0.66],
    spatialSpread: 0.5,
  },
  prismatic: {
    shadowTint: [0.0, 0.2, 0.8],
    highlightTint: [1.0, 0.33, 0.2],
    spatialSpread: 0.8,
  },
};

export const DIRECTOR_STORAGE_KEY = 'mv.globalDirector';

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function extractSettingValue(settingOrVal: unknown): unknown {
  if (settingOrVal && typeof settingOrVal === 'object' && 'value' in (settingOrVal as Record<string, unknown>)) {
    return (settingOrVal as { value: unknown }).value;
  }
  return settingOrVal;
}

export function analyzePresetMotion(preset?: Preset | null): Record<CameraMove, number> {
  if (!preset) {
    return {
      craneSway: 1.0,
      dutchRoll: 1.0,
      breathingPush: 1.0,
      horizonTilt: 1.0,
      stillAnchor: 0.5,
    };
  }

  let hasZFlight = false;
  let hasSpin = false;

  const layers = preset.layers || [];
  for (const layer of layers) {
    if (layer.enabled === false) continue;

    if (layer.type === 'tunnel' || layer.type === 'spectralTerrain') {
      hasZFlight = true;
    }

    if (layer.type === 'particles') {
      const mode = extractSettingValue(layer.params?.mode);
      const phylloPattern = extractSettingValue(layer.params?.phylloPattern);
      const swirlGain = Number(extractSettingValue(layer.params?.swirlGain) ?? 0);
      const subTwist = Number(extractSettingValue(layer.params?.subTwist) ?? 0);
      if (mode === 'phyllotaxis' || (phylloPattern && phylloPattern !== 'none') || swirlGain > 1.5 || subTwist > 0) {
        hasSpin = true;
      }
    }

    if (layer.type === 'rings') {
      const mode = extractSettingValue(layer.params?.mode);
      const spin = Number(extractSettingValue(layer.params?.spin) ?? 0);
      const rotationSpeed = Number(extractSettingValue(layer.params?.rotationSpeed) ?? 0);
      if (mode === 'mandala' || mode === 'orbitTriangles' || spin !== 0 || rotationSpeed !== 0) {
        hasSpin = true;
      }
    }

    if (layer.type === 'chladniSand') {
      const plateMode = extractSettingValue(layer.params?.plateMode);
      if (plateMode === 'radialMandala') {
        hasSpin = true;
      }
    }

    if (layer.type === 'shape') {
      const spinSpeed = Number(extractSettingValue(layer.params?.spinSpeed) ?? 0);
      const propMode = extractSettingValue(layer.params?.propMode);
      const propSpeed = Number(extractSettingValue(layer.params?.propSpeed) ?? 0);
      const baseShape = extractSettingValue(layer.params?.baseShape);

      if (spinSpeed !== 0 || propMode === 'orbit' || propMode === 'polar' || baseShape === 'spiral' || baseShape === 'figure8') {
        hasSpin = true;
      }
      if (propMode === 'stream' || (propMode === 'concentric' && Math.abs(propSpeed) > 0.5)) {
        hasZFlight = true;
      }
    }
  }

  if (preset.feedback) {
    const rotate = Number(extractSettingValue(preset.feedback.rotate) ?? 0);
    const warpMode = extractSettingValue(preset.feedback.warpMode);
    const mandalaCounterSpin = Number(extractSettingValue(preset.feedback.mandalaCounterSpin) ?? 0);
    const mandalaTile = Number(extractSettingValue(preset.feedback.mandalaTile) ?? 0);
    if (rotate !== 0 || warpMode === 'mobius' || warpMode === 'polarFold' || (mandalaTile > 0 && mandalaCounterSpin !== 0)) {
      hasSpin = true;
    }
  }

  if (hasZFlight && hasSpin) {
    return {
      craneSway: 1.5,
      dutchRoll: 0.1,
      breathingPush: 0.2,
      horizonTilt: 1.5,
      stillAnchor: 0.6,
    };
  } else if (hasZFlight) {
    return {
      craneSway: 1.5,
      dutchRoll: 1.5,
      breathingPush: 0.2,
      horizonTilt: 1.0,
      stillAnchor: 0.6,
    };
  } else if (hasSpin) {
    return {
      craneSway: 1.0,
      dutchRoll: 0.1,
      breathingPush: 1.5,
      horizonTilt: 1.5,
      stillAnchor: 0.6,
    };
  } else {
    return {
      craneSway: 1.0,
      dutchRoll: 1.0,
      breathingPush: 1.0,
      horizonTilt: 1.0,
      stillAnchor: 0.5,
    };
  }
}

/** Alias for motion profile analysis of presets. */
export const extractPresetMotionProfile = analyzePresetMotion;

function setCamera(out: CameraUniforms, panX: number, panY: number, zoom: number, roll: number, tiltX: number, tiltY: number): CameraUniforms {
  out.panX = panX;
  out.panY = panY;
  out.zoom = zoom;
  out.roll = roll;
  out.tiltX = tiltX;
  out.tiltY = tiltY;
  return out;
}

/**
 * Camera pose for one move. Pass `out` to have it filled and returned (no allocation); without it a new
 * object is returned.
 */
export function evaluateCameraMove(
  move: CameraMove,
  phaseSec: number,
  smoothedEnergy: number,
  out: CameraUniforms = { panX: 0, panY: 0, zoom: 1, roll: 0, tiltX: 0, tiltY: 0 },
): CameraUniforms {
  switch (move) {
    case 'craneSway': {
      const px = 0.12 * Math.sin(0.35 * phaseSec);
      const py = 0.12 * Math.cos(0.28 * phaseSec);
      return setCamera(out, px, py, 1.15, 0.0, -0.15 * px, -0.15 * py);
    }
    case 'dutchRoll': {
      const px = 0.06 * Math.cos(0.20 * phaseSec);
      const py = 0.06 * Math.sin(0.20 * phaseSec);
      return setCamera(out, px, py, 1.16, 0.42 * Math.sin(0.40 * phaseSec), 0.0, 0.0);
    }
    case 'breathingPush': {
      return setCamera(out, 0.0, 0.0, 1.08 + 0.42 * Math.max(0, Math.min(1, smoothedEnergy)), 0.0, 0.0, 0.0);
    }
    case 'horizonTilt': {
      return setCamera(out, 0.0, 0.0, 1.16, 0.0, 0.45 * Math.sin(0.25 * phaseSec), 0.60 * Math.cos(0.18 * phaseSec));
    }
    case 'stillAnchor':
    default: {
      return setCamera(out, 0.0, 0.0, 1.04, 0.0, 0.0, 0.0);
    }
  }
}

export function sanitizeDirectorSettings(raw: unknown): GlobalDirectorSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_DIRECTOR_SETTINGS };
  }
  const obj = raw as Record<string, unknown>;

  const experienceMode = EXPERIENCE_MODES.includes(obj.experienceMode as ExperienceMode)
    ? (obj.experienceMode as ExperienceMode)
    : DEFAULT_DIRECTOR_SETTINGS.experienceMode;

  const cameraMode = CAMERA_MODES.includes(obj.cameraMode as CameraMode)
    ? (obj.cameraMode as CameraMode)
    : DEFAULT_DIRECTOR_SETTINGS.cameraMode;

  const cameraIntensity =
    typeof obj.cameraIntensity === 'number' && Number.isFinite(obj.cameraIntensity)
      ? Math.max(0, Math.min(1, obj.cameraIntensity))
      : DEFAULT_DIRECTOR_SETTINGS.cameraIntensity;

  const colorMood = COLOR_MOODS.includes(obj.colorMood as ColorMood)
    ? (obj.colorMood as ColorMood)
    : DEFAULT_DIRECTOR_SETTINGS.colorMood;

  const colorIntensity =
    typeof obj.colorIntensity === 'number' && Number.isFinite(obj.colorIntensity)
      ? Math.max(0, Math.min(1, obj.colorIntensity))
      : DEFAULT_DIRECTOR_SETTINGS.colorIntensity;

  const triggerCadence = TRIGGER_CADENCES.includes(obj.triggerCadence as TriggerCadence)
    ? (obj.triggerCadence as TriggerCadence)
    : DEFAULT_DIRECTOR_SETTINGS.triggerCadence;

  return {
    experienceMode,
    cameraMode,
    cameraIntensity,
    colorMood,
    colorIntensity,
    triggerCadence,
  };
}

function getLocalStorage(): Storage | undefined {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Access denied (e.g. security sandbox)
  }
  return undefined;
}

export function readDirectorSettings(): GlobalDirectorSettings {
  const storage = getLocalStorage();
  if (!storage) {
    return { ...DEFAULT_DIRECTOR_SETTINGS };
  }
  try {
    const raw = storage.getItem(DIRECTOR_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DIRECTOR_SETTINGS };
    return sanitizeDirectorSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_DIRECTOR_SETTINGS };
  }
}

export function saveDirectorSettings(settings: GlobalDirectorSettings): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(DIRECTOR_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota or disabled localStorage errors
  }
}

export class GlobalDirector {
  private settings: GlobalDirectorSettings;
  private calm: boolean = false;
  private experienceListeners: Set<(mode: ExperienceMode) => void> = new Set();
  public onExperienceChange?: (mode: ExperienceMode) => void;

  private fromMove: CameraMove = 'craneSway';
  private toMove: CameraMove = 'craneSway';
  private moveMorphSec: number = 6.0;

  private fromPalette: PaletteName = 'cyberpunk';
  private toPalette: PaletteName = 'cyberpunk';
  private paletteMorphSec: number = 6.0;

  private phaseSec: number = 0;
  private elapsedSinceTriggerSec: number = 0;
  private beatCount: number = 0;
  private smoothedEnergy: number = 0;
  private gradAngle: number = 0;
  private cycleAngle: number = 0;
  private burstIntensity: number = 0;

  private currentPresetWeights: PresetMotionWeights;
  private fromPresetWeights: PresetMotionWeights;
  private targetPresetWeights: PresetMotionWeights;
  private presetWeightMorphSec: number = 4.0;

  constructor(initialSettings?: Partial<GlobalDirectorSettings>) {
    let resolvedSettings = initialSettings;
    if (
      initialSettings?.experienceMode &&
      initialSettings.experienceMode !== 'custom' &&
      initialSettings.cameraIntensity === undefined &&
      initialSettings.cameraMode === undefined &&
      initialSettings.colorMood === undefined &&
      initialSettings.colorIntensity === undefined
    ) {
      const prof = EXPERIENCE_PROFILES[initialSettings.experienceMode];
      if (prof) {
        resolvedSettings = {
          ...prof,
          ...initialSettings,
        };
      }
    }

    this.settings = resolvedSettings
      ? sanitizeDirectorSettings({ ...DEFAULT_DIRECTOR_SETTINGS, ...resolvedSettings })
      : readDirectorSettings();

    this.calm = this.settings.experienceMode === 'calm';

    const initWeights = analyzePresetMotion(null);
    this.currentPresetWeights = { ...initWeights };
    this.fromPresetWeights = { ...initWeights };
    this.targetPresetWeights = { ...initWeights };

    const initMove: CameraMove =
      this.settings.cameraMode !== 'auto' && this.settings.cameraMode !== 'off'
        ? this.settings.cameraMode
        : 'craneSway';
    this.fromMove = initMove;
    this.toMove = initMove;

    const initPalette: PaletteName =
      this.settings.colorMood !== 'auto' ? this.settings.colorMood : 'cyberpunk';
    this.fromPalette = initPalette;
    this.toPalette = initPalette;
  }

  getSettings(): GlobalDirectorSettings {
    return { ...this.settings };
  }

  getExperienceMode(): ExperienceMode {
    return this.settings.experienceMode;
  }

  setExperienceMode(mode: ExperienceMode): void {
    const prevMode = this.settings.experienceMode;

    if (mode === 'custom') {
      this.settings.experienceMode = 'custom';
      saveDirectorSettings(this.settings);
      if (prevMode !== 'custom') {
        this.notifyExperienceChange('custom');
      }
      return;
    }

    const profile = EXPERIENCE_PROFILES[mode];
    if (profile) {
      this.calm = profile.calm;
      this.settings = sanitizeDirectorSettings({
        ...this.settings,
        experienceMode: mode,
        cameraMode: profile.cameraMode,
        cameraIntensity: profile.cameraIntensity,
        colorMood: profile.colorMood,
        colorIntensity: profile.colorIntensity,
      });

      // If cameraMode set to specific move, morph to it
      if (this.settings.cameraMode !== 'auto' && this.settings.cameraMode !== 'off') {
        if (this.toMove !== this.settings.cameraMode) {
          this.fromMove = this.toMove;
          this.toMove = this.settings.cameraMode;
          this.moveMorphSec = 0;
        }
      }

      // If colorMood set to specific palette, morph to it
      if (this.settings.colorMood !== 'auto') {
        if (this.toPalette !== this.settings.colorMood) {
          this.fromPalette = this.toPalette;
          this.toPalette = this.settings.colorMood;
          this.paletteMorphSec = 0;
        }
      }

      saveDirectorSettings(this.settings);
      if (prevMode !== mode) {
        this.notifyExperienceChange(mode);
      }
    }
  }

  cycleExperienceMode(): ExperienceMode {
    const cycle: readonly ExperienceMode[] = ['cinematic', 'calm', 'minimal', 'colorWalk'];
    const idx = cycle.indexOf(this.settings.experienceMode);
    const nextMode = idx === -1 ? 'cinematic' : cycle[(idx + 1) % cycle.length]!;
    this.setExperienceMode(nextMode);
    return nextMode;
  }

  subscribeExperienceChange(fn: (mode: ExperienceMode) => void): () => void {
    this.experienceListeners.add(fn);
    return () => {
      this.experienceListeners.delete(fn);
    };
  }

  private notifyExperienceChange(mode: ExperienceMode): void {
    if (typeof this.onExperienceChange === 'function') {
      try {
        this.onExperienceChange(mode);
      } catch (err) {
        console.error('Error in onExperienceChange callback:', err);
      }
    }
    for (const listener of this.experienceListeners) {
      try {
        listener(mode);
      } catch (err) {
        console.error('Error in experienceListener callback:', err);
      }
    }
  }

  updateSettings(partial: Partial<GlobalDirectorSettings>): void {
    if (partial.experienceMode !== undefined && partial.experienceMode !== this.settings.experienceMode) {
      if (
        partial.cameraMode === undefined &&
        partial.cameraIntensity === undefined &&
        partial.colorMood === undefined &&
        partial.colorIntensity === undefined
      ) {
        this.setExperienceMode(partial.experienceMode);
        return;
      }
    }

    const prevMode = this.settings.experienceMode;
    this.settings = sanitizeDirectorSettings({
      ...this.settings,
      ...partial,
    });
    saveDirectorSettings(this.settings);

    if (this.settings.experienceMode !== prevMode) {
      this.notifyExperienceChange(this.settings.experienceMode);
    }

    // If cameraMode set to specific move, morph to it
    if (this.settings.cameraMode !== 'auto' && this.settings.cameraMode !== 'off') {
      if (this.toMove !== this.settings.cameraMode) {
        this.fromMove = this.toMove;
        this.toMove = this.settings.cameraMode;
        this.moveMorphSec = 0;
      }
    }

    // If colorMood set to specific palette, morph to it
    if (this.settings.colorMood !== 'auto') {
      if (this.toPalette !== this.settings.colorMood) {
        this.fromPalette = this.toPalette;
        this.toPalette = this.settings.colorMood;
        this.paletteMorphSec = 0;
      }
    }
  }

  setCalm(calm: boolean): void {
    this.calm = calm;
    if (calm && this.settings.experienceMode !== 'calm') {
      this.settings.experienceMode = 'calm';
      saveDirectorSettings(this.settings);
      this.notifyExperienceChange('calm');
    } else if (!calm && this.settings.experienceMode === 'calm') {
      this.settings.experienceMode = 'cinematic';
      saveDirectorSettings(this.settings);
      this.notifyExperienceChange('cinematic');
    }
  }

  isCalm(): boolean {
    return this.calm || this.settings.experienceMode === 'calm';
  }

  getFromMove(): CameraMove {
    return this.fromMove;
  }

  getToMove(): CameraMove {
    return this.toMove;
  }

  getMoveMorphSec(): number {
    return this.moveMorphSec;
  }

  getFromPalette(): PaletteName {
    return this.fromPalette;
  }

  getToPalette(): PaletteName {
    return this.toPalette;
  }

  getPaletteMorphSec(): number {
    return this.paletteMorphSec;
  }

  getElapsedSinceTriggerSec(): number {
    return this.elapsedSinceTriggerSec;
  }

  getBeatCount(): number {
    return this.beatCount;
  }

  getSmoothedEnergy(): number {
    return this.smoothedEnergy;
  }

  getGradAngle(): number {
    return this.gradAngle;
  }

  getCurrentPresetWeights(): Readonly<PresetMotionWeights> {
    return { ...this.currentPresetWeights };
  }

  getTargetPresetWeights(): Readonly<PresetMotionWeights> {
    return { ...this.targetPresetWeights };
  }

  notifyPresetChanged(preset?: Preset | null): void {
    this.fromPresetWeights = { ...this.currentPresetWeights };
    this.targetPresetWeights = analyzePresetMotion(preset);
    this.presetWeightMorphSec = 0;
  }

  selectNextCameraMove(currentMove: CameraMove): CameraMove {
    const allMoves: CameraMove[] = ['craneSway', 'dutchRoll', 'breathingPush', 'horizonTilt', 'stillAnchor'];
    const candidates = allMoves.filter((m) => m !== currentMove);

    const currentIdx = allMoves.indexOf(currentMove);
    candidates.sort((a, b) => {
      const wA = this.currentPresetWeights[a] ?? 1.0;
      const wB = this.currentPresetWeights[b] ?? 1.0;
      if (Math.abs(wB - wA) > 0.001) {
        return wB - wA; // Higher weight first
      }
      const distA = (allMoves.indexOf(a) - currentIdx + allMoves.length) % allMoves.length;
      const distB = (allMoves.indexOf(b) - currentIdx + allMoves.length) % allMoves.length;
      return distA - distB;
    });

    return candidates[0] ?? 'stillAnchor';
  }

  selectNextPalette(currentPalette: PaletteName): PaletteName {
    const idx = AUTOCYCLE_PALETTES.indexOf(currentPalette);
    if (idx === -1) {
      return AUTOCYCLE_PALETTES[0] ?? 'cyberpunk';
    }
    return AUTOCYCLE_PALETTES[(idx + 1) % AUTOCYCLE_PALETTES.length] ?? 'cyberpunk';
  }

  triggerMacro(forcedNextMove?: CameraMove, forcedNextPalette?: PaletteName): void {
    this.elapsedSinceTriggerSec = 0;
    this.beatCount = 0;

    if (this.settings.cameraMode === 'auto') {
      const nextMove = forcedNextMove ?? this.selectNextCameraMove(this.toMove);
      this.fromMove = this.toMove;
      this.toMove = nextMove;
      this.moveMorphSec = 0;
    }

    if (this.settings.colorMood === 'auto') {
      const nextPalette = forcedNextPalette ?? this.selectNextPalette(this.toPalette);
      this.fromPalette = this.toPalette;
      this.toPalette = nextPalette;
      this.paletteMorphSec = 0;
    }
  }

  advance(dtSec: number, frame?: Partial<AudioFrame>, sectionContrast?: number): void {
    if (dtSec <= 0) return;

    this.phaseSec += dtSec;
    this.elapsedSinceTriggerSec += dtSec;
    this.moveMorphSec += dtSec;
    this.paletteMorphSec += dtSec;
    this.presetWeightMorphSec += dtSec;

    this.gradAngle = (this.gradAngle + dtSec * 0.025) % (2 * Math.PI);
    if (this.gradAngle < 0) this.gradAngle += 2 * Math.PI;

    // Organic continuous breathing color shift (subtle ~0.10 rad/s baseline, accelerated slightly by energy)
    const energySpeed = 0.08 + 0.16 * Math.max(0, Math.min(1, this.smoothedEnergy));
    this.cycleAngle = (this.cycleAngle + dtSec * energySpeed) % (2 * Math.PI);
    if (this.cycleAngle < 0) this.cycleAngle += 2 * Math.PI;

    // Burst intensity on musical transients (kick onset, strong section flux) that decays smoothly
    if (!this.isCalm()) {
      const kickHit = frame?.kickPulse || (frame?.beat && (frame.beatStrength ?? 0) >= 0.7);
      const fluxHit = (frame?.flux ?? 0) > 0.4 || (sectionContrast ?? 0) > 0.1;
      if (kickHit) {
        this.burstIntensity = Math.min(1.0, this.burstIntensity + 0.35);
      }
      if (fluxHit) {
        this.burstIntensity = Math.min(1.0, this.burstIntensity + 0.5);
      }
    } else {
      this.burstIntensity = 0;
    }
    // Smooth decay of burst over ~0.8s
    this.burstIntensity *= Math.pow(0.15, dtSec);

    if (frame?.energy !== undefined) {
      const alpha = 1.0 - Math.exp(-dtSec * 3.0);
      this.smoothedEnergy += (frame.energy - this.smoothedEnergy) * alpha;
    }

    if (this.presetWeightMorphSec <= 4.0) {
      const wT = Math.min(1.0, this.presetWeightMorphSec / 4.0);
      const wAlpha = smoothstep(0, 1, wT);
      for (const m of CAMERA_MOVES) {
        this.currentPresetWeights[m] =
          (1 - wAlpha) * this.fromPresetWeights[m] + wAlpha * this.targetPresetWeights[m];
      }
    } else {
      for (const m of CAMERA_MOVES) this.currentPresetWeights[m] = this.targetPresetWeights[m];
    }

    const isBeat = Boolean(frame?.kickPulse || frame?.beatByBand?.sub || frame?.beat);
    if (isBeat) {
      this.beatCount += 1;
    }

    let shouldTrigger = false;
    const cadence = this.settings.triggerCadence;

    if (cadence === 'section') {
      const flux = frame?.flux ?? 0;
      const contrast = sectionContrast ?? 0;
      const noveltyHit = contrast > 0.08 || flux > 0.35;
      if ((this.elapsedSinceTriggerSec >= 35 && noveltyHit) || this.elapsedSinceTriggerSec >= 75) {
        shouldTrigger = true;
      }
    } else if (cadence === 'beats32') {
      if (this.beatCount >= 32 && this.elapsedSinceTriggerSec >= 6.0) {
        shouldTrigger = true;
      }
    } else if (cadence === 'beats64') {
      if (this.beatCount >= 64 && this.elapsedSinceTriggerSec >= 6.0) {
        shouldTrigger = true;
      }
    } else if (cadence === 'beats128') {
      if (this.beatCount >= 128 && this.elapsedSinceTriggerSec >= 6.0) {
        shouldTrigger = true;
      }
    } else if (cadence === 'timer45') {
      if (this.elapsedSinceTriggerSec >= 45) {
        shouldTrigger = true;
      }
    }

    if (shouldTrigger && this.moveMorphSec >= 6.0) {
      this.triggerMacro();
    }
  }

  // Scratch poses for the two moves being blended, reused every call.
  private readonly fromPose: CameraUniforms = { panX: 0, panY: 0, zoom: 1, roll: 0, tiltX: 0, tiltY: 0 };
  private readonly toPose: CameraUniforms = { panX: 0, panY: 0, zoom: 1, roll: 0, tiltX: 0, tiltY: 0 };

  /** Camera uniforms for this frame. Pass `out` to have it filled and returned (no allocation per frame). */
  getCameraUniforms(out: CameraUniforms = { panX: 0, panY: 0, zoom: 1, roll: 0, tiltX: 0, tiltY: 0 }): CameraUniforms {
    const effectiveIntensity = this.isCalm()
      ? Math.min(this.settings.cameraIntensity, 0.25)
      : this.settings.cameraIntensity;

    if (this.settings.cameraMode === 'off' || effectiveIntensity <= 0) {
      return setCamera(out, 0, 0, 1, 0, 0, 0);
    }

    const uFrom = evaluateCameraMove(this.fromMove, this.phaseSec, this.smoothedEnergy, this.fromPose);
    const uTo = evaluateCameraMove(this.toMove, this.phaseSec, this.smoothedEnergy, this.toPose);
    const alpha = smoothstep(0, 1, Math.min(1.0, this.moveMorphSec / 6.0));

    const rawPanX = (1 - alpha) * uFrom.panX + alpha * uTo.panX;
    const rawPanY = (1 - alpha) * uFrom.panY + alpha * uTo.panY;
    const rawZoom = (1 - alpha) * uFrom.zoom + alpha * uTo.zoom;
    const rawRoll = (1 - alpha) * uFrom.roll + alpha * uTo.roll;
    const rawTiltX = (1 - alpha) * uFrom.tiltX + alpha * uTo.tiltX;
    const rawTiltY = (1 - alpha) * uFrom.tiltY + alpha * uTo.tiltY;

    const calmDamp = this.isCalm() ? 0.25 : 1.0;
    const panX = rawPanX * effectiveIntensity;
    const panY = rawPanY * effectiveIntensity;
    const roll = rawRoll * effectiveIntensity * calmDamp;
    const tiltX = rawTiltX * effectiveIntensity * calmDamp;
    const tiltY = rawTiltY * effectiveIntensity * calmDamp;

    let zoom = 1.0 + (rawZoom - 1.0) * effectiveIntensity;
    const isStill = this.toMove === 'stillAnchor' && (this.fromMove === 'stillAnchor' || alpha >= 1.0);
    const minFloor = isStill ? 1.03 : Math.max(1.03, 1.0 + 0.08 * effectiveIntensity);
    zoom = Math.max(minFloor, zoom);

    return setCamera(out, panX, panY, zoom, roll, tiltX, tiltY);
  }

  /** Colour uniforms for this frame. Pass `out` to have it filled and returned (no allocation per frame). */
  getColorUniforms(
    out: ColorUniforms = { shadowTint: [1, 1, 1], highlightTint: [1, 1, 1], spatialSpread: 0, gradAngle: 0, intensity: 0, cycleAngle: 0 },
  ): ColorUniforms {
    if (this.settings.colorMood === 'native' || this.settings.colorIntensity <= 0) {
      out.shadowTint[0] = 1; out.shadowTint[1] = 1; out.shadowTint[2] = 1;
      out.highlightTint[0] = 1; out.highlightTint[1] = 1; out.highlightTint[2] = 1;
      out.spatialSpread = 0;
      out.gradAngle = this.gradAngle;
      out.intensity = 0;
      out.cycleAngle = 0;
      return out;
    }

    const pFrom = DIRECTOR_PALETTES[this.fromPalette] ?? DIRECTOR_PALETTES.native;
    const pTo = DIRECTOR_PALETTES[this.toPalette] ?? DIRECTOR_PALETTES.native;
    const beta = smoothstep(0, 1, Math.min(1.0, this.paletteMorphSec / 6.0));

    const shadowTint = out.shadowTint;
    const highlightTint = out.highlightTint;
    for (let i = 0; i < 3; i++) {
      shadowTint[i] = (1 - beta) * pFrom.shadowTint[i]! + beta * pTo.shadowTint[i]!;
      highlightTint[i] = (1 - beta) * pFrom.highlightTint[i]! + beta * pTo.highlightTint[i]!;
    }

    const spatialSpread = Math.min(1.0, (1 - beta) * pFrom.spatialSpread + beta * pTo.spatialSpread + 0.3 * this.burstIntensity);

    // Boosted baseline intensity + reactive flare on big hits
    const dynamicIntensity = Math.min(1.0, this.settings.colorIntensity * (1.2 + 0.5 * this.burstIntensity));

    out.spatialSpread = spatialSpread;
    out.gradAngle = this.gradAngle;
    out.intensity = dynamicIntensity;
    out.cycleAngle = this.cycleAngle;
    return out;
  }

  isActive(): boolean {
    const cameraActive = this.settings.cameraMode !== 'off' && this.settings.cameraIntensity > 0;
    const colorActive = this.settings.colorMood !== 'native' && this.settings.colorIntensity > 0;
    return cameraActive || colorActive;
  }

  reset(initialSettings?: Partial<GlobalDirectorSettings>): void {
    let resolvedSettings = initialSettings;
    if (
      initialSettings?.experienceMode &&
      initialSettings.experienceMode !== 'custom' &&
      initialSettings.cameraIntensity === undefined &&
      initialSettings.cameraMode === undefined &&
      initialSettings.colorMood === undefined &&
      initialSettings.colorIntensity === undefined
    ) {
      const prof = EXPERIENCE_PROFILES[initialSettings.experienceMode];
      if (prof) {
        resolvedSettings = {
          ...prof,
          ...initialSettings,
        };
      }
    }

    this.settings = resolvedSettings
      ? sanitizeDirectorSettings({ ...DEFAULT_DIRECTOR_SETTINGS, ...resolvedSettings })
      : readDirectorSettings();

    this.calm = this.settings.experienceMode === 'calm';
    this.phaseSec = 0;
    this.elapsedSinceTriggerSec = 0;
    this.beatCount = 0;
    this.smoothedEnergy = 0;
    this.gradAngle = 0;

    const initWeights = analyzePresetMotion(null);
    this.currentPresetWeights = { ...initWeights };
    this.fromPresetWeights = { ...initWeights };
    this.targetPresetWeights = { ...initWeights };
    this.presetWeightMorphSec = 4.0;

    const initMove: CameraMove =
      this.settings.cameraMode !== 'auto' && this.settings.cameraMode !== 'off'
        ? this.settings.cameraMode
        : 'craneSway';
    this.fromMove = initMove;
    this.toMove = initMove;
    this.moveMorphSec = 6.0;

    const initPalette: PaletteName =
      this.settings.colorMood !== 'auto' ? this.settings.colorMood : 'cyberpunk';
    this.fromPalette = initPalette;
    this.toPalette = initPalette;
    this.paletteMorphSec = 6.0;
  }
}

let directorInstance: GlobalDirector | null = null;

export function getGlobalDirector(): GlobalDirector {
  if (!directorInstance) {
    directorInstance = new GlobalDirector();
  }
  return directorInstance;
}

export function resetGlobalDirector(): void {
  directorInstance = null;
}
