// Preset thumbnails (Slice 21.6). A small JPEG of the canvas is captured THUMB_DELAY_MS after a preset becomes the
// one on screen, and kept in localStorage under a size cap. The pixel read happens only in the one frame that a
// capture is due. Normal playback frames only check a flag (captureIfDue) and never read pixels.
// The pure parts (store, cap, capture timing) take injected storage, timers and encoder, so they run under Vitest's
// node environment.

export const THUMB_WIDTH = 160;
export const THUMB_HEIGHT = 90;
export const THUMB_DELAY_MS = 3000;
export const THUMB_QUALITY = 0.7;
/** Largest single thumbnail (its data URL, in characters). A 160x90 JPEG is far below this. */
export const THUMB_MAX_BYTES = 30_000;
/** Everything the thumbnail store may hold together. Oldest thumbnails are dropped first. */
export const THUMB_MAX_TOTAL_BYTES = 1_000_000;
export const THUMB_STORAGE_KEY = 'mv.preset-thumbnails.v1';
export const THUMB_DATA_PREFIX = 'data:image/jpeg;base64,';

interface StoredThumb {
  id: string;
  url: string;
}

type ThumbStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface ThumbnailStore {
  get(id: string): string | undefined;
  /** Stores a thumbnail. Returns false (and stores nothing) when it is over the size cap or storage refuses it. */
  put(id: string, dataUrl: string): boolean;
  remove(id: string): void;
  totalBytes(): number;
}

function isStoredThumb(v: unknown): v is StoredThumb {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.url === 'string' && o.url.startsWith(THUMB_DATA_PREFIX);
}

/**
 * A thumbnail store over a Storage object. The list is kept oldest first, so eviction is a shift. A corrupt or
 * missing entry reads as empty, so the browser falls back to the placeholder instead of failing.
 */
export function createThumbnailStore(
  storage: ThumbStorage,
  opts: { key?: string; maxBytes?: number; maxTotalBytes?: number } = {},
): ThumbnailStore {
  const key = opts.key ?? THUMB_STORAGE_KEY;
  const maxBytes = opts.maxBytes ?? THUMB_MAX_BYTES;
  const maxTotal = opts.maxTotalBytes ?? THUMB_MAX_TOTAL_BYTES;

  const read = (): StoredThumb[] => {
    try {
      const raw = storage.getItem(key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isStoredThumb) : [];
    } catch {
      return [];
    }
  };
  const sizeOf = (items: StoredThumb[]): number => items.reduce((sum, i) => sum + i.url.length, 0);
  const write = (items: StoredThumb[]): boolean => {
    try {
      storage.setItem(key, JSON.stringify(items));
      return true;
    } catch {
      return false;
    }
  };

  return {
    get(id) {
      return read().find((i) => i.id === id)?.url;
    },
    put(id, dataUrl) {
      if (!dataUrl.startsWith(THUMB_DATA_PREFIX) || dataUrl.length > maxBytes) return false;
      const items = read().filter((i) => i.id !== id);
      items.push({ id, url: dataUrl });
      while (items.length > 1 && sizeOf(items) > maxTotal) items.shift();
      return write(items);
    },
    remove(id) {
      write(read().filter((i) => i.id !== id));
    },
    totalBytes() {
      return sizeOf(read());
    },
  };
}

/** The app's store, or null where there is no localStorage (tests, private modes that throw). */
export function defaultThumbnailStore(): ThumbnailStore | null {
  try {
    const storage = (globalThis as { localStorage?: ThumbStorage }).localStorage;
    return storage ? createThumbnailStore(storage) : null;
  } catch {
    return null;
  }
}

/** Thumbnail for a preset id, or undefined when none exists. The browser shows a placeholder for undefined. */
export function thumbnailFor(id: string): string | undefined {
  return defaultThumbnailStore()?.get(id);
}

/** Placeholder text for a preset with no thumbnail: up to two initials of its name. */
export function thumbnailFallbackLabel(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

/** Draws the source at THUMB_WIDTH x THUMB_HEIGHT and returns a JPEG data URL, or null if no 2D context. */
export function encodeCanvasThumbnail(source: CanvasImageSource): string | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  const url = canvas.toDataURL('image/jpeg', THUMB_QUALITY);
  return url.startsWith(THUMB_DATA_PREFIX) ? url : null;
}

export interface ThumbnailCaptureOptions {
  store: ThumbnailStore;
  delayMs?: number;
  encode?: (source: CanvasImageSource) => string | null;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Schedules one capture per activation. arm(id) starts the timer for the preset now on screen and drops any
 * earlier one. When the timer fires, the next captureIfDue() call (made once per frame by the compositor) reads
 * the canvas. Until then captureIfDue() only checks a flag and reads no pixels.
 */
export class ThumbnailCapture {
  private timer: unknown = null;
  private armedId: string | null = null;
  private dueId: string | null = null;
  private readonly delayMs: number;
  private readonly encode: (source: CanvasImageSource) => string | null;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly opts: ThumbnailCaptureOptions) {
    this.delayMs = opts.delayMs ?? THUMB_DELAY_MS;
    this.encode = opts.encode ?? encodeCanvasThumbnail;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Called when preset `id` becomes the one on screen. Re-arming the same id keeps the running timer. */
  arm(id: string): void {
    if (id === this.armedId) return;
    this.cancel();
    this.armedId = id;
    const handle: unknown = this.setTimer(() => {
      // A timer that was cancelled or replaced must not mark its preset due.
      if (this.timer !== handle) return;
      this.timer = null;
      this.dueId = id;
    }, this.delayMs);
    this.timer = handle;
  }

  /** Drops any pending or due capture. */
  cancel(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.armedId = null;
    this.dueId = null;
  }

  isDue(): boolean {
    return this.dueId !== null;
  }

  /**
   * Per-frame hook. Returns immediately unless a capture is due. Then reads `source` once, stores the thumbnail,
   * and returns true when it was stored.
   */
  captureIfDue(source: CanvasImageSource): boolean {
    const id = this.dueId;
    if (id === null) return false;
    this.dueId = null;
    this.armedId = null;
    this.timer = null;
    const url = this.encode(source);
    return url !== null && this.opts.store.put(id, url);
  }
}

/** A capture wired to the app's localStorage store, or null where there is none. */
export function defaultThumbnailCapture(): ThumbnailCapture | null {
  const store = defaultThumbnailStore();
  return store ? new ThumbnailCapture({ store }) : null;
}
