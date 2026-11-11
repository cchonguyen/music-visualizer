// Tempo tracker (Slice 17.2). Watches the short-window onsets, estimates a tempo from the gaps between them
// over the last few seconds, and keeps a beat count and a bar position.
//
// Method: every pair of recent onsets within a small lookback votes for the tempo that gap implies (inter-onset
// histogram, 1 BPM bins, 60..180 BPM). A gap that is two beats long also supports the half tempo, so it counts
// at half weight. Confidence is how much of the vote sits on the winning tempo (or its half and double), scaled
// down while there are few onsets. No randomness: the same onsets always give the same result.
//
// When confidence is low there is no usable grid, so the count simply counts detected onsets. That is the
// fallback "every N beats" reactions rely on.

export const MIN_BPM = 60;
export const MAX_BPM = 180;
export const BEATS_PER_BAR = 4;
export const TEMPO_WINDOW_SEC = 10;
/** Confidence needed before the beat grid is trusted over raw onset counting. */
export const LOCK_CONFIDENCE = 0.5;

const MAX_ONSETS = 48;
const LOOKBACK = 6;
const MIN_ONSETS_FOR_CONFIDENCE = 8;
const BIN_COUNT = MAX_BPM - MIN_BPM + 1;
// An onset counts as "on the beat" when it lands this close to the predicted time (fraction of a beat).
const SNAP_TOLERANCE = 0.2;
// Silence for this many beats (and at least 2 s) drops the lock.
const LOST_BEATS = 3;
const LOST_MIN_SEC = 2;
// Gaps longer than this mean a source change or a hidden tab; start over.
const MAX_GAP_SEC = 3;

export interface TempoState {
  /** Estimated tempo, 0 until there are enough onsets. */
  bpm: number;
  /** 0..1, how much the recent onsets agree on one tempo. */
  confidence: number;
  /** Beats counted so far. Grid beats when locked, detected onsets otherwise. */
  beatCount: number;
  /** True only on the frame the count went up. */
  beatTick: boolean;
  /** 0..1 through the current beat. */
  beatPhase: number;
  /** 0..1 through the current bar of BEATS_PER_BAR beats. */
  barPhase: number;
}

export class TempoTracker {
  private readonly onsetTimes = new Float64Array(MAX_ONSETS);
  private readonly onsetWeights = new Float64Array(MAX_ONSETS);
  private onsetCount = 0;
  private readonly histogram = new Float64Array(BIN_COUNT);

  private lastTime: number | null = null;
  private lastOnsetTime = -Infinity;
  private lastBeatTime = 0;
  private locked = false;
  private readonly state: TempoState = {
    bpm: 0,
    confidence: 0,
    beatCount: 0,
    beatTick: false,
    beatPhase: 0,
    barPhase: 0,
  };

  /** Advance to `timeSec`. The returned object is reused; do not keep it. */
  step(timeSec: number, onset: boolean, strength = 1): Readonly<TempoState> {
    const s = this.state;
    s.beatTick = false;

    if (this.lastTime !== null && (timeSec < this.lastTime || timeSec - this.lastTime > MAX_GAP_SEC)) {
      this.restart();
    }
    this.lastTime = timeSec;

    if (onset) {
      this.addOnset(timeSec, strength);
      this.lastOnsetTime = timeSec;
      this.estimate(timeSec);
    }

    // Silence loses the lock: no onset for a few beats means the grid is a guess.
    if (s.bpm > 0) {
      const lostAfter = Math.max(LOST_MIN_SEC, (LOST_BEATS * 60) / s.bpm);
      if (timeSec - this.lastOnsetTime > lostAfter) {
        s.confidence = 0;
        s.bpm = 0;
        this.onsetCount = 0;
      }
    }

    const nowLocked = s.confidence >= LOCK_CONFIDENCE && s.bpm > 0;
    if (nowLocked && !this.locked) {
      // Start the grid at the most recent onset so the count carries on from where it was.
      this.lastBeatTime = this.lastOnsetTime;
    }
    const justLocked = nowLocked && !this.locked;
    this.locked = nowLocked;

    if (justLocked && onset) {
      // The onset that earned the lock is still a beat; the grid starts from it.
      s.beatCount += 1;
      s.beatTick = true;
    } else if (this.locked) {
      this.followGrid(timeSec, onset);
    } else if (onset) {
      s.beatCount += 1;
      s.beatTick = true;
      this.lastBeatTime = timeSec;
    }

    const period = this.locked ? 60 / s.bpm : 0.5;
    const phase = (timeSec - this.lastBeatTime) / period;
    s.beatPhase = phase < 0 ? 0 : phase > 1 ? 1 : phase;
    s.barPhase = ((s.beatCount % BEATS_PER_BAR) + s.beatPhase) / BEATS_PER_BAR;
    return s;
  }

  reset(): void {
    this.restart();
    this.lastTime = null;
    this.lastOnsetTime = -Infinity;
    this.lastBeatTime = 0;
    const s = this.state;
    s.beatCount = 0;
    s.beatTick = false;
    s.beatPhase = 0;
    s.barPhase = 0;
  }

