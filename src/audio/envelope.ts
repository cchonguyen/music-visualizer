// NOTE(spec): The spec's "Defaults: attack 10 ms, release 250 ms" is interpreted as
// convenience constants (DEFAULT_ATTACK_MS / DEFAULT_RELEASE_MS) exported for callers;
// the constructor keeps the two required parameters exactly as specified.

/**
 * Asymmetric envelope follower: fast attack, slow release.
 * Per-step coefficient is 1 - exp(-dt / tau), where tau is the attack time
 * constant when the input is rising and the release constant otherwise.
 */
export const DEFAULT_ATTACK_MS = 10;
export const DEFAULT_RELEASE_MS = 250;

export class Envelope {
  private attackMs: number;
  private releaseMs: number;
  private value = 0;

  constructor(attackMs: number, releaseMs: number) {
    this.attackMs = attackMs;
    this.releaseMs = releaseMs;
  }

  /** Advance the envelope with `input` over `dtSec` seconds, return the new value. */
  step(input: number, dtSec: number): number {
    if (dtSec <= 0) return this.value; // no time elapsed -> no movement
    const tauMs = input > this.value ? this.attackMs : this.releaseMs;
    const tau = tauMs / 1000;
    const coef = 1 - Math.exp(-dtSec / tau);
    this.value += coef * (input - this.value);
    return this.value;
  }

  /** Reset the follower to zero (e.g. on audio restart). */
  reset(): void {
    this.value = 0;
  }
}
