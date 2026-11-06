import { describe, it, expect } from 'vitest';
import indexHtml from '../../index.html?raw';
import { canStartSwipe, isControlsBarFocusable, isPhoneSheetWidth, isSwipeDismiss, SWIPE_DISMISS_PX } from './controls';

// The shortcuts list is static markup, so the test reads it from index.html (no jsdom in this repo).
const dialog = indexHtml.slice(indexHtml.indexOf('<dialog id="shortcuts"'), indexHtml.indexOf('</dialog>'));

describe('controls bar focus when idle (slice 11.4)', () => {
  it('is focusable while awake', () => {
    expect(isControlsBarFocusable(false)).toBe(true);
  });

  it('is not focusable while faded for idleness, and returns when awake again', () => {
    expect(isControlsBarFocusable(true)).toBe(false);
    expect(isControlsBarFocusable(false)).toBe(true);
  });
});

describe('phone sheet swipe down (slice 11.6, handle only follow-up)', () => {
  it('counts widths under 600 px as phone, and 600 px and up as desktop', () => {
    expect(isPhoneSheetWidth(360)).toBe(true);
    expect(isPhoneSheetWidth(390)).toBe(true);
    expect(isPhoneSheetWidth(599)).toBe(true);
    expect(isPhoneSheetWidth(600)).toBe(false);
    expect(isPhoneSheetWidth(1280)).toBe(false);
  });

  it('starts only from the handle, never from the header or body', () => {
    expect(canStartSwipe(true)).toBe(true);
    expect(canStartSwipe(false)).toBe(false);
  });

  it('gives every settings surface a handle at its top', () => {
    const studio = indexHtml.slice(indexHtml.indexOf('<div id="studio"'), indexHtml.indexOf('<div class="studio-head'));
    const controls = indexHtml.slice(indexHtml.indexOf('<nav id="controls"'), indexHtml.indexOf('<div class="sheet-head controls-head">'));
    const shortcuts = indexHtml.slice(indexHtml.indexOf('<dialog id="shortcuts"'), indexHtml.indexOf('<div class="dialog-head sheet-head">'));
    for (const block of [studio, controls, shortcuts]) expect(block).toContain('class="sheet-handle"');
  });

  it('dismisses when the downward drag reaches about 80 px, and not before', () => {
    expect(SWIPE_DISMISS_PX).toBe(80);
    expect(isSwipeDismiss(100, 100)).toBe(false);
    expect(isSwipeDismiss(100, 179)).toBe(false);
    expect(isSwipeDismiss(100, 180)).toBe(true);
    expect(isSwipeDismiss(100, 400)).toBe(true);
  });

  it('never dismisses on an upward or sideways drag', () => {
    expect(isSwipeDismiss(300, 100)).toBe(false);
    expect(isSwipeDismiss(300, 300)).toBe(false);
  });
});

describe('settings layout (slice 11.6)', () => {
  const nav = indexHtml.slice(indexHtml.indexOf('<nav id="controls"'), indexHtml.indexOf('</nav>'));
  // The Sound group has nested divs, so it ends where the Display group starts. The Display row has none.
  const soundStart = nav.indexOf('aria-label="Sound and response"');
  const displayStart = nav.indexOf('aria-label="Display"');
  const block = (label: string) => {
    const start = nav.indexOf(`aria-label="${label}"`);
    return nav.slice(start, nav.indexOf('</div>', start));
  };

  it('groups Volume, Visual gain and Beat sensitivity as value buttons in one section', () => {
    const sound = nav.slice(soundStart, displayStart);
    for (const id of ['volume-btn', 'gain-btn', 'beat-btn']) expect(sound).toContain(`id="${id}"`);
    expect(sound).not.toContain('id="calm"');
  });

  it('puts Calm, Render quality and Aspect correction on one row', () => {
    const row = block('Display');
    for (const id of ['calm', 'render-quality', 'aspect-correct']) expect(row).toContain(`id="${id}"`);
  });

  it('keeps one sticky close header on the controls panel', () => {
    expect(nav).toContain('class="sheet-head controls-head"');
    expect(nav).toContain('id="controls-close"');
  });
});

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
