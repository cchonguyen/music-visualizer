# Audit: legacy Bars, Waveform and Rings against Shape

Written for Slice 19.8. Charlie's condition: a legacy layer folds into Shape only if Shape gives a similar level of function and reactivity. Nothing is removed or migrated by default until Charlie accepts this audit.

Marks: **covered** (Shape does it), **close enough** (similar, not identical), **missing** (Shape cannot do it today).

Source read: `src/render/layers/{bars,waveform,rings}.ts`, their shaders, `src/presets/legacyShapeMigration.ts`, and the Shape layer as of Slices 19.1 to 19.7.

## Where things stand
- Legacy layers still render. Presets only use Shape for them when `migrateLegacy` is passed (default off). `legacyShapeMigration.ts` already maps old layers to Shape; it was written in Stage 9 and has not been checked against these gaps.
- Built-in presets that use them: rings 5, waveform 3, bars 1. User-saved presets are unknown.

## Bars (48 log-spaced bars from the bottom)
| Function or reactivity | Legacy | Shape | Mark |
|---|---|---|---|
| Bars along the bottom edge | full width, 48 bars, 8% gap | `edgeLine` bottom with `bars`; sample count 16 to 256, gap 0 to 0.8 | covered |
| Log-spaced frequency bands from the smoothed spectrum | `barValues` on `smoothedSpectrum` | same helper, `spectrum` source | covered |
| Height range expansion: `(v - 0.3) / 0.4` | yes, because raw bars sat in 0.3 to 0.65 | none; height is value x reactivity | missing |
| Punch: height from rise above each bar's own 2.5 s average | yes (`SlowFollower`, `punch`) | none; Shape has attack and release smoothing only | missing |
| Global visual gain (`shapeReaction`) | yes | not applied | missing |
| Band texture: mid sets height, high sets brightness, per bar | yes (Texture strength) | none | missing |
| Colour: accent A to accent B across the width, dimmed to 0.7 | yes | `palette` colour mode blends accents across the path, plus glow | close enough |
| Peak caps, LED segments, top or both rails, mirror, bars on circle | no | yes | Shape adds |
| Bar width and height cap | fixed; lit up to 80% of screen height | `effectLength` (default 0.35) | close enough |

Verdict: **not ready**. The look is similar but the reactivity is different: legacy bars react to change (punch) and Shape bars react to level.

## Waveform (line, circle, star7, lissajous)
| Function or reactivity | Legacy | Shape | Mark |
|---|---|---|---|
| Line across the screen | signed trace, flat at silence | `centerLine` with the new `scope` source (Slice 19.1) | covered |
| Circle | trace around a circle | `circle` base with `scope` | covered |
| Star7 | trace on a 7-point star | `star` base, sides 7, `scope` | close enough |
| 3D Lissajous knot | 1025 points, rotating pitch and yaw (speeds follow sub and high), phase follows mid and kick | `figure8` is a fixed flat curve, no rotation, no audio-driven phase | missing |
| Amplitude 0 to 1.5 | `amplitude` | `reactivity` and `effectLength` | covered |
| Line thickness 0.5 to 5 | yes | 0.5 to 10 | covered |
| Radius | `radius` 0.15 to 0.95 | `size` 0.1 to 2 | covered |
| Colour: white, palette, gradient | yes | `solid` (white), `palette`, `frequencyGradient` | covered |
| Band texture: high band sets brightness along the line | yes | none | missing |
| Sample detail | every waveform sample | up to 256 points | close enough |
| Raw, unsmoothed trace | yes | `scope` smooths with the attack time (5 ms minimum) | close enough |

Issue in the existing migration: it maps `waveform` to the unsigned `waveform` source, which draws silence at half height. It should use `scope`.

Verdict: **line, circle and star7 are ready once the migration uses `scope`. Lissajous and band texture are missing.**

## Rings (concentric, up to 6)
| Function or reactivity | Legacy | Shape | Mark |
|---|---|---|---|
| Concentric outline rings | up to 6, loop in the shader | `concentric` propagation, 1 to 16 copies, `pulsingLine` | close enough |
| Ring count follows loudness change (0.4 energy + 0.6 punch of loudness), fewer in calm | yes | copy count is fixed; no loudness-driven count | missing |
| Stroke width follows mean norm of the three bands and bass punch | yes | `thickness` fixed, no per-frame audio width | missing |
| Polygon rings, 3 to 12 sides | yes | `polygon` base | covered |
| Filled style | yes | `auroraFill` only fills along the extrusion, not a solid shape | missing |
| Kick pulse | `uKick` | `basePulse` and `shockwave` mode | close enough |
| Band texture: sub by angle sets brightness, mid by radius sets width | yes | none | missing |
| Mode `orbitTriangles` (stained-glass lattice, used by one preset) | yes | none | missing |
| Mode `polarGrid` (used by one preset) | yes | none | missing |
| Calm mode ring cap | yes | none | missing |

Verdict: **not ready**. Rings has the most behaviour Shape lacks, and two of its modes are separate patterns, not rings.

## Summary
| Layer | Fold into Shape now? | Gaps to close first |
|---|---|---|
| Waveform (line, circle, star7) | Yes, after the migration uses `scope` | none beyond that |
| Waveform (lissajous) | No | rotating 3D knot with audio-driven phase |
| Bars | No | range expansion and punch option on the spectrum source, visual gain, band texture |
| Rings | No | loudness-driven count and stroke width, filled style, orbitTriangles, polarGrid, calm cap, band texture |

## Proposed work for Slice 19.9 (needs Charlie's go-ahead)
1. Spectrum "punch" audio source for Shape (range expansion plus rise above the 2.5 s average, with visual gain). Closes the Bars reactivity gap.
2. Band texture options on Shape (height and brightness along the path). Closes Bars, Waveform and Rings texture gaps.
3. Rotating 3D Lissajous as a Shape base.
4. Loudness-driven copy count and per-frame stroke width for `concentric` mode.
5. Not proposed: orbitTriangles and polarGrid. These are separate patterns; keep the Rings layer for them.

## Decisions for Charlie
1. Accept this audit as written, or change a mark.
2. Which of the five items above to build in Slice 19.9 (the 19.9 target list is Shape files only, so items touching other files need a corrected slice line).
3. Slice 19.10: migrate only Waveform line, circle and star7 now, and leave Bars and Rings as legacy layers until their gaps close. This is the recommended default.
4. Keep the legacy layer code in all cases until Charlie has compared before and after on the live site.
