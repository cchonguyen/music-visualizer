# Stage 3 accessibility audit (static, 2026-11-05)

Scope: `index.html`, the control labels in `src/ui/controls.ts`, and the notices. This is a code-reading audit. No browser, screen reader or contrast measurement was run. The owner should confirm the items marked "check in browser".

## What is in place
- Canvas has `role="img"` and a plain-language `aria-label`.
- Notices and toasts use `role="status"` with `aria-live="polite"`. Source label uses `aria-live="polite"`.
- Source buttons carry `aria-pressed` (set in `controls.ts`).
- Play, Fullscreen and the test-signal select have `aria-label`s. The seek slider and the Calm switch have labels.
- Photosensitivity note is on the start screen, with the Calm switch named as the way to reduce motion.
- Calm defaults on when `prefers-reduced-motion: reduce` is set (`src/main.ts`).
- Keyboard shortcuts: Space (play or pause), arrows, F (fullscreen), P (palette), K (freeze), . (step one frame), digits and [ ] for presets, E for Studio.

## Findings
1. **File picker cannot be reached by keyboard (fix in next slice).** `File…` is a `<label for="file-input">` on a hidden `<input>`. A label is not focusable, so Tab skips it. Fix: make it a `<button>` that calls `fileInput.click()`.
2. **Play button label does not match its state.** The visible text is "Pause" and the `aria-label` is "Play or pause (Space)". Screen readers should hear the current action. Fix: update the label to "Pause" or "Play" when the state changes.
3. **Controls hide after 3 s idle.** If keyboard focus sits on a control when it hides, focus is lost. Check in browser: does focus move, and is the hidden control still focusable? Fix if needed: keep controls visible while any control has focus.
4. **Studio is a third-party panel (Tweakpane).** Its keyboard and label support was not checked. Check in browser with Tab and Enter.
5. **Focus outline and contrast.** The CSS was not measured. Check in browser: visible focus ring on every control, and text contrast of the overlay hint and the source label against the dark background (WCAG AA: 4.5:1 for body text).
6. **Start screen focus.** The Start button is the only focusable element on load, which is correct. Check that focus lands on it when the page opens.

## Not covered
- Screen reader run (NVDA or VoiceOver). Owner or tester needed.
- Colour-blind check of the palettes. Not part of this audit.
- Flash rate: the 3-per-second limit is stated in the start screen note. Measuring it needs the flash governor data (P6), not this audit.
