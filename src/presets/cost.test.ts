import { describe, expect, it } from 'vitest';
import { COST_LEVELS, LIGHT_FADE_MAX_SEC, LIGHT_MAX, MEDIUM_MAX, costLevelOf, costScore, maxCostForTier, presetCost, withinCost } from './cost';
import { ALL_PRESETS } from './builtin';
import type { Preset } from './format';

type P = Pick<Preset, 'feedback' | 'post' | 'layers'>;
const layer = (type: string, enabled = true) => ({ type, enabled, opacity: 1, blend: 'max' as const, params: {} });
type Loose = { feedback?: Record<string, unknown>; post?: Record<string, unknown>; layers?: P['layers'] };
const base = (over: Loose = {}): P => ({ feedback: {}, post: {}, layers: [], ...over } as unknown as P);

describe('costScore', () => {
  it('is 0 for an empty preset', () => {
    expect(costScore(base())).toBe(0);
  });

  it('counts warp mode only while warp is above 0', () => {
    expect(costScore(base({ feedback: { warpMode: 'curl', warp: 0 } }))).toBe(0);
    expect(costScore(base({ feedback: { warpMode: 'curl', warp: 0.3 } }))).toBeGreaterThan(costScore(base({ feedback: { warpMode: 'mobius', warp: 0.3 } })));
    expect(costScore(base({ feedback: { warpMode: 'classic', warp: 0.3 } }))).toBe(0);
  });

  it('adds sobel, solarize, bloom and mirror', () => {
    expect(costScore(base({ feedback: { sobel: 0.5 } }))).toBe(2);
    expect(costScore(base({ feedback: { solarize: 0.5 } }))).toBe(2);
    expect(costScore(base({ post: { bloom: 0.5 } }))).toBe(2);
    expect(costScore(base({ post: { mirror: 4 } }))).toBe(1);
    expect(costScore(base({ post: { mirror: 0 } }))).toBe(0);
  });

  it('adds the layers that are switched on and ignores disabled ones', () => {
    expect(costScore(base({ layers: [layer('spectralTerrain'), layer('particles')] }))).toBe(7);
    expect(costScore(base({ layers: [layer('spectralTerrain', false)] }))).toBe(0);
    expect(costScore(base({ layers: [layer('somethingNew')] }))).toBe(1);
  });

  it('survives junk values', () => {
    expect(costScore(base({ feedback: { warp: 'x' } }))).toBe(0);
  });
});

describe('levels', () => {
  it('splits at the documented limits', () => {
    expect(costLevelOf(0)).toBe('light');
    expect(costLevelOf(LIGHT_MAX)).toBe('light');
    expect(costLevelOf(LIGHT_MAX + 1)).toBe('medium');
    expect(costLevelOf(MEDIUM_MAX)).toBe('medium');
    expect(costLevelOf(MEDIUM_MAX + 1)).toBe('heavy');
  });

  it('presetCost returns score and level together', () => {
    const r = presetCost(base({ feedback: { warpMode: 'curl', warp: 0.4 }, post: { bloom: 0.3 } }));
    expect(r.score).toBe(11);
    expect(r.level).toBe('heavy');
  });

  it('a heavy-effects preset is heavier than a plain one', () => {
    const plain = presetCost(base({ layers: [layer('shape')] }));
    const heavy = presetCost(base({ feedback: { warpMode: 'curl', warp: 0.4, sobel: 0.9, solarize: 0.9 }, layers: [layer('spectralTerrain')] }));
    expect(plain.level).toBe('light');
    expect(heavy.level).toBe('heavy');
  });

  it('withinCost orders light, medium, heavy', () => {
    expect(COST_LEVELS).toEqual(['light', 'medium', 'heavy']);
    expect(withinCost('light', 'medium')).toBe(true);
    expect(withinCost('medium', 'medium')).toBe(true);
    expect(withinCost('heavy', 'medium')).toBe(false);
    expect(withinCost('heavy', 'heavy')).toBe(true);
  });
});

describe('tiers', () => {
  it('phones and integrated laptops skip Heavy; desktops run everything', () => {
    expect(maxCostForTier('phone')).toBe('medium');
    expect(maxCostForTier('integrated')).toBe('medium');
    expect(maxCostForTier('desktop')).toBe('heavy');
  });

  it('the lighter crossfade cap is under a second', () => {
    expect(LIGHT_FADE_MAX_SEC).toBeLessThan(1);
  });
});

describe('built-in presets', () => {
  it('all get a level, and the plain ones are not Heavy', () => {
    const levels = ALL_PRESETS.map((p) => presetCost(p.preset).level);
    expect(levels.every((l) => COST_LEVELS.includes(l))).toBe(true);
    expect(levels.filter((l) => l === 'light').length).toBeGreaterThan(0);
    expect(levels.filter((l) => l === 'heavy').length).toBeLessThan(levels.length / 2);
  });
});
