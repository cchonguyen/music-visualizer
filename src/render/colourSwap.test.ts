import { describe, expect, it } from 'vitest';
import { blendAccents, ColourSwap, type ColourSwapInput, SWAP_SEC } from './colourSwap';

const quiet: ColourSwapInput = { dtSec: 0.1, contrast: 0, energy: 0.5, kick: false, calm: false };
const dip: ColourSwapInput = { ...quiet, contrast: -0.3 };
const drop: ColourSwapInput = { ...quiet, kick: true, energy: 0.9 };

/** Runs n frames of 0.1 s and returns the last mix. */
function run(swap: ColourSwap, input: ColourSwapInput, frames: number): number {
  let mix = 0;
  for (let i = 0; i < frames; i++) mix = swap.update(input);
  return mix;
}

describe('ColourSwap', () => {
  it('does not swap without a breakdown dip', () => {
    const swap = new ColourSwap();
    expect(swap.update(drop)).toBe(0);
    expect(run(swap, drop, 20)).toBe(0);
  });

  it('swaps after a dip when a loud kick lands', () => {
    const swap = new ColourSwap();
    run(swap, dip, 5);
    swap.update(drop);
    expect(run(swap, quiet, 15)).toBe(1);
  });

  it('does not swap on a kick below the energy threshold', () => {
    const swap = new ColourSwap();
    run(swap, dip, 5);
    expect(run(swap, { ...drop, energy: 0.7 }, 1)).toBe(0);
  });

  it('does not swap on a non-kick frame', () => {
    const swap = new ColourSwap();
    run(swap, dip, 5);
    expect(run(swap, { ...drop, kick: false }, 1)).toBe(0);
  });

  it('ignores a dip older than 8 seconds', () => {
    const swap = new ColourSwap();
    run(swap, dip, 1);
    run(swap, quiet, 85); // about 8.6 s later
    expect(run(swap, drop, 1)).toBe(0);
  });

  it('crossfades over about one second, not a jump', () => {
    const swap = new ColourSwap();
    run(swap, dip, 5);
    swap.update(drop);
    const half = run(swap, quiet, Math.round((SWAP_SEC / 2) / 0.1));
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.8);
    const first = swap.update(quiet);
    expect(first).toBeGreaterThan(half);
    expect(first).toBeLessThan(1);
  });

  it('swaps back on the next drop after a new dip', () => {
    const swap = new ColourSwap();
    run(swap, dip, 5);
    swap.update(drop);
    run(swap, quiet, 15);
    run(swap, dip, 5);
    swap.update(drop);
    expect(run(swap, quiet, 15)).toBe(0);
  });

  it('never swaps in calm mode and eases back to normal', () => {
    const swap = new ColourSwap();
    run(swap, dip, 5);
    expect(swap.update({ ...drop, calm: true })).toBe(0);
    expect(run(swap, { ...quiet, calm: true }, 20)).toBe(0);
  });

  it('reset clears the swap and the dip memory', () => {
    const swap = new ColourSwap();
    run(swap, dip, 5);
    swap.update(drop);
    swap.reset();
    expect(run(swap, drop, 1)).toBe(0);
  });
});

describe('blendAccents', () => {
  const a: [number, number, number] = [1, 0, 0];
  const b: [number, number, number] = [0, 0, 1];

  it('leaves accents unchanged at mix 0', () => {
    expect(blendAccents(a, b, 0)).toEqual({ a, b });
  });

  it('exchanges accents at mix 1', () => {
    expect(blendAccents(a, b, 1)).toEqual({ a: b, b: a });
  });

  it('is halfway at mix 0.5', () => {
    const half = blendAccents(a, b, 0.5);
    expect(half.a[0]).toBeCloseTo(0.5, 10);
    expect(half.a[2]).toBeCloseTo(0.5, 10);
  });
});
