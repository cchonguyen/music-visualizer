import { describe, it, expect } from 'vitest';
import {
  applyLinkCurve,
  hexToHsl,
  hslToHex,
  LinkRunner,
  neutralPointForSpec,
  ReactionBank,
  shiftHexHue,
  sourceValue,
  type LinkInputs,
} from './links';
import type { Reaction } from './reactions';
import type { AudioFrame } from '../audio/types';
import { AUDIO_SOURCES, type Settings } from './format';
import type { ParamSpec } from './schema';

function frame(over: Partial<AudioFrame> = {}): AudioFrame {
  const bands = { sub: 0, mid: 0, high: 0 };
  return {
    frameIndex: 0, time: 0, dtSec: 0.016,
    raw: { ...bands }, env: { ...bands, sub: 0.3 }, norm: { ...bands, sub: 0.6, mid: 0.2, high: 0.9 },
    loudness: 0.4, energy: 0.7, flux: 0.1, fluxByBand: { ...bands }, beat: false,
    beatByBand: { sub: false, mid: false, high: false }, beatStrength: 0,
    kickEnv: 0, kickPulse: false,
    waveform: new Float32Array(0),
    bandWaveforms: { sub: new Float32Array(0), mid: new Float32Array(0), high: new Float32Array(0) },
    spectrum: new Float32Array(0), smoothedSpectrum: new Float32Array(0), sampleRate: 48000,
    ...over,
  };
}
const inputs = (over: Partial<LinkInputs> = {}): LinkInputs => ({ frame: frame(), timeSec: 0, sectionContrast: 0, ...over });

const zoom: ParamSpec = { type: 'float', name: 'zoom', label: 'Zoom', group: 'G', default: 1, min: 0.8, max: 1.2, step: 0.01 };

