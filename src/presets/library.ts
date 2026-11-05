// Preset switching (slice 4.4): pure key and selection logic, plus the "remember last preset"
// setting in localStorage (the browser's small per-site storage; it survives reloads).
export const PRESET_STORAGE_KEY = 'mv.preset';

/** Next or previous index, wrapping at the ends. `count` must be at least 1. */
export function cycleIndex(current: number, count: number, step: 1 | -1): number {
  if (count < 1) throw new Error('cycleIndex: no presets');
  return (((current + step) % count) + count) % count;
}

/**
 * Digit keys: 0 is the first preset, 1 the second, … 9 the tenth. Digits past the
 * preset count do nothing (returns null).
 */
export function indexForDigit(key: string, count: number): number | null {
  if (!/^[0-9]$/.test(key)) return null;
  const index = Number(key);
  return index < count ? index : null;
}

/** Key for `[` (previous) and `]` (next), or null for other keys. */
export function stepForKey(key: string): 1 | -1 | null {
  if (key === ']') return 1;
  if (key === '[') return -1;
  return null;
}

/** The saved preset id, or null when none is saved or storage is unavailable. */
export function readStoredPresetId(storage: Storage | undefined = safeStorage()): string | null {
  try {
    return storage?.getItem(PRESET_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function storePresetId(id: string, storage: Storage | undefined = safeStorage()): void {
  try {
    storage?.setItem(PRESET_STORAGE_KEY, id);
  } catch {
    // Private mode or a full store: switching still works, it just is not remembered.
  }
}

/** localStorage, or undefined when the browser blocks it. */
export function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
