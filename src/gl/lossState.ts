// Pure GPU context-loss state. Lets loss and restore logic be tested without WebGL.

export type LossEvent = 'lost' | 'restored';

export class ContextLossState {
  private lost = false;

  get isLost(): boolean {
    return this.lost;
  }

  /** Returns 'lost' only on the transition from live to lost. */
  markLost(): LossEvent | null {
    if (this.lost) return null;
    this.lost = true;
    return 'lost';
  }

  /** Returns 'restored' only on the transition from lost to live. */
  markRestored(): LossEvent | null {
    if (!this.lost) return null;
    this.lost = false;
    return 'restored';
  }
}
