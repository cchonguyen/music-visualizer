import { describe, expect, it } from 'vitest';
import { sceneForKey } from './sceneKeys';

describe('sceneForKey', () => {
  it('maps 0 to the crown scene, 1 to flight, 2 to bars', () => {
    expect(sceneForKey('0')).toBe('crown');
    expect(sceneForKey('1')).toBe('flight');
    expect(sceneForKey('2')).toBe('bars');
  });

  it('returns null for every other key', () => {
    for (const k of ['3', '9', 'a', ' ', 'Enter', '', '00', '1 ']) {
      expect(sceneForKey(k)).toBeNull();
    }
  });
});
