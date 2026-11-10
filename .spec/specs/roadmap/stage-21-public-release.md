# Stage 21: Public release

Goal: ready for people who have never seen the app. A preset browser on the main screen, basic phone support, a lighter first load with no admin code for visitors, clearer accessibility controls, and backup.

Read `README.md` in this folder first. Needs Stage 16 merged. The security work is in Stage 14 and must already be live.

## Why
- The preset browser exists only inside the Studio. Favourites can only be set there. Auto-cycle is off by default.
- Start screen text mentions a "Calm switch". No element with id `calm` exists in `index.html`; Calm is a mode button. The checkbox branches in `src/ui/controls.ts` (near 189, 270, 359, 377) are dead.
- Calm mode silently switches preset (`main.ts` near 386 to 405).
- Browsers without tab audio capture show a permanent error banner (`notices.ts:26`, shown with no timeout from `main.ts` near 694).
- The shortcuts dialog advertises the debug panel.
- `prefers-reduced-motion` is read once at startup (`main.ts:373`). The photosensitivity limiter has no user setting.
- No touch handling on the canvas. No wake lock.
- Tweakpane and the Studio are statically imported into the main bundle (`main.ts:29`, `studio.ts:6`).
- User presets live only in local storage (`mv.userPresets` and related keys). There is no whole-library export.
- No manifest or service worker.

## Scope decision
Phone support is basic for now (Charlie, 2026-11-10): file and microphone sources, usable controls, no phone-specific features beyond that.

## Slices

- [ ] **Slice 21.1: Fix start-screen copy, remove dead Calm checkbox code, hide the debug shortcut, and announce the Calm preset switch** 🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `index.html`, `src/ui/controls.ts`, `src/ui/controls.test.ts`, `src/main.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 21.2: Tab-audio notice shown once and dismissible; phone-first source picker** 🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/ui/notices.ts`, `src/ui/controls.ts`, `src/main.ts`, `index.html` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 21.3: Intensity control (Full, Reduced, Calm) and live reduced-motion handling** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/render/safety.ts`, `src/render/safety.test.ts`, `src/ui/controls.ts`, `src/main.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 21.4: Preset browser on the main screen with themes, favourites and cost badges** 🖐 `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/ui/presetBrowser.ts` [NEW], `src/ui/presetBrowser.test.ts` [NEW], `index.html`, `src/style.css` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 21.5: Wire the preset browser, favourite button and auto-cycle defaults** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/main.ts`, `src/ui/controls.ts`, `src/presets/autoCycle.ts`, `src/presets/autoCycle.test.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 21.6: Preset thumbnails captured from the canvas** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/ui/thumbnails.ts` [NEW], `src/ui/thumbnails.test.ts` [NEW], `src/ui/presetBrowser.ts`, `src/render/compositor.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 21.7: Touch gestures and screen wake lock** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/ui/gestures.ts` [NEW], `src/ui/gestures.test.ts` [NEW], `src/main.ts`, `src/style.css` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 21.8: Studio and admin code load only when opened** `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/main.ts`, `src/studio/studio.ts`, `src/studio/adminControls.ts`, `vite.config.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 21.9: Export and import the whole user library** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `src/presets/session.ts`, `src/presets/session.test.ts`, `src/studio/studio.ts`, `src/ui/controls.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 21.10: Installable app with offline cache** 🖐 `[CORE / DATA]` worker: engineer-sonnet (Sonnet) Target files: `public/manifest.webmanifest` [NEW], `public/sw.js` [NEW], `index.html`, `src/main.ts` | Verify: npm run typecheck && npm test && npm run build && npm run lint
- [ ] **Slice 21.11: Accessibility pass on the new screens** `[UI / VISUAL]` worker: engineer-sonnet (Sonnet) Target files: `src/ui/presetBrowser.ts`, `src/ui/toast.ts`, `src/style.css`, `docs/stage21-accessibility-audit.md` [NEW] | Verify: npm run typecheck && npm test && npm run build && npm run lint

## Slice notes
- **21.3** Full keeps today's limits. Reduced and Calm tighten them. No setting may loosen the limiter beyond today's values. Listen for changes to the reduced-motion media query.
- **21.5** Turning auto-cycle on by default changes first-run behaviour for everyone. Confirm with Charlie in the PR before merge. On the phone tier, auto-cycle skips Heavy presets.
- **21.6** Capture a small image a few seconds after a preset becomes active, at low resolution, and store it in local storage or IndexedDB with a size cap. Do not read pixels during normal playback frames.
- **21.7** Tap toggles controls, horizontal swipe changes preset, double-tap toggles fullscreen. Wake lock is requested while audio is playing and released when hidden.
- **21.8** Use dynamic `import()`. After this slice a visitor who never opens the Studio downloads no Tweakpane and no admin code. Report bundle sizes before and after.
- **21.10** Cache the app shell and builtin presets. The service worker must never cache `/admin` routes. Check that Cloudflare static asset caching and the worker-first `/admin` rule in `wrangler.jsonc` still behave.
- **21.11** Keyboard reachability, focus order, labels, contrast on the preset browser. Fix the toast's `aria-label` on a live region.

## Done when
- A first-time visitor on a phone can start with a file or the microphone, pick a preset from a grid, and favourite it, without opening the Studio.
- The main bundle contains no Studio or admin code.
- A user can export their library, clear site data, import it, and see everything back.

## Out of scope
Visitor preset sharing and any marketplace. Accounts. Native apps.
