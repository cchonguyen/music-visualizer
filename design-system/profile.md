# Music Visualizer: Harness UI profile

This file is the app's own. Sync never touches it. Each line below is a departure from a kit default, or a choice the kit leaves to the app.

## Choices the app owns
- **Signature hue:** `neon-azure` (`data-accent="azure"` on `<html>`). The kit's hue table also lists azure for Media Recommendation. The two apps are separate products, so sharing a hue is accepted.
- **Density:** comfortable (`data-density="comfortable"`).
- **Voice warmth:** plain and brief, as in `voice.md`. No celebration copy.
- **Fonts:** system fonts only, no Newsreader or JetBrains Mono. Reason: a real-time visualizer should start fast and has no long reading text.

## Departures from kit defaults
- **theme-lock: dark.** The visuals are drawn on black. `data-theme="dark"` is set on `<html>` in `index.html` and `popout.html`, and the app has no light theme and no theme picker.
- **Canvas and overlays:** the WebGL canvas, the start screen scrim and the HUD panels sit on pure black or translucent black, not on `--bg`. Reason: the visual must not be tinted.
- **Tweakpane (Preset Studio parameter controls):** stays on its own look. Reason: it is a third-party control set and restyling it is out of scope.
- **Toast, shortcuts dialog and HUD panels (Source, Visuals, Studio):** the containers stay custom. Reason: the kit's `ui-toast` and `ui-dialog` are bottom-sheet patterns with a display font and a separate scrim, and ours are a floating toast, a native `<dialog>` with a key table, and anchored panels. The buttons inside them use kit `ui-btn`, `ui-icon-btn` and `ui-segmented`.
- **Control bar pill group:** the segmented pill container is app-only. Its buttons are kit `ui-btn ui-btn--ghost`. The kit's `ui-pill` is a status chip and is not used for controls.
- **Icons:** inline SVG in the kit's style (Lucide look, stroke 1.75), written by hand. No icon package or font. Reason: no dependency for a few glyphs.

## States
The app has no record states. Source and mode controls use the kit's selected and pressed styles, not status pills.

## Focus
Keyboard focus uses the kit's 2px `--focus` outline with a 2px offset. The older 3px yellow ring is retired.

## Reduced motion
Animations and the pill, source card, mode button and toast transitions turn off under `prefers-reduced-motion: reduce`. Each screen that moves onto the kit keeps this behaviour.
