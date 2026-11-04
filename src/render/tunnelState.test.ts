import { describe, expect, it } from 'vitest';
import { BASE_SPEED, BOOST, FlightState, flightRate } from './tunnelState';

describe('flightRate', () => {
  it('is never negative, even for out-of-range energy', () => {
    for (const energy of [-5, -0.1, 0, 0.08, 0.5, 1, 3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(flightRate(energy, false)).toBeGreaterThanOrEqual(0);
      expect(flightRate(energy, true)).toBeGreaterThanOrEqual(0);
    }
  });

  it('rises with energy and clamps energy to 0..1', () => {
    expect(flightRate(0, false)).toBeCloseTo(BASE_SPEED, 10);
    expect(flightRate(1, false)).toBeCloseTo(BASE_SPEED + BOOST, 10);
    expect(flightRate(5, false)).toBeCloseTo(BASE_SPEED + BOOST, 10);
  });

  it('calm rate is below the normal rate at energy 1', () => {
    expect(flightRate(1, true)).toBeLessThan(flightRate(1, false));
  });

  it('calm rate ignores energy', () => {
    expect(flightRate(0, true)).toBeCloseTo(BASE_SPEED * 0.25, 10);
    expect(flightRate(1, true)).toBeCloseTo(BASE_SPEED * 0.25, 10);
  });
});

describe('FlightState', () => {
  it('never decreases while energy swings between 0.08 and 1.0 over 1000 frames', () => {
    const flight = new FlightState();
    let previous = flight.current;
    for (let i = 0; i < 1000; i++) {
      const energy = i % 2 === 0 ? 0.08 : 1.0;
      const phase = flight.advance(0.016, energy, false);
      expect(phase).toBeGreaterThanOrEqual(previous);
      previous = phase;
    }
    expect(previous).toBeGreaterThan(0);
  });

  it('never decreases in calm mode either', () => {
    const flight = new FlightState();
    let previous = 0;
    for (let i = 0; i < 1000; i++) {
      const phase = flight.advance(0.016, i % 3 === 0 ? 1 : 0, true);
      expect(phase).toBeGreaterThanOrEqual(previous);
      previous = phase;
    }
  });

  it('integrates dt times rate, so a louder passage moves further than a quieter one', () => {
    const quiet = new FlightState();
    const loud = new FlightState();
    const quietPhase = quiet.advance(1, 0, false);
    const loudPhase = loud.advance(1, 1, false);
    expect(quietPhase).toBeCloseTo(BASE_SPEED, 10);
    expect(loudPhase).toBeCloseTo(BASE_SPEED + BOOST, 10);
  });

  it('reset returns phase to 0', () => {
    const flight = new FlightState();
    flight.advance(2, 1, false);
    expect(flight.current).toBeGreaterThan(0);
    flight.reset();
    expect(flight.current).toBe(0);
  });
});
