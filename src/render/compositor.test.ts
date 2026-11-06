import { describe, it, expect } from 'vitest';
import { Compositor, aspectBox } from './compositor';
import { Scene } from './scene';

const mk = (name: string) => new Scene(name, []);

describe('aspectBox (slice 8.2 fit rule)', () => {
  it('letterboxes landscape 2560x1440 with correction on', () => {
    const b = aspectBox(2560, 1440, true);
    expect(b).toEqual({ width: 2560, height: 1440, offX: 0, offY: 0 });
  });
  it('pillarboxes ultrawide 3440x1440 with correction on', () => {
    const b = aspectBox(3440, 1440, true);
    expect(b.width).toBe(2560);
    expect(b.height).toBe(1440);
    expect(b.offX).toBe(440);
    expect(b.offY).toBe(0);
  });
  it('fills the full canvas for portrait 780x1688 with correction on', () => {
    expect(aspectBox(780, 1688, true)).toEqual({ width: 780, height: 1688, offX: 0, offY: 0 });
  });
  it('fills the full canvas for portrait with correction off', () => {
    expect(aspectBox(780, 1688, false)).toEqual({ width: 780, height: 1688, offX: 0, offY: 0 });
  });
  it('fills the full canvas for square 1000x1000 with correction on', () => {
    expect(aspectBox(1000, 1000, true)).toEqual({ width: 1000, height: 1000, offX: 0, offY: 0 });
  });
  it('letterboxes 4:3 1024x768 with correction on (landscape rule)', () => {
    expect(aspectBox(1024, 768, true)).toEqual({ width: 1024, height: 576, offX: 0, offY: 96 });
  });
  it('never exceeds the canvas and keeps offsets as integers', () => {
    const sizes: [number, number][] = [
      [2560, 1440], [3440, 1440], [780, 1688], [1000, 1000], [1024, 768], [1921, 1080], [391, 845], [280, 900],
    ];
    for (const [w, h] of sizes) {
      for (const correct of [true, false]) {
        const b = aspectBox(w, h, correct);
        expect(b.width).toBeLessThanOrEqual(w);
        expect(b.height).toBeLessThanOrEqual(h);
        expect(b.offX + b.width).toBeLessThanOrEqual(w);
        expect(b.offY + b.height).toBeLessThanOrEqual(h);
        expect(Number.isInteger(b.offX)).toBe(true);
        expect(Number.isInteger(b.offY)).toBe(true);
      }
    }
  });
});

describe('Compositor input checks', () => {
  it('refuses a third active scene (the shader has two inputs)', () => {
    const c = new Compositor([mk('a'), mk('b'), mk('c')]);
    expect(() => c.setWeights({ a: 0.5, b: 0.3, c: 0.2 })).toThrow(/at most two/);
  });
  it('allows two active scenes, and zero-weight scenes do not count', () => {
    const c = new Compositor([mk('a'), mk('b'), mk('c')]);
    expect(() => c.setWeights({ a: 0.5, b: 0.5, c: 0 })).not.toThrow();
  });
  it('rejects an unknown scene name', () => {
    const c = new Compositor([mk('a')]);
    expect(() => c.setWeights({ nope: 1 })).toThrow(/unknown scene/);
  });
  it('clamps weights to 0..1', () => {
    const c = new Compositor([mk('a'), mk('b')]);
    expect(() => c.setWeights({ a: 2, b: -1 })).not.toThrow();
  });
});