  private restart(): void {
    this.onsetCount = 0;
    this.locked = false;
    this.state.bpm = 0;
    this.state.confidence = 0;
  }

  private followGrid(timeSec: number, onset: boolean): void {
    const s = this.state;
    const period = 60 / s.bpm;
    const next = this.lastBeatTime + period;
    if (onset && Math.abs(timeSec - next) <= SNAP_TOLERANCE * period) {
      // An onset near the predicted beat is that beat. Nudge the grid halfway toward it so it tracks drift.
      this.lastBeatTime = next + 0.5 * (timeSec - next);
      s.beatCount += 1;
      s.beatTick = true;
    } else if (timeSec > next + SNAP_TOLERANCE * period) {
      // The beat was due and no onset came (a dropped or masked kick): the grid keeps time.
      this.lastBeatTime = next;
      s.beatCount += 1;
      s.beatTick = true;
    }
  }

  private addOnset(timeSec: number, strength: number): void {
    // Drop onsets that fell out of the window (the buffer is in time order).
    let drop = 0;
    while (drop < this.onsetCount && timeSec - (this.onsetTimes[drop] ?? 0) > TEMPO_WINDOW_SEC) drop += 1;
    if (drop > 0) {
      this.onsetTimes.copyWithin(0, drop, this.onsetCount);
      this.onsetWeights.copyWithin(0, drop, this.onsetCount);
      this.onsetCount -= drop;
    }
    if (this.onsetCount === MAX_ONSETS) {
      this.onsetTimes.copyWithin(0, 1, MAX_ONSETS);
      this.onsetWeights.copyWithin(0, 1, MAX_ONSETS);
      this.onsetCount -= 1;
    }
    this.onsetTimes[this.onsetCount] = timeSec;
    this.onsetWeights[this.onsetCount] = 0.5 + 0.5 * (strength < 0 ? 0 : strength > 1 ? 1 : strength);
    this.onsetCount += 1;
  }

  private estimate(timeSec: number): void {
    const s = this.state;
    const n = this.onsetCount;
    if (n < 3) {
      s.bpm = 0;
      s.confidence = 0;
      return;
    }
    const hist = this.histogram;
    hist.fill(0);
    let total = 0;
    for (let j = 1; j < n; j += 1) {
      const tj = this.onsetTimes[j] ?? 0;
      // Newer onsets count more, so a tempo change is picked up within a few bars.
      const recency = 1 - 0.5 * ((timeSec - tj) / TEMPO_WINDOW_SEC);
      for (let k = 1; k <= LOOKBACK && j - k >= 0; k += 1) {
        const gap = tj - (this.onsetTimes[j - k] ?? 0);
        if (gap <= 0) continue;
        const bpm = 60 / gap;
        if (bpm < MIN_BPM - 2 || bpm > MAX_BPM + 2) continue;
        const w = (this.onsetWeights[j] ?? 1) * recency * (k === 1 ? 1 : 0.5 / k);
        // Spread each vote over three bins so a little timing jitter still lands on one peak.
        const centre = Math.round(bpm) - MIN_BPM;
        for (let d = -1; d <= 1; d += 1) {
          const bin = centre + d;
          if (bin < 0 || bin >= BIN_COUNT) continue;
          const spread = d === 0 ? 1 : 0.5;
          hist[bin] = (hist[bin] ?? 0) + w * spread;
          total += w * spread;
        }
      }
    }
    if (total <= 0) {
      s.bpm = 0;
      s.confidence = 0;
      return;
    }
    let best = 0;
    for (let i = 1; i < BIN_COUNT; i += 1) if ((hist[i] ?? 0) > (hist[best] ?? 0)) best = i;
    // Refine with the weighted mean of the peak's neighbours (sub-BPM resolution).
    let num = 0;
    let den = 0;
    for (let d = -2; d <= 2; d += 1) {
      const bin = best + d;
      if (bin < 0 || bin >= BIN_COUNT) continue;
      num += (hist[bin] ?? 0) * (bin + MIN_BPM);
      den += hist[bin] ?? 0;
    }
    const bpm = den > 0 ? num / den : best + MIN_BPM;

    const support =
      this.mass(bpm, 0.04) + 0.75 * this.mass(bpm / 2, 0.04) + 0.75 * this.mass(bpm * 2, 0.04);
    const few = Math.min(1, n / MIN_ONSETS_FOR_CONFIDENCE);
    const fewOnsets = few * few; // five onsets can never lock; a steady eight or more can
    const conf = Math.min(1, support / total) * fewOnsets;
    s.bpm = bpm;
    s.confidence = conf;
  }

  /** Histogram mass within +-`frac` of `bpm` (0 outside the supported range). */
  private mass(bpm: number, frac: number): number {
    if (bpm < MIN_BPM || bpm > MAX_BPM) return 0;
    const lo = Math.max(0, Math.floor(bpm * (1 - frac)) - MIN_BPM);
    const hi = Math.min(BIN_COUNT - 1, Math.ceil(bpm * (1 + frac)) - MIN_BPM);
    let m = 0;
    for (let i = lo; i <= hi; i += 1) m += this.histogram[i] ?? 0;
    return m;
  }
}
