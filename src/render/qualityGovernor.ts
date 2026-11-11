// Automatic resolution scaling (Stage 16, Slice 16.6). Pure logic, no DOM and no GL.
//
// It watches how long frames take and moves a render scale (0.25 to 1) down when frames run long and back
// up when there has been headroom for a while. The scale is applied by gl/size.ts (`setAutoScale`); the
// owner's Render quality choice stays a ceiling because the scale in use is the smaller of the two.
//
// Down: after about 1.5 seconds in which a large share of frames were long, step down one notch at once.
// Up:   after a long calm spell (6 seconds to start), step up one notch. If a step up is followed by a step
//       down within 10 seconds, the spell required before the next step up doubles (up to 60 seconds), so
//       the scale does not bounce between two levels. A calm spell of 60 seconds shortens it again.
//
// The first scale depends on the device tier (phone, integrated-graphics laptop, desktop).

export type DeviceTier = 'phone' | 'integrated' | 'desktop';

export interface TierSettings {
  tier: DeviceTier;
  /** Scale used from the first frame. */
  startScale: number;
  /** The governor never goes below this. */
  minScale: number;
}

/**
 * Per-tier starting points. A phone starts at 0.6, which on a 3x phone screen is a render density of about 1.8
 * device pixels per screen point (the roadmap asks for a 1 to 1.5 pixel ratio cap; the canvas itself is sized in
 * gl/size.ts and the scale brings the work down to that range).
 */
export const TIER_SETTINGS: Record<DeviceTier, TierSettings> = {
  phone: { tier: 'phone', startScale: 0.6, minScale: 0.4 },
  integrated: { tier: 'integrated', startScale: 0.8, minScale: 0.5 },
  desktop: { tier: 'desktop', startScale: 1, minScale: 0.5 },
};

export interface DeviceInfo {
  userAgent: string;
  maxTouchPoints: number;
  /** Shorter side of the screen in CSS pixels. */
  screenShortSide: number;
  /** Unmasked GPU name, or an empty string if the browser hides it. */
  renderer: string;
}

/** Integrated or software graphics: weak for this kind of work. Discrete Intel Arc is not matched. */
const INTEGRATED_GPU = /intel\(r\)\s*(uhd|hd|iris)|intel.*(uhd graphics|hd graphics|iris)|mali|adreno|powervr|videocore|llvmpipe|swiftshader|microsoft basic render/i;
const PHONE_UA = /android|iphone|ipod|mobile/i;

/** Picks a device tier. Phones by user agent or a small touch screen; integrated GPUs by name; else desktop. */
export function detectTier(info: DeviceInfo): DeviceTier {
  const touchSmall = info.maxTouchPoints > 1 && info.screenShortSide > 0 && info.screenShortSide <= 820;
  if (PHONE_UA.test(info.userAgent) || touchSmall) return 'phone';
  if (INTEGRATED_GPU.test(info.renderer)) return 'integrated';
  return 'desktop';
}

export interface GovernorOptions {
  /** A frame longer than this counts as long. */
  longFrameMs: number;
  /** Length of the window used to decide a step down. */
  downWindowSec: number;
  /** Share of long frames in the window that triggers a step down (0..1). */
  downShare: number;
  /** Share of long frames at or below which a moment counts as calm (0..1). */
  calmShare: number;
  /** Calm time needed before the first step up. */
  upAfterSec: number;
  /** Longest calm time ever required. */
  maxUpAfterSec: number;
  /** A step down this soon after a step up counts as bouncing. */
  bounceSec: number;
  /** Size of one step. */
  step: number;
  /** Frames longer than this are ignored (tab switch, debugger): not a load signal. */
  ignoreAboveMs: number;
  /** Minimum time between two step downs. */
  downCooldownSec: number;
}

