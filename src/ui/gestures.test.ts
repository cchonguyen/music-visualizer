import { describe, it, expect, vi } from 'vitest';
import { classifyGesture, isDoubleTap, TouchGestureRecognizer, DEFAULT_THRESHOLDS } from './gestures';

const at = (x: number, y: number, t: number) => ({ x, y, t });

describe('classifyGesture', () => {
  it('classifies a still touch as a tap', () => {
    expect(classifyGesture(at(100, 100, 0), at(102, 101, 120))).toBe('tap');
  });

  it('does not call a long press a tap', () => {
    expect(classifyGesture(at(100, 100, 0), at(100, 100, 600))).toBe('none');
  });

  it('classifies a fast horizontal move to the left as swipe-left', () => {
    expect(classifyGesture(at(300, 200, 0), at(200, 205, 250))).toBe('swipe-left');
  });

  it('classifies a fast horizontal move to the right as swipe-right', () => {
    expect(classifyGesture(at(100, 200, 0), at(220, 190, 300))).toBe('swipe-right');
  });

  it('does not treat a short horizontal move as a swipe', () => {
    expect(classifyGesture(at(100, 200, 0), at(130, 200, 200))).toBe('none');
  });

  it('does not treat a slow horizontal drag as a swipe', () => {
    expect(classifyGesture(at(100, 200, 0), at(300, 200, 2000))).toBe('none');
  });

  it('ignores a vertical move (not a swipe)', () => {
    expect(classifyGesture(at(150, 100, 0), at(152, 300, 250))).toBe('none');
    expect(classifyGesture(at(150, 300, 0), at(150, 100, 250))).toBe('none');
  });

  it('ignores a diagonal move that is not clearly horizontal', () => {
    expect(classifyGesture(at(100, 100, 0), at(160, 160, 200))).toBe('none');
  });

  it('returns none for a negative time span', () => {
    expect(classifyGesture(at(0, 0, 500), at(0, 0, 100))).toBe('none');
  });
});

describe('isDoubleTap', () => {
  it('accepts a second tap within the gap and distance limits', () => {
    expect(isDoubleTap(at(100, 100, 0), at(104, 102, 250))).toBe(true);
  });

  it('accepts a second tap exactly at the gap limit', () => {
    expect(isDoubleTap(at(100, 100, 0), at(100, 100, DEFAULT_THRESHOLDS.doubleTapMaxGapMs))).toBe(true);
  });

  it('rejects a second tap after the gap limit', () => {
    expect(isDoubleTap(at(100, 100, 0), at(100, 100, DEFAULT_THRESHOLDS.doubleTapMaxGapMs + 1))).toBe(false);
  });

  it('rejects a second tap that lands too far away', () => {
    expect(isDoubleTap(at(100, 100, 0), at(180, 100, 200))).toBe(false);
  });

  it('rejects a second tap with an earlier timestamp', () => {
    expect(isDoubleTap(at(100, 100, 500), at(100, 100, 400))).toBe(false);
  });
});

describe('TouchGestureRecognizer', () => {
  function setup() {
    const timers: { fn: () => void; ms: number; id: number; cleared: boolean }[] = [];
    const handlers = {
      onTap: vi.fn(),
      onSwipe: vi.fn(),
      onDoubleTap: vi.fn(),
    };
    const rec = new TouchGestureRecognizer({
      ...handlers,
      setTimer: (fn, ms) => {
        const entry = { fn, ms, id: timers.length, cleared: false };
        timers.push(entry);
        return entry;
      },
      clearTimer: (h) => {
        (h as { cleared: boolean }).cleared = true;
      },
    });
    const tap = (x: number, t: number) => {
      rec.pointerDown(at(x, 100, t));
      return rec.pointerUp(at(x, 100, t + 40));
    };
    const fireDueTimers = () => {
      for (const entry of timers) {
        if (entry.cleared) continue;
        entry.cleared = true; // each timer runs once
        entry.fn();
      }
    };
    return { rec, handlers, tap, fireDueTimers, timers };
  }

  it('fires a single tap only after the double-tap window passes', () => {
    const { rec, handlers, tap, fireDueTimers } = setup();
    expect(tap(100, 0)).toBe('tap');
    expect(handlers.onTap).not.toHaveBeenCalled();
    fireDueTimers();
    expect(handlers.onTap).toHaveBeenCalledTimes(1);
    expect(handlers.onDoubleTap).not.toHaveBeenCalled();
    void rec;
  });

  it('turns two quick taps into one double tap and no single tap', () => {
    const { handlers, tap, fireDueTimers } = setup();
    tap(100, 0);
    tap(102, 150);
    fireDueTimers();
    expect(handlers.onDoubleTap).toHaveBeenCalledTimes(1);
    expect(handlers.onTap).not.toHaveBeenCalled();
  });

  it('treats two taps far apart in time as two single taps', () => {
    const { handlers, tap, fireDueTimers } = setup();
    tap(100, 0);
    fireDueTimers();
    tap(100, 1000);
    fireDueTimers();
    expect(handlers.onTap).toHaveBeenCalledTimes(2);
    expect(handlers.onDoubleTap).not.toHaveBeenCalled();
  });

  it('fires a swipe at once and cancels a pending tap', () => {
    const { rec, handlers, tap, fireDueTimers } = setup();
    tap(100, 0);
    rec.pointerDown(at(300, 100, 2000));
    expect(rec.pointerUp(at(200, 100, 2200))).toBe('swipe-left');
    expect(handlers.onSwipe).toHaveBeenCalledWith('left');
    fireDueTimers();
    expect(handlers.onTap).not.toHaveBeenCalled();
  });

  it('reports none when there was no matching pointer down', () => {
    const { rec, handlers } = setup();
    expect(rec.pointerUp(at(0, 0, 10))).toBe('none');
    expect(handlers.onTap).not.toHaveBeenCalled();
  });
});
