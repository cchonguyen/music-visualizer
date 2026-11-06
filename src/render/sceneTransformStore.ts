// Scene transform for particles that follow the scene (2026-11-06, "Follow scene transform").
// The Scene passes its feedback zoom and rotate here once per frame. Particles read the result
// with getSceneTransform() and add it to their own rotation and zoom when the switch is on.
// Rotation is wrapped to one turn so it never grows without bound. Zoom is the current setting,
// not an accumulated product, so it stays bounded too.

const TAU = Math.PI * 2;

export interface SceneTransform {
  /** Accumulated rotation in radians, wrapped to 0..2π. */
  angle: number;
  /** Current feedback zoom (1 = none). */
  scale: number;
}

const IDENTITY: SceneTransform = { angle: 0, scale: 1 };
let current: SceneTransform = IDENTITY;

/** Advances the stored transform for this frame. Call once per frame from the Scene. */
export function advanceSceneTransform(zoom: number, rotate: number): SceneTransform {
  const turn = Number.isFinite(rotate) ? rotate : 0;
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const angle = (((current.angle + turn) % TAU) + TAU) % TAU;
  current = { angle, scale: z };
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
