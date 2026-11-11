import { describe, it, expect, vi } from 'vitest';
import { Scene } from '../scene';
import feedbackSrc from '../shaders/feedback.frag.glsl?raw';
import postSrc from '../shaders/post.frag.glsl?raw';
import compositorSrc from '../compositor.ts?raw';
import blurChainSrc from '../blurChain.ts?raw';
import sceneSrc from '../scene.ts?raw';

const DEAD = ['uKick', 'uSub', 'uMobiusPolePolarity', 'uCrtScanlines', 'uCrtBarrel'];

describe('Slice 14.8: dead shader inputs removed', () => {
  it('no dead uniform is declared in the feedback or post shaders', () => {
    for (const name of DEAD) {
      const re = new RegExp(`\\b${name}\\b`);
      expect(feedbackSrc).not.toMatch(re);
      expect(postSrc).not.toMatch(re);
    }
  });

  it('no dead uniform is uploaded or looked up by scene.ts or compositor.ts', () => {
    for (const name of DEAD) {
      const re = new RegExp(`\\b${name}\\b`);
      expect(sceneSrc).not.toMatch(re);
      expect(compositorSrc).not.toMatch(re);
    }
  });

  it('the scene looks up none of the dead uniforms at init', () => {
    const looked: string[] = [];
    const gl = new Proxy({} as Record<string, unknown>, {
      get: (t, prop: string) => {
        if (prop === 'getUniformLocation') return (_p: unknown, n: string) => { looked.push(n); return { name: n }; };
        if (prop in t) return t[prop];
        return vi.fn().mockReturnValue({});
      },
    }) as unknown as WebGL2RenderingContext;
    try {
      new Scene('t', []).init(gl);
    } catch {
      // A thin mock may fail later in init; the lookups made so far are what this test reads.
    }
    for (const name of DEAD) expect(looked).not.toContain(name);
  });
});

describe('Slice 14.8: RGB split survives blur', () => {
  it('blurs each channel around its own split coordinate', () => {
    expect(feedbackSrc).toContain('blurPrev(uvR, uBlur).r');
    expect(feedbackSrc).toContain('blurPrev(uvB, uBlur).b');
  });
});

describe('Slice 14.8: bloom blur steps use matching texel sizes', () => {
  it('uses one half-resolution texel per axis', () => {
    // The blur passes moved from the compositor into the blur chain (Slice 18.6); each level steps one of its own texels.
    expect(blurChainSrc).toContain('(1 / pp.width) * k, 0,');
    expect(blurChainSrc).toContain('0, (1 / pp.height) * k,');
    expect(blurChainSrc).not.toContain('2 / pp.width');
    expect(blurChainSrc).not.toContain('2 / pp.height');
    expect(compositorSrc).not.toContain('2 / full.width');
    expect(compositorSrc).not.toContain('2 / half.height');
  });
});
