import { describe, it, expect } from 'vitest';
import indexHtml from '../../index.html?raw';

// The shortcuts list is static markup, so the test reads it from index.html (no jsdom in this repo).
const dialog = indexHtml.slice(indexHtml.indexOf('<dialog id="shortcuts"'), indexHtml.indexOf('</dialog>'));

describe('shortcuts list keys (slices 8.1 and 8.7)', () => {
  it('makes every key in the list tappable: letters, digits, brackets, arrows, Space and .', () => {
    const keys = [...dialog.matchAll(/<button type="button" class="key" data-key="([^"]+)"/g)].map((m) => m[1]);
    const expected = ['A', 'B', 'C', 'D', 'E', 'F', 'K', 'P', 'X', ' ', '.', '[', ']', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    expect(keys.sort()).toEqual(expected.sort());
  });

  it('keeps ? and the non-key help text as plain kbd', () => {
    const kbds = [...dialog.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map((m) => m[1]);
    expect(kbds).toContain('?');
    for (const letter of ['F', 'P', 'K', 'C', 'B', 'X', 'E', 'A', 'D']) {
      expect(kbds).not.toContain(letter);
    }
  });
});
