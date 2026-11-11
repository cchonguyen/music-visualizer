import { describe, expect, it } from 'vitest';
import { DEFAULT_GOVERNOR, QualityGovernor, TIER_SETTINGS, detectTier, type DeviceInfo } from './qualityGovernor';

const base: DeviceInfo = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/130', maxTouchPoints: 0, screenShortSide: 1080, renderer: 'Apple M2' };

describe('detectTier', () => {
  it('treats a Mac or discrete GPU desktop as desktop', () => {
    expect(detectTier(base)).toBe('desktop');
    expect(detectTier({ ...base, renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11)' })).toBe('desktop');
    expect(detectTier({ ...base, renderer: 'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11)' })).toBe('desktop');
  });

  it('treats Intel integrated and software renderers as integrated', () => {
    expect(detectTier({ ...base, renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)' })).toBe('integrated');
    expect(detectTier({ ...base, renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)' })).toBe('integrated');
    expect(detectTier({ ...base, renderer: 'Google SwiftShader' })).toBe('integrated');
  });

  it('treats phones as phone, by user agent or by a small touch screen', () => {
    expect(detectTier({ ...base, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile Chrome/130', renderer: 'Mali-G710' })).toBe('phone');
    expect(detectTier({ ...base, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', renderer: 'Apple GPU' })).toBe('phone');
    expect(detectTier({ ...base, maxTouchPoints: 5, screenShortSide: 412 })).toBe('phone');
  });

  it('a large touch laptop is not a phone', () => {
    expect(detectTier({ ...base, maxTouchPoints: 10, screenShortSide: 1080 })).toBe('desktop');
  });

  it('works with an unknown renderer name', () => {
    expect(detectTier({ ...base, renderer: '' })).toBe('desktop');
  });
});

describe('tier settings', () => {
  it('starts lower on weaker tiers and never above 1', () => {
    expect(TIER_SETTINGS.desktop.startScale).toBe(1);
    expect(TIER_SETTINGS.integrated.startScale).toBeLessThan(TIER_SETTINGS.desktop.startScale);
    expect(TIER_SETTINGS.phone.startScale).toBeLessThan(TIER_SETTINGS.integrated.startScale);
    for (const t of Object.values(TIER_SETTINGS)) {
      expect(t.minScale).toBeLessThanOrEqual(t.startScale);
      expect(t.minScale).toBeGreaterThanOrEqual(0.25);
    }
  });

  it('the governor starts at the tier start scale', () => {
    expect(new QualityGovernor(TIER_SETTINGS.phone).scale).toBe(0.6);
    expect(new QualityGovernor(TIER_SETTINGS.integrated).scale).toBe(0.8);
    expect(new QualityGovernor().scale).toBe(1);
  });
});

/** Feeds `seconds` of frames at `ms` each; returns every scale change in order. */
function run(g: QualityGovernor, seconds: number, ms: number): number[] {
  const changes: number[] = [];
  const n = Math.round((seconds * 1000) / ms);
  for (let i = 0; i < n; i++) {
    const c = g.push(ms);
    if (c !== null) changes.push(c);
  }
  return changes;
}

describe('QualityGovernor stepping down', () => {
  it('does nothing while frames are healthy', () => {
    const g = new QualityGovernor();
    expect(run(g, 30, 16.7)).toEqual([]);
    expect(g.scale).toBe(1);
  });

  it('steps down after about 1.5 seconds of long frames', () => {
    const g = new QualityGovernor();
    expect(run(g, 1.0, 40)).toEqual([]);
    const changes = run(g, 1.0, 40);
    expect(changes[0]).toBe(0.9);
  });

  it('keeps stepping down under sustained load but not faster than the cooldown, and stops at the tier minimum', () => {
    const g = new QualityGovernor();
    const changes = run(g, 20, 40);
    expect(changes).toEqual([0.9, 0.8, 0.7, 0.6, 0.5]);
    expect(g.scale).toBe(TIER_SETTINGS.desktop.minScale);
    // 5 steps need at least 4 cooldowns between them.
    const g2 = new QualityGovernor();
    expect(run(g2, 6, 40).length).toBeLessThanOrEqual(3);
  });

  it('a phone cannot go below its own minimum', () => {
    const g = new QualityGovernor(TIER_SETTINGS.phone);
    run(g, 30, 50);
    expect(g.scale).toBe(TIER_SETTINGS.phone.minScale);
  });

  it('ignores a short hitch (a few long frames) so a preset switch does not drop quality', () => {
    const g = new QualityGovernor();
    const changes: number[] = [];
    for (let s = 0; s < 20; s++) {
      for (let i = 0; i < 60; i++) {
        const c = g.push(i === 0 ? 90 : 16.7);
        if (c !== null) changes.push(c);
      }
    }
    expect(changes).toEqual([]);
  });

  it('ignores huge gaps (tab switch) and junk values', () => {
    const g = new QualityGovernor();
    for (let i = 0; i < 200; i++) {
      expect(g.push(5000)).toBeNull();
      expect(g.push(Number.NaN)).toBeNull();
      expect(g.push(-3)).toBeNull();
      expect(g.push(0)).toBeNull();
    }
    expect(g.scale).toBe(1);
  });
});

/** Healthy frames long enough for the window to forget a spell of long ones, without reaching a step up. */
const SETTLE_SEC = 2;

describe('QualityGovernor stepping up', () => {
  it('steps back up after a calm spell and stops at 1', () => {
    const g = new QualityGovernor();
    run(g, 5, 40);
    run(g, SETTLE_SEC, 16.7);
    const down = g.scale;
    expect(down).toBeLessThan(1);
    const changes = run(g, 120, 16.7);
    expect(changes[0]).toBeCloseTo(down + 0.1, 5);
    expect(g.scale).toBe(1);
  });

  it('does not step up before the calm spell is over', () => {
    const g = new QualityGovernor();
    run(g, 3, 40);
    run(g, SETTLE_SEC, 16.7);
    const down = g.scale;
    expect(run(g, DEFAULT_GOVERNOR.upAfterSec - SETTLE_SEC - 1, 16.7)).toEqual([]);
    expect(g.scale).toBe(down);
  });

  it('a long frame in the calm spell restarts the wait', () => {
    const g = new QualityGovernor();
    run(g, 3, 40);
    run(g, SETTLE_SEC, 16.7);
    const down = g.scale;
    run(g, 3, 16.7);
    g.push(60);
    expect(run(g, DEFAULT_GOVERNOR.upAfterSec - 1, 16.7)).toEqual([]);
    expect(g.scale).toBe(down);
    expect(run(g, 3, 16.7)[0]).toBeCloseTo(down + 0.1, 5);
  });

  it('a phone that starts at 0.6 steps up toward 1 when it has headroom', () => {
    const g = new QualityGovernor(TIER_SETTINGS.phone);
    run(g, 120, 16.7);
    expect(g.scale).toBe(1);
  });
});

describe('QualityGovernor hysteresis', () => {
  /** One probe: load, a calm spell long enough to step up, then the load returns at once. */
  function probe(g: QualityGovernor): void {
    run(g, DEFAULT_GOVERNOR.maxUpAfterSec + SETTLE_SEC + 2, 16.7);
    run(g, 3, 40);
  }

  it('doubles the calm wait when a step up is followed by a step down, so it does not oscillate', () => {
    const g = new QualityGovernor();
    run(g, 4, 40);
    expect(g.upAfterSec).toBe(DEFAULT_GOVERNOR.upAfterSec);
    run(g, DEFAULT_GOVERNOR.upAfterSec + SETTLE_SEC + 1, 16.7); // steps up
    run(g, 3, 40); // the load comes straight back: steps down again
    expect(g.upAfterSec).toBe(DEFAULT_GOVERNOR.upAfterSec * 2);
  });

  it('never needs a calm wait longer than the maximum', () => {
    const g = new QualityGovernor();
    run(g, 4, 40);
    for (let i = 0; i < 8; i++) probe(g);
    expect(g.upAfterSec).toBeLessThanOrEqual(DEFAULT_GOVERNOR.maxUpAfterSec);
  });

  it('under steady load at the edge, probing slows down instead of bouncing every few seconds', () => {
    // Heavy at scale 1 and 0.9, fine at 0.8 or lower: the governor should settle at 0.8.
    const g = new QualityGovernor();
    const changeTimes: number[] = [];
    for (let t = 0; t < 900; t += 1) {
      const ms = g.scale > 0.85 ? 40 : 16.7;
      for (let i = 0; i < Math.round(1000 / ms); i++) {
        if (g.push(ms) !== null) changeTimes.push(t);
      }
    }
    expect(g.scale).toBeLessThanOrEqual(0.9);
    expect(g.scale).toBeGreaterThanOrEqual(0.8);
    const late = changeTimes.filter((t) => t >= 450);
    // Each probe is an up and a down, and probes are at least about a minute apart by then.
    expect(late.length).toBeLessThanOrEqual(2 * 8);
    expect(g.upAfterSec).toBe(DEFAULT_GOVERNOR.maxUpAfterSec);
  });

  it('a long calm spell earns a shorter wait back', () => {
    const g = new QualityGovernor();
    run(g, 4, 40);
    run(g, DEFAULT_GOVERNOR.upAfterSec + SETTLE_SEC + 1, 16.7);
    run(g, 3, 40);
    expect(g.upAfterSec).toBeGreaterThan(DEFAULT_GOVERNOR.upAfterSec);
    run(g, 400, 16.7);
    expect(g.scale).toBe(1);
    expect(g.upAfterSec).toBe(DEFAULT_GOVERNOR.upAfterSec);
  });
});

describe('QualityGovernor tier change', () => {
  it('setTier restarts from the new tier start scale and clears history', () => {
    const g = new QualityGovernor();
    run(g, 4, 40);
    g.setTier(TIER_SETTINGS.integrated);
    expect(g.tier).toBe('integrated');
    expect(g.scale).toBe(0.8);
    expect(g.upAfterSec).toBe(DEFAULT_GOVERNOR.upAfterSec);
  });
});
