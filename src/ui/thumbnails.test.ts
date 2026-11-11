import { describe, it, expect } from 'vitest';
import {
  THUMB_DATA_PREFIX,
  THUMB_DELAY_MS,
  THUMB_MAX_BYTES,
  THUMB_MAX_TOTAL_BYTES,
  THUMB_STORAGE_KEY,
  ThumbnailCapture,
  createThumbnailStore,
  thumbnailFallbackLabel,
} from './thumbnails';

/** In-memory Storage stand-in. `refuse` makes setItem throw like a full quota. */
function fakeStorage(opts: { refuse?: boolean } = {}) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.refuse) throw new Error('QuotaExceededError');
      data.set(k, v);
    },
  };
}

const img = (size: number, fill = 'A') => THUMB_DATA_PREFIX + fill.repeat(Math.max(0, size - THUMB_DATA_PREFIX.length));

describe('thumbnail size cap', () => {
  it('refuses a thumbnail over the per-image cap and stores nothing', () => {
    const storage = fakeStorage();
    const store = createThumbnailStore(storage);
    expect(store.put('big', img(THUMB_MAX_BYTES + 1))).toBe(false);
    expect(store.get('big')).toBeUndefined();
    expect(storage.data.has(THUMB_STORAGE_KEY)).toBe(false);
  });

  it('accepts a thumbnail exactly at the per-image cap', () => {
    const store = createThumbnailStore(fakeStorage());
    expect(store.put('edge', img(THUMB_MAX_BYTES))).toBe(true);
  });

  it('refuses anything that is not a JPEG data URL', () => {
    const store = createThumbnailStore(fakeStorage());
    expect(store.put('png', 'data:image/png;base64,AAAA')).toBe(false);
    expect(store.put('plain', 'hello')).toBe(false);
  });

  it('evicts the oldest thumbnails so the total stays under the store cap', () => {
    const store = createThumbnailStore(fakeStorage(), { maxBytes: 10_000, maxTotalBytes: 25_000 });
    for (let i = 0; i < 10; i++) expect(store.put(`p${i}`, img(9_000))).toBe(true);
    expect(store.totalBytes()).toBeLessThanOrEqual(25_000);
    // Newest kept, oldest gone.
    expect(store.get('p9')).toBeDefined();
    expect(store.get('p0')).toBeUndefined();
  });

  it('keeps the default total cap', () => {
    const store = createThumbnailStore(fakeStorage());
    for (let i = 0; i < 60; i++) store.put(`p${i}`, img(THUMB_MAX_BYTES));
    expect(store.totalBytes()).toBeLessThanOrEqual(THUMB_MAX_TOTAL_BYTES);
    expect(store.get('p59')).toBeDefined();
  });

  it('re-putting an id replaces it rather than adding a second copy', () => {
    const store = createThumbnailStore(fakeStorage());
    store.put('a', img(100, 'X'));
    store.put('a', img(200, 'Y'));
    expect(store.get('a')).toBe(img(200, 'Y'));
    expect(store.totalBytes()).toBe(200);
  });

  it('returns false when storage refuses the write (quota)', () => {
    const store = createThumbnailStore(fakeStorage({ refuse: true }));
    expect(store.put('a', img(500))).toBe(false);
  });
});

describe('thumbnail storage round trip', () => {
  it('reads back what was stored, through a new store on the same storage', () => {
    const storage = fakeStorage();
    const url = img(400, 'Q');
    expect(createThumbnailStore(storage).put('preset-1', url)).toBe(true);
    expect(createThumbnailStore(storage).get('preset-1')).toBe(url);
  });

  it('remove drops only the named thumbnail', () => {
    const store = createThumbnailStore(fakeStorage());
    store.put('a', img(100));
    store.put('b', img(100));
    store.remove('a');
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toBeDefined();
  });
});

