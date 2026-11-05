import { describe, it, expect } from 'vitest';
import { RELEASE_TAU_SEC, releaseEnvelope } from './releaseEnvelope';

const TAU = 0.32;
const FRAME = 1 / 60;

/** Run `frames` steps of `dt` with a fixed target, starting from `start`. */
function run(start: number, target: number, frames: number, dt: number, attack = 0.01, release = TAU): number {
  let v = start;
  for (let i = 0; i < frames; i++) v = releaseEnvelope(v, target, dt, attack, release);
  return v;
}

describe('releaseEnvelope', () => {
  it('uses the 320 ms shared release constant (inside the 250–400 ms band)', () => {
    expect(RELEASE_TAU_SEC).toBe(0.32);
  });

  it('falls about 63% after one 320 ms time constant', () => {
    // From 1 toward 0 in 60 fps frames: 320 ms is 19.2 frames. Expect ~exp(-1) = 0.368 left.
    const after = run(1, 0, Math.round(0.32 * 60), FRAME);
    expect(Math.abs(after - Math.exp(-1))).toBeLessThan(0.02);
    expect(1 - after).toBeGreaterThan(0.6);
    expect(1 - after).toBeLessThan(0.67);
  });

  it('falls to about 5% after three time constants (about 1 s)', () => {
    const after = run(1, 0, Math.round(3 * 0.32 * 60), FRAME);
    expect(after).toBeLessThan(0.06);
    expect(after).toBeGreaterThan(0.04);
  });

  it('never jumps in a single frame from loud to silence', () => {
    // Largest single-frame drop at 60 fps must be well under the full range.
    const next = releaseEnvelope(1, 0, FRAME, 0.01, TAU);
    expect(1 - next).toBeLessThan(0.15);
    expect(next).toBeGreaterThan(0.8);
  });

  it('attacks fast: a 10 ms attack tau reaches about 80% in one 60 fps frame', () => {
    const next = releaseEnvelope(0, 1, FRAME, 0.01, TAU);
    expect(next).toBeGreaterThan(0.8);
  });

  it('instant attack (tau 0) jumps straight to a louder target', () => {
    expect(releaseEnvelope(0.2, 0.9, FRAME, 0, TAU)).toBeCloseTo(0.9, 12);
  });

  it('dt = 0 leaves the value unchanged', () => {
    expect(releaseEnvelope(0.7, 0, 0, 0.01, TAU)).toBe(0.7);
    expect(releaseEnvelope(0.2, 1, 0, 0.01, TAU)).toBe(0.2);
  });

  it('treats negative or non-finite dt as 0', () => {
    expect(releaseEnvelope(0.7, 0, -1, 0.01, TAU)).toBe(0.7);
    expect(releaseEnvelope(0.7, 0, NaN, 0.01, TAU)).toBe(0.7);
  });

  it('large dt does not overshoot the target', () => {
    expect(releaseEnvelope(1, 0, 10, 0.01, TAU)).toBeGreaterThanOrEqual(0);
    expect(releaseEnvelope(1, 0, 10, 0.01, TAU)).toBeLessThan(1e-6);
    expect(releaseEnvelope(0, 1, 10, 0.01, TAU)).toBeLessThanOrEqual(1);
    expect(releaseEnvelope(0, 1, 10, 0.01, TAU)).toBeGreaterThan(0.999);
    expect(releaseEnvelope(0, 1, 1e9, 0, 0)).toBe(1);
  });

  it('stays between current and target for any dt', () => {
    for (const dt of [0.001, 0.016, 0.1, 0.5, 2]) {
      const v = releaseEnvelope(0.3, 0.8, dt, 0.01, TAU);
      expect(v).toBeGreaterThanOrEqual(0.3);
      expect(v).toBeLessThanOrEqual(0.8);
      const w = releaseEnvelope(0.8, 0.3, dt, 0.01, TAU);
      expect(w).toBeGreaterThanOrEqual(0.3);
      expect(w).toBeLessThanOrEqual(0.8);
    }
  });

  it('a non-finite current is treated as 0', () => {
    expect(releaseEnvelope(NaN, 0.5, FRAME, 0, TAU)).toBe(0.5);
  });
});
