import { describe, it, expect } from 'vitest';
import { numberLines } from './shader';

describe('numberLines', () => {
  it('numbers each line from 1 so driver errors like 0:2 are easy to find', () => {
    expect(numberLines('a\nb')).toBe('  1| a\n  2| b');
  });
});
