import { describe, it, expect } from 'vitest';
import indexHtml from '../../index.html?raw';

// The shortcuts list is static markup, so the test reads it from index.html (no jsdom in this repo).
const dialog = indexHtml.slice(indexHtml.indexOf('<dialog id="shortcuts"'), indexHtml.indexOf('</dialog>'));

describe('shortcuts list keys (slice 8.1)', () => {
  it('makes exactly the letter keys F, P, K, C, B, X, E, A, D tappable', () => {
    const keys = [...dialog.matchAll(/<button type="button" class="key" data-key="([^"]+)"/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'K', 'P', 'X']);
  });

  it('keeps digits, arrows, Space, ., ? and brackets as plain kbd', () => {
    const kbds = [...dialog.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map((m) => m[1]);
    for (const k of ['Space', '←', '→', '↑', '↓', '.', '0', '9', '[', ']', '?']) {
      expect(kbds).toContain(k);
    }
    for (const letter of ['F', 'P', 'K', 'C', 'B', 'X', 'E', 'A', 'D']) {
      expect(kbds).not.toContain(letter);
    }
  });
});
