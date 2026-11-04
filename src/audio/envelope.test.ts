import { describe, it, expect } from "vitest";
import { Envelope } from "./envelope";

/** Feed the follower with `value` totalling `durationSec` in small steps. */
function runFor(env: Envelope, value: number, durationSec: number, dtSec: number): number {
  let out = 0;
  const steps = Math.round(durationSec / dtSec);
  for (let i = 0; i < steps; i++) out = env.step(value, dtSec);
  return out;
}

describe("Envelope", () => {
  it("reaches 90% of a sustained step input within 3x attack time", () => {
    const env = new Envelope(10, 250); // attack 10 ms
    const after = runFor(env, 1, 0.03, 0.001); // 30 ms = 3x attack
    expect(after).toBeGreaterThanOrEqual(0.9);
  });

  it("decays to under 10% within 3x release time after the input stops", () => {
    const env = new Envelope(10, 250); // release 250 ms
    runFor(env, 1, 0.2, 0.001); // fully saturated near 1
    const after = runFor(env, 0, 0.75, 0.001); // 750 ms = 3x release
    expect(after).toBeLessThan(0.1);
  });

  it("attacks fast and releases slowly for the same input shape", () => {
    const env = new Envelope(10, 250);
    const afterAttack = runFor(env, 1, 0.05, 0.001); // 50 ms
    expect(afterAttack).toBeGreaterThan(0.95);

    const env2 = new Envelope(10, 250);
    runFor(env2, 1, 0.2, 0.001);
    const afterRelease50 = runFor(env2, 0, 0.05, 0.001); // same 50 ms of decay
    expect(afterRelease50).toBeLessThan(0.9); // far slower than the attack path
  });

  it("changes nothing when dt is 0", () => {
    const env = new Envelope(10, 250);
    const first = env.step(1, 0.01);
    expect(env.step(0, 0)).toBe(first);
    expect(env.step(1, 0)).toBe(first);
  });

  it("reset returns the follower to zero", () => {
    const env = new Envelope(10, 250);
    runFor(env, 1, 0.2, 0.001);
    env.reset();
    expect(env.step(0, 0.001)).toBeLessThan(0.01);
  });
});