describe('thumbnail fallback', () => {
  it('returns undefined when no thumbnail exists', () => {
    expect(createThumbnailStore(fakeStorage()).get('nothing')).toBeUndefined();
  });

  it('treats corrupt stored JSON as empty and still accepts new thumbnails', () => {
    const storage = fakeStorage();
    storage.data.set(THUMB_STORAGE_KEY, '{not json');
    const store = createThumbnailStore(storage);
    expect(store.get('a')).toBeUndefined();
    expect(store.put('a', img(100))).toBe(true);
    expect(store.get('a')).toBeDefined();
  });

  it('ignores stored entries with the wrong shape', () => {
    const storage = fakeStorage();
    storage.data.set(THUMB_STORAGE_KEY, JSON.stringify([{ id: 'x', url: 'javascript:alert(1)' }, 42, null]));
    expect(createThumbnailStore(storage).totalBytes()).toBe(0);
  });

  it('labels a preset with up to two initials when it has no thumbnail', () => {
    expect(thumbnailFallbackLabel('Aurora Drift')).toBe('AD');
    expect(thumbnailFallbackLabel('pulse')).toBe('P');
    expect(thumbnailFallbackLabel('  three word name ')).toBe('TW');
    expect(thumbnailFallbackLabel('   ')).toBe('?');
  });
});

describe('ThumbnailCapture scheduling', () => {
  function harness(encode: (src: unknown) => string | null = () => img(300)) {
    const storage = fakeStorage();
    const store = createThumbnailStore(storage);
    const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
    const capture = new ThumbnailCapture({
      store,
      encode: encode as never,
      setTimer: (fn, ms) => {
        const t = { fn, ms, cleared: false };
        timers.push(t);
        return t;
      },
      clearTimer: (h) => {
        (h as { cleared: boolean }).cleared = true;
      },
    });
    return { capture, store, timers };
  }

  it('does not read pixels while nothing is due (normal playback frames)', () => {
    let reads = 0;
    const { capture } = harness(() => {
      reads++;
      return img(300);
    });
    capture.arm('p1');
    for (let frame = 0; frame < 100; frame++) expect(capture.captureIfDue({} as never)).toBe(false);
    expect(reads).toBe(0);
  });

  it('schedules a capture after the delay and stores it once', () => {
    let reads = 0;
    const { capture, store, timers } = harness(() => {
      reads++;
      return img(300, 'Z');
    });
    capture.arm('p1');
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(THUMB_DELAY_MS);
    timers[0]!.fn();
    expect(capture.isDue()).toBe(true);
    expect(reads).toBe(0);
    expect(capture.captureIfDue({} as never)).toBe(true);
    expect(reads).toBe(1);
    expect(store.get('p1')).toBe(img(300, 'Z'));
    expect(capture.captureIfDue({} as never)).toBe(false);
    expect(reads).toBe(1);
  });

  it('re-arming a different preset cancels the earlier timer', () => {
    const { capture, store, timers } = harness();
    capture.arm('p1');
    capture.arm('p2');
    expect((timers[0] as unknown as { cleared: boolean }).cleared).toBe(true);
    timers[0]!.fn(); // a cancelled timer firing late must not capture p1
    timers[1]!.fn();
    capture.captureIfDue({} as never);
    expect(store.get('p1')).toBeUndefined();
    expect(store.get('p2')).toBeDefined();
  });

  it('re-arming the same preset keeps the running timer', () => {
    const { capture, timers } = harness();
    capture.arm('p1');
    capture.arm('p1');
    expect(timers).toHaveLength(1);
  });

  it('a failed encode stores nothing and reports false', () => {
    const { capture, store, timers } = harness(() => null);
    capture.arm('p1');
    timers[0]!.fn();
    expect(capture.captureIfDue({} as never)).toBe(false);
    expect(store.get('p1')).toBeUndefined();
  });

  it('cancel drops a due capture', () => {
    const { capture, timers } = harness();
    capture.arm('p1');
    timers[0]!.fn();
    capture.cancel();
    expect(capture.isDue()).toBe(false);
    expect(capture.captureIfDue({} as never)).toBe(false);
  });
});
