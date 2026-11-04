import { describe, it, expect } from "vitest";
import { binForFrequency, bandLevel, computeBands, byteSpectrumToUnit } from "./bands";

describe("binForFrequency", () => {
  it("maps 120 Hz to different bins at 44.1 kHz and 48 kHz", () => {
    const bin44 = binForFrequency(120, 44100, 2048);
    const bin48 = binForFrequency(120, 48000, 2048);

    // 120 * 2048 / 44100 = 5.57 -> 6; 120 * 2048 / 48000 = 5.12 -> 5.
    expect(bin44).toBe(6);
    expect(bin48).toBe(5);
    expect(bin44).not.toBe(bin48);
  });

  it("clamps to the first bin", () => {
    expect(binForFrequency(-50, 48000, 4096)).toBe(0);
  });

  it("clamps to the top usable bin", () => {
    const lastBin = 4096 / 2 - 1;
    expect(binForFrequency(1_000_000, 48000, 4096)).toBe(lastBin);
    expect(binForFrequency(24000, 48000, 4096)).toBe(lastBin);
  });
});

describe("bandLevel", () => {
  it("averages only the bins in the requested range", () => {
    const spectrum = new Float32Array(16);
    spectrum[2] = 0.6;
    spectrum[3] = 0.4;

    // At 48 kHz / fftSize 32, each bin is 1500 Hz; half-open [3 kHz, 6 kHz) is bins 2-3.
    const level = bandLevel(spectrum, 3000, 6000, 48000, 32);
    expect(level).toBeCloseTo(0.5, 6);
  });

  it("returns zero for an empty spectrum", () => {
    expect(bandLevel(new Float32Array(0), 0, 120, 48000, 4096)).toBe(0);
  });

  it("does not read past the clamped top bin", () => {
    const fftSize = 4096;
    const spectrum = new Float32Array(fftSize / 2);
    spectrum[fftSize / 2 - 1] = 1;

    // Both edges are above the 24 kHz Nyquist and clamp to the same last bin.
    expect(bandLevel(spectrum, 30000, 40000, 48000, fftSize)).toBe(1);
  });
});

describe("computeBands", () => {
  it("puts a low bin only in sub at 48 kHz / 4096", () => {
    const fftSize = 4096;
    const spectrum = new Float32Array(fftSize / 2);
    spectrum[2] = 1; // ~23.4 Hz, well inside sub

    const bands = computeBands(spectrum, 48000, fftSize);
    expect(bands.sub).toBeGreaterThan(0);
    expect(bands.mid).toBe(0);
    expect(bands.high).toBe(0);
  });

  it("returns all zeros for an empty spectrum", () => {
    expect(computeBands(new Float32Array(0), 48000, 4096)).toEqual({
      sub: 0,
      mid: 0,
      high: 0,
    });
  });

  it("returns all zeros for a silent spectrum", () => {
    expect(computeBands(new Float32Array(2048), 44100, 4096)).toEqual({
      sub: 0,
      mid: 0,
      high: 0,
    });
  });

  it("reads energy in the top bin as high-band energy", () => {
    const fftSize = 4096;
    const spectrum = new Float32Array(fftSize / 2);
    spectrum[fftSize / 2 - 1] = 1;

    // At 16 kHz the 10 kHz edge is above Nyquist, so the high band clamps to
    // and includes the last usable bin.
    const bands = computeBands(spectrum, 16000, fftSize);
    expect(bands.sub).toBe(0);
    expect(bands.mid).toBe(0);
    expect(bands.high).toBeGreaterThan(0);
  });
});

describe("byteSpectrumToUnit", () => {
  it("divides each byte by 255", () => {
    const src = new Uint8Array([0, 127, 255]);
    const out = new Float32Array(3);

    byteSpectrumToUnit(src, out);

    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(127 / 255, 6);
    expect(out[2]).toBe(1);
  });

  it("only writes the overlapping prefix", () => {
    const src = new Uint8Array([255, 255, 255]);
    const out = new Float32Array(2);

    byteSpectrumToUnit(src, out);

    expect(Array.from(out)).toEqual([1, 1]);
  });
});

describe("band ranges do not overlap", () => {
  it("puts a single bin into exactly one band", () => {
    const fftSize = 4096, sr = 48000;
    const boundary = binForFrequency(120, sr, fftSize);
    const spec = new Float32Array(fftSize / 2);
    spec[boundary] = 1;
    const b = computeBands(spec, sr, fftSize);
    expect([b.sub, b.mid, b.high].filter((v) => v > 0).length).toBe(1);
  });
});
