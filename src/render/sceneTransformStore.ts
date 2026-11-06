// Scene transform for particles that follow the scene (2026-11-06, "Follow scene transform").
// The Scene passes its feedback settings here once per frame. Particles read the result with
// getSceneTransform() and apply it when their own switch is on: zoom, rotation, drift (centre),
// stretch, and the wave warp (morph, which also drives their swirl).
// Rotation is wrapped to one turn so it never grows without bound. Other values are the current
// settings, not accumulated products, so they stay bounded too.

const TAU = Math.PI * 2;

/** The feedback settings the store reads. Names match the feedback pass. */
export interface SceneInput {
  zoom: number;
  rotate: number;
  centreX: number;
  centreY: number;
  stretchX: number;
  stretchY: number;
  warp: number;
  warpScale: number;
  warpSpeed: number;
}

export interface SceneTransform {
  /** Accumulated rotation in radians, wrapped to 0..2π. */
  angle: number;
  /** Current feedback zoom (1 = none). */
  scale: number;
  centreX: number;
  centreY: number;
  stretchX: number;
  stretchY: number;
  /** Wave warp amount, 0..1 (the morph). */
  warp: number;
  warpScale: number;
  warpSpeed: number;
  /** Integrated seconds, so the wave moves with the scene. */
  timeSec: number;
}

const IDENTITY: SceneTransform = {
  angle: 0,
  scale: 1,
  centreX: 0,
  centreY: 0,
  stretchX: 1,
  stretchY: 1,
  warp: 0,
  warpScale: 1,
  warpSpeed: 1,
  timeSec: 0,
};
let current: SceneTransform = IDENTITY;

function finite(x: number, fallback: number): number {
  return Number.isFinite(x) ? x : fallback;
}

function positive(x: number): number {
  return Number.isFinite(x) && x > 0 ? x : 1;
}

/** Advances the stored transform for this frame. Call once per frame from the Scene. */
export function advanceSceneTransform(input: SceneInput, timeSec: number): SceneTransform {
  const angle = (((current.angle + finite(input.rotate, 0)) % TAU) + TAU) % TAU;
  current = {
    angle,
    scale: positive(input.zoom),
    centreX: finite(input.centreX, 0),
    centreY: finite(input.centreY, 0),
    stretchX: positive(input.stretchX),
    stretchY: positive(input.stretchY),
    warp: Math.min(1, Math.max(0, finite(input.warp, 0))),
    warpScale: finite(input.warpScale, 1),
    warpSpeed: finite(input.warpSpeed, 1),
    timeSec: finite(timeSec, 0),
  };
  return current;
}

/** The transform from the last advance. */
export function getSceneTransform(): SceneTransform {
  return current;
}

/** Test helper: back to no transform. */
export function resetSceneTransform(): void {
  current = IDENTITY;
}
