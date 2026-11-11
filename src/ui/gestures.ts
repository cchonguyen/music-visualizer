// Touch gestures for the stage canvas (Slice 21.7). The classifier is pure: it takes pointer samples
// (position and time in ms) and says what they mean. The recognizer wraps it with a double-tap wait.
//   tap          → toggle the controls
//   swipe left   → next preset      swipe right → previous preset
//   double tap   → toggle fullscreen

export interface PointerSample {
  x: number;
  y: number;
  /** Time in ms (performance.now() or event.timeStamp). */
  t: number;
}

export type SwipeDirection = 'left' | 'right';
export type GestureKind = 'tap' | 'swipe-left' | 'swipe-right' | 'none';

export interface GestureThresholds {
  /** A touch that moves at most this far (px) can be a tap. */
  tapMaxMove: number;
  /** A tap must lift within this many ms. */
  tapMaxMs: number;
  /** A swipe must move at least this far horizontally (px). */
  swipeMinDx: number;
  /** A swipe must lift within this many ms. */
  swipeMaxMs: number;
  /** Horizontal movement must be at least this many times the vertical movement. */
  swipeAxisRatio: number;
  /** Second tap must land within this many ms of the first tap's lift. */
  doubleTapMaxGapMs: number;
  /** Second tap must land within this many px of the first tap. */
  doubleTapMaxDist: number;
}

export const DEFAULT_THRESHOLDS: GestureThresholds = {
  tapMaxMove: 10,
  tapMaxMs: 300,
  swipeMinDx: 50,
  swipeMaxMs: 800,
  swipeAxisRatio: 1.5,
  doubleTapMaxGapMs: 300,
  doubleTapMaxDist: 30,
};

/** Classify one touch from its down and up samples. A vertical or diagonal move that is not a swipe is 'none'. */
export function classifyGesture(
  down: PointerSample,
  up: PointerSample,
  limits: GestureThresholds = DEFAULT_THRESHOLDS,
): GestureKind {
  const dx = up.x - down.x;
  const dy = up.y - down.y;
  const dt = up.t - down.t;
  if (dt < 0) return 'none';
  const dist = Math.hypot(dx, dy);
  if (dist <= limits.tapMaxMove && dt <= limits.tapMaxMs) return 'tap';
  const absX = Math.abs(dx);
  if (dt <= limits.swipeMaxMs && absX >= limits.swipeMinDx && absX >= limits.swipeAxisRatio * Math.abs(dy)) {
    return dx < 0 ? 'swipe-left' : 'swipe-right';
  }
  return 'none';
}

/** True when `next` is close enough in time and place to `prev` to count as a double tap. */
export function isDoubleTap(
  prev: PointerSample,
  next: PointerSample,
  limits: GestureThresholds = DEFAULT_THRESHOLDS,
): boolean {
  const gap = next.t - prev.t;
  if (gap < 0 || gap > limits.doubleTapMaxGapMs) return false;
  return Math.hypot(next.x - prev.x, next.y - prev.y) <= limits.doubleTapMaxDist;
}

export interface GestureHandlers {
  onTap: () => void;
  onSwipe: (direction: SwipeDirection) => void;
  onDoubleTap: () => void;
  /** Injectable timers for tests. Default: window.setTimeout / clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  limits?: GestureThresholds;
}

/**
 * Turns touch down/up samples into handler calls. A single tap waits one double-tap window before it fires,
 * so a second tap can cancel it and become a double tap instead.
 */
export class TouchGestureRecognizer {
  private down: PointerSample | null = null;
  private lastTap: PointerSample | null = null;
  private pending: unknown = null;
  private readonly limits: GestureThresholds;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly handlers: GestureHandlers) {
    this.limits = handlers.limits ?? DEFAULT_THRESHOLDS;
    this.setTimer = handlers.setTimer ?? ((fn, ms) => window.setTimeout(fn, ms));
    this.clearTimer = handlers.clearTimer ?? ((h) => window.clearTimeout(h as number));
  }

  pointerDown(sample: PointerSample): void {
    this.down = sample;
  }

  /** Returns the classified gesture for this touch ('none' when there was no matching down). */
  pointerUp(sample: PointerSample): GestureKind {
    const down = this.down;
    this.down = null;
    if (!down) return 'none';
    const kind = classifyGesture(down, sample, this.limits);
    if (kind === 'tap') {
      if (this.lastTap && isDoubleTap(this.lastTap, sample, this.limits)) {
        this.cancelPending();
        this.lastTap = null;
        this.handlers.onDoubleTap();
        return kind;
      }
      this.cancelPending();
      this.lastTap = sample;
      this.pending = this.setTimer(() => {
        this.pending = null;
        this.lastTap = null;
        this.handlers.onTap();
      }, this.limits.doubleTapMaxGapMs);
      return kind;
    }
    if (kind === 'swipe-left' || kind === 'swipe-right') {
      this.cancelPending();
      this.lastTap = null;
      this.handlers.onSwipe(kind === 'swipe-left' ? 'left' : 'right');
    }
    return kind;
  }

  /** Forget any touch in progress (for example when the pointer is cancelled). */
  cancel(): void {
    this.down = null;
  }

  private cancelPending(): void {
    if (this.pending !== null) this.clearTimer(this.pending);
    this.pending = null;
  }
}
