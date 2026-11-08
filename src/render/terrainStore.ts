export interface TerrainState {
  active: boolean;
  historyTex: WebGLTexture | null;
  writeRow: number;
  rows: number;
  tilt: number;
  heightScale: number;
  terrainFlow: number;
}

const DEFAULT_TERRAIN_STATE: TerrainState = {
  active: false,
  historyTex: null,
  writeRow: 0,
  rows: 64,
  tilt: 0,
  heightScale: 1.0,
  terrainFlow: 0.35,
};

const terrainStore = new WeakMap<WebGL2RenderingContext, TerrainState>();

export function getTerrainState(gl: WebGL2RenderingContext): TerrainState {
  if (!gl) return { ...DEFAULT_TERRAIN_STATE };
  return terrainStore.get(gl) ?? { ...DEFAULT_TERRAIN_STATE };
}

export function setTerrainState(gl: WebGL2RenderingContext, state: Partial<TerrainState>): void {
  if (!gl) return;
  const current = getTerrainState(gl);
  terrainStore.set(gl, { ...current, ...state });
}

export function clearTerrainState(gl: WebGL2RenderingContext): void {
  if (!gl) return;
  terrainStore.set(gl, { ...DEFAULT_TERRAIN_STATE });
}
