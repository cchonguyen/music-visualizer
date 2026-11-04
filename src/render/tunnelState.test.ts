import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED,
  BOOST,
  BendState,
  bendOffset,
  BEND_X,
  BEND_Y,
  FlightState,
  flightRate,
  ROLL_BASE,
  ROLL_ENERGY,
  RollState,
  rollRate,
  wrapAngle,
} from './tunnelState';

const TAU = 2 * Math.PI;

describe('rollRate', () => {
  it('is never negative, even for out-of-range energy', () => {
    for (const energy of [-5, 0, 1, 3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rollRate(energy, false)).toBeGreaterThanOrEqual(0);
      expect(rollRate(energy, true)).toBeGreaterThanOrEqual(0);
    }
  });

  it('rises with energy and clamps energy to 0..1', () => {
    expect(rollRate(0, false)).toBeCloseTo(ROLL_BASE, 10);
    expect(rollRate(1, false)).toBeCloseTo(ROLL_BASE + ROLL_ENERGY, 10);
    expect(rollRate(5, false)).toBeCloseTo(ROLL_BASE + ROLL_ENERGY, 10);
  });

  it('calm rate ignores energy (no speed-up)', () => {
    expect(rollRate(0, true)).toBeCloseTo(ROLL_BASE, 10);
    expect(rollRate(1, true)).toBeCloseTo(ROLL_BASE, 10);
  });
});

describe('wrapAngle', () => {
  it('keeps angles in [0, 2π) and maps non-finite input to 0', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(TAU + 0.5)).toBeCloseTo(0.5, 10);
    expect(wrapAngle(-0.5)).toBeCloseTo(TAU - 0.5, 10);
    expect(wrapAngle(Number.NaN)).toBe(0);
    expect(wrapAngle(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('RollState', () => {
  it('integrates dt times rate and stays in [0, 2π)', () => {
    const roll = new RollState();
    expect(roll.advance(1, 0, false)).toBeCloseTo(ROLL_BASE, 10);
    for (let i = 0; i < 100000; i++) {
      const angle = roll.advance(0.016, 1, false);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(TAU);
    }
  });

  it('ignores negative and non-finite dt (no backward roll)', () => {
    const roll = new RollState();
    roll.advance(1, 0, false);
    const before = roll.current;
    expect(roll.advance(-5, 1, false)).toBeCloseTo(before, 10);
    expect(roll.advance(Number.NaN, 1, false)).toBeCloseTo(before, 10);
  });

  it('reset returns the angle to 0', () => {
    const roll = new RollState();
    roll.advance(2, 1, false);
    roll.reset();
    expect(roll.current).toBe(0);
  });
});

describe('bendOffset', () => {
  it('is zero in calm mode', () => {
    expect(bendOffset(1.2, 1, true)).toEqual({ x: 0, y: 0 });
  });

  it('stays inside the figure-eight bounds, scaled by mid', () => {
    const bend = new BendState();
    for (let i = 0; i < 1000; i++) {
      const { x, y } = bendOffset(bend.advance(0.05), 1, false);
      expect(Math.abs(x)).toBeLessThanOrEqual(BEND_X + 1e-12);
      expect(Math.abs(y)).toBeLessThanOrEqual(BEND_Y + 1e-12);
    }
  });

  it('is zero when mid is zero or not finite', () => {
    expect(bendOffset(1.2, 0, false)).toEqual({ x: 0, y: 0 });
    expect(bendOffset(1.2, Number.NaN, false)).toEqual({ x: 0, y: 0 });
  });
});

describe('BendState', () => {
  it('reaches half a cycle (pi) after 5 seconds at 0.1 Hz', () => {
    const bend = new BendState();
    expect(bend.advance(5)).toBeCloseTo(Math.PI, 6);
  });
});

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

describe('flightRate scale (P4 section contrast)', () => {
  it('multiplies the normal rate by the scale', () => {
    expect(flightRate(0.5, false, 1.5)).toBeCloseTo(flightRate(0.5, false) * 1.5, 10);
    expect(flightRate(0.5, false, 0.5)).toBeCloseTo(flightRate(0.5, false) * 0.5, 10);
  });

  it('stays positive for a scale from 0.5 to 1.5', () => {
    expect(flightRate(0, false, 0.5)).toBeGreaterThan(0);
  });

  it('ignores the scale in calm mode', () => {
    expect(flightRate(1, true, 1.5)).toBeCloseTo(BASE_SPEED * 0.25, 10);
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