describe('sources', () => {
  it('reads the matching frame values', () => {
    expect(sourceValue('sub', inputs())).toBe(0.6);
    expect(sourceValue('bass', inputs())).toBe(0.3);
    expect(sourceValue('energy', inputs())).toBe(0.7);
    expect(sourceValue('beat', inputs({ frame: frame({ beatByBand: { sub: true, mid: false, high: false } }) }))).toBe(1);
  });

  it('every source gives a value between 0 and 1', () => {
    for (const s of ['sub','bass','mid','high','energy','loudness','beat','onset','section','lfoSine','lfoSaw','lfoRandom','time'] as const) {
      for (const t of [0, 0.37, 12.5, 999.9]) {
        const v = sourceValue(s, inputs({ timeSec: t, sectionContrast: -1 }));
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('new sources (4.11)', () => {
  it('AUDIO_SOURCES lists the five new names', () => {
    for (const s of ['beatStrength', 'brightness', 'subFlux', 'midFlux', 'highFlux']) {
      expect(AUDIO_SOURCES).toContain(s);
    }
  });

  it('beatStrength passes through', () => {
    expect(sourceValue('beatStrength', inputs({ frame: frame({ beatStrength: 0.7 }) }))).toBe(0.7);
  });

  it('highFlux reads fluxByBand.high', () => {
    const f = frame({ fluxByBand: { sub: 0.1, mid: 0.2, high: 0.8 } });
    expect(sourceValue('highFlux', inputs({ frame: f }))).toBe(0.8);
    expect(sourceValue('subFlux', inputs({ frame: f }))).toBe(0.1);
    expect(sourceValue('midFlux', inputs({ frame: f }))).toBe(0.2);
  });

  it('brightness and centroid hold 0.5 for an all-zero spectrum (silence freeze)', () => {
    const f = frame({ spectrum: new Float32Array(64), frameIndex: 100 });
    expect(sourceValue('brightness', inputs({ frame: f }))).toBe(0.5);
    expect(sourceValue('centroid', inputs({ frame: f }))).toBe(0.5);
  });

  it('AUDIO_SOURCES lists kickEnv and centroid', () => {
    expect(AUDIO_SOURCES).toContain('kickEnv');
    expect(AUDIO_SOURCES).toContain('centroid');
  });

  it('kickEnv passes through from frame.kickEnv', () => {
    expect(sourceValue('kickEnv', inputs({ frame: frame({ kickEnv: 0.72 }) }))).toBeCloseTo(0.72, 3);
  });

  it('centroid aliases to silence-safe spectral centroid', () => {
    const high = new Float32Array(64);
    high[60] = 1;
    const f = frame({ spectrum: high, frameIndex: 400 });
    expect(sourceValue('centroid', inputs({ frame: f }))).toBe(sourceValue('brightness', inputs({ frame: f })));
  });

  it('brightness is higher for high-bin energy than low-bin energy, both in 0..1', () => {
    const low = new Float32Array(64);
    low[1] = 1;
    const high = new Float32Array(64);
    high[60] = 1;
    const vLow = sourceValue('brightness', inputs({ frame: frame({ spectrum: low, frameIndex: 201 }) }));
    const vHigh = sourceValue('brightness', inputs({ frame: frame({ spectrum: high, frameIndex: 202 }) }));
    expect(vLow).toBeGreaterThanOrEqual(0);
    expect(vHigh).toBeLessThanOrEqual(1);
    expect(vHigh).toBeGreaterThan(vLow);
  });

  it('brightness returns the same value on a second call with the same frame', () => {
    const spectrum = new Float32Array(64);
    spectrum[30] = 0.5;
    const f = frame({ spectrum, frameIndex: 300 });
    const first = sourceValue('brightness', inputs({ frame: f }));
    const second = sourceValue('brightness', inputs({ frame: f }));
    expect(second).toBe(first);
  });
});

describe('LinkRunner', () => {
  const settings = (link?: Settings['zoom']['link'], value = 1): Settings => ({ zoom: { value, ...(link ? { link } : {}) } });

  it('leaves an unlinked setting unchanged', () => {
    const out = new LinkRunner().resolve('F', settings(undefined, 1.05), [zoom], inputs(), 0.016);
    expect(out.zoom).toBe(1.05);
  });

  it('adds amount × range × source to the base value', () => {
    // smooth 0 settles almost at once when dt is large
    const link = { source: 'sub' as const, amount: 0.5, smooth: 0 };
    const out = new LinkRunner().resolve('F', settings(link, 1), [zoom], inputs(), 10);
    // base 1 + 0.5 × 0.4 × 0.6 = 1.12
    expect(out.zoom as number).toBeCloseTo(1.12, 3);
  });

  it('clamps to the setting range', () => {
    const link = { source: 'sub' as const, amount: 1, smooth: 0 };
    const out = new LinkRunner().resolve('F', settings(link, 1.2), [zoom], inputs(), 10);
    expect(out.zoom).toBe(1.2);
  });

  it('smooths over time: a sudden jump moves gradually with a high smooth value', () => {
    const link = { source: 'sub' as const, amount: 1, smooth: 1 };
    const runner = new LinkRunner();
    const first = runner.resolve('F', settings(link, 1), [zoom], inputs({ frame: frame({ norm: { sub: 0, mid: 0, high: 0 }, env: { sub: 0, mid: 0, high: 0 } }) }), 0.016);
    const second = runner.resolve('F', settings(link, 1), [zoom], inputs(), 0.016);
    const third = runner.resolve('F', settings(link, 1), [zoom], inputs(), 0.016);
    expect(first.zoom as number).toBeCloseTo(1, 3);
    expect(second.zoom as number).toBeGreaterThan(1);
    expect(second.zoom as number).toBeLessThan(1.2 * 0.9 + 0.001);
    expect(third.zoom as number).toBeGreaterThan(second.zoom as number);
  });

  it('a negative amount pulls the value down', () => {
    const link = { source: 'sub' as const, amount: -0.5, smooth: 0 };
    const out = new LinkRunner().resolve('F', settings(link, 1), [zoom], inputs(), 10);
    expect(out.zoom as number).toBeCloseTo(0.88, 3);
  });

  it('keeps separate state per scope', () => {
    const runner = new LinkRunner();
    const link = { source: 'sub' as const, amount: 1, smooth: 1 };
    runner.resolve('A', settings(link, 1), [zoom], inputs({ frame: frame({ norm: { sub: 0, mid: 0, high: 0 }, env: { sub: 0, mid: 0, high: 0 } }) }), 0.016);
    // Scope B starts at its own target (sub 0.6 -> 1 + 0.4 × 0.6 = 1.24, clamped to 1.2).
    // If it shared state with A (sub 0, so near 1), it would sit near 1.0.
    const b = runner.resolve('B', settings(link, 1), [zoom], inputs(), 0.0001);
    expect(b.zoom as number).toBeCloseTo(1.2, 3);
  });

  it('morphs a setting with no link: at half a period it reaches `to`', () => {
    // A fresh settings object per sample: each morph keeps its own integrated phase.
    const morphed = (): Settings => ({ zoom: { value: 1, morph: { to: 1.1, rate: 0.5 } } });
    const atStart = new LinkRunner().resolve('M', morphed(), [zoom], inputs({ timeSec: 0 }), 0.016);
    const atHalf = new LinkRunner().resolve('M', morphed(), [zoom], inputs({ timeSec: 1 }), 0.016);
    expect(atStart.zoom as number).toBeCloseTo(1, 5);
    expect(atHalf.zoom as number).toBeCloseTo(1.1, 5);
  });

  it('rounds integer settings', () => {
    const sides: ParamSpec = { type: 'int', name: 'sides', label: 'Sides', group: 'G', default: 4, min: 3, max: 12, step: 1 };
    const out = new LinkRunner().resolve('S', { sides: { value: 4, link: { source: 'sub', amount: 0.3, smooth: 0 } } }, [sides], inputs(), 10);
    expect(Number.isInteger(out.sides)).toBe(true);
  });
});

describe('LFO rate', () => {
  it('changes the sine speed and clamps the rate range', () => {
    const quarter = 0.25; // seconds
    // At 0.5 Hz a quarter second is a quarter cycle: sin(pi/4) → 0.5 + 0.5·0.707.
    expect(sourceValue('lfoSine', inputs({ timeSec: quarter }), 0.5)).toBeCloseTo(0.5 + 0.5 * Math.SQRT1_2, 5);
    // At 2 Hz the same time is a full cycle later: sin(pi) → 0.5.
    expect(sourceValue('lfoSine', inputs({ timeSec: quarter }), 2)).toBeCloseTo(0.5, 5);
    // Out-of-range rates are clamped to 8 Hz, so the result is still in 0..1.
    const v = sourceValue('lfoSaw', inputs({ timeSec: 3.3 }), 1000);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe('reactions in the link runner (Slice 17.4)', () => {
  const bank = () => new ReactionBank();
  const kick = (over: Partial<Reaction> = {}): Reaction => ({
    trigger: { type: 'beat' }, response: 'kick', target: { group: 'feedback', name: 'zoom' }, amount: 0.25, ease: 0.3, ...over,
  });
  const beatInputs = (beat: boolean, t: number): LinkInputs => ({ frame: frame({ onset: beat, onsetStrength: 0.9 }), timeSec: t, sectionContrast: 0 });

  it('leaves settings alone when no reaction targets them', () => {
    const engine = bank().engineFor('p', [kick({ target: { group: 'feedback', name: 'rotate' } })])!;
    const out = new LinkRunner().resolve('F', { zoom: { value: 1.05 } }, [zoom], beatInputs(true, 0), 0.016, { engine, group: 'feedback' });
    expect(out.zoom).toBe(1.05);
  });

  it('adds the kick to a plain value and eases back, clamped to the range', () => {
    const engine = bank().engineFor('p', [kick()])!;
    const runner = new LinkRunner();
    engine.update(frame({ onset: true, onsetStrength: 0.9 }), 0, 0.016, 0);
    const hit = runner.resolve('F', { zoom: { value: 1 } }, [zoom], beatInputs(true, 0), 0.016, { engine, group: 'feedback' }).zoom as number;
    expect(hit).toBeCloseTo(1 + 0.25 * 0.4, 6);
    for (let i = 1; i < 90; i += 1) engine.update(frame(), i / 60, 1 / 60, 0);
    const later = runner.resolve('F', { zoom: { value: 1 } }, [zoom], beatInputs(false, 1.5), 0.016, { engine, group: 'feedback' }).zoom as number;
    expect(later).toBeCloseTo(1, 3);
    engine.update(frame({ onset: true, onsetStrength: 0.9 }), 2, 0.016, 0);
    const high = runner.resolve('F', { zoom: { value: 1.19 } }, [zoom], beatInputs(true, 2), 0.016, { engine, group: 'feedback' }).zoom as number;
    expect(high).toBe(zoom.max);
  });

  it('runs after the audio link: base, link, reaction, clamp', () => {
    const engine = bank().engineFor('p', [kick({ amount: 0.1 })])!;
    engine.update(frame({ onset: true, onsetStrength: 0.9 }), 0, 0.016, 0);
    // sub norm is 0.6, so the link alone gives 1 + 0.5 x 0.4 x 0.6 = 1.12 (smooth 0 follows within one step at a long dt).
    const linkedOnly = new LinkRunner().resolve('F', { zoom: { value: 1, link: { source: 'sub', amount: 0.5, smooth: 0 } } }, [zoom], beatInputs(true, 0), 10).zoom as number;
    const both = new LinkRunner().resolve('F', { zoom: { value: 1, link: { source: 'sub', amount: 0.5, smooth: 0 } } }, [zoom], beatInputs(true, 0), 10, { engine, group: 'feedback' }).zoom as number;
    expect(both).toBeCloseTo(linkedOnly + 0.1 * 0.4, 6);
  });

  it('applies to a morph-only setting too, and rounds integer settings', () => {
    const level: ParamSpec = { type: 'int', name: 'level', label: 'L', group: 'G', default: 2, min: 0, max: 10, step: 1 };
    const engine = bank().engineFor('p', [kick({ target: { group: 'post', name: 'level' }, amount: 0.24 })])!;
    engine.update(frame({ onset: true, onsetStrength: 0.9 }), 0, 0.016, 0);
    const out = new LinkRunner().resolve('P', { level: { value: 2, morph: { to: 4, rate: 0.1 } } }, [level], beatInputs(true, 0), 0.016, { engine, group: 'post' }).level;
    expect(Number.isInteger(out)).toBe(true);
    expect(out).toBe(Math.round(2 + 0.24 * 10));
  });
});

describe('ReactionBank', () => {
  const r = (): Reaction => ({ trigger: { type: 'beat' }, response: 'kick', target: { group: 'feedback', name: 'zoom' }, amount: 0.2, ease: 0.3 });

  it('gives no engine without reactions, and keeps one engine while they are unchanged', () => {
    const bank = new ReactionBank();
    expect(bank.engineFor('a', undefined)).toBeNull();
    expect(bank.engineFor('a', [])).toBeNull();
    const first = bank.engineFor('a', [r()]);
    expect(first).not.toBeNull();
    expect(bank.engineFor('a', [r()])).toBe(first); // equal content, even as a new array
  });

  it('rebuilds when a reaction changes, including an edit in place', () => {
    const bank = new ReactionBank();
    const list = [r()];
    const first = bank.engineFor('a', list);
    list[0]!.amount = 0.5;
    const second = bank.engineFor('a', list);
    expect(second).not.toBe(first);
    expect(bank.engineFor('a', list)).toBe(second);
  });

  it('seeds from the scope, so the same preset always picks the same values', () => {
    const pick: Reaction = { trigger: { type: 'beat' }, response: 'pick', target: { group: 'feedback', name: 'zoom' }, amount: 1, ease: 0 };
    const results = ['x', 'x', 'y'].map((scope) => {
      const e = new ReactionBank().engineFor(scope, [pick])!;
      e.update(frame({ onset: true }), 0, 0.016, 0);
      return e.apply('feedback', 'zoom', 1, { min: 0, max: 2 });
    });
    expect(results[0]).toBe(results[1]);
    expect(results[0]).not.toBe(results[2]);
  });
});

describe('song-arc sources (13.2)', () => {
  it('AUDIO_SOURCES includes the 5 song-arc sources', () => {
    for (const s of ['drop', 'breakdown', 'phrase16', 'phrase32', 'energySlow']) {
      expect(AUDIO_SOURCES).toContain(s);
    }
  });

  it('sourceValue evaluates drop, breakdown, phrase16, phrase32, and energySlow', () => {
    expect(sourceValue('drop', inputs({ sectionContrast: 0.25 }))).toBeCloseTo(0.5, 5);
    expect(sourceValue('drop', inputs({ sectionContrast: -0.25 }))).toBe(0);
    expect(sourceValue('breakdown', inputs({ sectionContrast: -0.3 }))).toBeCloseTo(0.6, 5);
    expect(sourceValue('breakdown', inputs({ sectionContrast: 0.3 }))).toBe(0);
    expect(sourceValue('phrase16', inputs({ timeSec: 2 }))).toBeCloseTo(0.25, 5);
    expect(sourceValue('phrase32', inputs({ timeSec: 4 }))).toBeCloseTo(0.25, 5);
    expect(sourceValue('energySlow', inputs({ frame: frame({ energy: 0.85 }) }))).toBeCloseTo(0.85, 5);
  });

  it('LinkRunner tracks stateful phrase16/phrase32 beat counts once beats arrive and advances once per frame', () => {
    const runner = new LinkRunner();
    const unit: ParamSpec = { type: 'float', name: 'u', label: 'U', group: 'G', default: 0, min: 0, max: 1, step: 0.01 };
    const p16Settings: Settings = { u: { value: 0, link: { source: 'phrase16', amount: 1, smooth: 0 } } };
    const p32Settings: Settings = { u: { value: 0, link: { source: 'phrase32', amount: 1, smooth: 0 } } };

    // Before first beat: falls back to time ramp (timeSec=4 -> phrase16 = 0.5).
    const pre = runner.resolve('P16', p16Settings, [unit], inputs({ timeSec: 4, frame: frame({ frameIndex: 1 }) }), 10);
    expect(pre.u as number).toBeCloseTo(0.5, 3);

    // Beat 1 at t=5.0 -> beatCount=1. Calling resolve multiple times in same frame does NOT double-count.
    const fBeat1 = frame({ frameIndex: 2, kickPulse: true });
    runner.resolve('P16', p16Settings, [unit], inputs({ timeSec: 5.0, frame: fBeat1 }), 10);
    const sameFrame = runner.resolve('P32', p32Settings, [unit], inputs({ timeSec: 5.0, frame: fBeat1 }), 10);
    expect(runner.resolvedByKey('P16.u')).toBeCloseTo(1 / 16, 3);
    expect(sameFrame.u as number).toBeCloseTo(1 / 32, 3);

    // Release beat, then trigger beat 2 after 180ms cooldown.
    runner.resolve('P16', p16Settings, [unit], inputs({ timeSec: 5.1, frame: frame({ frameIndex: 3, kickPulse: false }) }), 0.1);
    runner.resolve('P16', p16Settings, [unit], inputs({ timeSec: 5.3, frame: frame({ frameIndex: 4, beatByBand: { sub: true, mid: false, high: false } }) }), 10);
    expect(runner.resolvedByKey('P16.u')).toBeCloseTo(2 / 16, 3);
  });

  it('LinkRunner seeds energySlow on first call and smooths with tau = 10s', () => {
    const runner = new LinkRunner();
    const unit: ParamSpec = { type: 'float', name: 'u', label: 'U', group: 'G', default: 0, min: 0, max: 1, step: 0.01 };
    const s: Settings = { u: { value: 0, link: { source: 'energySlow', amount: 1, smooth: 0 } } };

    // Seed at 0.2
    const first = runner.resolve('E', s, [unit], inputs({ timeSec: 0, frame: frame({ frameIndex: 1, energy: 0.2 }) }), 0.016);
    expect(first.u as number).toBeCloseTo(0.2, 4);

    // Jump energy to 1.0 over dt = 10s -> energySlow moves 1 - e^-1 (~0.632) toward 1.0: 0.2 + 0.8 * 0.63212 = 0.7057
    const second = runner.resolve('E', s, [unit], inputs({ timeSec: 10, frame: frame({ frameIndex: 2, energy: 1.0 }) }), 10);
    expect(second.u as number).toBeCloseTo(0.2 + 0.8 * (1 - Math.exp(-1)), 2);
  });
});

describe('applyLinkCurve and neutralPointForSpec (13.2)', () => {
  it('applies linear, punch, swell, and gate curves', () => {
    expect(applyLinkCurve(0.5)).toBeCloseTo(0.5, 5);
    expect(applyLinkCurve(0.5, 'linear')).toBeCloseTo(0.5, 5);
    expect(applyLinkCurve(0.5, 'punch')).toBeCloseTo(Math.pow(0.5, 2.2), 5);
    expect(applyLinkCurve(0.25, 'swell')).toBeCloseTo(0.5, 5);
    expect(applyLinkCurve(0.3, 'gate', 0.35)).toBe(0);
    expect(applyLinkCurve(0.35, 'gate', 0.35)).toBe(0);
    expect(applyLinkCurve(0.675, 'gate', 0.35)).toBeCloseTo(0.5, 5);
    expect(applyLinkCurve(1.0, 'gate', 0.35)).toBeCloseTo(1.0, 5);
    // Clamps threshold bounds and handles NaN
    expect(applyLinkCurve(0.5, 'gate', Number.NaN)).toBeCloseTo((0.5 - 0.35) / 0.65, 5);
  });

  it('computes neutral points for zoom, signed ranges, and default fallback', () => {
    expect(neutralPointForSpec(zoom)).toBe(1.0);
    expect(neutralPointForSpec({ name: 'rotate', default: 0.2, min: -1, max: 1 })).toBe(0.0);
    expect(neutralPointForSpec({ name: 'decay', default: 0.92, min: 0.5, max: 0.99 })).toBe(0.92);
  });
});

describe('LinkRunner modes, bounds, calm damping, resolvedByKey & clear (13.2)', () => {
  const rotate: ParamSpec = { type: 'float', name: 'rotate', label: 'Rotate', group: 'G', default: 0, min: -1, max: 1, step: 0.01 };
  const flash: ParamSpec = { type: 'float', name: 'flash', label: 'Flash', group: 'G', default: 0, min: 0, max: 1, step: 0.01, intense: true };

  it('bipolar mode centers modulation around start value', () => {
    const runner = new LinkRunner();
    const s: Settings = { rotate: { value: 0, link: { source: 'sub', amount: 0.5, smooth: 0, mode: 'bipolar' } } };
    // sub = 0 -> curved = 0 -> 0 + 0.5 * 2 * (0 - 1) = -1
    const low = runner.resolve('F', s, [rotate], inputs({ frame: frame({ frameIndex: 1, norm: { sub: 0, mid: 0, high: 0 } }) }), 10);
    expect(low.rotate as number).toBeCloseTo(-1, 3);
    // sub = 0.5 -> curved*2 - 1 = 0 -> 0
    const mid = runner.resolve('F', s, [rotate], inputs({ timeSec: 1, frame: frame({ frameIndex: 2, norm: { sub: 0.5, mid: 0, high: 0 } }) }), 10);
    expect(mid.rotate as number).toBeCloseTo(0, 3);
  });

  it('flipOnBeat flips polarity around neutral point for zoom (1.0) and rotate (0.0) with slew', () => {
    const runner = new LinkRunner();
    const s: Settings = {
      zoom: { value: 1.0, link: { source: 'sub', amount: 0.5, smooth: 0, mode: 'flipOnBeat', flipSlew: 0.2 } },
      rotate: { value: 0.1, link: { source: 'sub', amount: 0.25, smooth: 0, mode: 'flipOnBeat', flipSlew: 0.2 } },
    };
    // Initial frame without beat: polarity = +1
    const f0 = runner.resolve('F', s, [zoom, rotate], inputs({ timeSec: 0, frame: frame({ frameIndex: 1, norm: { sub: 0.5, mid: 0, high: 0 } }) }), 10);
    // zoom: 1.0 + (0 + 0.5*0.4*0.5)*1 = 1.1; rotate: 0 + (0.1 + 0.25*2*0.5)*1 = 0.35
    expect(f0.zoom as number).toBeCloseTo(1.1, 3);
    expect(f0.rotate as number).toBeCloseTo(0.35, 3);

    // Beat triggers flip target -> -1; dt=0.1s with flipSlew=0.2s moves current by (2/0.2)*0.1 = 1.0 -> current = 0.0
    const f1 = runner.resolve('F', s, [zoom, rotate], inputs({ timeSec: 0.1, frame: frame({ frameIndex: 2, kickPulse: true, norm: { sub: 0.5, mid: 0, high: 0 } }) }), 0.1);
    expect(f1.zoom as number).toBeCloseTo(1.0, 3);
    expect(f1.rotate as number).toBeCloseTo(0.0, 3);

    // Another dt=0.1s completes slew to -1
    const f2 = runner.resolve('F', s, [zoom, rotate], inputs({ timeSec: 0.2, frame: frame({ frameIndex: 3, kickPulse: false, norm: { sub: 0.5, mid: 0, high: 0 } }) }), 0.1);
    expect(f2.zoom as number).toBeCloseTo(0.9, 3);
    expect(f2.rotate as number).toBeCloseTo(-0.35, 3);
  });

  it('flipOnDrop and flipOnSection flip on contrast edges', () => {
    const runner = new LinkRunner();
    const s: Settings = {
      rotate: { value: 0, link: { source: 'sub', amount: 0.5, smooth: 0, mode: 'flipOnDrop', flipSlew: 0.1 } },
      zoom: { value: 1, link: { source: 'sub', amount: 0.5, smooth: 0, mode: 'flipOnSection', flipSlew: 0.1 } },
    };
    const init = runner.resolve('F', s, [rotate, zoom], inputs({ timeSec: 0, sectionContrast: 0, frame: frame({ frameIndex: 1, norm: { sub: 1, mid: 0, high: 0 } }) }), 10);
    expect(init.rotate as number).toBeCloseTo(1.0, 3);
    expect(init.zoom as number).toBeCloseTo(1.2, 3);

    // sectionContrast >= 0.22 triggers both dropEdge (>=0.18) and sectionEdge (>=0.22)
    const flipped = runner.resolve('F', s, [rotate, zoom], inputs({ timeSec: 1, sectionContrast: 0.25, frame: frame({ frameIndex: 2, norm: { sub: 1, mid: 0, high: 0 } }) }), 0.2);
    expect(flipped.rotate as number).toBeCloseTo(-1.0, 3);
    expect(flipped.zoom as number).toBeCloseTo(0.8, 3);
  });

  it('enforces normalized minBound / maxBound even if reversed', () => {
    const runner = new LinkRunner();
    const s: Settings = {
      zoom: { value: 1.0, link: { source: 'sub', amount: 1, smooth: 0, minBound: 0.75, maxBound: 0.25 } },
    };
    // span 0.4, min 0.8 -> [0.9, 1.1]
    const out = runner.resolve('F', s, [zoom], inputs({ frame: frame({ norm: { sub: 1, mid: 0, high: 0 } }) }), 10);
    expect(out.zoom as number).toBeCloseTo(1.1, 4);
  });

  it('applies calm damping (0.35x normal, 0.2x intense)', () => {
    const runner = new LinkRunner();
    const s: Settings = {
      rotate: { value: 0, link: { source: 'sub', amount: 0.5, smooth: 0 } },
      flash: { value: 0, link: { source: 'sub', amount: 1.0, smooth: 0 } },
    };
    const out = runner.resolve('F', s, [rotate, flash], inputs({ calm: true, frame: frame({ norm: { sub: 1, mid: 0, high: 0 } }) }), 10);
    // rotate: 0 + (0.5 * 0.35) * 2 * 1 = 0.35
    expect(out.rotate as number).toBeCloseTo(0.35, 4);
    // flash (intense): 0 + (1.0 * 0.2) * 1 * 1 = 0.20
    expect(out.flash as number).toBeCloseTo(0.2, 4);
  });

  it('exposes resolvedByKey for linked and morph-only settings and resets on clear()', () => {
    const runner = new LinkRunner();
    const s: Settings = {
      zoom: { value: 1, link: { source: 'sub', amount: 0.5, smooth: 0 } },
      rotate: { value: 0, morph: { to: 0.5, rate: 0.5 } },
    };
    runner.resolve('F', s, [zoom, rotate], inputs({ timeSec: 1, frame: frame({ frameIndex: 1, kickPulse: true }) }), 10);
    expect(runner.resolvedByKey('F.zoom')).toBeCloseTo(1.12, 3);
    expect(runner.resolvedByKey('F.rotate')).toBeCloseTo(0.5, 4);
    expect(runner.meterByKey('F.zoom')).toBeCloseTo(0.6, 3);

    runner.clear();
    expect(runner.resolvedByKey('F.zoom')).toBeUndefined();
    expect(runner.resolvedByKey('F.rotate')).toBeUndefined();
    expect(runner.meterByKey('F.zoom')).toBeUndefined();
  });
});

describe('linkedEnum (13.5)', () => {
  const modeSpec: ParamSpec = {
    type: 'enum',
    name: 'warpMode',
    label: 'Warp Mode',
    group: 'G',
    default: 'none',
    options: ['none', 'curl', 'radial', 'mobius'],
  };

  it('steps through options on section, drop, and beat triggers with cooldown and calm 2x cooldown', () => {
    const runner = new LinkRunner();
    const sBeat: Settings = {
      warpMode: {
        value: 'none',
        link: { source: 'beat', amount: 0.5, smooth: 0, cooldownSec: 4 },
      },
    };

    // Frame 1: no beat -> stays at 'none'
    const r0 = runner.resolve('F', sBeat, [modeSpec], inputs({ timeSec: 0, frame: frame({ frameIndex: 1 }) }), 0.016);
    expect(r0.warpMode).toBe('none');
    expect(runner.resolvedStringByKey('F.warpMode')).toBe('none');
    expect(runner.resolvedByKey('F.warpMode')).toBeUndefined();

    // Frame 2: beat at t=1 -> switches to 'curl'
    const r1 = runner.resolve('F', sBeat, [modeSpec], inputs({ timeSec: 1, frame: frame({ frameIndex: 2, kickPulse: true }) }), 0.016);
    expect(r1.warpMode).toBe('curl');
    expect(runner.resolvedStringByKey('F.warpMode')).toBe('curl');

    // Release beat, then another beat at t=3 (< 4s cooldown) -> blocked
    runner.resolve('F', sBeat, [modeSpec], inputs({ timeSec: 2, frame: frame({ frameIndex: 3, kickPulse: false }) }), 0.016);
    const rBlocked = runner.resolve('F', sBeat, [modeSpec], inputs({ timeSec: 3, frame: frame({ frameIndex: 4, kickPulse: true }) }), 0.016);
    expect(rBlocked.warpMode).toBe('curl');

    // Release beat, then beat at t=6 in calm mode (cooldown = 4 * 2 = 8s -> 6 - 1 = 5 < 8 -> blocked)
    runner.resolve('F', sBeat, [modeSpec], inputs({ timeSec: 5, calm: true, frame: frame({ frameIndex: 5, kickPulse: false }) }), 0.016);
    const rCalmBlocked = runner.resolve('F', sBeat, [modeSpec], inputs({ timeSec: 6, calm: true, frame: frame({ frameIndex: 6, kickPulse: true }) }), 0.016);
    expect(rCalmBlocked.warpMode).toBe('curl');

    // Release beat, then beat at t=9 in calm mode (9 - 1 = 8 >= 8 -> switches to 'radial')
    runner.resolve('F', sBeat, [modeSpec], inputs({ timeSec: 8, calm: true, frame: frame({ frameIndex: 7, kickPulse: false }) }), 0.016);
    const rCalmAllowed = runner.resolve('F', sBeat, [modeSpec], inputs({ timeSec: 9, calm: true, frame: frame({ frameIndex: 8, kickPulse: true }) }), 0.016);
    expect(rCalmAllowed.warpMode).toBe('radial');

    // clear() resets string and enum state
    runner.clear();
    expect(runner.resolvedStringByKey('F.warpMode')).toBeUndefined();
    const rAfterClear = runner.resolve('F', sBeat, [modeSpec], inputs({ timeSec: 10, frame: frame({ frameIndex: 9 }) }), 0.016);
    expect(rAfterClear.warpMode).toBe('none');
  });

  it('supports section and drop triggers, enumOptions subset, and negative step', () => {
    const runner = new LinkRunner();
    const sDrop: Settings = {
      warpMode: {
        value: 'curl',
        link: {
          source: 'drop',
          amount: -0.5,
          smooth: 0,
          cooldownSec: 1,
          enumOptions: ['curl', 'mobius', 'invalidOption'],
        },
      },
    };
    const sSection: Settings = {
      warpMode: {
        value: 'none',
        link: { source: 'section', amount: 0.5, smooth: 0, cooldownSec: 1 },
      },
    };

    // Initial seed
    expect(runner.resolve('D', sDrop, [modeSpec], inputs({ timeSec: 0, sectionContrast: 0, frame: frame({ frameIndex: 1 }) }), 0.016).warpMode).toBe('curl');
    expect(runner.resolve('S', sSection, [modeSpec], inputs({ timeSec: 0, sectionContrast: 0, frame: frame({ frameIndex: 1 }) }), 0.016).warpMode).toBe('none');

    // sectionContrast = 0.25 fires both dropEdge and sectionEdge; D steps backward through ['curl', 'mobius'] -> 'mobius'
    expect(runner.resolve('D', sDrop, [modeSpec], inputs({ timeSec: 2, sectionContrast: 0.25, frame: frame({ frameIndex: 2 }) }), 0.016).warpMode).toBe('mobius');
    expect(runner.resolve('S', sSection, [modeSpec], inputs({ timeSec: 2, sectionContrast: 0.25, frame: frame({ frameIndex: 2 }) }), 0.016).warpMode).toBe('curl');
  });

  it('triggers phrase16 on 8s time buckets before first beat, then every 16th beat after beats arrive', () => {
    const runner = new LinkRunner();
    const sPhrase: Settings = {
      warpMode: {
        value: 'none',
        link: { source: 'phrase16', amount: 0.5, smooth: 0, cooldownSec: 1 },
      },
    };

    // t=0 seeds bucket 0 -> stays 'none'
    expect(runner.resolve('P', sPhrase, [modeSpec], inputs({ timeSec: 0, frame: frame({ frameIndex: 1 }) }), 0.016).warpMode).toBe('none');
    // t=8 changes bucket to 1 -> switches to 'curl'
    expect(runner.resolve('P', sPhrase, [modeSpec], inputs({ timeSec: 8, frame: frame({ frameIndex: 2 }) }), 0.016).warpMode).toBe('curl');

    // Feed 16 beats; only the 16th beat should trigger a switch to 'radial'
    let t = 10;
    let frameIdx = 3;
    for (let b = 1; b <= 16; b++) {
      const res = runner.resolve('P', sPhrase, [modeSpec], inputs({ timeSec: t, frame: frame({ frameIndex: frameIdx++, kickPulse: true }) }), 0.016);
      if (b < 16) expect(res.warpMode).toBe('curl');
      else expect(res.warpMode).toBe('radial');
      t += 0.2;
      runner.resolve('P', sPhrase, [modeSpec], inputs({ timeSec: t, frame: frame({ frameIndex: frameIdx++, kickPulse: false }) }), 0.016);
      t += 0.2;
    }
  });
});

describe('HSL helpers & linkedColour (13.5)', () => {
  const hueSpec: ParamSpec = { type: 'colour', name: 'colour', label: 'Colour', group: 'G', default: '#ff0000' };
  const intenseColour: ParamSpec = { type: 'colour', name: 'flashCol', label: 'Flash Colour', group: 'G', default: '#ff0000', intense: true };

  it('converts #rrggbb to HSL and back, enforces dark floor, and preserves grayscale/invalid on shiftHexHue', () => {
    const hslRed = hexToHsl('#FF0000');
    expect(hslRed).not.toBeNull();
    expect(hslRed![0]).toBeCloseTo(0, 5);
    expect(hslRed![1]).toBeCloseTo(1, 5);
    expect(hslRed![2]).toBeCloseTo(0.5, 5);
    expect(hexToHsl('not-hex')).toBeNull();

    expect(hslToHex(120, 1, 0.5)).toBe('#00ff00');
    expect(hslToHex(-120, 1, 0.5)).toBe('#0000ff');
    expect(hslToHex(480, 1, 0.5)).toBe('#00ff00');
    expect(hslToHex(200, 1, 0)).toBe('#000000');
    expect(hslToHex(200, 1, 1e-5)).toBe('#000000');

    expect(shiftHexHue('#ff0000', 120)).toBe('#00ff00');
    expect(shiftHexHue('#000000', 120)).toBe('#000000');
    expect(shiftHexHue('#808080', 120)).toBe('#808080');
    expect(shiftHexHue('bad', 120)).toBe('bad');
  });

  it('modulates colour hue in add, bipolar, flipOnBeat, and calm modes and caches resolvedStringByKey', () => {
    const runner = new LinkRunner();
    const sAdd: Settings = {
      colour: { value: '#ff0000', link: { source: 'sub', amount: 0.5, smooth: 0 } },
    };
    // sub = 0.5 -> delta = 0.5 * 360 * 0.5 = 90 deg -> hue 90 (yellow-green #80ff00)
    const outAdd = runner.resolve(
      'C',
      sAdd,
      [hueSpec],
      inputs({ frame: frame({ frameIndex: 1, norm: { sub: 0.5, mid: 0, high: 0 } }) }),
      10,
    );
    expect(outAdd.colour).toBe(hslToHex(90, 1, 0.5));
    expect(runner.resolvedStringByKey('C.colour')).toBe(outAdd.colour);
    expect(runner.resolvedByKey('C.colour')).toBeUndefined();

    // Bipolar at sub = 0 -> modFactor = -1 -> delta = -180 -> cyan #00ffff
    const sBipolar: Settings = {
      colour: { value: '#ff0000', link: { source: 'sub', amount: 0.5, smooth: 0, mode: 'bipolar' } },
    };
    const outBi = runner.resolve(
      'CB',
      sBipolar,
      [hueSpec],
      inputs({ frame: frame({ frameIndex: 2, norm: { sub: 0, mid: 0, high: 0 } }) }),
      10,
    );
    expect(outBi.colour).toBe('#00ffff');

    // flipOnBeat flips hue shift sign after beat + slew
    const sFlip: Settings = {
      colour: { value: '#ff0000', link: { source: 'sub', amount: 1 / 3, smooth: 0, mode: 'flipOnBeat', flipSlew: 0.1 } },
    };
    const fInit = runner.resolve(
      'CF',
      sFlip,
      [hueSpec],
      inputs({ timeSec: 0, frame: frame({ frameIndex: 3, norm: { sub: 1, mid: 0, high: 0 } }) }),
      10,
    );
    expect(fInit.colour).toBe(hslToHex(120, 1, 0.5));

    const fFlipped = runner.resolve(
      'CF',
      sFlip,
      [hueSpec],
      inputs({ timeSec: 0.2, frame: frame({ frameIndex: 4, kickPulse: true, norm: { sub: 1, mid: 0, high: 0 } }) }),
      0.2,
    );
    expect(fFlipped.colour).toBe(hslToHex(240, 1, 0.5));

    // Calm damping: normal = 0.35x, intense = 0.2x
    const sCalm: Settings = {
      colour: { value: '#ff0000', link: { source: 'sub', amount: 1, smooth: 0 } },
      flashCol: { value: '#ff0000', link: { source: 'sub', amount: 1, smooth: 0 } },
    };
    const outCalm = runner.resolve(
      'CC',
      sCalm,
      [hueSpec, intenseColour],
      inputs({ calm: true, frame: frame({ frameIndex: 5, norm: { sub: 1, mid: 0, high: 0 } }) }),
      10,
    );
    expect(outCalm.colour).toBe(hslToHex(0.35 * 360, 1, 0.5));
    expect(outCalm.flashCol).toBe(hslToHex(0.2 * 360, 1, 0.5));

    runner.clear();
    expect(runner.resolvedStringByKey('C.colour')).toBeUndefined();
  });
});
