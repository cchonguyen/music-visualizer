import { describe, it, expect } from 'vitest';
import { Compositor } from './compositor';
import { Scene } from './scene';

const mk = (name: string) => new Scene(name, []);

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
