import { describe, it, expect } from 'vitest';
import { LinkRunner, sourceValue, type LinkInputs } from './links';
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
    const morphed: Settings = { zoom: { value: 1, morph: { to: 1.1, rate: 0.5 } } };
    const atStart = new LinkRunner().resolve('M', morphed, [zoom], inputs({ timeSec: 0 }), 0.016);
    const atHalf = new LinkRunner().resolve('M', morphed, [zoom], inputs({ timeSec: 1 }), 0.016);
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
