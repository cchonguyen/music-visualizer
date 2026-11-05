// Freeze mode: holds the picture; a step request draws exactly one frame while frozen.
// Pure logic, no DOM.

/** Time advanced per stepped frame while frozen (one 60 Hz frame). */
export const STEP_DT_SEC = 1 / 60;

export class FrameStepper {
  private frozen = false;
  private pending = 0;

  get isFrozen(): boolean {
    return this.frozen;
  }

  /** Flips freeze on or off. Unfreezing drops any pending steps. Returns the new state. */
  toggle(): boolean {
    this.frozen = !this.frozen;
    if (!this.frozen) this.pending = 0;
    return this.frozen;
  }

  /** Queues one frame to draw. Does nothing while running. */
  requestStep(): void {
    if (this.frozen) this.pending += 1;
  }

  /** True when a frame should be drawn now. While frozen, each true result uses up one pending step. */
  consumeDraw(): boolean {
    if (!this.frozen) return true;
    if (this.pending > 0) {
      this.pending -= 1;
      return true;
    }
    return false;
  }
}
