import { describe, it, expect } from 'vitest';
import { cycleIndex, indexForDigit, readStoredPresetId, storePresetId, stepForKey, PRESET_STORAGE_KEY } from './library';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  } as unknown as Storage;
}

describe('cycleIndex', () => {
  it('moves forward and back, wrapping at both ends', () => {
    expect(cycleIndex(0, 3, 1)).toBe(1);
    expect(cycleIndex(2, 3, 1)).toBe(0);
    expect(cycleIndex(0, 3, -1)).toBe(2);
    expect(cycleIndex(1, 1, 1)).toBe(0);
  });

  it('refuses an empty list', () => {
    expect(() => cycleIndex(0, 0, 1)).toThrow();
  });
});

describe('indexForDigit', () => {
  it('maps 0 to the first preset and 1 to the second', () => {
    expect(indexForDigit('0', 3)).toBe(0);
    expect(indexForDigit('2', 3)).toBe(2);
  });

  it('ignores digits past the preset count and non-digits', () => {
    expect(indexForDigit('3', 3)).toBeNull();
    expect(indexForDigit('9', 3)).toBeNull();
    expect(indexForDigit('a', 3)).toBeNull();
    expect(indexForDigit('', 3)).toBeNull();
    expect(indexForDigit('10', 11)).toBeNull();
  });
});

describe('stepForKey', () => {
  it('maps brackets to previous and next', () => {
    expect(stepForKey(']')).toBe(1);
    expect(stepForKey('[')).toBe(-1);
    expect(stepForKey('x')).toBeNull();
  });
});

describe('stored preset', () => {
  it('remembers the last preset', () => {
    const s = memoryStorage();
    expect(readStoredPresetId(s)).toBeNull();
    storePresetId('flight', s);
    expect(readStoredPresetId(s)).toBe('flight');
  });

  it('uses the expected key name', () => {
    const s = memoryStorage();
    storePresetId('bars', s);
    expect(s.getItem(PRESET_STORAGE_KEY)).toBe('bars');
  });

  it('does not throw when storage is missing or broken', () => {
    expect(readStoredPresetId(undefined)).toBeNull();
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } } as unknown as Storage;
    expect(readStoredPresetId(broken)).toBeNull();
    expect(() => storePresetId('x', broken)).not.toThrow();
  });
});
