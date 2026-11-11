# Stage 21 accessibility audit: preset browser and toast (Slice 21.11)

Scope: `src/ui/presetBrowser.ts`, `src/ui/toast.ts`, the browser rules in `src/style.css`. This is a code-reading audit. No real browser, screen reader, or pixel contrast measurement was run. Items marked "browser check needed" must be confirmed by hand.

## Checks

| # | Check | Method | Result | Change |
|---|-------|--------|--------|--------|
| 1 | Every card reachable by keyboard | Read | Pass. Each card has a real `<button>` for the name and one for the favourite. Both are in DOM order, so Tab reaches every card. The thumbnail is `aria-hidden` and not focusable. | None |
| 2 | Focus order | Read | Pass. Within a card: name, then favourite. Cards follow the group order. | None |
| 3 | Focus kept after favourite toggle | Read | Fixed. The card was rebuilt on every toggle, so keyboard focus dropped to the page. | After re-render, focus returns to the same card's favourite button. |
| 4 | Visible focus style | Read | Fixed. The card buttons and theme select had 2px rings with 1px offset. | Set to a 3px `--focus` ring with 2px offset on the card buttons and theme select. The list has 6px padding so rings are not clipped by the scroll box. |
| 5 | Favourite toggle name and state | Read | Fixed. The accessible name changed between "Add" and "Remove" with the state, and `aria-pressed` was also set. | Name is now the stable `Favourite <preset name>`. State is only in `aria-pressed`. |
| 6 | Cost badges not colour alone | Read | Pass. Each badge has text (Light, Medium, Heavy). The colour is extra. | None |
| 7 | Theme filter named | Read | Pass. The select has `aria-label="Filter presets by theme"`. | None |
| 8 | Contrast of body text on its surface (4.5:1) | Read, computed from tokens | Pass by calculation. `--text` #eee on `--surface-2` #222 is about 15:1. `--muted` #9a9a9a on `--surface-2` #222 is about 5.6:1. Cost badge text (#eee) on the tinted badge backgrounds is about 9:1 or more. | None |
| 9 | Focus ring contrast (3:1 non-text) | Read, computed from tokens | Pass by calculation. `--focus` #ffd54a on #222 is well above 3:1. | None |
| 10 | Thumbnail dismiss button | Not present | No dismiss button exists in the browser or in `thumbnails.ts`. Nothing to fix. | None |
| 11 | Toast live region | Read | Fixed. `aria-label` was set on a `role="status"` live region, which screen readers do not announce. | `showToast` sets `role="status"` and `aria-live="polite"`, removes `aria-label`, and announces from text content. `index.html` already had the two attributes. |

## Could not verify without a real browser or screen reader
- Actual screen reader output for the favourite button and for the toast (NVDA, VoiceOver, TalkBack). Browser check needed.
- Real rendered contrast on the browser's actual background, which depends on the panel stacking. Browser check needed.
- Focus ring visibility on the cards inside the scroll box at each breakpoint. Browser check needed.
- Keyboard focus restoration after toggling a favourite in a real browser. Browser check needed.
- Touch target size of the favourite button (32px). WCAG 2.5.5 (AAA) is not targeted in this slice. Not measured.

## Test status
- `src/ui/controls.test.ts` has four tests that still assert the old toast `aria-label`. Those tests are outside this slice's target files and were not edited. They must be updated in a slice that owns that file.
