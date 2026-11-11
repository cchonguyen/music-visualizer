// Shader program cache (Stage 16, Slice 16.2). One compiled program per distinct pair of shader
// sources, shared by every scene on a context. Scenes used to compile the same feedback and blit
// programs again on every init, and threw them away when a scene was disposed.
//
// Programs stay in the cache after the last scene lets go of them (up to `maxIdle` of them, oldest
// first out), so switching back to a preset already seen compiles nothing.
//
// `prewarm` starts a compile in the background (KHR_parallel_shader_compile where present) so a
// program can be ready before it is needed; `isReady` polls it.
import { finishProgram, isProgramComplete, startProgram, type PendingProgram } from './shader';

interface Entry {
  key: string;
  name: string;
  /** Set while the compile is started but not yet finished. */
  pending: PendingProgram | null;
  program: WebGLProgram;
  refs: number;
  /** Increases on each use; the idle entry with the lowest value is evicted first. */
  lastUsed: number;
}

export interface ProgramCacheStats {
  entries: number;
  hits: number;
  misses: number;
}

/** Programs with no user that are kept for reuse. */
export const DEFAULT_MAX_IDLE = 24;

const keyOf = (vertSrc: string, fragSrc: string): string => `${vertSrc}\u0000${fragSrc}`;

export class ProgramCache {
  private readonly entries = new Map<string, Entry>();
  private readonly byProgram = new Map<WebGLProgram, Entry>();
  private tick = 0;
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly maxIdle = DEFAULT_MAX_IDLE,
  ) {}

  /** Returns a ready program for these sources and counts one more user. Pair with `release`. */
  acquire(vertSrc: string, fragSrc: string, name = 'program'): WebGLProgram {
    const key = keyOf(vertSrc, fragSrc);
    let entry = this.live(key);
    if (entry) {
      this.hits++;
    } else {
      this.misses++;
      entry = this.add(key, name, vertSrc, fragSrc);
    }
    this.settle(entry);
    entry.refs++;
    entry.lastUsed = ++this.tick;
    return entry.program;
  }

  /** One user is done with the program. The program stays cached for reuse. */
  release(program: WebGLProgram): void {
    const entry = this.byProgram.get(program);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    this.evictIdle();
  }

  /** Starts compiling in the background. Does nothing if the program is already cached. */
  prewarm(vertSrc: string, fragSrc: string, name = 'program'): void {
    const key = keyOf(vertSrc, fragSrc);
    if (this.live(key)) return;
    this.misses++;
    const entry = this.add(key, name, vertSrc, fragSrc);
    entry.lastUsed = ++this.tick;
    // Without the extension nothing can run in the background, so finish now rather than on first use.
    if (entry.pending && isProgramComplete(this.gl, entry.pending)) {
      try {
        this.settle(entry);
      } catch {
        // A broken shader surfaces when a scene asks for it with `acquire`, not here.
      }
    }
    this.evictIdle();
  }

  /** True when `acquire` for these sources would not wait on the driver. */
  isReady(vertSrc: string, fragSrc: string): boolean {
    const entry = this.live(keyOf(vertSrc, fragSrc));
    if (!entry) return false;
    return !entry.pending || isProgramComplete(this.gl, entry.pending);
  }

  stats(): ProgramCacheStats {
    return { entries: this.entries.size, hits: this.hits, misses: this.misses };
  }

  /** Deletes every program. Used on teardown, not after context loss (the objects are already dead). */
  clear(): void {
    for (const entry of this.entries.values()) this.destroy(entry);
    this.entries.clear();
    this.byProgram.clear();
  }

  /** The entry for a key, or null if missing or dead (its program was lost with the old context). */
  private live(key: string): Entry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (!this.gl.isProgram(entry.program)) {
      this.entries.delete(key);
      this.byProgram.delete(entry.program);
      return null;
    }
    return entry;
  }

  private add(key: string, name: string, vertSrc: string, fragSrc: string): Entry {
    const pending = startProgram(this.gl, vertSrc, fragSrc, name);
    const entry: Entry = { key, name, pending, program: pending.program, refs: 0, lastUsed: ++this.tick };
    this.entries.set(key, entry);
    this.byProgram.set(entry.program, entry);
    return entry;
  }

  /** Reads the final status of a started program. On failure the entry is removed and the error thrown. */
  private settle(entry: Entry): void {
    if (!entry.pending) return;
    const pending = entry.pending;
    try {
      finishProgram(this.gl, pending);
      entry.pending = null;
    } catch (err) {
      this.entries.delete(entry.key);
      this.byProgram.delete(entry.program);
      throw err;
    }
  }

  private evictIdle(): void {
    const idle: Entry[] = [];
    for (const e of this.entries.values()) if (e.refs === 0) idle.push(e);
    if (idle.length <= this.maxIdle) return;
    idle.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const e of idle.slice(0, idle.length - this.maxIdle)) {
      this.destroy(e);
      this.entries.delete(e.key);
      this.byProgram.delete(e.program);
    }
  }

  private destroy(entry: Entry): void {
    this.gl.deleteProgram(entry.program);
  }
}

const caches = new WeakMap<WebGL2RenderingContext, ProgramCache>();

/** The shared cache for a context. */
export function getProgramCache(gl: WebGL2RenderingContext): ProgramCache {
  let cache = caches.get(gl);
  if (!cache) {
    cache = new ProgramCache(gl);
    caches.set(gl, cache);
  }
  return cache;
}