export const DEFAULT_GOVERNOR: GovernorOptions = {
  longFrameMs: 25,
  downWindowSec: 1.5,
  downShare: 0.4,
  calmShare: 0.02,
  upAfterSec: 6,
  maxUpAfterSec: 60,
  bounceSec: 10,
  step: 0.1,
  ignoreAboveMs: 500,
  downCooldownSec: 2,
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export class QualityGovernor {
  private readonly opts: GovernorOptions;
  private settings: TierSettings;
  private current: number;
  // Recent frames, oldest first, inside the decision window.
  private readonly window: { ms: number; long: boolean }[] = [];
  private windowMs = 0;
  private windowLong = 0;
  private calmSec = 0;
  private sinceChangeSec = Infinity;
  private sinceDownSec = Infinity;
  private requiredCalmSec: number;
  private lastChange: 'up' | 'down' | null = null;

  constructor(tier: TierSettings = TIER_SETTINGS.desktop, opts: Partial<GovernorOptions> = {}) {
    this.opts = { ...DEFAULT_GOVERNOR, ...opts };
    this.settings = tier;
    this.current = round2(tier.startScale);
    this.requiredCalmSec = this.opts.upAfterSec;
  }

  get scale(): number {
    return this.current;
  }

  get tier(): DeviceTier {
    return this.settings.tier;
  }

  /** Seconds of calm needed before the next step up (grows when the scale bounces). */
  get upAfterSec(): number {
    return this.requiredCalmSec;
  }

  /** Switch tier (for example after the GPU name becomes known). Restarts from that tier's starting scale. */
  setTier(tier: TierSettings): void {
    this.settings = tier;
    this.current = round2(tier.startScale);
    this.resetWindow();
    this.requiredCalmSec = this.opts.upAfterSec;
    this.lastChange = null;
  }

  /**
   * Records one frame time in ms. Returns the new scale if it changed on this frame, else null.
   * Non-finite, negative and huge (tab switch) values are ignored.
   */
  push(frameMs: number): number | null {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > this.opts.ignoreAboveMs) return null;
    const sec = frameMs / 1000;
    this.sinceChangeSec += sec;
    this.sinceDownSec += sec;

    const long = frameMs > this.opts.longFrameMs;
    this.window.push({ ms: frameMs, long });
    this.windowMs += frameMs;
    if (long) this.windowLong++;
    while (this.window.length > 1 && this.windowMs - this.window[0]!.ms >= this.opts.downWindowSec * 1000) {
      const old = this.window.shift()!;
      this.windowMs -= old.ms;
      if (old.long) this.windowLong--;
    }
    const full = this.windowMs >= this.opts.downWindowSec * 1000 * 0.9;
    const share = this.window.length > 0 ? this.windowLong / this.window.length : 0;

    // Calm time only counts while recent frames are healthy.
    if (long || (full && share > this.opts.calmShare)) this.calmSec = 0;
    else this.calmSec += sec;

    if (full && share >= this.opts.downShare && this.sinceDownSec >= this.opts.downCooldownSec) {
      return this.stepDown();
    }
    if (this.calmSec >= this.requiredCalmSec && this.current < 1) return this.stepUp();
    // A long spell of calm earns back a shorter wait.
    if (this.calmSec >= this.opts.maxUpAfterSec && this.requiredCalmSec > this.opts.upAfterSec) {
      this.requiredCalmSec = this.opts.upAfterSec;
    }
    return null;
  }

  private stepDown(): number | null {
    const next = round2(Math.max(this.settings.minScale, this.current - this.opts.step));
    if (this.lastChange === 'up' && this.sinceChangeSec < this.opts.bounceSec) {
      this.requiredCalmSec = Math.min(this.opts.maxUpAfterSec, this.requiredCalmSec * 2);
    }
    this.sinceDownSec = 0;
    this.resetWindow();
    if (next === this.current) return null;
    this.current = next;
    this.lastChange = 'down';
    this.sinceChangeSec = 0;
    return next;
  }

  private stepUp(): number | null {
    const next = round2(Math.min(1, this.current + this.opts.step));
    this.resetWindow();
    if (next === this.current) return null;
    this.current = next;
    this.lastChange = 'up';
    this.sinceChangeSec = 0;
    return next;
  }

  private resetWindow(): void {
    this.window.length = 0;
    this.windowMs = 0;
    this.windowLong = 0;
    this.calmSec = 0;
  }
}
