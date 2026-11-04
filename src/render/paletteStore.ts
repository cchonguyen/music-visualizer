// The one shared palette setting. Visuals read it every frame; the P key cycles it.
// Saved in localStorage so the choice survives a reload.
import { DEFAULT_PALETTE, nextPalette, type PaletteName, PALETTE_ORDER } from './palette';

const KEY = 'mv.palette';

function load(): PaletteName {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && (PALETTE_ORDER as string[]).includes(saved)) return saved as PaletteName;
  } catch {
    // localStorage can be blocked; fall back to the default.
  }
  return DEFAULT_PALETTE;
}

let current: PaletteName = load();

export function getCurrentPalette(): PaletteName {
  return current;
}

/** Advance to the next palette, save it, and return the new name. */
export function cyclePalette(): PaletteName {
  current = nextPalette(current);
  try {
    localStorage.setItem(KEY, current);
  } catch {
    // Not saved if storage is blocked; still applies for this session.
  }
  return current;
}
